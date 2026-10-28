export const WORLD_ID_PREFIX = 'elsemesh:';
export const WORLD_PROTOCOL_NAMESPACE = 'elsemesh';

const WORLD_ID_PATTERN = /^elsemesh:[\w.-]{1,128}$/;

export function isWorldID( value ) {
	return typeof value === 'string' && WORLD_ID_PATTERN.test( value );
}
