import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

export async function generateTidewaterReefURLs() {

	const sourcePath = path.join( REPO, 'worlds', 'tidewater', 'world-source.json' );
	const source = JSON.parse( await readFile( sourcePath, 'utf8' ) );
	const assetIDs = [ ...new Set( source.components.filter( component => component.type === 'elsemesh.static-reef/1' ).map( component => component.placementAssetId ) ) ].sort();
	if ( ! assetIDs.length || assetIDs.some( id => ! /^sha256:[0-9a-f]{64}$/.test( id ) ) ) throw new Error( 'Tidewater source has no valid static Reef placement assets' );
	const imports = assetIDs.map( ( id, index ) => `import asset${index} from './tidewater/assets/${id.slice( 7 )}?url';` );
	const entries = assetIDs.map( ( id, index ) => `\t'${id}': asset${index},` );
	const output = `${imports.join( '\n' )}\n\nexport const DEFAULT_REEF_PLACEMENT_ASSETS = Object.freeze( {\n${entries.join( '\n' )}\n} );\n`;
	await writeFile( path.join( REPO, 'worlds', 'default-reef-assets.js' ), output );
	return output;

}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) await generateTidewaterReefURLs();
