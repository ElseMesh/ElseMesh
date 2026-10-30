import { validateStaticModelInstanceSet, STATIC_MODEL_INSTANCE_LOD_FADE_FRACTION } from '../../network/StaticModelInstanceSet.js';
import { WebGLCoordinateSystem } from '../math/Matrix4.js';

const finiteVector3 = value => Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite );

/** Convert an engine or Three.js perspective camera into the planner's backend-neutral view. */
export function staticModelInstanceCamera( camera ) {
	if ( ! camera?.projectionMatrix?.elements || ! camera?.matrixWorldInverse?.elements || ! camera?.matrixWorld?.elements || typeof camera.getEffectiveFOV !== 'function' ) throw new Error( 'Static model instance camera requires a perspective camera' );
	camera.updateMatrixWorld( true );
	const a = camera.projectionMatrix.elements, b = camera.matrixWorldInverse.elements, viewProjection = new Float64Array( 16 );
	for ( let column = 0; column < 4; column ++ ) for ( let row = 0; row < 4; row ++ ) {
		let value = 0;
		for ( let k = 0; k < 4; k ++ ) value += a[ k * 4 + row ] * b[ column * 4 + k ];
		viewProjection[ column * 4 + row ] = value;
	}
	const row = index => [ viewProjection[ index ], viewProjection[ index + 4 ], viewProjection[ index + 8 ], viewProjection[ index + 12 ] ];
	const r0 = row( 0 ), r1 = row( 1 ), r2 = row( 2 ), r3 = row( 3 );
	const combine = ( left, right, sign ) => left.map( ( value, index ) => value + sign * right[ index ] );
	const near = camera.reversedDepth ? combine( r3, r2, - 1 ) : camera.coordinateSystem === WebGLCoordinateSystem ? combine( r3, r2, 1 ) : r2;
	const far = camera.reversedDepth ? r2 : combine( r3, r2, - 1 );
	const frustumPlanes = [ combine( r3, r0, 1 ), combine( r3, r0, - 1 ), combine( r3, r1, 1 ), combine( r3, r1, - 1 ), near, far ].map( plane => {
		const length = Math.hypot( plane[ 0 ], plane[ 1 ], plane[ 2 ] );
		return length < 1e-8 ? [ 0, 0, 0, 1 ] : plane.map( value => value / length );
	} );
	const world = camera.matrixWorld.elements;
	return { position: [ world[ 12 ], world[ 13 ], world[ 14 ] ], verticalFovRadians: camera.getEffectiveFOV() * Math.PI / 180, frustumPlanes };
}

/** Backend-neutral visibility and LOD selection for a decoded static model instance set. */
export class StaticModelInstanceSetPlanner {
	constructor( document ) {
		this.document = validateStaticModelInstanceSet( document );
		this.groups = [];
		this.shadowGroups = [];
		this._groupsByModel = [];
		this._shadowsByModel = [];
		const modelIndexById = new Map( document.models.map( ( model, index ) => [ model.id, index ] ) );
		const modelInstanceCounts = new Uint32Array( document.models.length );
		this._instanceModelIndices = new Uint16Array( document.instances.length );
		for ( let i = 0; i < document.instances.length; i ++ ) {
			const modelIndex = modelIndexById.get( document.instances[ i ].model );
			this._instanceModelIndices[ i ] = modelIndex;
			modelInstanceCounts[ modelIndex ] ++;
		}
		for ( let modelIndex = 0; modelIndex < document.models.length; modelIndex ++ ) {
			const model = document.models[ modelIndex ];
			const capacity = modelInstanceCounts[ modelIndex ];
			const modelGroups = model.lods.map( ( _lod, lodIndex ) => {
				const group = { modelIndex, modelId: model.id, lodIndex, indices: new Uint32Array( capacity ), fade: new Float32Array( capacity ), incoming: new Uint8Array( capacity ), count: 0 };
				this.groups.push( group );
				return group;
			} );
			this._groupsByModel.push( modelGroups );
			const shadowGroup = { modelIndex, modelId: model.id, lodIndex: model.shadowLod, indices: new Uint32Array( capacity ), count: 0 };
			this.shadowGroups.push( shadowGroup );
			this._shadowsByModel.push( shadowGroup );
		}
		this._normalizedPlanes = new Float64Array( 24 );
	}

	/**
	 * Updates stable output buffers. Camera planes use inward-facing [nx, ny, nz, constant]
	 * coefficients; they are normalized here so sphere radii are in world units.
	 */
	update( camera ) {
		if ( ! camera || ! finiteVector3( camera.position ) || ! Number.isFinite( camera.verticalFovRadians ) || camera.verticalFovRadians <= 0 || camera.verticalFovRadians >= Math.PI || ! Array.isArray( camera.frustumPlanes ) || camera.frustumPlanes.length !== 6 ) throw new Error( 'Invalid static model planner camera' );
		const tanHalfFov = Math.tan( camera.verticalFovRadians * 0.5 );
		for ( let planeIndex = 0; planeIndex < 6; planeIndex ++ ) {
			const plane = camera.frustumPlanes[ planeIndex ];
			if ( ! Array.isArray( plane ) || plane.length !== 4 || ! plane.every( Number.isFinite ) ) throw new Error( 'Invalid static model planner frustum plane' );
			const offset = planeIndex * 4;
			const length = Math.hypot( plane[ 0 ], plane[ 1 ], plane[ 2 ] );
			if ( length < 1e-8 ) {
				if ( plane[ 3 ] <= 0 ) throw new Error( 'Static model planner frustum plane has a zero normal' );
				this._normalizedPlanes[ offset ] = 0;
				this._normalizedPlanes[ offset + 1 ] = 0;
				this._normalizedPlanes[ offset + 2 ] = 0;
				this._normalizedPlanes[ offset + 3 ] = 1;
				continue;
			}
			for ( let axis = 0; axis < 4; axis ++ ) this._normalizedPlanes[ offset + axis ] = plane[ axis ] / length;
			for ( let axis = 0; axis < 4; axis ++ ) this._normalizedPlanes[ offset + axis ] = plane[ axis ] / length;
		}
		for ( const group of this.groups ) group.count = 0;
		for ( const group of this.shadowGroups ) group.count = 0;

		for ( let instanceIndex = 0; instanceIndex < this.document.instances.length; instanceIndex ++ ) {
			const instance = this.document.instances[ instanceIndex ];
			const modelIndex = this._instanceModelIndices[ instanceIndex ];
			const model = this.document.models[ modelIndex ];
			const [ sx, sy, sz ] = instance.scale;
			const [ qx, qy, qz, qw ] = instance.rotation;
			const localX = model.bounds.center[ 0 ] * sx, localY = model.bounds.center[ 1 ] * sy, localZ = model.bounds.center[ 2 ] * sz;
			const tx = 2 * ( qy * localZ - qz * localY ), ty = 2 * ( qz * localX - qx * localZ ), tz = 2 * ( qx * localY - qy * localX );
			const centerX = instance.position[ 0 ] + localX + qw * tx + ( qy * tz - qz * ty );
			const centerY = instance.position[ 1 ] + localY + qw * ty + ( qz * tx - qx * tz );
			const centerZ = instance.position[ 2 ] + localZ + qw * tz + ( qx * ty - qy * tx );
			const radius = model.bounds.radius * Math.max( sx, sy, sz );
			const dx = centerX - camera.position[ 0 ], dy = centerY - camera.position[ 1 ], dz = centerZ - camera.position[ 2 ];
			const distance = Math.hypot( dx, dy, dz );
			if ( distance <= model.shadowMaxDistance ) {
				const shadowGroup = this._shadowsByModel[ modelIndex ];
				shadowGroup.indices[ shadowGroup.count ++ ] = instanceIndex;
			}
			if ( distance - radius > model.drawMaxDistance ) continue;
			let visible = true;
			for ( let planeIndex = 0; planeIndex < 6; planeIndex ++ ) {
				const offset = planeIndex * 4;
				if ( this._normalizedPlanes[ offset ] * centerX + this._normalizedPlanes[ offset + 1 ] * centerY + this._normalizedPlanes[ offset + 2 ] * centerZ + this._normalizedPlanes[ offset + 3 ] < -radius ) { visible = false; break; }
			}
			if ( ! visible ) continue;

			const projectedRadius = radius / ( Math.max( distance, 1e-6 ) * tanHalfFov );
			const groups = this._groupsByModel[ modelIndex ];
			let transition = -1;
			for ( let thresholdIndex = 0; thresholdIndex < model.lodThresholds.length; thresholdIndex ++ ) {
				const threshold = model.lodThresholds[ thresholdIndex ];
				if ( projectedRadius < threshold && projectedRadius >= threshold * ( 1 - STATIC_MODEL_INSTANCE_LOD_FADE_FRACTION ) ) { transition = thresholdIndex; break; }
			}
			if ( transition >= 0 ) {
				const threshold = model.lodThresholds[ transition ];
				const incomingFade = ( threshold - projectedRadius ) / ( threshold * STATIC_MODEL_INSTANCE_LOD_FADE_FRACTION );
				this._append( groups[ transition ], instanceIndex, incomingFade, 0 );
				this._append( groups[ transition + 1 ], instanceIndex, incomingFade, 1 );
			} else {
				let lodIndex = 0;
				while ( lodIndex < model.lodThresholds.length && projectedRadius < model.lodThresholds[ lodIndex ] ) lodIndex ++;
				this._append( groups[ lodIndex ], instanceIndex, 1, 2 ); // 2 = steady, 0/1 = outgoing/incoming transition sides
			}
		}
		return this;
	}

	_append( group, instanceIndex, fade, incoming ) {
		const offset = group.count ++;
		group.indices[ offset ] = instanceIndex;
		group.fade[ offset ] = fade;
		group.incoming[ offset ] = incoming;
	}
}
