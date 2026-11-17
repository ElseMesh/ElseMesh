export const WORLD_LOCAL_LIGHT_SET_COMPONENT = 'elsemesh.local-light-set/1';

const VECTOR3 = value => Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite );
const KEYS = new Set( [ 'position', 'color', 'intensity', 'range', 'type', 'direction', 'innerCone', 'outerCone', 'flicker', 'alwaysOn' ] );

export function validateWorldLocalLightSet( component ) {

	if ( component?.type !== WORLD_LOCAL_LIGHT_SET_COMPONENT || ! component.data || ! Array.isArray( component.data.lights ) || component.data.lights.length > 256 ) throw new Error( 'Invalid world local-light-set component' );
	for ( const light of component.data.lights ) {
		if ( ! light || typeof light !== 'object' || Array.isArray( light ) || Object.keys( light ).some( key => ! KEYS.has( key ) ) || ! VECTOR3( light.position ) || ! VECTOR3( light.color ) || light.color.some( value => value < 0 || value > 16 ) || ! Number.isFinite( light.intensity ) || light.intensity < 0 || light.intensity > 100000 || ! Number.isFinite( light.range ) || light.range <= 0 || light.range > 1000 || ! [ 'point', 'spot' ].includes( light.type ) || light.direction !== undefined && ! VECTOR3( light.direction ) || light.type === 'spot' && ( light.direction === undefined || ! Number.isFinite( light.innerCone ) || ! Number.isFinite( light.outerCone ) || light.innerCone < 0 || light.outerCone <= light.innerCone || light.outerCone >= Math.PI ) || light.type === 'point' && ( light.direction !== undefined || light.innerCone !== undefined || light.outerCone !== undefined ) || light.flicker !== undefined && ( ! Number.isFinite( light.flicker ) || light.flicker < 0 || light.flicker > 1 ) || light.alwaysOn !== undefined && typeof light.alwaysOn !== 'boolean' ) throw new Error( 'Invalid world local-light-set entry' );
	}
	return component.data.lights;

}

export function worldLocalLightSources( components ) {
	return ( components || [] ).filter( component => component.type === WORLD_LOCAL_LIGHT_SET_COMPONENT ).flatMap( validateWorldLocalLightSet );
}
