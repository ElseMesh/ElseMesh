async function load( descriptor, loadWorldProviders ) {

	if ( descriptor && typeof loadWorldProviders === 'function' ) await loadWorldProviders( descriptor );

}

export async function loadWorldPackageProviders( worldPackage, loadWorldProviders ) {

	await load( worldPackage?.source, loadWorldProviders );

}

export async function loadWorldManifestProviders( manifest, loadWorldProviders ) {

	await load( manifest, loadWorldProviders );

}
