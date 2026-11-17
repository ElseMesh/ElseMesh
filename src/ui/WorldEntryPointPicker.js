import { AVATAR_STYLE_BY_PROFILE_ID, loadAppearance, loadWorldAppearance, saveWorldAppearance } from '../player/AvatarAppearance.js';

const ENTRY_STORAGE_PREFIX = 'elsemesh.world-entry.v1:';
const AVATAR_OPTION_STORAGE_PREFIX = 'elsemesh.world-avatar-option.v1:';

export function selectedWorldAppearance( selection, manifest, { storage = globalThis.localStorage, persist = true } = {} ) {
	const worldId = manifest?.worldId;
	const appearance = ( worldId && loadWorldAppearance( worldId, storage ) ) || loadAppearance( storage );
	if ( selection?.avatarOptionId ) {
		const option = manifest?.avatarOptions?.find( candidate => candidate.id === selection.avatarOptionId );
		const style = option && AVATAR_STYLE_BY_PROFILE_ID[ option.profileId ];
		if ( ! style ) throw new Error( `World admission refers to an unsupported avatar option: ${selection.avatarOptionId}` );
		appearance.style = style;
		if ( option.palette ) Object.assign( appearance, option.palette );
	}
	if ( selection?.uniform ) Object.assign( appearance, selection.uniform );
	if ( persist && worldId && selection ) saveWorldAppearance( worldId, appearance, storage );
	return appearance;
}

export async function chooseWorldAdmission( manifest, { storage = globalThis.localStorage, documentRef = globalThis.document } = {} ) {
	const entries = manifest?.entryPoints || [];
	const avatarOptions = manifest?.avatarOptions || [];
	if ( ! entries.length && ! avatarOptions.length ) return null;
	if ( entries.length && ( typeof manifest.entryPointPrompt !== 'string' || ! manifest.entryPointPrompt.trim() ) ) throw new Error( 'World is missing its entry point prompt' );
	const worldId = manifest.worldId || '';
	let savedEntry = null, savedAvatarOption = null;
	try {
		savedEntry = entries.find( entry => entry.id === storage?.getItem( `${ENTRY_STORAGE_PREFIX}${worldId}` ) ) || null;
		savedAvatarOption = avatarOptions.find( option => option.id === storage?.getItem( `${AVATAR_OPTION_STORAGE_PREFIX}${worldId}` ) ) || null;
	} catch {}
	if ( savedEntry && ( savedEntry.avatarOptionId || ! avatarOptions.length || savedAvatarOption ) ) return {
		...savedEntry,
		...( savedEntry.avatarOptionId ? {} : savedAvatarOption ? { avatarOptionId: savedAvatarOption.id } : {} ),
	};
	if ( ! entries.length && savedAvatarOption ) return { avatarOptionId: savedAvatarOption.id };
	if ( ! documentRef?.body ) throw new Error( 'Cannot choose a world admission option without a browser document' );

	const actionLabel = entries.length
		? typeof manifest.entryPointActionLabel === 'string' && manifest.entryPointActionLabel.trim() ? manifest.entryPointActionLabel.trim() : 'Choose an entry point'
		: 'Choose your avatar';
	const prompt = entries.length ? manifest.entryPointPrompt : 'Choose your avatar';
	return new Promise( resolve => {
		const backdrop = documentRef.createElement( 'div' );
		backdrop.setAttribute( 'role', 'dialog' );
		backdrop.setAttribute( 'aria-modal', 'true' );
		backdrop.setAttribute( 'aria-labelledby', 'world-entry-title' );
		Object.assign( backdrop.style, { position: 'fixed', inset: '0', zIndex: '10000', display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.78)', color: '#f4f0e8', font: '16px system-ui,sans-serif' } );
		const panel = documentRef.createElement( 'section' );
		const theme = manifest.experience?.theme;
		const colors = theme?.colors || {};
		Object.assign( panel.style, { width: 'min(440px, calc(100vw - 32px))', padding: '24px', border: `1px solid ${colors.border || '#b99b65'}`, borderRadius: '12px', background: colors.surface || '#17191d', color: colors.text || '#f4f0e8', boxShadow: '0 18px 70px #000a' } );
		const title = documentRef.createElement( 'h2' );
		title.id = 'world-entry-title';
		title.textContent = manifest.title || actionLabel;
		if ( theme?.logo ) {
			const logo = documentRef.createElement( 'img' );
			logo.src = theme.logo.src;
			logo.alt = theme.logo.alt;
			Object.assign( logo.style, { display: 'block', maxWidth: '100%', maxHeight: '120px', objectFit: 'contain', margin: '0 auto 18px' } );
			panel.append( logo );
		}
		panel.append( title );
		const actions = documentRef.createElement( 'div' );
		const styleButton = button => Object.assign( button.style, { display: 'block', width: '100%', margin: '10px 0', padding: '12px', color: colors.buttonText || colors.text || '#f4f0e8', background: colors.button || '#292d34', border: `1px solid ${colors.border || '#766747'}`, borderRadius: '6px', cursor: 'pointer', textAlign: 'left' } );
		const finish = ( entry, avatarOption ) => {
			const selection = entry ? { ...entry, ...( avatarOption && ! entry.avatarOptionId ? { avatarOptionId: avatarOption.id } : {} ) } : { avatarOptionId: avatarOption.id };
			try {
				if ( entry ) storage?.setItem( `${ENTRY_STORAGE_PREFIX}${worldId}`, entry.id );
				if ( selection.avatarOptionId ) storage?.setItem( `${AVATAR_OPTION_STORAGE_PREFIX}${worldId}`, selection.avatarOptionId );
			} catch {}
			backdrop.remove();
			resolve( selection );
		};
		const showAvatarOptions = entry => {
			title.textContent = 'Choose your avatar';
			actions.replaceChildren();
			for ( const option of avatarOptions ) {
				const button = documentRef.createElement( 'button' );
				button.type = 'button';
				button.textContent = option.label;
				styleButton( button );
				button.addEventListener( 'click', () => finish( entry, option ) );
				actions.append( button );
			}
			actions.querySelector( 'button' )?.focus();
		};
		const showEntries = () => {
			title.textContent = prompt;
			actions.replaceChildren();
			for ( const entry of entries ) {
				const button = documentRef.createElement( 'button' );
				button.type = 'button';
				button.textContent = entry.label;
				styleButton( button );
				button.addEventListener( 'click', () => {
					if ( entry.avatarOptionId || ! avatarOptions.length ) finish( entry, null );
					else showAvatarOptions( entry );
				} );
				actions.append( button );
			}
			actions.querySelector( 'button' )?.focus();
		};
		const action = documentRef.createElement( 'button' );
		action.type = 'button';
		action.textContent = actionLabel;
		styleButton( action );
		action.addEventListener( 'click', entries.length ? showEntries : () => showAvatarOptions( null ) );
		actions.append( action );
		panel.append( actions );
		backdrop.append( panel );
		documentRef.body.append( backdrop );
		action.focus();
	} );
}
