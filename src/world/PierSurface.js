import { ISLAND_DEFINITION } from './IslandDefinition.js';

// Renderer-neutral walkable height for the authored pier surface. The full
// collision world still supplies exact step boxes; this continuous step ramp is
// the equivalent lightweight query used by renderer fallbacks.
export function pierWalkableHeightAt( x, z, terrainHeightAt ) {

	const P = ISLAND_DEFINITION.pier;
	let height = terrainHeightAt( x, z );
	const stepGround = terrainHeightAt( P.x, P.zStart - 0.7 );
	const rise = Math.max( 0, P.deckHeight - stepGround );
	const nSteps = Math.max( 2, Math.ceil( rise / 0.22 ) );
	const footZ = P.zStart - ( nSteps - 1 ) * 0.32 - 0.3;
	const onSteps = Math.abs( x - P.x ) <= P.width * 0.5 && z >= footZ && z < P.zStart;
	const onWalkway = Math.abs( x - P.x ) <= P.width * 0.5 && z >= P.zStart && z <= P.zEnd;
	const onHead = Math.abs( x - P.x ) <= P.headWidth * 0.5 && z >= P.zEnd - P.headDepth && z <= P.zEnd;
	if ( onSteps ) height = Math.max( height, stepGround + rise * ( z - footZ ) / ( P.zStart - footZ ) );
	if ( onWalkway || onHead ) height = Math.max( height, P.deckHeight );
	return height;

}
