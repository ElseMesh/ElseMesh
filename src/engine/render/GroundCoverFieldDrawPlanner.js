import { writeInstanceDrawDistanceFade, writeInstanceLODSelection, writeTransformedInstanceSphere } from './InstanceDrawPlannerMath.js';

const isVector3 = value => Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite );

function createGroup( speciesId, lodIndex ) {
	return { speciesId, lodIndex, indices: [], fade: [], incoming: [], drawFade: [], drawFadeEnabled: [] };
}

function append( group, index, fade, incoming, drawFade, drawFadeEnabled ) {
	group.indices.push( index );
	group.fade.push( fade );
	group.incoming.push( incoming );
	group.drawFade.push( drawFade );
	group.drawFadeEnabled.push( drawFadeEnabled );
}

/** Shared dynamic-instance LOD, visibility, and shadow planning for ground-cover adapters. */
export class GroundCoverFieldDrawPlanner {
	constructor() {
		this.sphereScratch = new Float64Array( 5 );
		this.lodScratch = new Float64Array( 4 );
		this.fadeScratch = new Float64Array( 2 );
	}

	update( instances, camera, renderLoadBias = 0 ) {
		if ( ! Array.isArray( instances ) || ! camera || ! isVector3( camera.position ) || ! Number.isFinite( camera.verticalFovRadians ) || camera.verticalFovRadians <= 0 || camera.verticalFovRadians >= Math.PI || ! Array.isArray( camera.frustumPlanes ) || camera.frustumPlanes.length !== 6 ) throw new Error( 'Invalid ground-cover draw-planner input' );
		if ( ! Number.isInteger( renderLoadBias ) || renderLoadBias < 0 || renderLoadBias > 2 ) throw new Error( `Invalid ground-cover render-load bias: ${renderLoadBias}` );
		const visibleGroups = new Map(), shadowGroups = new Map(), tanHalfFov = Math.tan( camera.verticalFovRadians * 0.5 );
		const groupsFor = ( map, record ) => {
			let groups = map.get( record.speciesId );
			if ( ! groups ) {
				groups = record.modelAssetIds.map( ( _assetId, lodIndex ) => createGroup( record.speciesId, lodIndex ) );
				map.set( record.speciesId, groups );
			}
			return groups;
		};
		const planes = camera.frustumPlanes.map( plane => {
			if ( ! Array.isArray( plane ) || plane.length !== 4 || ! plane.every( Number.isFinite ) ) throw new Error( 'Invalid ground-cover frustum plane' );
			const length = Math.hypot( plane[ 0 ], plane[ 1 ], plane[ 2 ] );
			if ( length < 1e-8 ) {
				if ( plane[ 3 ] <= 0 ) throw new Error( 'Ground-cover frustum plane has a zero normal' );
				return [ 0, 0, 0, 1 ];
			}
			return plane.map( value => value / length );
		} );

		for ( let index = 0; index < instances.length; index ++ ) {
			const record = instances[ index ];
			if ( ! record || ! isVector3( record.position ) || ! isVector3( record.scale ) || ! Array.isArray( record.rotation ) || record.rotation.length !== 4 || ! record.rotation.every( Number.isFinite ) || ! record.bounds || ! isVector3( record.bounds.center ) || ! Number.isFinite( record.bounds.radius ) || record.bounds.radius <= 0 ) throw new Error( 'Invalid ground-cover instance record' );
			const sphere = writeTransformedInstanceSphere( this.sphereScratch, record.position, record.rotation, record.scale, record.bounds );
			const [ centerX, centerY, centerZ, radius, maxScale ] = sphere;
			const dx = centerX - camera.position[ 0 ], dy = centerY - camera.position[ 1 ], dz = centerZ - camera.position[ 2 ];
			const distance = Math.hypot( dx, dy, dz );
			if ( record.castsShadow && distance <= record.shadowMaxDistance ) append( groupsFor( shadowGroups, record )[ 0 ], index, 1, 2, 1, 0 );
			if ( distance > record.drawMaxDistance ) continue;
			let visible = true;
			for ( const plane of planes ) if ( plane[ 0 ] * centerX + plane[ 1 ] * centerY + plane[ 2 ] * centerZ + plane[ 3 ] < - radius ) { visible = false; break; }
			if ( ! visible ) continue;

			const fade = writeInstanceDrawDistanceFade( this.fadeScratch, record.drawFadeStartDistance, record.drawMaxDistance, distance );
			const selection = writeInstanceLODSelection( this.lodScratch, record.lodMetric, distance, radius, maxScale, tanHalfFov, record.lodThresholds, record.lodFadeFraction, renderLoadBias );
			const groups = groupsFor( visibleGroups, record );
			const [ lodIndex, transition, incomingFade ] = selection;
			if ( transition >= 0 ) {
				append( groups[ transition ], index, incomingFade, 0, fade[ 0 ], fade[ 1 ] );
				append( groups[ transition + 1 ], index, incomingFade, 1, fade[ 0 ], fade[ 1 ] );
			} else {
				append( groups[ lodIndex ], index, 1, 2, fade[ 0 ], fade[ 1 ] );
			}
		}
		return { visibleGroups, shadowGroups };
	}
}
