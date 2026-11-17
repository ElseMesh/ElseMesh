import { MAX_WORLD_ONE_SHOT_BYTES } from '../audio/SoundScape.js';

export function createWorldDoorAudioObserver( audio, connector ) {
	return ( _states, transitions = [] ) => {
		if ( ! audio?.enabled || ! connector || ! Array.isArray( transitions ) ) return;
		for ( const transition of transitions ) {
			if ( ! transition?.eventId || ! transition.soundAssetId ) continue;
			const door = connector.manifest?.components?.find( component => component.id === transition.id && component.type === 'elsemesh.interactive-door/1' );
			const position = door?.data?.position;
			if ( ! Array.isArray( position ) || position.length !== 3 || ! position.every( Number.isFinite ) ) continue;
			const asset = connector.manifest?.assets?.find( item => item.id === transition.soundAssetId && item.kind === 'audio/ogg' );
			if ( ! asset || ! Number.isSafeInteger( asset.bytes ) || asset.bytes <= 0 || asset.bytes > MAX_WORLD_ONE_SHOT_BYTES ) continue;
			Promise.resolve().then( () => connector.getAsset( asset.id ) )
				.then( bytes => audio.playWorldOneShot( connector.worldId, transition.eventId, asset.id, bytes, position ) )
				.catch( error => console.warn( 'World door sound unavailable', error ) );
		}
	};
}
