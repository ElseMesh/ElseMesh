async function load( descriptor, loadWorldProviders ) {

	if ( descriptor && typeof loadWorldProviders === 'function' ) await loadWorldProviders( descriptor );

}

export function worldProviderMatchesManifest( provider, manifest ) {
	const components = new Set( ( manifest?.components || [] ).map( component => component?.type ).filter( value => typeof value === 'string' ) );
	const behaviors = manifest?.experience?.behaviors || {};
	return ( provider.componentTypes || [] ).some( type => components.has( type ) ) ||
		( provider.behaviorIds || [] ).some( id => Object.hasOwn( behaviors, id ) );
}

export async function loadMatchingWorldProviders( manifest, providers ) {
	for ( const provider of providers ) {
		if ( ! worldProviderMatchesManifest( provider, manifest ) ) continue;
		const module = await provider.load();
		if ( typeof module?.loadWorldProvider !== 'function' ) throw new Error( 'World provider module does not export loadWorldProvider()' );
		await module.loadWorldProvider();
	}
}

export async function loadWorldPackageProviders( worldPackage, loadWorldProviders ) {

	await load( worldPackage?.source, loadWorldProviders );

}

export async function loadWorldManifestProviders( manifest, loadWorldProviders ) {

	await load( manifest, loadWorldProviders );

}
