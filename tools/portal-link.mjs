#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldSource } from '../src/network/WorldSource.js';

const MAX_SOURCE = 16 * 1024 * 1024;
const MAX_LINK = 16384;
const worldId = ( value ) => typeof value === 'string' && /^elsemesh:[\w.-]{1,128}$/.test( value );
const portalId = ( value ) => typeof value === 'string' && /^elsemesh-portal:[\w.-]{1,128}$/.test( value );
function exact( value, required, optional = [] ) {
	if ( ! value || typeof value !== 'object' || Array.isArray( value ) || required.some( ( key ) => ! Object.hasOwn( value, key ) ) || Object.keys( value ).some( ( key ) => ! [ ...required, ...optional ].includes( key ) ) ) throw new Error( 'Invalid portal link fields' );
}
function frame( value ) {
	exact( value, [ 'position', 'yaw' ] );
	if ( ! Array.isArray( value.position ) || value.position.length !== 3 || value.position.some( ( n ) => ! Number.isFinite( n ) || Math.abs( n ) > 100000 ) || ! Number.isFinite( value.yaw ) || Math.abs( value.yaw ) > 1000 ) throw new Error( 'Invalid portal link frame' );
	return { position: [ ...value.position ], yaw: value.yaw };
}
const opposite = ( value ) => ( { ...frame( value ), yaw: Math.atan2( Math.sin( value.yaw + Math.PI ), Math.cos( value.yaw + Math.PI ) ) } );
function provider( value ) {
	if ( value.peerId !== undefined && ( typeof value.peerId !== 'string' || ! /^[A-Za-z0-9]{20,256}$/.test( value.peerId ) ) ) throw new Error( 'Invalid portal link peer ID' );
	if ( value.gateway !== undefined ) {
		let url;
		try { url = new URL( value.gateway ); } catch { throw new Error( 'Invalid portal link gateway' ); }
		if ( ! [ 'https:', 'wss:' ].includes( url.protocol ) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || value.gateway.length > 2048 ) throw new Error( 'Invalid portal link gateway' );
	}
}
export function validatePortalLink( link ) {
	if ( Buffer.byteLength( JSON.stringify( link ) ) > MAX_LINK ) throw new Error( 'Portal link exceeds 16 KiB' );
	exact( link, [ 'protocol', 'source', 'target' ] );
	if ( link.protocol !== 'elsemesh.portal-link/1' ) throw new Error( 'Invalid portal link protocol' );
	exact( link.source, [ 'worldId', 'portalId', 'side', 'entry' ], [ 'peerId', 'gateway' ] );
	exact( link.target, [ 'worldId', 'exit' ] );
	if ( ! worldId( link.source.worldId ) || ! worldId( link.target.worldId ) || ! portalId( link.source.portalId ) || ! [ 'front', 'back' ].includes( link.source.side ) ) throw new Error( 'Invalid portal link identity' );
	frame( link.source.entry ); frame( link.target.exit ); provider( link.source );
	return link;
}
export function exportPortalLink( source, id, side = 'front', { gateway, peerId } = {} ) {
	validateWorldSource( source );
	if ( ! [ 'front', 'back' ].includes( side ) ) throw new Error( 'Side must be front or back' );
	const portal = source.portals.find( ( value ) => value.id === id );
	if ( ! portal ) throw new Error( 'Portal does not exist' );
	const route = side === 'back' ? portal.back : portal;
	if ( ! route ) throw new Error( 'Portal has no configured back side' );
	const link = { protocol: 'elsemesh.portal-link/1', source: { worldId: source.worldId, portalId: id, side, entry: side === 'back' ? opposite( portal.entry ) : frame( portal.entry ), ...( peerId !== undefined ? { peerId } : {} ), ...( gateway !== undefined ? { gateway } : {} ) }, target: { worldId: route.destinationWorldId, exit: frame( route.exit ) } };
	return validatePortalLink( link );
}
export function importPortalLink( sourceBytes, link, id ) {
	if ( ! ( sourceBytes instanceof Uint8Array ) || sourceBytes.byteLength > MAX_SOURCE ) throw new Error( 'Source exceeds 16 MiB or is not bytes' );
	const source = validateWorldSource( JSON.parse( Buffer.from( sourceBytes ).toString( 'utf8' ) ) );
	validatePortalLink( link );
	if ( source.worldId !== link.target.worldId ) throw new Error( 'Portal link target does not match this source world' );
	if ( ! portalId( id ) || source.portals.some( ( value ) => value.id === id ) ) throw new Error( 'Invalid or existing complementary portal ID' );
	const portal = { id, destinationWorldId: link.source.worldId, ...( link.source.peerId ? { destinationPeerId: link.source.peerId } : {} ), ...( link.source.gateway ? { destinationGateway: link.source.gateway } : {} ), entry: opposite( link.target.exit ), exit: opposite( link.source.entry ), openView: true, enabled: true };
	validateWorldSource( { ...source, portals: [ ...source.portals, portal ] } );
	return { protocol: 'elsemesh.world-proposal/1', worldId: source.worldId, sourceHash: `sha256:${createHash( 'sha256' ).update( sourceBytes ).digest( 'hex' )}`, operations: [ { op: 'portal.add', portal } ] };
}
async function boundedRead( name, limit ) {
	const info = await stat( name );
	if ( ! info.isFile() || info.size > limit ) throw new Error( 'Input must be a bounded regular file' );
	const bytes = await readFile( name );
	if ( bytes.byteLength > limit ) throw new Error( 'Input exceeds size limit' );
	return bytes;
}
async function main() {
	const [ command, ...argv ] = process.argv.slice( 2 );
	if ( ! [ 'export', 'import' ].includes( command ) ) throw new Error( 'Use export or import' );
	const allowed = command === 'export' ? [ 'source', 'id', 'side', 'out', 'gateway', 'node-id' ] : [ 'source', 'link', 'id', 'out' ];
	const args = {};
	for ( let index = 0; index < argv.length; index += 2 ) {
		const key = argv[ index ].replace( /^--/, '' );
		if ( ! argv[ index ].startsWith( '--' ) || ! allowed.includes( key ) || Object.hasOwn( args, key ) || ! argv[ index + 1 ] ) throw new Error( 'Invalid or duplicate CLI option' );
		args[ key ] = argv[ index + 1 ];
	}
	for ( const key of [ 'source', 'id', 'out', ...( command === 'import' ? [ 'link' ] : [] ) ] ) if ( ! args[ key ] ) throw new Error( `Missing --${key}` );
	const source = await boundedRead( args.source, MAX_SOURCE );
	const result = command === 'export' ? exportPortalLink( JSON.parse( source ), args.id, args.side, { gateway: args.gateway, peerId: args[ 'node-id' ] } ) : importPortalLink( source, JSON.parse( await boundedRead( args.link, MAX_LINK ) ), args.id );
	await writeFile( args.out, `${JSON.stringify( result, null, 2 )}\n`, { flag: 'wx' } );
	console.log( `Wrote ${command === 'export' ? 'data-only portal link' : 'unsigned portal proposal'} to ${args.out}` );
}
if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) main().catch( ( error ) => { console.error( error.message ); process.exitCode = 1; } );
