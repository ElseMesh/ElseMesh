import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile( new URL( '../src/App.js', import.meta.url ), 'utf8' );
const presentation = await readFile( new URL( '../src/world/BuiltinWorldPresentation.js', import.meta.url ), 'utf8' );
const hostedReturn = app.indexOf( "if ( engine.backend === 'webgpu' && worldLink ) return this.initHostedPackageWorld( progress );" );
const dynamicLoad = app.indexOf( "await import( './world/BuiltinWorldPresentation.js' )" );

assert( hostedReturn >= 0 && dynamicLoad > hostedReturn, 'hosted WebGPU returns before loading default-world presentation' );
for ( const [ appPath, presentationPath ] of [
	[ './world/Village.js', './Village.js' ], [ './world/Reef.js', './Reef.js' ], [ './world/BoatModel.js', './BoatModel.js' ],
	[ './world/Rocks.js', './Rocks.js' ], [ './world/Debris.js', './Debris.js' ],
	[ './world/wildlife/Wildlife.js', '../../worlds/tidewater/wildlife/Wildlife.js' ], [ './world/marine/Whale.js', './marine/Whale.js' ],
] ) {
	assert.doesNotMatch( app, new RegExp( `from ['"]${appPath.replaceAll( '.', '\\.' )}['"]` ), `App has no static default-world import for ${appPath}` );
	assert( presentation.includes( `from '${presentationPath}'` ), `built-in presentation module owns ${presentationPath}` );
}

console.log( 'Built-in world presentation loads only after the hosted WebGPU package-only route' );
