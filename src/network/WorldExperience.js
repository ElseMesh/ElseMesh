import { worldBehaviorsFor } from './WorldBehaviorRegistry.js';
import { WORLD_JAVASCRIPT_EXTENSION_MAX_BYTES } from './WorldJavaScriptExtension.js';

const EXPERIENCE_FIELDS = [ 'genre', 'tagline', 'loadingNote', 'tips', 'stages', 'theme', 'environment', 'navigation', 'behaviors', 'extensions' ];
const MAX_LOADING_STAGES = 12;
const LOADING_STAGE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const THEME_COLORS = [ 'background', 'surface', 'accent', 'text', 'muted', 'button', 'buttonText', 'border' ];
const SKY_MODES = new Set( [ 'none', 'atmosphere' ] );
const CLOUD_MODES = new Set( [ 'none', 'procedural' ] );

export function worldEnvironmentSettings( experience ) {
	const environment = experience?.environment;
	return {
		sky: environment?.sky === 'atmosphere',
		clouds: environment?.clouds === 'procedural',
	};
}

export const GENERIC_WORLD_EXPERIENCE = Object.freeze( validateWorldExperience( {
	genre: 'A connected world',
	tagline: 'Explore a place shaped by its owner.',
	loadingNote: 'Preparing this ThruHold. Its first launch may take longer while shaders compile.',
	tips: [ 'World details and activities are provided by this ThruHold.' ],
	stages: { world: 'Preparing this ThruHold…' },
} ) );

export function validateWorldExperience( experience, assets, options = {} ) {
	if ( experience === undefined ) return undefined;
	if ( ! experience || typeof experience !== 'object' || Array.isArray( experience ) || Object.keys( experience ).some( ( key ) => ! EXPERIENCE_FIELDS.includes( key ) ) ) throw new Error( 'Invalid ThruHold experience descriptor' );
	for ( const key of [ 'genre', 'tagline', 'loadingNote' ] ) if ( typeof experience[ key ] !== 'string' || ! experience[ key ].trim() || experience[ key ].length > 240 ) throw new Error( `Invalid ThruHold experience ${key}` );
	if ( ! Array.isArray( experience.tips ) || experience.tips.length < 1 || experience.tips.length > 12 || experience.tips.some( ( tip ) => typeof tip !== 'string' || ! tip.trim() || tip.length > 320 ) ) throw new Error( 'Invalid ThruHold loading tips' );
	if ( ! experience.stages || typeof experience.stages !== 'object' || Array.isArray( experience.stages ) || Object.keys( experience.stages ).length > MAX_LOADING_STAGES ) throw new Error( 'Invalid ThruHold loading stages' );
	for ( const [ stage, text ] of Object.entries( experience.stages ) ) if ( ! LOADING_STAGE_PATTERN.test( stage ) || typeof text !== 'string' || ! text.trim() || text.length > 120 ) throw new Error( `Invalid ThruHold loading stage ${stage}` );
	worldBehaviorsFor( experience, options );
	if ( experience.extensions !== undefined ) {
		if ( ! Array.isArray( experience.extensions ) || experience.extensions.length > 16 ) throw new Error( 'Invalid world JavaScript extensions' );
		const behaviorIDs = new Set();
		for ( const extension of experience.extensions ) {
			if ( ! extension || typeof extension !== 'object' || Array.isArray( extension ) || Object.keys( extension ).some( key => ! [ 'behaviorId', 'assetId', 'events' ].includes( key ) ) || typeof extension.behaviorId !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( extension.behaviorId ) || ! Object.hasOwn( experience.behaviors || {}, extension.behaviorId ) || typeof extension.assetId !== 'string' || ! /^sha256:[0-9a-f]{64}$/.test( extension.assetId ) || behaviorIDs.has( extension.behaviorId ) || ( extension.events !== undefined && ( ! Array.isArray( extension.events ) || extension.events.length > 16 || new Set( extension.events ).size !== extension.events.length || extension.events.some( type => typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) ) ) ) ) throw new Error( 'Invalid world JavaScript extension reference' );
			behaviorIDs.add( extension.behaviorId );
		}
		if ( assets !== undefined ) {
			if ( ! Array.isArray( assets ) ) throw new Error( 'Invalid world JavaScript extension assets' );
			for ( const extension of experience.extensions ) {
				const matches = assets.filter( asset => asset?.id === extension.assetId );
				const asset = matches[ 0 ];
				if ( matches.length !== 1 || asset?.kind !== 'javascript/1' || ! Number.isSafeInteger( asset.bytes ) || asset.bytes < 1 || asset.bytes > WORLD_JAVASCRIPT_EXTENSION_MAX_BYTES || asset.priority !== 'visible' ) throw new Error( `World behavior ${extension.behaviorId} has an invalid JavaScript asset reference` );
			}
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
	if ( experience.environment !== undefined ) {
		const environment = experience.environment;
		if ( ! environment || typeof environment !== 'object' || Array.isArray( environment ) || Object.keys( environment ).some( key => ! [ 'sky', 'clouds' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold environment profile' );
		if ( environment.sky !== undefined && ! SKY_MODES.has( environment.sky ) ) throw new Error( 'Invalid ThruHold sky mode' );
		if ( environment.clouds !== undefined && ! CLOUD_MODES.has( environment.clouds ) ) throw new Error( 'Invalid ThruHold cloud mode' );
		if ( environment.clouds === 'procedural' && environment.sky !== 'atmosphere' ) throw new Error( 'Procedural clouds require the atmospheric sky' );
	}
	if ( experience.navigation !== undefined ) {
		const navigation = experience.navigation;
		if ( ! navigation || typeof navigation !== 'object' || Array.isArray( navigation ) || Object.keys( navigation ).some( key => ! [ 'compass', 'map' ].includes( key ) ) ) throw new Error( 'Invalid ThruHold navigation presentation' );
		if ( navigation.compass !== undefined ) {
			const compass = navigation.compass;
			if ( ! compass || typeof compass !== 'object' || Array.isArray( compass ) || Object.keys( compass ).some( key => ! [ 'north', 'east', 'south', 'west' ].includes( key ) ) || [ compass.north, compass.east, compass.south, compass.west ].some( label => typeof label !== 'string' || ! label.trim() || label.length > 8 ) ) throw new Error( 'Invalid ThruHold compass labels' );
		}
		if ( navigation.map !== undefined ) {
			const map = navigation.map;
			const bounds = map?.bounds;
			let safeURL = typeof map?.src === 'string' && map.src.length <= 500 && typeof map.alt === 'string' && map.alt.trim() && map.alt.length <= 160;
			if ( safeURL && map.src.startsWith( '/' ) ) safeURL = ! map.src.startsWith( '//' ) && ! map.src.split( '/' ).includes( '..' );
			else if ( safeURL ) {
				try { const url = new URL( map.src ); safeURL = url.protocol === 'https:' && ! url.username && ! url.password; } catch { safeURL = false; }
			}
			if ( ! safeURL || Object.keys( map ).some( key => ! [ 'src', 'alt', 'bounds' ].includes( key ) ) || ! bounds || typeof bounds !== 'object' || Array.isArray( bounds ) || Object.keys( bounds ).some( key => ! [ 'minX', 'maxX', 'minZ', 'maxZ' ].includes( key ) ) || ! [ bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ ].every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ ) throw new Error( 'Invalid ThruHold minimap source or world bounds' );
		}
	}
	return experience;
}
