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

function smoothstep( start, end, value ) {
	const amount = Math.max( 0, Math.min( 1, ( value - start ) / ( end - start ) ) );
	return amount * amount * ( 3 - 2 * amount );
}

/** Shared dynamic-instance LOD, visibility, and shadow planning for ground-cover adapters. */
export class GroundCoverFieldDrawPlanner {
	update( instances, camera, renderLoadBias = 0 ) {
		if ( ! Array.isArray( instances ) || ! camera || ! isVector3( camera.position ) || ! Number.isFinite( camera.verticalFovRadians ) || camera.verticalFovRadians <= 0 || camera.verticalFovRadians >= Math.PI || ! Array.isArray( camera.frustumPlanes ) || camera.frustumPlanes.length !== 6 ) throw new Error( 'Invalid ground-cover draw-planner input' );
		if ( ! Number.isInteger( renderLoadBias ) || renderLoadBias < 0 || renderLoadBias > 2 ) throw new Error( `Invalid ground-cover render-load bias: ${renderLoadBias}` );
		const visibleGroups = new Map(), shadowGroups = new Map(), tanHalfFov = Math.tan( camera.verticalFovRadians * 0.5 ), loadScale = 2 ** renderLoadBias;
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
			const [ sx, sy, sz ] = record.scale, [ qx, qy, qz, qw ] = record.rotation;
			const [ localX, localY, localZ ] = record.bounds.center.map( ( value, axis ) => value * [ sx, sy, sz ][ axis ] );
			const tx = 2 * ( qy * localZ - qz * localY ), ty = 2 * ( qz * localX - qx * localZ ), tz = 2 * ( qx * localY - qy * localX );
			const center = [
				record.position[ 0 ] + localX + qw * tx + ( qy * tz - qz * ty ),
				record.position[ 1 ] + localY + qw * ty + ( qz * tx - qx * tz ),
				record.position[ 2 ] + localZ + qw * tz + ( qx * ty - qy * tx ),
			];
			const radius = record.bounds.radius * Math.max( sx, sy, sz );
			const dx = center[ 0 ] - camera.position[ 0 ], dy = center[ 1 ] - camera.position[ 1 ], dz = center[ 2 ] - camera.position[ 2 ];
			const distance = Math.hypot( dx, dy, dz );
			if ( record.castsShadow && distance <= record.shadowMaxDistance ) append( groupsFor( shadowGroups, record )[ 0 ], index, 1, 2, 1, 0 );
			if ( distance > record.drawMaxDistance ) continue;
			let visible = true;
			for ( const plane of planes ) if ( plane[ 0 ] * center[ 0 ] + plane[ 1 ] * center[ 1 ] + plane[ 2 ] * center[ 2 ] + plane[ 3 ] < - radius ) { visible = false; break; }
			if ( ! visible ) continue;

			const projectedRadius = radius / ( Math.max( distance, 1e-6 ) * tanHalfFov );
			const baseMeasure = record.lodMetric === 'projected-radius' ? projectedRadius : distance / Math.max( sx, sy, sz );
			const lodMeasure = record.lodMetric === 'projected-radius' ? baseMeasure / loadScale : baseMeasure * loadScale;
			const drawFade = record.drawFadeStartDistance < record.drawMaxDistance ? 1 - smoothstep( record.drawFadeStartDistance, record.drawMaxDistance, distance ) : 1;
			const drawFadeEnabled = record.drawFadeStartDistance < record.drawMaxDistance ? 1 : 0;
			const groups = groupsFor( visibleGroups, record );
			let transition = - 1;
			for ( let thresholdIndex = 0; thresholdIndex < record.lodThresholds.length; thresholdIndex ++ ) {
				const threshold = record.lodThresholds[ thresholdIndex ];
				const fadeStart = threshold * ( 1 - record.lodFadeFraction );
				if ( record.lodMetric === 'projected-radius' ? lodMeasure < threshold && lodMeasure >= fadeStart : lodMeasure >= threshold && lodMeasure < threshold / ( 1 - record.lodFadeFraction ) ) { transition = thresholdIndex; break; }
			}
			if ( transition >= 0 ) {
				const threshold = record.lodThresholds[ transition ];
				const fadeStart = record.lodMetric === 'projected-radius' ? threshold * ( 1 - record.lodFadeFraction ) : threshold / ( 1 - record.lodFadeFraction );
				const incomingFade = record.lodMetric === 'projected-radius'
					? ( lodMeasure - fadeStart ) / ( threshold - fadeStart )
					: ( fadeStart - lodMeasure ) / ( fadeStart - threshold );
				append( groups[ transition ], index, incomingFade, 0, drawFade, drawFadeEnabled );
				append( groups[ transition + 1 ], index, incomingFade, 1, drawFade, drawFadeEnabled );
			} else {
				let lodIndex = 0;
				while ( lodIndex < record.lodThresholds.length && ( record.lodMetric === 'projected-radius' ? lodMeasure >= record.lodThresholds[ lodIndex ] : lodMeasure < record.lodThresholds[ lodIndex ] ) ) lodIndex ++;
				append( groups[ lodIndex ], index, 1, 2, drawFade, drawFadeEnabled );
			}
		}
		return { visibleGroups, shadowGroups };
	}
}
