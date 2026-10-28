#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldSource } from '../src/network/WorldSource.js';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_OPERATIONS = 1000;
const OBJECT_FIELDS = new Set( [ 'label', 'assetId', 'lods', 'priority', 'streamingBounds', 'transform', 'scale', 'collision' ] );
const PORTAL_FIELDS = new Set( [ 'destinationWorldId', 'destinationPeerId', 'destinationGateway', 'entry', 'exit', 'openView', 'enabled', 'visual', 'back' ] );
const WORLD_FIELDS = new Set( [ 'title', 'styleGuide', 'updatedAt', 'rules', 'hosts' ] );

function parseArgs( argv ) {
	const result = {};
	for ( let index = 0; index < argv.length; index ++ ) {
		const key = argv[ index ];
		if ( ! [ '--source', '--proposal', '--out' ].includes( key ) || ! argv[ index + 1 ] ) throw new Error( `Invalid or incomplete option: ${key}` );
		result[ key.slice( 2 ) ] = argv[ ++ index ];
	}
	for ( const key of [ 'source', 'proposal', 'out' ] ) if ( ! result[ key ] ) throw new Error( `Missing --${key}` );
	return result;
}

export function applyWorldProposal( sourceBytes, proposal ) {
	if ( proposal?.protocol !== 'elsemesh.world-proposal/1' || typeof proposal.worldId !== 'string' || ! /^elsemesh:[\w.-]{1,128}$/.test( proposal.worldId ) || ! /^sha256:[0-9a-f]{64}$/.test( proposal.sourceHash || '' ) || ! Array.isArray( proposal.operations ) || proposal.operations.length > MAX_OPERATIONS ) throw new Error( 'Invalid world proposal header' );
	if ( ! ( sourceBytes instanceof Uint8Array ) || `sha256:${createHash( 'sha256' ).update( sourceBytes ).digest( 'hex' )}` !== proposal.sourceHash ) throw new Error( 'Proposal source hash mismatch' );
	const source = JSON.parse( Buffer.from( sourceBytes ).toString( 'utf8' ) );
	if ( source.worldId !== proposal.worldId ) throw new Error( 'Proposal world ID does not match the source world' );
	const result = JSON.parse( JSON.stringify( validateWorldSource( source ) ) );
	const counts = { added: 0, updated: 0, removed: 0 };
	for ( const operation of proposal.operations ) {
		if ( ! operation || typeof operation !== 'object' || Array.isArray( operation ) ) throw new Error( 'Proposal operation must be an object' );
		switch ( operation.op ) {
			case 'object.add':
				result.objects.push( requireRecord( operation.object, 'object' ) );
				counts.added ++;
				break;
			case 'object.update':
				updateRecord( result.objects, operation.id, operation.fields, OBJECT_FIELDS, 'object' );
				counts.updated ++;
				break;
			case 'object.remove':
				removeRecord( result.objects, operation.id, 'object' );
				counts.removed ++;
				break;
			case 'portal.add':
				result.portals.push( requireRecord( operation.portal, 'portal' ) );
				counts.added ++;
				break;
			case 'portal.update':
				updateRecord( result.portals, operation.id, operation.fields, PORTAL_FIELDS, 'portal' );
				counts.updated ++;
				break;
			case 'portal.remove':
				removeRecord( result.portals, operation.id, 'portal' );
				counts.removed ++;
				break;
			case 'world.update':
				assignFields( result, operation.fields, WORLD_FIELDS, 'world' );
				counts.updated ++;
				break;
			default: throw new Error( `Unsupported proposal operation: ${operation.op}` );
		}
	}
	validateWorldSource( result );
	return { source: result, counts };
}

function requireRecord( value, kind ) {
	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) throw new Error( `Proposal ${kind} record is invalid` );
	return JSON.parse( JSON.stringify( value ) );
}

function updateRecord( records, id, fields, allowed, kind ) {
	if ( typeof id !== 'string' || ! id ) throw new Error( `Proposal ${kind} ID is missing` );
	const record = records.find( ( entry ) => entry.id === id );
	if ( ! record ) throw new Error( `Proposal ${kind} does not exist: ${id}` );
	assignFields( record, fields, allowed, kind );
}

function removeRecord( records, id, kind ) {
	if ( typeof id !== 'string' || ! id ) throw new Error( `Proposal ${kind} ID is missing` );
	const index = records.findIndex( ( entry ) => entry.id === id );
	if ( index < 0 ) throw new Error( `Proposal ${kind} does not exist: ${id}` );
	records.splice( index, 1 );
}

function assignFields( record, fields, allowed, kind ) {
	if ( ! fields || typeof fields !== 'object' || Array.isArray( fields ) ) throw new Error( `Proposal ${kind} fields are invalid` );
	const keys = Object.keys( fields );
	if ( keys.length === 0 || keys.some( ( key ) => ! allowed.has( key ) ) ) throw new Error( `Proposal ${kind} contains a protected or unsupported field` );
	for ( const key of keys ) record[ key ] = JSON.parse( JSON.stringify( fields[ key ] ) );
}

async function main() {
	const args = parseArgs( process.argv.slice( 2 ) );
	const sourcePath = path.resolve( args.source );
	const proposalPath = path.resolve( args.proposal );
	const outputPath = path.resolve( args.out );
	const [ sourceInfo, proposalInfo ] = await Promise.all( [ stat( sourcePath ), stat( proposalPath ) ] );
	if ( ! sourceInfo.isFile() || ! proposalInfo.isFile() || sourceInfo.size > MAX_DOCUMENT_BYTES || proposalInfo.size > MAX_DOCUMENT_BYTES ) throw new Error( 'Source or proposal must be a regular file no larger than 16 MiB' );
	const [ sourceBytes, proposalBytes ] = await Promise.all( [ readFile( sourcePath ), readFile( proposalPath ) ] );
	if ( sourceBytes.byteLength > MAX_DOCUMENT_BYTES || proposalBytes.byteLength > MAX_DOCUMENT_BYTES ) throw new Error( 'Source or proposal exceeds 16 MiB' );
	const proposal = JSON.parse( proposalBytes );
	const { source, counts } = applyWorldProposal( sourceBytes, proposal );
	await writeFile( outputPath, `${JSON.stringify( source, null, 2 )}\n`, { flag: 'wx' } );
	console.log( `Wrote unsigned proposal result to ${path.relative( ROOT, outputPath ) || outputPath}` );
	console.log( `Operations: ${counts.added} added, ${counts.updated} updated, ${counts.removed} removed. Review the source diff before conversion and owner signing.` );
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) main().catch( ( error ) => { console.error( error.message ); process.exitCode = 1; } );
