export const WORLD_LOCAL_LIGHT_SET_COMPONENT = 'elsemesh.local-light-set/1';

const VECTOR3 = value => Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite );
const KEYS = new Set( [ 'position', 'objectId', 'color', 'intensity', 'range', 'type', 'direction', 'innerCone', 'outerCone', 'flicker', 'alwaysOn' ] );

export function validateWorldLocalLightSet( component ) {

	if ( component?.type !== WORLD_LOCAL_LIGHT_SET_COMPONENT || ! component.data || ! Array.isArray( component.data.lights ) || component.data.lights.length > 256 ) throw new Error( 'Invalid world local-light-set component' );
	for ( const light of component.data.lights ) {
		if ( ! light || typeof light !== 'object' || Array.isArray( light ) || Object.keys( light ).some( key => ! KEYS.has( key ) ) || ! VECTOR3( light.position ) || light.objectId !== undefined && ! /^elsemesh-object:[a-z0-9][a-z0-9._:-]{0,127}$/.test( light.objectId ) || ! VECTOR3( light.color ) || light.color.some( value => value < 0 || value > 16 ) || ! Number.isFinite( light.intensity ) || light.intensity < 0 || light.intensity > 100000 || ! Number.isFinite( light.range ) || light.range <= 0 || light.range > 1000 || ! [ 'point', 'spot' ].includes( light.type ) || light.direction !== undefined && ( ! VECTOR3( light.direction ) || Math.hypot( ...light.direction ) < 1e-8 ) || light.type === 'spot' && ( light.direction === undefined || ! Number.isFinite( light.innerCone ) || ! Number.isFinite( light.outerCone ) || light.innerCone < 0 || light.outerCone <= light.innerCone || light.outerCone >= Math.PI ) || light.type === 'point' && ( light.direction !== undefined || light.innerCone !== undefined || light.outerCone !== undefined ) || light.flicker !== undefined && ( ! Number.isFinite( light.flicker ) || light.flicker < 0 || light.flicker > 1 ) || light.alwaysOn !== undefined && typeof light.alwaysOn !== 'boolean' ) throw new Error( 'Invalid world local-light-set entry' );
	}
	return component.data.lights;

}

export function worldLocalLightSources( components ) {
	return ( components || [] ).filter( component => component.type === WORLD_LOCAL_LIGHT_SET_COMPONENT ).flatMap( validateWorldLocalLightSet );
}

// Transform object-local light inputs without binding the world contract to a renderer's math API.
// `matrix` is a column-major affine transform; outputs are reusable three-element arrays.
export function transformWorldLocalLightInto( light, matrix, position, direction = null ) {
	const p = light.position;
	position[ 0 ] = matrix[ 0 ] * p[ 0 ] + matrix[ 4 ] * p[ 1 ] + matrix[ 8 ] * p[ 2 ] + matrix[ 12 ];
	position[ 1 ] = matrix[ 1 ] * p[ 0 ] + matrix[ 5 ] * p[ 1 ] + matrix[ 9 ] * p[ 2 ] + matrix[ 13 ];
	position[ 2 ] = matrix[ 2 ] * p[ 0 ] + matrix[ 6 ] * p[ 1 ] + matrix[ 10 ] * p[ 2 ] + matrix[ 14 ];
	if ( direction && light.direction ) {
		const d = light.direction;
		direction[ 0 ] = matrix[ 0 ] * d[ 0 ] + matrix[ 4 ] * d[ 1 ] + matrix[ 8 ] * d[ 2 ];
		direction[ 1 ] = matrix[ 1 ] * d[ 0 ] + matrix[ 5 ] * d[ 1 ] + matrix[ 9 ] * d[ 2 ];
		direction[ 2 ] = matrix[ 2 ] * d[ 0 ] + matrix[ 6 ] * d[ 1 ] + matrix[ 10 ] * d[ 2 ];
		const length = Math.hypot( direction[ 0 ], direction[ 1 ], direction[ 2 ] );
		if ( length > 1e-8 ) {
			direction[ 0 ] /= length;
			direction[ 1 ] /= length;
			direction[ 2 ] /= length;
		}
	}
}
