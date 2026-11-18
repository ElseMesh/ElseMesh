/** Shared renderer-independent graphics options selected from the page URL. */
export function autoExposureEnabled( searchParams = new URLSearchParams() ) {
	if ( typeof searchParams?.has !== 'function' ) throw new TypeError( 'Graphics options require URLSearchParams' );
	return ! searchParams.has( 'noAutoExposure' );
}
