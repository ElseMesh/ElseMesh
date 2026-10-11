// Renderer-independent authored layout for the built-in island. Keep this
// file as plain data; WorldLayout adapts vectors for the simulation/render APIs.
export const ISLAND_DEFINITION = Object.freeze( {
	terrainSize: 2048,
	terrainRes: 2048,
	beach: Object.freeze( { xMin: - 150, xMax: 170 } ),
	pier: Object.freeze( { x: 55, zStart: - 64, zEnd: 40, deckHeight: 2.3, width: 2.6, headWidth: 14, headDepth: 7 } ),
	boatDock: Object.freeze( { position: Object.freeze( [ 64.5, 0, 36.5 ] ), heading: 0 } ),
	village: Object.freeze( { center: Object.freeze( [ 40, 0, - 118 ] ), radius: 95 } ),
	reef: Object.freeze( { center: Object.freeze( [ - 78, 0, 58 ] ), radius: 58 } ),
	spawn: Object.freeze( { position: Object.freeze( [ 18, 0, - 60 ] ), yaw: Math.PI } ),
	start: Object.freeze( { position: Object.freeze( [ 53.6, 0, - 77 ] ), yaw: Math.PI } ),
	// Incoming swell direction (unit, travel direction).
	swellDir: Object.freeze( [ - 0.12, - 1 ] ),
} );
