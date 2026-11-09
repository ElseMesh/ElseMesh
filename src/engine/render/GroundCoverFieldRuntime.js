import { GroundCoverCellPlanner } from './GroundCoverCellPlanner.js';
import { GroundCoverFieldDrawPlanner } from './GroundCoverFieldDrawPlanner.js';
import { validateGroundCoverField } from '../../network/GroundCoverField.js';
import { compileGroundCoverDensityExpression } from '../../network/GroundCoverDensityExpression.js';
import { bestCandidateBlueNoise } from '../../util/BlueNoise.js';
import { mulberry32 } from '../../util/Noise.js';

function random01( seed, x, z, candidate, salt = 0 ) {

	let value = seed ^ Math.imul( x + 0x9e3779b9, 0x85ebca6b ) ^ Math.imul( z + 0x7f4a7c15, 0xc2b2ae35 ) ^ Math.imul( candidate + 1, 0x27d4eb2f ) ^ Math.imul( salt + 1, 0x165667b1 );
	value = Math.imul( value ^ value >>> 16, 0x7feb352d );
	value = Math.imul( value ^ value >>> 15, 0x846ca68b );
	return ( ( value ^ value >>> 16 ) >>> 0 ) / 0x100000000;

}

function blueNoisePattern( seed, count, size ) {
	return bestCandidateBlueNoise( mulberry32( seed ), count, size );
}

function speciesSalt( id ) {
	let value = 0x811c9dc5;
	for ( let index = 0; index < id.length; index ++ ) value = Math.imul( value ^ id.charCodeAt( index ), 0x01000193 );
	return value >>> 0;
}

function sampleDensity( field, x, z, channel ) {
	const texel = field.size / field.res;
	const fx = ( x - field.origin ) / texel - 0.5, fz = ( z - field.origin ) / texel - 0.5;
	if ( fx < 0 || fz < 0 || fx >= field.res - 1 || fz >= field.res - 1 ) return 0;
	const ix = Math.floor( fx ), iz = Math.floor( fz ), tx = fx - ix, tz = fz - iz;
	const index = ( iz * field.res + ix ) * 4 + channel, row = field.res * 4;
	const top = field.data[ index ] * ( 1 - tx ) + field.data[ index + 4 ] * tx;
	const bottom = field.data[ index + row ] * ( 1 - tx ) + field.data[ index + row + 4 ] * tx;
	return ( top * ( 1 - tz ) + bottom * tz ) / 255;
}

function sampleDensityChannels( field, x, z, channels, target ) {
	for ( const channel of channels ) target[ channel ] = sampleDensity( field, x, z, channel );
	return target;
}

/**
 * Renderer-neutral candidate placement for a signed ground-cover field.
 * Returns plain instance records; backend adapters own meshes, materials, and GPU buffers.
 */
export class GroundCoverFieldRuntime {
	constructor( { data, componentAssets, terrain, density } = {} ) {
		validateGroundCoverField( data, componentAssets );
		if ( ! terrain || ! Number.isInteger( terrain.res ) || terrain.res < 2 || ! Number.isFinite( terrain.size ) || ! Number.isFinite( terrain.origin ) || ! Number.isFinite( terrain.texel ) || ! terrain.heights || terrain.heights.length !== terrain.res * terrain.res || typeof terrain.heightAt !== 'function' ) throw new Error( 'Ground-cover runtime requires a valid renderer-neutral terrain heightfield' );
		if ( ! density || ! Number.isInteger( density.res ) || density.res < 2 || ! Number.isFinite( density.size ) || ! Number.isFinite( density.origin ) || ! ( density.data instanceof Uint8Array ) || density.data.length !== density.res * density.res * 4 || density.size !== terrain.size || density.origin !== terrain.origin ) throw new Error( 'Ground-cover runtime requires a matching decoded density field' );
		this.data = data;
		this.terrain = terrain;
		this.density = density;
		this.species = data.species.map( species => ( { ...species, density: compileGroundCoverDensityExpression( species.densityExpression ), salt: speciesSalt( species.id ) } ) );
		this.densityChannels = [ ...new Set( this.species.flatMap( species => species.density.channels ) ) ];
		this.planner = new GroundCoverCellPlanner( {
			terrain,
			density,
			cellSize: data.cellSize,
			levels: data.distanceBands.map( ( { maxDistance, cellCapacity } ) => ( { maxDistance, capacity: cellCapacity } ) ),
			occupiedThreshold: Math.min( ...data.species.map( species => species.densityThreshold ) ),
			densityChannels: this.densityChannels,
		} );
		this.pattern = blueNoisePattern( data.seed, data.pointsPerCell, data.cellSize );
		this.drawPlanner = new GroundCoverFieldDrawPlanner();
		this.recordsByCell = new Map();
		this.instances = [];
		this.cellOriginScratch = [ 0, 0 ];
		this.densityScratch = new Float64Array( 4 );
		this.disposed = false;
	}

	#recordsForCell( cellIndex ) {
		let records = this.recordsByCell.get( cellIndex );
		if ( records ) return records;
		const [ originX, originZ ] = this.planner.cellOrigin( cellIndex, this.cellOriginScratch );
		const cellX = cellIndex % this.planner.cellsPerSide, cellZ = Math.floor( cellIndex / this.planner.cellsPerSide );
		const rotation = random01( this.data.seed, cellX, cellZ, 0, 31 ) * Math.PI * 2;
		const offsetX = random01( this.data.seed, cellX, cellZ, 0, 32 ) * this.data.cellSize;
		const offsetZ = random01( this.data.seed, cellX, cellZ, 0, 33 ) * this.data.cellSize;
		const cos = Math.cos( rotation ), sin = Math.sin( rotation );
		records = [];
		for ( let candidateIndex = 0; candidateIndex < this.pattern.length; candidateIndex ++ ) {
			const [ px, pz ] = this.pattern[ candidateIndex ];
			const localX = ( px + offsetX ) % this.data.cellSize, localZ = ( pz + offsetZ ) % this.data.cellSize;
			const rotatedX = this.data.cellSize * 0.5 + ( localX - this.data.cellSize * 0.5 ) * cos - ( localZ - this.data.cellSize * 0.5 ) * sin;
			const rotatedZ = this.data.cellSize * 0.5 + ( localX - this.data.cellSize * 0.5 ) * sin + ( localZ - this.data.cellSize * 0.5 ) * cos;
		const x = originX + ( ( rotatedX % this.data.cellSize ) + this.data.cellSize ) % this.data.cellSize;
		const z = originZ + ( ( rotatedZ % this.data.cellSize ) + this.data.cellSize ) % this.data.cellSize;
			const height = this.terrain.heightAt( x, z );
			sampleDensityChannels( this.density, x, z, this.densityChannels, this.densityScratch );
			for ( const species of this.species ) {
				const density = species.density.evaluate( this.densityScratch );
				if ( density * 255 <= species.densityThreshold || random01( this.data.seed, cellX, cellZ, candidateIndex, species.salt + 64 ) >= density ) continue;
				const scaleRandom = random01( this.data.seed, cellX, cellZ, candidateIndex, species.salt + 128 );
				const yaw = random01( this.data.seed, cellX, cellZ, candidateIndex, species.salt + 192 ) * Math.PI * 2;
				const scale = species.scaleRange[ 0 ] + ( species.scaleRange[ 1 ] - species.scaleRange[ 0 ] ) * scaleRandom;
				records.push( {
					speciesId: species.id,
					modelAssetIds: species.modelAssetIds,
					bounds: species.bounds,
					geometryMirrorX: species.geometryMirrorX,
					lodMetric: species.lodMetric,
					lodThresholds: species.lodThresholds,
					lodFadeFraction: species.lodFadeFraction,
					drawMaxDistance: species.drawMaxDistance,
					drawFadeStartDistance: species.drawFadeStartDistance,
					windInfluence: species.windInfluence,
					castsShadow: species.castsShadow,
					shadowMaxDistance: species.shadowMaxDistance,
					cellIndex,
					candidateIndex,
					position: [ x, height, z ],
					rotation: [ 0, Math.sin( yaw * 0.5 ), 0, Math.cos( yaw * 0.5 ) ],
					scale: [ scale, scale, scale ],
					seed: random01( this.data.seed, cellX, cellZ, candidateIndex, species.salt + 256 ),
				} );
			}
		}
		this.recordsByCell.set( cellIndex, records );
		return records;
	}

	update( cameraPosition, isVisible = null ) {
		if ( this.disposed ) throw new Error( 'Ground-cover runtime is disposed' );
		const levels = this.planner.update( cameraPosition, isVisible );
		this.instances.length = 0;
		const activeCells = new Set();
		for ( let lodIndex = 0; lodIndex < levels.length; lodIndex ++ ) {
			const level = levels[ lodIndex ];
			for ( let i = 0; i < level.count; i ++ ) {
				const cellIndex = level.cells[ i ];
				activeCells.add( cellIndex );
				for ( const instance of this.#recordsForCell( cellIndex ) ) {
					instance.cellLodIndex = lodIndex;
					this.instances.push( instance );
				}
			}
		}
		for ( const cellIndex of this.recordsByCell.keys() ) if ( ! activeCells.has( cellIndex ) ) this.recordsByCell.delete( cellIndex );
		return this.instances;
	}

	planDraws( camera, renderLoadBias = 0 ) {
		if ( this.disposed ) throw new Error( 'Ground-cover runtime is disposed' );
		return this.drawPlanner.update( this.instances, camera, renderLoadBias );
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.recordsByCell.clear();
		this.instances.length = 0;
	}
}
