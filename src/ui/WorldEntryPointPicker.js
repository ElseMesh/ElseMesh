import { loadAppearance } from '../player/AvatarAppearance.js';

const STORAGE_PREFIX = 'elsemesh.world-entry.v1:';

export function selectedWorldEntryAppearance( entry, storage = globalThis.localStorage ) {
	const appearance = loadAppearance( storage );
	if ( entry?.uniform ) Object.assign( appearance, entry.uniform );
	return appearance;
}

export async function chooseWorldEntryPoint( manifest, { storage = globalThis.localStorage, documentRef = globalThis.document } = {} ) {
	const entries = manifest?.entryPoints || [];
	if ( ! entries.length ) return null;
	if ( typeof manifest.entryPointPrompt !== 'string' || ! manifest.entryPointPrompt.trim() ) throw new Error( 'World is missing its entry point prompt' );
	const actionLabel = typeof manifest.entryPointActionLabel === 'string' && manifest.entryPointActionLabel.trim() ? manifest.entryPointActionLabel.trim() : 'Choose an entry point';
	let saved = null;
	try { saved = entries.find( entry => entry.id === storage?.getItem( `${STORAGE_PREFIX}${manifest.worldId}` ) ) || null; } catch {}
	if ( saved ) return saved;
	if ( ! documentRef?.body ) throw new Error( 'Cannot choose a world entry point without a browser document' );
	return new Promise( resolve => {
		const backdrop = documentRef.createElement( 'div' );
		backdrop.setAttribute( 'role', 'dialog' );
		backdrop.setAttribute( 'aria-modal', 'true' );
		backdrop.setAttribute( 'aria-labelledby', 'world-entry-title' );
		Object.assign( backdrop.style, { position: 'fixed', inset: '0', zIndex: '10000', display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.78)', color: '#f4f0e8', font: '16px system-ui,sans-serif' } );
		const panel = documentRef.createElement( 'section' );
		Object.assign( panel.style, { width: 'min(440px, calc(100vw - 32px))', padding: '24px', border: '1px solid #b99b65', borderRadius: '12px', background: '#17191d', boxShadow: '0 18px 70px #000a' } );
		const title = documentRef.createElement( 'h2' );
		title.id = 'world-entry-title';
		title.textContent = manifest.title || actionLabel;
		panel.append( title );
		const actions = documentRef.createElement( 'div' );
		const styleButton = button => Object.assign( button.style, { display: 'block', width: '100%', margin: '10px 0', padding: '12px', color: 'inherit', background: '#292d34', border: '1px solid #766747', borderRadius: '6px', cursor: 'pointer', textAlign: 'left' } );
		const chooseEntry = entry => {
				try { storage?.setItem( `${STORAGE_PREFIX}${manifest.worldId}`, entry.id ); } catch {}
				backdrop.remove();
				resolve( entry );
		};
		const action = documentRef.createElement( 'button' );
		action.type = 'button';
		action.textContent = actionLabel;
		styleButton( action );
		action.addEventListener( 'click', () => {
			title.textContent = manifest.entryPointPrompt;
			actions.replaceChildren();
			for ( const entry of entries ) {
				const button = documentRef.createElement( 'button' );
				button.type = 'button';
				button.textContent = entry.label;
				styleButton( button );
				button.addEventListener( 'click', () => chooseEntry( entry ) );
				actions.append( button );
			}
			actions.querySelector( 'button' )?.focus();
		} );
		actions.append( action );
		panel.append( actions );
		backdrop.append( panel );
		documentRef.body.append( backdrop );
		action.focus();
	} );
}
