import { worldBehaviorsFor } from './WorldBehaviorRegistry.js';

const EXPERIENCE_FIELDS = [ 'genre', 'tagline', 'loadingNote', 'tips', 'stages', 'theme', 'behaviors', 'fishing' ];
const LOADING_STAGES = new Set( [ 'gpu', 'atmosphere', 'terrain', 'village', 'vegetation', 'ocean', 'reef', 'simulation', 'shaders', 'world', 'compile', 'warmup' ] );
const THEME_COLORS = [ 'background', 'surface', 'accent', 'text', 'muted', 'button', 'buttonText', 'border' ];

export const GENERIC_WORLD_EXPERIENCE = Object.freeze( validateWorldExperience( {
	genre: 'A connected world',
	tagline: 'Explore a place shaped by its owner.',
	loadingNote: 'Preparing this ThruHold. Its first launch may take longer while shaders compile.',
	tips: [ 'World details and activities are provided by this ThruHold.' ],
	stages: Object.fromEntries( [ ...LOADING_STAGES ].map( ( stage ) => [ stage, 'Preparing this ThruHold…' ] ) ),
} ) );

export function validateWorldExperience( experience ) {
	if ( experience === undefined ) return undefined;
	if ( ! experience || typeof experience !== 'object' || Array.isArray( experience ) || Object.keys( experience ).some( ( key ) => ! EXPERIENCE_FIELDS.includes( key ) ) ) throw new Error( 'Invalid ThruHold experience descriptor' );
	for ( const key of [ 'genre', 'tagline', 'loadingNote' ] ) if ( typeof experience[ key ] !== 'string' || ! experience[ key ].trim() || experience[ key ].length > 240 ) throw new Error( `Invalid ThruHold experience ${key}` );
	if ( ! Array.isArray( experience.tips ) || experience.tips.length < 1 || experience.tips.length > 12 || experience.tips.some( ( tip ) => typeof tip !== 'string' || ! tip.trim() || tip.length > 320 ) ) throw new Error( 'Invalid ThruHold loading tips' );
	if ( ! experience.stages || typeof experience.stages !== 'object' || Array.isArray( experience.stages ) || Object.keys( experience.stages ).length > LOADING_STAGES.size ) throw new Error( 'Invalid ThruHold loading stages' );
	for ( const [ stage, text ] of Object.entries( experience.stages ) ) if ( ! LOADING_STAGES.has( stage ) || typeof text !== 'string' || ! text.trim() || text.length > 120 ) throw new Error( `Invalid ThruHold loading stage ${stage}` );
	worldBehaviorsFor( experience );
	if ( experience.fishing !== undefined ) {
		const fishing = experience.fishing;
		if ( ! fishing || typeof fishing !== 'object' || Array.isArray( fishing ) || Object.keys( fishing ).some( key => ! [ 'fishStand', 'chandlery' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold fishing locations' );
		for ( const [ name, location ] of Object.entries( fishing ) ) {
			if ( ! location || typeof location !== 'object' || Array.isArray( location ) || Object.keys( location ).some( key => ! [ 'position', 'yaw', 'interactionRadius' ].includes( key ) ) || ! Array.isArray( location.position ) || location.position.length !== 2 || location.position.some( value => ! Number.isFinite( value ) || Math.abs( value ) > 1000000 ) || ! Number.isFinite( location.yaw ) || Math.abs( location.yaw ) > 360 || ! Number.isFinite( location.interactionRadius ) || location.interactionRadius < 0.5 || location.interactionRadius > 20 ) throw new Error( `Invalid ThruHold fishing location ${name}` );
		}
	}
	if ( experience.theme !== undefined ) {
		const theme = experience.theme;
		if ( ! theme || typeof theme !== 'object' || Array.isArray( theme ) || Object.keys( theme ).some( key => ! [ 'logo', 'colors' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold loading theme' );
		if ( theme.logo !== undefined ) {
			const logo = theme.logo;
			let safeURL = typeof logo?.src === 'string' && logo.src.length <= 500 && typeof logo.alt === 'string' && logo.alt.trim() && logo.alt.length <= 160;
			if ( safeURL && logo.src.startsWith( '/' ) ) safeURL = ! logo.src.startsWith( '//' ) && ! logo.src.split( '/' ).includes( '..' );
			else if ( safeURL ) {
				try { const url = new URL( logo.src ); safeURL = url.protocol === 'https:' && ! url.username && ! url.password; } catch { safeURL = false; }
			}
			if ( ! safeURL || Object.keys( logo ).some( key => ! [ 'src', 'alt' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold loading logo' );
		}
		if ( theme.colors !== undefined && ( ! theme.colors || typeof theme.colors !== 'object' || Array.isArray( theme.colors ) || Object.keys( theme.colors ).some( key => ! THEME_COLORS.includes( key ) ) || Object.values( theme.colors ).some( color => typeof color !== 'string' || ! /^#[0-9a-f]{6}$/i.test( color ) ) ) ) throw new Error( 'Invalid ThruHold loading theme colors' );
	}
	return experience;
}
