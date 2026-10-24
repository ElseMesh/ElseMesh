export function goBuildEnvironment( extra = {} ) {
	const env = { ...process.env, ...extra };
	if ( process.platform === 'android' ) env.GOFLAGS = [ env.GOFLAGS, '-ldflags=-checklinkname=0' ].filter( Boolean ).join( ' ' );
	return env;
}
