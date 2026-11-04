const DIRECTORY_NAME = 'elsemesh-local-region-cache-v1';
const MAX_CACHE_BYTES = 42 * 1024 * 1024 * 1024;
const MIN_STORAGE_RESERVE_BYTES = 512 * 1024 * 1024;
const MAX_PENDING_WRITE_BYTES = 768 * 1024 * 1024;
const INDEX_RECONCILE_MS = 5 * 60 * 1000;
const RECENCY_WRITE_INTERVAL_MS = 30 * 1000;
const CACHE_SCHEMA = 1;
const DIGEST = /^[0-9a-f]{64}$/;

async function sha256Hex( value ) {
	const digest = await globalThis.crypto.subtle.digest( 'SHA-256', value );
	return [ ...new Uint8Array( digest ) ].map( byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

async function writeFile( directory, name, contents ) {
	const handle = await directory.getFileHandle( name, { create: true } );
	const writable = await handle.createWritable();
	try {
		await writable.write( contents );
		await writable.close();
	} catch ( error ) {
		try { await writable.abort(); } catch { /* The file can be removed by the caller. */ }
		throw error;
	}
}

export class LocalRegionDiskCache {
	static async open( { worldId, sourceRevision, onError = () => {}, onMetric = () => {} } ) {
		const storage = globalThis.navigator?.storage;
		if ( ! globalThis.crypto?.subtle || typeof storage?.getDirectory !== 'function' ) return null;
		try {
			const root = await storage.getDirectory();
			const directory = await root.getDirectoryHandle( DIRECTORY_NAME, { create: true } );
			const cache = new LocalRegionDiskCache( { directory, storage, worldId, sourceRevision, onError, onMetric } );
			cache.ready = cache.#exclusive( async () => {
				await cache.#indexExistingEntries();
				await cache.#refreshBudget();
			} ).catch( error => onError( error ) );
			return cache;
		} catch ( error ) {
			onError( error );
			return null;
		}
	}

	constructor( { directory, storage, worldId, sourceRevision, onError, onMetric } ) {
		this.directory = directory;
		this.storage = storage;
		this.scope = `${worldId}\0${sourceRevision}`;
		this.onError = onError;
		this.onMetric = onMetric;
		this.entries = new Map();
		this.cachedBytes = 0;
		this.budgetBytes = MAX_CACHE_BYTES;
		this.nextEstimateAt = 0;
		this.nextIndexAt = 0;
		this.lastUsed = 0;
		this.queue = Promise.resolve();
		this.pendingWriteBytes = 0;
		this.lockName = 'elsemesh-local-region-cache-v1';
		this.ready = Promise.resolve();
	}

	async #exclusive( operation ) {
		const run = () => {
			const locks = globalThis.navigator?.locks;
			return typeof locks?.request === 'function' ? locks.request( this.lockName, { mode: 'exclusive' }, operation ) : operation();
		};
		const result = this.queue.then( run, run );
		this.queue = result.catch( () => {} );
		return result;
	}

	async #indexExistingEntries() {
		const startedAt = performance.now();
		this.entries.clear();
		this.cachedBytes = 0;
		const dataFiles = new Set();
		for await ( const [ name ] of this.directory.entries() ) {
			if ( name.endsWith( '.bin' ) ) {
				dataFiles.add( name.slice( 0, - 4 ) );
				continue;
			}
			if ( ! name.endsWith( '.meta' ) ) continue;
			const id = name.slice( 0, - 5 );
			try {
				const handle = await this.directory.getFileHandle( name );
				const metadata = JSON.parse( await ( await handle.getFile() ).text() );
				if ( metadata?.schema !== CACHE_SCHEMA || metadata.id !== id || ! Number.isSafeInteger( metadata.bytes ) || metadata.bytes < 0 || !( metadata.digest === null || DIGEST.test( metadata.digest || '' ) ) || ! Number.isFinite( metadata.lastUsed ) ) throw new Error( 'Invalid local region cache metadata' );
				if ( ! dataFiles.has( id ) ) throw new Error( 'Local region cache data file is missing' );
				this.entries.set( id, metadata );
				this.cachedBytes += metadata.bytes;
				this.lastUsed = Math.max( this.lastUsed, metadata.lastUsed );
			} catch {
				await this.#removeFiles( id );
			}
		}
		for ( const id of dataFiles ) if ( ! this.entries.has( id ) ) await this.#removeFiles( id );
		this.nextIndexAt = Date.now() + INDEX_RECONCILE_MS;
		this.onMetric( { operation: 'index', entries: this.entries.size, bytes: this.cachedBytes, elapsedMs: performance.now() - startedAt } );
	}

	async #refreshBudget( force = false ) {
		if ( ! force && Date.now() < this.nextEstimateAt ) return;
		this.nextEstimateAt = Date.now() + 30000;
		try {
			const estimate = await this.storage.estimate();
			if ( Number.isFinite( estimate?.quota ) && Number.isFinite( estimate?.usage ) ) {
				const availableIncludingCache = Math.max( 0, estimate.quota - estimate.usage + this.cachedBytes );
				const reserve = Math.max( MIN_STORAGE_RESERVE_BYTES, estimate.quota * 0.1 );
				this.budgetBytes = Math.min( MAX_CACHE_BYTES, Math.max( 0, availableIncludingCache - reserve ) );
			}
		} catch ( error ) {
			this.onError( error );
		}
	}

	async #idFor( assetId ) {
		return sha256Hex( new TextEncoder().encode( `${this.scope}\0${assetId}` ) );
	}

	async get( assetId ) {
		const id = await this.#idFor( assetId );
		let metadata;
		try {
			const metaHandle = await this.directory.getFileHandle( `${id}.meta` );
			metadata = JSON.parse( await ( await metaHandle.getFile() ).text() );
			if ( metadata?.schema !== CACHE_SCHEMA || metadata.id !== id || ! Number.isSafeInteger( metadata.bytes ) || metadata.bytes < 0 || !( metadata.digest === null || DIGEST.test( metadata.digest || '' ) ) || ! Number.isFinite( metadata.lastUsed ) ) throw new Error( 'Invalid local region cache metadata' );
		} catch ( error ) {
			if ( error?.name !== 'NotFoundError' ) this.onError( error );
			await this.#removeEntry( id );
			return null;
		}
		try {
			const handle = await this.directory.getFileHandle( `${id}.bin` );
			const bytes = new Uint8Array( await ( await handle.getFile() ).arrayBuffer() );
			if ( bytes.byteLength !== metadata.bytes || metadata.digest !== null && await sha256Hex( bytes ) !== metadata.digest ) throw new Error( 'Local region cache digest mismatch' );
			const indexed = this.entries.get( id );
			const indexedLastUsed = indexed?.lastUsed || 0;
			const previousLastUsed = Math.max( metadata.lastUsed, indexedLastUsed );
			const persistRecency = Date.now() - previousLastUsed >= RECENCY_WRITE_INTERVAL_MS;
			metadata.lastUsed = persistRecency ? this.#nextLastUsed( previousLastUsed ) : previousLastUsed;
			if ( indexed ) indexed.lastUsed = metadata.lastUsed;
			else {
				this.entries.set( id, metadata );
				this.cachedBytes += metadata.bytes;
			}
			if ( persistRecency ) void this.#exclusive( () => this.#writeMetadata( metadata ) ).catch( error => this.onError( error ) );
			return bytes;
		} catch ( error ) {
			this.onError( error );
			await this.#removeEntry( id );
			return null;
		}
	}

	async touch( assetId ) {
		try {
			await this.ready;
			return await this.#exclusive( async () => {
				const id = await this.#idFor( assetId );
				let metadata = this.entries.get( id );
				if ( ! metadata ) return false;
				// RAM hits also count as demand for the disk LRU. Persist at most once
				// per 30 seconds per entry to avoid turning hot reads into OPFS writes.
				if ( Date.now() - metadata.lastUsed < 30000 ) return true;
				try {
					const handle = await this.directory.getFileHandle( `${id}.meta` );
					metadata = JSON.parse( await ( await handle.getFile() ).text() );
					if ( metadata?.schema !== CACHE_SCHEMA || metadata.id !== id || ! Number.isSafeInteger( metadata.bytes ) || metadata.bytes < 0 || !( metadata.digest === null || DIGEST.test( metadata.digest || '' ) ) || ! Number.isFinite( metadata.lastUsed ) ) throw new Error( 'Invalid local region cache metadata' );
					metadata.lastUsed = this.#nextLastUsed( metadata.lastUsed );
					await this.#writeMetadata( metadata );
					this.entries.set( id, metadata );
					return true;
				} catch ( error ) {
					this.onError( error );
					await this.#removeEntry( id );
					return false;
				}
			} );
		} catch ( error ) {
			this.onError( error );
			return false;
		}
	}

	async put( assetId, bytes, digest ) {
		return this.putMany( [ { assetId, bytes, digest } ] );
	}

	async putMany( entries ) {
		if ( ! Array.isArray( entries ) || entries.length === 0 ) return true;
		const totalBytes = entries.reduce( ( total, entry ) => total + ( entry?.bytes?.byteLength || 0 ), 0 );
		if ( ! Number.isSafeInteger( totalBytes ) || totalBytes > MAX_PENDING_WRITE_BYTES || this.pendingWriteBytes + totalBytes > MAX_PENDING_WRITE_BYTES
			|| entries.some( entry => typeof entry?.assetId !== 'string' || !( entry.bytes instanceof Uint8Array ) || !( entry.digest === null || DIGEST.test( entry.digest || '' ) ) ) ) return false;
		this.pendingWriteBytes += totalBytes;
		try {
			await this.ready;
			return await this.#exclusive( async () => {
				if ( Date.now() >= this.nextIndexAt ) await this.#indexExistingEntries();
				await this.#refreshBudget();
				let storedAll = true;
				for ( const { assetId, bytes, digest } of entries ) {
					if ( bytes.byteLength > MAX_CACHE_BYTES || bytes.byteLength > this.budgetBytes ) {
						storedAll = false;
						continue;
					}
					const id = await this.#idFor( assetId );
					const existing = this.entries.get( id );
					await this.#evictTo( Math.max( 0, this.budgetBytes - bytes.byteLength + ( existing?.bytes || 0 ) ), id );
					let stored = false;
					for ( let attempts = 0; attempts < 3 && ! stored; attempts ++ ) {
						try {
							await writeFile( this.directory, `${id}.bin`, bytes );
							const metadata = { schema: CACHE_SCHEMA, id, bytes: bytes.byteLength, digest, lastUsed: this.#nextLastUsed( existing?.lastUsed || 0 ) };
							await this.#writeMetadata( metadata );
							this.entries.set( id, metadata );
							this.cachedBytes = this.cachedBytes - ( existing?.bytes || 0 ) + bytes.byteLength;
							stored = true;
						} catch ( error ) {
							this.onError( error );
							await this.#removeEntry( id );
							if ( ! await this.#evictOldest( id ) ) break;
							await this.#refreshBudget( true );
						}
					}
					storedAll &&= stored;
				}
				return storedAll;
			} );
		} finally {
			this.pendingWriteBytes = Math.max( 0, this.pendingWriteBytes - totalBytes );
		}
	}

	async #writeMetadata( metadata ) {
		await writeFile( this.directory, `${metadata.id}.meta`, JSON.stringify( metadata ) );
	}

	#nextLastUsed( previous ) {
		this.lastUsed = Math.max( Date.now(), this.lastUsed + 1, previous + 1 );
		return this.lastUsed;
	}

	async #evictTo( targetBytes, preserveId = '' ) {
		while ( this.cachedBytes > targetBytes ) {
			if ( ! await this.#evictOldest( preserveId ) ) break;
		}
	}

	async #evictOldest( preserveId = '' ) {
		const oldest = [ ...this.entries.entries() ]
			.filter( ( [ id ] ) => id !== preserveId )
			.sort( ( a, b ) => a[ 1 ].lastUsed - b[ 1 ].lastUsed )[ 0 ];
		if ( ! oldest ) return false;
		await this.#removeEntry( oldest[ 0 ] );
		return true;
	}

	async #removeFiles( id ) {
		for ( const suffix of [ '.bin', '.meta' ] ) {
			try { await this.directory.removeEntry( `${id}${suffix}` ); } catch { /* Missing or unavailable entries are already evicted. */ }
		}
	}

	async #removeEntry( id ) {
		const metadata = this.entries.get( id );
		await this.#removeFiles( id );
		if ( metadata ) {
			this.entries.delete( id );
			this.cachedBytes = Math.max( 0, this.cachedBytes - metadata.bytes );
		}
	}
}
