let runExtension = null;
let moduleURL = null;
const protocol = 'elsemesh.world-extension/1';

self.addEventListener( 'message', async ( { data } ) => {
	if ( data?.protocol !== protocol ) return;
	if ( data?.type === 'init' ) {
		try {
			const source = String( data.source || '' );
			moduleURL = URL.createObjectURL( new Blob( [ source ], { type: 'text/javascript' } ) );
			const extension = await import( /* @vite-ignore */ moduleURL );
			if ( typeof extension.run !== 'function' ) throw new Error( 'module must export run(event)' );
			runExtension = extension.run;
			self.postMessage( { protocol, type: 'ready' } );
		} catch ( error ) {
			self.postMessage( { protocol, type: 'ready', error: String( error?.message || error ).slice( 0, 240 ) } );
			self.close();
		} finally {
			if ( moduleURL ) URL.revokeObjectURL( moduleURL );
			moduleURL = null;
		}
		return;
	}
	if ( data?.type !== 'run' || ! runExtension ) return;
	try {
		const result = await runExtension( data.event );
		const json = JSON.stringify( result );
		if ( typeof json !== 'string' ) throw new Error( 'run(event) must return a JSON object' );
		if ( new TextEncoder().encode( json ).byteLength > 16 * 1024 ) throw new Error( 'run(event) result exceeds the 16 KiB limit' );
		const parsed = JSON.parse( json );
		if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) throw new Error( 'run(event) must return a JSON object' );
		self.postMessage( { protocol, id: data.id, result: parsed } );
	} catch ( error ) {
		self.postMessage( { protocol, id: data.id, error: String( error?.message || error ).slice( 0, 240 ) } );
	}
} );
