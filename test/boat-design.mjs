import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/math/Vector3.js';
import { BoatDesign } from '../src/world/boat/BoatDesign.js';
import { BoatController } from '../src/player/BoatController.js';

const design = new BoatDesign();

assert.ok( design.dimensions.length > 8 && design.dimensions.length < 9, 'design exposes the lobster boat length in metres' );
assert.ok( design.hydro.suggestedMass > 0 && design.hydro.displacedVolume > 0, 'design exposes finite hydrostatic data' );
assert.ok( design.hullSamples.length > 0, 'design exposes hull waterplane samples' );
assert.ok( design.colliders.some( collider => collider.walkable ), 'design exposes walkable interaction surfaces' );
assert.equal( 'group' in design || 'meshes' in design || 'materials' in design, false, 'design contains no renderer objects' );

const allocations = [];
const query = { allocate( kind, count ) { allocations.push( { kind, count } ); return 4; } };
const berth = new Vector3( 12, 0, 18 );
const controller = new BoatController( {
	design,
	query,
	terrain: null,
	colliders: [],
	initialPosition: berth,
	initialHeading: 0.35,
} );

assert.equal( controller.design, design, 'simulation consumes the renderer-neutral design directly' );
assert.equal( controller.model, undefined, 'simulation does not require a presentation model' );
assert.equal( allocations[ 0 ].kind, 'boatHull' );
assert.equal( allocations[ 0 ].count, design.hullSamples.length );
assert.ok( controller.position.distanceTo( berth ) < 1e-9, 'initial simulation state uses the authored berth' );
assert.ok( [ ...controller.position.toArray(), ...controller.quaternion.toArray() ].every( Number.isFinite ) );

console.log( 'ok renderer-neutral boat design feeds simulation without constructing a render model' );
