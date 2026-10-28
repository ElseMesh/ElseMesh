import assert from 'node:assert/strict';
import { createWorldSource, validateWorldSource } from '../src/network/WorldSource.js';
import { validateWorldPortals } from '../src/network/WorldConnector.js';
const front = { id: 'elsemesh-portal:test', destinationWorldId: 'elsemesh:front', entry: { position: [ 0, 0, 0 ], yaw: 0 }, exit: { position: [ 1, 2, 3 ], yaw: 0 }, openView: true, enabled: true };
const back = { destinationWorldId: 'elsemesh:rear', exit: { position: [ 4, 5, 6 ], yaw: Math.PI }, openView: false, enabled: true };
for ( const validate of [ ( p ) => validateWorldPortals( [ p ], new Set(), { requiredFeatures: [ 'elsemesh.portal-two-sided/1' ] } ), ( p ) => validateWorldSource( { ...createWorldSource(), rules: { ...createWorldSource().rules, requiredFeatures: [ 'elsemesh.portal-two-sided/1' ] }, portals: [ p ] } ) ] ) {
 validate( front ); validate( { ...front, back } );
 for ( const invalid of [ null, [], { ...back, exit: { ...back.exit, scale: 1 } }, { ...back, entry: front.entry }, { ...back, visual: 'stone' }, { ...back, id: front.id }, { ...back, enabled: undefined }, { ...back, destinationGateway: 'http://example.com' }, { ...back, exit: { ...back.exit, yaw: Infinity } }, { ...back, exit: { ...back.exit, position: [ 1e7, 0, 0 ] } } ] ) assert.throws( () => validate( { ...front, back: invalid } ) );
}
console.log( 'ok independent rear portal contract and legacy compatibility' );

assert.throws( () => validateWorldPortals( [ { ...front, back } ] ) );
assert.throws( () => validateWorldSource( { ...createWorldSource(), portals: [ { ...front, back } ] } ) );
