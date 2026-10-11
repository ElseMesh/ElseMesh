import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const styleID = 'elsemesh-build-commit-style';
const stampID = 'build-commit';
const style = `<style id="${ styleID }">
	#${ stampID } {
		position: fixed; right: 12px; bottom: 42px; z-index: 1999;
		color: #e8f6ff; background: rgba(8, 14, 22, 0.72); padding: 4px 7px;
		border-radius: 5px; pointer-events: none; backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px); font: 500 11px/1.2 'JetBrains Mono', ui-monospace, monospace;
		letter-spacing: 0.02em;
	}
</style>`;

function replaceOrInsert( html, pattern, markup, closeTag, label ) {
	if ( pattern.test( html ) ) return html.replace( pattern, markup );
	const closeIndex = html.toLowerCase().lastIndexOf( closeTag );
	if ( closeIndex < 0 ) throw new Error( `Cannot stamp build commit: missing ${ label }` );
	return `${ html.slice( 0, closeIndex ) }${ markup }\n${ html.slice( closeIndex ) }`;
}

export function stampBuildCommit( html, commitSha ) {
	if ( ! /^[\da-f]{40}$/i.test( commitSha ) ) throw new Error( 'Build commit must be a full 40-character SHA' );
	const shortSha = commitSha.slice( 0, 8 ).toLowerCase();
	const stamp = `<div id="${ stampID }" aria-label="Build commit ${ shortSha }" title="Build commit ${ shortSha }">${ shortSha }</div>`;

	html = replaceOrInsert( html,
		new RegExp( `<style\\s+id=["']${ styleID }["'][^>]*>[\\s\\S]*?<\\/style>`, 'i' ),
		style, '</head>', 'the closing head tag' );
	html = replaceOrInsert( html,
		new RegExp( `<div\\s+id=["']${ stampID }["'][^>]*>[\\s\\S]*?<\\/div>`, 'i' ),
		stamp, '</body>', 'the closing body tag' );
	return html;
}

if ( process.argv[ 1 ] && fileURLToPath( import.meta.url ) === resolve( process.argv[ 1 ] ) ) {
	const [ htmlPath, commitSha ] = process.argv.slice( 2 );
	if ( ! htmlPath || ! commitSha ) throw new Error( 'Usage: node stamp-build-commit.mjs <index.html> <full-commit-sha>' );
	const html = readFileSync( htmlPath, 'utf8' );
	writeFileSync( htmlPath, stampBuildCommit( html, commitSha ) );
}
