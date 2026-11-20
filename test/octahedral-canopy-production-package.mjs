import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadCanopyProductionPackage( rootPath ) {
	const root = path.resolve( rootPath );
	const packageDocument = JSON.parse( await readFile( path.join( root, 'vegetation-canopy-runtime-package.json' ), 'utf8' ) );
	const assets = new Map();
	for ( const asset of packageDocument.assetFiles ) assets.set( asset.assetId, await readFile( path.join( root, asset.file ) ) );
	const component = packageDocument.component;
	const connector = {
		manifest: { assets: packageDocument.assetFiles.map( ( { assetId, kind } ) => ( { id: assetId, kind } ) ) },
		assets,
		async getAsset( assetId ) { return assets.get( assetId ); },
	};
	const descriptor = JSON.parse( assets.get( component.data.descriptorAssetId ) );
	const instanceSet = JSON.parse( assets.get( descriptor.instanceSetAssetId ) );
	const instance = instanceSet.instances.find( item => item.model.startsWith( 'tree-' ) );
	if ( ! instance ) throw new Error( 'Exported Tidewater canopy package contains no tree instance' );
	const group = descriptor.variantGroups.find( item => item.id === 'trees' );
	const target = instance.position.map( ( value, index ) => value + group.bounds.center[ index ] );
	const cameraPosition = [ target[ 0 ] + 110, target[ 1 ] + 45, target[ 2 ] + 110 ];
	return { packageDocument, connector, component, descriptor, instanceSet, cameraPosition, target };
}
