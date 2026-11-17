import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AVATAR_STYLES, DEFAULT_APPEARANCE, loadWorldAppearance, saveAppearance } from '../src/player/AvatarAppearance.js';
import { createWorldSource, validateWorldEntryPoints, validateWorldSource } from '../src/network/WorldSource.js';
import { chooseWorldAdmission, selectedWorldAppearance } from '../src/ui/WorldEntryPointPicker.js';

const hogwarts = JSON.parse( await readFile( new URL( '../worlds/Hogwarts/entry-point-selection.json', import.meta.url ), 'utf8' ) );
assert.equal( hogwarts.entryPointChoicesEnabled, false, 'avatar catalogues do not re-enable the Hogwarts house prompt' );
assert.deepEqual( hogwarts.avatarOptions.map( option => option.id ), [ 'short-hair', 'ponytail' ], 'Hogwarts exposes only generic registered avatar options while house entry choices are disabled' );
const schema = JSON.parse( await readFile( new URL( '../docs/schemas/world-source.schema.json', import.meta.url ), 'utf8' ) );
assert.deepEqual( schema.properties.avatarOptions.items.properties.profileId.enum.slice().sort(), Object.values( AVATAR_STYLES ).map( profile => profile.profileId ).sort(), 'the published schema profile allowlist matches the browser registry' );

const avatarOptions = [
	{ id: 'traveler', profileId: 'elsemesh.avatar.stock-female/1', label: 'Ponytail', palette: { shirt: '#aabbcc' } },
];
const entryPoints = [ { id: 'start', label: 'Start here', position: [ 1, 2, 3 ], yaw: 0, avatarOptionId: 'traveler' } ];
assert.doesNotThrow( () => validateWorldEntryPoints( entryPoints, 'Choose a start', 'Enter', avatarOptions ) );
assert.throws( () => validateWorldEntryPoints( entryPoints, 'Choose a start', 'Enter', [ ...avatarOptions, { ...avatarOptions[ 0 ] } ] ), /duplicate/ );
assert.throws( () => validateWorldEntryPoints( entryPoints, 'Choose a start', 'Enter', [ { ...avatarOptions[ 0 ], profileId: 'elsemesh.avatar.not-registered/1' } ] ), /avatar option/ );
assert.throws( () => validateWorldEntryPoints( entryPoints, 'Choose a start', 'Enter', [ { ...avatarOptions[ 0 ], palette: { hair: '#000000' } } ] ), /palette/ );
assert.throws( () => validateWorldEntryPoints( [ { ...entryPoints[ 0 ], avatarOptionId: 'missing' } ], 'Choose a start', 'Enter', avatarOptions ), /entry point/ );
assert.throws( () => validateWorldEntryPoints( [ { ...entryPoints[ 0 ], extra: true } ], 'Choose a start', 'Enter', avatarOptions ), /entry point/ );

const source = createWorldSource( { worldId: 'elsemesh:avatar-options-test', title: 'Avatar options' } );
source.avatarOptions = avatarOptions;
source.entryPointActionLabel = 'Enter';
source.entryPointPrompt = 'Choose a start';
source.entryPoints = entryPoints;
assert.doesNotThrow( () => validateWorldSource( source ) );
assert.throws( () => validateWorldSource( { ...source, rules: { ...source.rules, avatarPolicy: { allowedProfiles: [ 'elsemesh.avatar.stock-male/1' ] } } } ), /avatar option is excluded/, 'world avatar choices cannot contradict their admission allowlist' );

const data = new Map();
const storage = {
	getItem: key => data.get( key ) ?? null,
	setItem: ( key, value ) => data.set( key, value ),
};
saveAppearance( { ...DEFAULT_APPEARANCE, style: 'male', trousers: '#102030' }, storage );
const manifest = { worldId: source.worldId, avatarOptions };
const selected = selectedWorldAppearance( entryPoints[ 0 ], manifest, { storage } );
assert.equal( selected.style, 'female' );
assert.equal( selected.shirt, '#aabbcc' );
assert.equal( selected.trousers, '#102030' );
assert.deepEqual( loadWorldAppearance( source.worldId, storage ), selected, 'selected appearance persists under this world ID' );
assert.equal( selectedWorldAppearance( { id: 'other' }, manifest, { storage } ).style, 'female', 'the world appearance remains selected when the next entry has no override' );
assert.equal( selectedWorldAppearance( { id: 'other' }, { ...manifest, worldId: 'elsemesh:another-world' }, { storage } ).style, 'male', 'another world retains the global fallback instead of inheriting this world selection' );

const avatarOnlyStorage = { getItem: key => key.endsWith( `:${manifest.worldId}` ) ? 'traveler' : null };
const avatarOnlySelection = await chooseWorldAdmission( { ...manifest, entryPoints: [] }, { storage: avatarOnlyStorage, documentRef: null } );
assert.deepEqual( avatarOnlySelection, { avatarOptionId: 'traveler' }, 'world-authored avatar choices remain selectable when a world has no entry points' );
console.log( 'ok world-authored avatar options and per-world appearance persistence' );
