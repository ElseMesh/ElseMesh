import { fetchGLBTextureLevel } from '../engine/loaders/GLBRange.js';
import { staticModelTextureScreenFraction } from '../network/WorldPackage.js';

// Track actual source textures shared by instanced draws, without constructing
// scene objects for texture demand. One global flight bounds fetch and decode.
export class WebGLProgressiveStaticTextures {
 constructor( fallback, connector, { fetchLevel = fetchGLBTextureLevel } = {} ) {
  this.fallback = fallback;
  this.connector = connector;
  this.fetchLevel = fetchLevel;
  this.entries = new Map();
  this.registrations = new Map();
  this.inFlight = null;
  this.lastFrame = null;
 }
 register( runtime, modelIndex, lodIndex, assetId, source, progressive ) {
  if ( ! progressive?.textures?.length ) return;
  let registrations = this.registrations.get( runtime );
  if ( ! registrations ) this.registrations.set( runtime, registrations = [] );
  const parser = source.parser;
  for ( const image of progressive.textures ) {
   const indexSet = new Set( image.imageIndices );
   const textureIndices = new Set();
   for ( const [ index, texture ] of ( parser.json.textures || [] ).entries() ) {
    if ( indexSet.has( texture.extensions?.KHR_texture_basisu?.source ?? texture.source ) ) textureIndices.add( index );
   }
   const textures = new Set();
   for ( const [ object, association ] of parser.associations ) if ( object?.isTexture && textureIndices.has( association?.textures ) ) textures.add( object );
   if ( ! textures.size ) continue;
   const key = image.textureAssetId || `${assetId}:${image.imageIndices.join(',')}`;
   let entry = this.entries.get( key );
   if ( ! entry ) {
    entry = { key, image, assetId, progressive, registrations: new Set(), level: image.levelCount - 1, decoded: null, retryAfter: 0 };
    this.entries.set( key, entry );
   }
   const registration = { runtime, modelIndex, lodIndex, textures, assetId, progressive, image };
   entry.registrations.add( registration );
   registrations.push( [ entry, registration ] );
   if ( entry.decoded ) for ( const texture of textures ) copyTexturePixels( texture, entry.decoded );
  }
 }
 unregister( runtime ) {
  for ( const [ entry, registration ] of this.registrations.get( runtime ) || [] ) {
   entry.registrations.delete( registration );
   if ( ! entry.registrations.size ) {
    this.entries.delete( entry.key );
    entry.abortController?.abort();
    entry.decoded?.dispose();
   }
  }
  this.registrations.delete( runtime );
 }
 update( camera, frame ) {
  if ( this.lastFrame === frame || this.inFlight || ! this.entries.size ) return;
  this.lastFrame = frame;
  let best = null;
  const viewportHeight = this.fallback.renderer.domElement.height || 1;
  const fractions = new Map();
  for ( const entry of this.entries.values() ) {
   if ( performance.now() < entry.retryAfter ) continue;
   let fraction = 0;
   for ( const registration of entry.registrations ) {
    let runtimeFractions = fractions.get( registration.runtime );
    if ( ! runtimeFractions ) fractions.set( registration.runtime, runtimeFractions = new Map() );
    const key = `${registration.modelIndex}:${registration.lodIndex}`;
    let value = runtimeFractions.get( key );
    if ( value === undefined ) {
     value = staticModelTextureScreenFraction( registration, camera ) || 0;
     runtimeFractions.set( key, value );
    }
    fraction = Math.max( fraction, value );
   }
   if ( ! fraction ) continue;
   const pixels = Math.max( 1, fraction * viewportHeight * 2 );
   const desired = Math.min( entry.image.levelCount - 1, Math.max( 0, Math.floor( Math.log2( Math.max( entry.image.baseWidth, entry.image.baseHeight ) / pixels ) ) ) );
   if ( entry.level === desired ) continue;
   const next = entry.level > desired ? entry.level - 1 : desired, offset = 80 + next * 24;
   const bytes = Number( new DataView( entry.image.headerAndIndex.buffer, entry.image.headerAndIndex.byteOffset, entry.image.headerAndIndex.byteLength ).getBigUint64( offset + 8, true ) );
   const priority = fraction * fraction / Math.max( 1, bytes );
   if ( ! best || priority > best.priority ) best = { entry, next, priority };
  }
  if ( ! best ) return;
  const { entry, next } = best;
  const source = entry.registrations.values().next().value;
  const controller = entry.abortController = new AbortController();
  this.inFlight = ( async () => {
   const levels = await this.fetchLevel( this.connector, source.assetId, source.progressive, { imageIndices: source.image.imageIndices, levelIndex: next, signal: controller.signal } );
   if ( levels.length !== 1 ) throw new Error( 'Expected one progressive WebGL texture level' );
   const bytes = levels[ 0 ].bytes;
   const input = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
   const decoded = await new Promise( ( resolve, reject ) => this.fallback.ktx2Loader.parse( input, resolve, reject ) );
   if ( this.entries.get( entry.key ) !== entry ) { decoded.dispose(); return; }
   try {
    for ( const registration of entry.registrations ) for ( const texture of registration.textures ) copyTexturePixels( texture, decoded );
   } catch ( error ) { decoded.dispose(); throw error; }
   entry.decoded?.dispose();
   entry.decoded = decoded;
   entry.level = next;
  } )().catch( error => {
   if ( error?.name === 'AbortError' ) return;
   entry.retryAfter = performance.now() + 5000;
   console.warn( 'WebGL static texture mip upgrade failed', entry.assetId, error );
  } ).finally( () => { entry.abortController = null; this.inFlight = null; } );
 }
}

function copyTexturePixels( target, source ) {
 if ( Boolean( target.isCompressedTexture ) !== Boolean( source.isCompressedTexture ) || Boolean( target.isDataTexture ) !== Boolean( source.isDataTexture ) ) throw new Error( 'Progressive KTX2 texture representation changed' );
 target.image = source.image;
 target.mipmaps = source.mipmaps;
 target.format = source.format;
 target.type = source.type;
 target.internalFormat = source.internalFormat;
 target.minFilter = source.minFilter;
 target.generateMipmaps = source.generateMipmaps;
 target.needsUpdate = true;
}
