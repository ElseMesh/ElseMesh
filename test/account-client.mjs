import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { accountConfiguration, createAccountProofMessage, createWorldProposalSubmission } from '../src/network/AccountClient.js';

assert.equal( accountConfiguration(), null, 'account sign-in stays disabled without explicit deployment config' );
assert.equal( accountConfiguration( { accountd: 'http://accounts.example.org', googleClientId: 'client' } ), null, 'account broker must use HTTPS' );
assert.equal( accountConfiguration( { accountd: 'https://user:pass@accounts.example.org', googleClientId: 'client' } ), null, 'account broker URL must not contain credentials' );
assert.equal( accountConfiguration( { accountd: 'https://accounts.example.org/api?debug=1', googleClientId: 'client' } ), null, 'account broker URL must not contain query parameters' );
assert.deepEqual( accountConfiguration( { accountd: 'https://accounts.example.org/accountd/', googleClientId: '  client-id  ' } ), {
	accountd: 'https://accounts.example.org/accountd', googleClientId: 'client-id',
}, 'valid account settings are normalized' );

const challenge = { challengeId: 'one-time-id', nonce: 'fresh-nonce' };
const message = createAccountProofMessage( challenge, 'https://game.example' );
assert.equal( new TextDecoder().decode( message ), 'elsemesh.account-proof/1\none-time-id\nfresh-nonce\nhttps://game.example', 'proof message matches accountd protocol bytes' );
const pair = await webcrypto.subtle.generateKey( { name: 'Ed25519' }, false, [ 'sign', 'verify' ] );
const signature = await webcrypto.subtle.sign( { name: 'Ed25519' }, pair.privateKey, message );
assert.equal( await webcrypto.subtle.verify( { name: 'Ed25519' }, pair.publicKey, signature, message ), true, 'non-extractable account key signs the expected message' );
assert.equal( pair.privateKey.extractable, false, 'account private key is non-extractable' );
assert.equal( pair.publicKey.extractable, true, 'account public key remains exportable for broker registration' );

const roleGrant = { protocol: 'elsemesh.world-role/1', worldId: 'elsemesh:account-client-test', scopes: [ 'world.content.edit' ] };
const proposal = { protocol: 'elsemesh.world-proposal/1', worldId: roleGrant.worldId, sourceHash: `sha256:${'1'.repeat( 64 )}`, operations: [ { op: 'world.update', fields: { title: '<A proposed & reviewed world>' } } ] };
const submission = await createWorldProposalSubmission( proposal, roleGrant, pair );
assert.equal( submission.protocol, 'elsemesh.world-proposal-submission/1' );
const decodeBase64URL = ( value ) => Uint8Array.from( atob( value.replace( /-/g, '+' ).replace( /_/g, '/' ) ), ( c ) => c.charCodeAt( 0 ) );
const quoteCanonical = ( value ) => JSON.stringify( value ).replace( /[<>&\u2028\u2029]/g, ( character ) => `\\u${character.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' )}` );
const canonical = ( value ) => Array.isArray( value ) ? `[${value.map( canonical ).join( ',' )}]` : value && typeof value === 'object' ? `{${Object.keys( value ).sort().map( ( key ) => `${quoteCanonical( key )}:${canonical( value[ key ])}` ).join( ',' )}}` : typeof value === 'string' ? quoteCanonical( value ) : JSON.stringify( value );
const { signature: proposalSignature, ...unsignedSubmission } = submission;
const signedBytes = new TextEncoder().encode( `elsemesh.world-proposal-submission/1\n${canonical( unsignedSubmission )}` );
assert.equal( await webcrypto.subtle.verify( { name: 'Ed25519' }, pair.publicKey, decodeBase64URL( proposalSignature ), signedBytes ), true, 'proposal submission uses canonical domain-separated account signatures' );
const changedSubmission = { ...unsignedSubmission, proposal: { ...proposal, operations: [] } };
const changedBytes = new TextEncoder().encode( `elsemesh.world-proposal-submission/1\n${canonical( changedSubmission )}` );
assert.equal( await webcrypto.subtle.verify( { name: 'Ed25519' }, pair.publicKey, decodeBase64URL( proposalSignature ), changedBytes ), false, 'signature cannot authorize a modified proposal' );
assert.equal( pair.privateKey.extractable, false, 'proposal signing preserves the non-extractable browser key' );

console.log( 'Browser account configuration, proof, and proposal-signing protocols passed.' );
