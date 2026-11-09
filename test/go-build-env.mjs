export function goBuildEnvironment( extra = {} ) {
	const env = { ...process.env, ...extra };
	env.GOFLAGS = [ env.GOFLAGS, '-buildvcs=false', ...( process.platform === 'android' ? [ '-ldflags=-checklinkname=0' ] : [] ) ].filter( Boolean ).join( ' ' );
	return env;
}
