import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function load( url, context, nextLoad ) {
	const asset = new URL( url );
	const raw = asset.searchParams.has( 'raw' );
	const asURL = asset.searchParams.has( 'url' );
	if ( ! raw && ! asURL ) return nextLoad( url, context );
	asset.search = '';
	asset.hash = '';
	const file = fileURLToPath( asset );
	const source = raw
		? `export default ${JSON.stringify( await readFile( file, 'utf8' ) )};`
		: `export default ${JSON.stringify( pathToFileURL( file ).href )};`;
	return { format: 'module', shortCircuit: true, source };
}
