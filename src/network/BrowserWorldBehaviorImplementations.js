import { Game } from '../game/Game.js';
import { ShoreWaves } from '../ocean/ShoreWaves.js';
import { registerWorldBehaviorImplementation } from './WorldBehaviorRegistry.js';

registerWorldBehaviorImplementation( 'elsemesh.shore-aware-boat/1', {
	onHostedWorldActivated( { app, terrain, active } ) {
		if ( ! active || ! terrain ) return;
		// The boat's hosted hydrostatics use the destination terrain and shore model.
		terrain.shore ||= new ShoreWaves( terrain.terrainGPU );
		if ( terrain.terrain && app.terrain.wetness ) {
			terrain.terrain.wetness = app.terrain.wetness;
			terrain.terrain.finalizeMaterial();
		}
		app.hostedWaterSurface.terrain = terrain.terrainGPU;
		app.hostedWaterSurface.shore = terrain.shore;
	},
} );

registerWorldBehaviorImplementation( 'elsemesh.fishing-game/1', {
	onBuiltinWorldActivated( { app, experience, worldId } ) {
		let game = app.worldGames.get( worldId );
		if ( ! game ) {
			game = new Game( app, { query: app.query, terrain: app.terrainData, colliders: app.colliders, boatController: app.boatCtl, experience, worldId } );
			app.worldGames.set( worldId, game );
		}
		app.game = game;
		game.setWorldActive( true );
	},
	onHostedWorldActivated( { app, connector, root, active } ) {
		if ( ! active ) {
			app.game?.setWorldActive( false );
			return;
		}
		const worldTerrain = root.userData.terrainData || app.terrainData;
		let game = app.worldGames.get( connector.worldId );
		if ( ! game ) {
			game = new Game( app, { query: app.hostedQuery, terrain: worldTerrain, colliders: app.hostedColliders, boatController: app.player.boat || app.boatCtl, experience: connector.manifest.experience, worldId: connector.worldId } );
			app.worldGames.set( connector.worldId, game );
		}
		app.game = game;
		game.setWorldContext( { query: app.hostedQuery, terrain: worldTerrain, colliders: app.hostedColliders, boatController: app.player.boat || app.boatCtl } );
		game.setWorldActive( true );
	},
	onWorldDeactivated( { app, mode } ) {
		if ( ! app.game ) return;
		if ( mode === 'hosted' ) app.game.setWorldContext( { query: app.query, terrain: app.terrainData, colliders: app.colliders, boatController: app.boatCtl } );
		app.game.setWorldActive( false );
	},
	onWorldFrame( { app, active, dt } ) {
		if ( active && app.game?.active ) app.game.update( dt );
	},
} );
