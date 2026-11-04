import assert from 'node:assert/strict';
import { hideReplacedWorldObjects } from '../src/fallback/WebGLWorldObjectVisibility.js';

const preview = { id: 'elsemesh-object:terrain-preview', priority: 'portal-preview' };
const full = { id: 'elsemesh-object:terrain', priority: 'visible', replacesObjectId: preview.id };
const previewRoot = { visible: true };
const fullRoot = { visible: true };

hideReplacedWorldObjects( [ preview, full ], new Map( [ [ preview.id, previewRoot ] ] ) );
assert.equal( previewRoot.visible, true, 'a preview remains visible until its replacement is resident' );

// Both arrival orders must converge on the full object only.
const previewThenFull = new Map( [ [ preview.id, { visible: true } ], [ full.id, { visible: true } ] ] );
hideReplacedWorldObjects( [ preview, full ], previewThenFull );
assert.equal( previewThenFull.get( preview.id ).visible, false, 'a resident full object hides its already-loaded placeholder' );
assert.equal( previewThenFull.get( full.id ).visible, true, 'the full object stays visible' );

const fullThenPreview = new Map( [ [ full.id, { visible: true } ], [ preview.id, { visible: true } ] ] );
hideReplacedWorldObjects( [ preview, full ], fullThenPreview );
assert.equal( fullThenPreview.get( preview.id ).visible, false, 'a late placeholder is hidden when its replacement is already resident' );

const standalone = { id: 'elsemesh-object:standalone-preview', priority: 'portal-preview' };
const standaloneRoot = { visible: true };
hideReplacedWorldObjects( [ standalone ], new Map( [ [ standalone.id, standaloneRoot ] ] ) );
assert.equal( standaloneRoot.visible, true, 'a preview without a replacement remains the world representation' );

console.log( 'WebGL hosted object replacement visibility passed' );
