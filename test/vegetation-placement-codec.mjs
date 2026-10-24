import assert from 'node:assert/strict';
import { appendVegetationPlacements, decodeVegetationPlacements, encodeVegetationPlacements, VEGETATION_PLACEMENT_KINDS } from '../src/network/VegetationPlacements.js';

const source = Object.fromEntries( VEGETATION_PLACEMENT_KINDS.map( kind => [ kind, [] ] ) );
source.villagePalms = 3;
source.palms.push( { x: 1, y: 2, z: 3, s: 1, yaw: 0, la: 0, l: 0, H: 4, seed: 0.5 } );
const decoded = decodeVegetationPlacements( encodeVegetationPlacements( source, 7 ), 7 );
const target = { palms: [ { x: -1 } ] };

assert.equal( appendVegetationPlacements( target, decoded ), target );
assert.deepEqual( target.palms, [ { x: -1 }, source.palms[ 0 ] ] );
assert.deepEqual( Object.keys( target ).sort(), [ ...VEGETATION_PLACEMENT_KINDS ].sort(), 'scalar package metadata such as villagePalms is not merged into iterable placement records' );
console.log( 'vegetation placement records append only the declared iterable kinds' );
