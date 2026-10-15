import { Vector3, Euler, Color, MathUtils, Mesh } from './engine/index.js';
import { GPU } from './engine/gpu/GPU.js';
import { SunShadows } from './engine/render/Shadows.js';
import { FrameUniforms } from './engine/render/Frame.js';
import { FrameRate } from './engine/FrameTiming.js';

import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { CDLOD } from './core/CDLOD.js';
import { G } from './core/Globals.js';
import { Profiler } from './core/Profiler.js';
import { SceneRenderer, LAYERS } from './core/SceneRenderer.js';
import { DEPTH_FORMAT } from './engine/render/SceneRenderer.js';
import { installDebugViews } from './core/DebugViews.js';

import { Atmosphere, SUN_ILLUMINANCE } from './sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from './sky/Sky.js';
import { Clouds } from './sky/Clouds.js';
import { SkyProClouds } from './sky/SkyProClouds.js';
import { Environment } from './sky/Environment.js';

import { TerrainData } from './world/TerrainData.js';
import { TerrainGPU } from './world/TerrainGPU.js';
import { Terrain } from './world/Terrain.js';
import { ProceduralWorld } from './world/ProceduralWorld.js';
import { PROCEDURAL_SEED } from './world/ProceduralHeight.js';
import { LandscapeBuilder, readSavedLandscapeSpec } from './world/LandscapeBuilder.js';
import { landscapePathLayout } from './world/LandscapeHeight.js';
import { effectiveLandscapeSpec, readSavedLandscapeWorldDocument } from './world/LandscapeWorldDocument.js';
import { LandscapeWarehouse } from './world/LandscapeWarehouse.js';
import { computeShoreField } from './world/ShoreField.js';
import { WORLD } from './world/WorldLayout.js';
import { Colliders } from './world/Colliders.js';
import { CaveSystem } from './world/CaveSystem.js';
import { Village } from './world/Village.js';
import { Reef } from './world/Reef.js';
import { BoatModel } from './world/BoatModel.js';
import { Rocks } from './world/Rocks.js';
import { Debris } from './world/Debris.js';
import { Wildlife } from './world/wildlife/Wildlife.js';
import { Whale } from './world/marine/Whale.js';
import { KaijuEncounter } from './world/KaijuEncounter.js';
import { MonorailSystem } from './world/MonorailSystem.js';
import { ThirdIslandSystem } from './world/ThirdIslandSystem.js';
import { FourthIslandSystem } from './world/FourthIslandSystem.js';
import { IslandFiveSystem } from './world/IslandFiveSystem.js';
import { PortIslandSystem } from './world/PortIslandSystem.js';
import { reviewCameraMinimumHeight } from './world/WorldLocation.js';

import { OceanFFT } from './ocean/OceanFFT.js';
import { WaterSurface } from './ocean/WaterSurface.js';
import { WaterMaterial } from './ocean/WaterMaterial.js';
import { createFoamTexture } from './ocean/FoamTexture.js';
import { ShoreWaves } from './ocean/ShoreWaves.js';
import { ShoreSim } from './ocean/ShoreSim.js';
import { Caustics } from './ocean/Caustics.js';
import { installUnderwaterLighting } from './ocean/UnderwaterLighting.js';
import { RefractionPass } from './ocean/RefractionPass.js';
import { QUALITY, qualityFor, AdaptiveResolution } from './core/RenderQuality.js';
import { installGroundBounce } from './materials/GroundBounce.js';
import { LocalLights, addVillageLights, addBoatLights } from './materials/LocalLights.js';
import { WaterQuery } from './ocean/WaterQuery.js';
import { Breakers } from './ocean/Breakers.js';
import { SurfFoam } from './ocean/SurfFoam.js';
import { Spray } from './fx/Spray.js';
import { SeaDetail } from './ocean/SeaDetail.js';
import { MarineSnow } from './fx/MarineSnow.js';
import { AirMotes } from './fx/AirMotes.js';

import { Underwater, LENS_REACH } from './post/Underwater.js';
import { PostFX } from './post/PostFX.js';
import { AirHaze } from './post/AirHaze.js';
import { FlyCamera } from './player/FlyCamera.js';
import { Player } from './player/Player.js';
import { PlayerAvatar } from './player/PlayerAvatar.js';
import { AvatarChooser } from './player/AvatarChooser.js';
import { SurvivalPistol } from './player/SurvivalPistol.js';
import { Game } from './game/Game.js';
import { SurvivalNeeds } from './game/SurvivalNeeds.js';
import { STAND } from './game/FishStand.js';
import { CHANDLERY } from './game/Chandlery.js';
import { BoatController } from './player/BoatController.js';
import { BoatSpray } from './player/BoatSpray.js';
import { WakeSim } from './ocean/WakeSim.js';
import { Vegetation } from './world/Vegetation.js';
import { loadScannedBark } from './world/vegetation/ScannedBark.js';
import { SoundScape } from './audio/SoundScape.js';
import { WarehouseGhost } from './world/WarehouseGhost.js';
import { updateCameraVelocity, useStaticVelocity } from './post/CameraVelocity.js';

const _up = new Vector3( 0, 1, 0 );

export class App {

	constructor() {

		this.settings = {
			timeOfDay: new Date().getHours() + new Date().getMinutes() / 60,
			clockMode: 'local',
			localTime: true,
			sunAzimuth: 0, // degrees: turns the sun's daily path about the vertical
			timeSpeed: 0, // hours per real second
			exposure: 0.55,
			renderScale: 1, // internal resolution (the temporal upscaler reconstructs the output), Performance tab
			terrainShading: 'full',
		};
		this.qs = new URLSearchParams( location.search );

	}

	async init( onProgress = () => {} ) {

		const qs = this.qs;
		// report a stage, then let the page paint it before the (synchronous) stage work starts
		const progress = async ( p, text, until ) => {

			onProgress( p, text, until );
			if ( typeof requestAnimationFrame === 'function' ) await new Promise( ( r ) => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

		};
		await progress( 0.02, 'Starting WebGPU…' );
		const engine = this.engine = new Engine( document.getElementById( 'app' ) );
		await engine.init();
		// systems take `renderer` first as in the three.js version: it is the Engine now (GPU access is global)
		const renderer = engine;
		const { scene, camera } = engine;
		// the near clip plane is the lens: it slices the water surface at the waterline (see Underwater)
		camera.near = 0.1;
		camera.updateProjectionMatrix();
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;

		this.input = new Input( engine.domElement, {
			keyboardLookBlocked: () => Boolean( window.__ui?._start || window.__ui?.helpOpen || this.game?.guide?.open ),
		} );
		this.fly = new FlyCamera( camera, engine.domElement, this.input );
		this.fly.setPose( new Vector3( 20, 6, - 20 ), Math.PI * 0.9, - 0.12 );

		// ---------------------------------------------------------------- sky
		await progress( 0.04, 'Building the atmosphere…' );
		this.atmosphere = new Atmosphere( renderer );
		this.sky = new Sky( this.atmosphere );
		if ( ! qs.has( 'noClouds' ) ) {

			// sky-pro-webgpu's clouds ("Partly cloudy"); ?oldClouds: the previous ones
			this.clouds = qs.has( 'oldClouds' ) ? new Clouds( renderer, this.atmosphere ) : new SkyProClouds( renderer, this.atmosphere );
			if ( this.clouds.ready ) await this.clouds.ready;
			this.sky.clouds = this.clouds;

		}

		// 3 cascades: 0-10 m (~1 cm texels, fine contact detail), 10-60 m, 60-400 m (rough far shadows);
		// contact-hardening filter sized by the sun's disc on the near cascade. Each cascade's depth range
		// is its light margin (200 m) + its extent, which keeps the depth bias small in metres.
		// Shadows come from the opaque and the late (transparent-pass) layers.
		this.csm = this.shadows = new SunShadows( { size: 2048, splits: [ 10, 60, 400 ], lightMargin: 200, normalBias: [ 0.015, 0.06, 0.3 ], bias: 0.00002 } );
		this.shadows.layerMask = ( 1 << LAYERS.OPAQUE ) | ( 1 << LAYERS.TRANSPARENT );

		this.environment = new Environment( renderer, scene, this.sky );

		// ---------------------------------------------------------------- island
		await progress( 0.06, 'Shaping the island…' );
		this.terrainData = new TerrainData();
		// Resolve the saved, validated definition before any terrain WGSL is built.
		// The authored islands remain untouched; the new domain lies outside them.
		this.landscapeDocument = qs.has( 'landscapeBuilder' ) && qs.get( 'generated' ) === '1' ? readSavedLandscapeWorldDocument() : null;
		this.landscapeSpec = this.landscapeDocument ? effectiveLandscapeSpec( this.landscapeDocument ) : qs.has( 'landscapeBuilder' ) && qs.get( 'generated' ) === '1' ? readSavedLandscapeSpec() : null;
		if ( this.landscapeSpec ) { this.terrainData.landscapeSpec = this.landscapeSpec; this.terrainData.landscapeEdits = this.landscapeDocument?.terrain ?? []; }
		// Experimental outer world is opt-in; the authored grid is generated unchanged.
		if ( ! this.landscapeSpec && qs.has( 'procedural' ) ) this.terrainData.proceduralSeed = PROCEDURAL_SEED;
		this.colliders = new Colliders();
		// the village flattens building pads into the heightmap: build it before any terrain
		// data is derived (shore field, GPU textures, meshes)
		await progress( 0.12, 'Building the village…' );
		this.village = new Village( { scene, terrain: this.terrainData, colliders: this.colliders } );
		if ( ! qs.has( 'noVeg' ) ) {

			await progress( 0.14, 'Planting the island…' );
			await loadScannedBark();
			this.vegetation = new Vegetation( { scene, terrain: this.terrainData, village: this.village } );
			useStaticVelocity( this.vegetation.group );

		}

		await progress( 0.19, 'Rolling in the swell…' );
		this.shoreField = computeShoreField( this.terrainData, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
		this.terrainGPU = new TerrainGPU( this.terrainData, this.shoreField );
		// terrain and rocks apply the heightfield sun shadow (long hill shadows) in their own lighting
		this.terrain = new Terrain( { scene, terrainData: this.terrainData, terrainGPU: this.terrainGPU, renderer } );
		this.rocks = new Rocks( { scene, terrain: this.terrain, village: this.village, colliders: this.colliders } );
		// driftwood (CC0 photoscans), wrack, pebbles and village clutter
		this.debris = new Debris( { scene, terrain: this.terrain, village: this.village, vegetation: this.vegetation, rocks: this.rocks, colliders: this.colliders } );
		// these apply the heightfield sun shadow in their own lighting model (see UnderwaterLighting)
		this.terrain.mesh.material.appliesHillShadow = true;
		this.rocks.material.appliesHillShadow = true;

		await progress( 0.23, 'Growing the reef…' );
		this.reef = new Reef( { scene, terrain: this.terrainData, shoreField: this.shoreField } );

		this.boat = new BoatModel();
		scene.add( this.boat.group );
		this.boat.group.position.copy( WORLD.boatDock.position );
		this.boat.group.rotation.y = WORLD.boatDock.heading;

		// ---------------------------------------------------------------- ocean
		await progress( 0.3, 'Simulating the ocean…' );
		this.fft = new OceanFFT( renderer );
		if ( this.reef.setOcean ) this.reef.setOcean( this.fft ); // coral / sea fan sway follows the simulated swell
		this.foamTexture = createFoamTexture( renderer );
		this.oceanLOD = new CDLOD( { gridSize: Number( qs.get( 'G' ) || 32 ), leafSize: 8, levels: 12, minY: - 25, maxY: 25 } );
		this.surface = new WaterSurface( { fft: this.fft, cdlod: this.oceanLOD, foamTexture: this.foamTexture } );
		this.surface.terrain = this.terrainGPU;
		this.seaDetail = new SeaDetail();
		this.surface.detail = this.seaDetail;
		this.shore = new ShoreWaves( this.terrainGPU );
		this.surface.shore = this.shore;
		this.caustics = qs.has( 'noCaustics' ) ? null : new Caustics( renderer, this.fft );
		if ( this.caustics ) this.caustics.detail = this.seaDetail;

		if ( ! qs.has( 'noSim' ) ) {

			this.shoreSim = new ShoreSim( renderer, { terrainGPU: this.terrainGPU, shore: this.shore } );
			this.surface.shoreSim = this.shoreSim;
			// WGSL: fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f (x = wetness, y = sand foam)
			this.terrain.wetness = {
				modules: [ this.shoreSim.module ],
				code: /* wgsl */`
fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f {
	let s = shoreSimSample( xz );
	let inside = shoreSimInside( shoreSimUvOf( xz ) );
	// outside the simulated region fall back to a static damp band
	let band = smoothstep( 0.45, 0.0, h );
	// foam left on the sand: the lace the water carried, stranded and popping (ShoreSim.sandFoam)
	return vec2f( max( s.y, band * ( 1.0 - inside ) ), shoreSimSandFoam( xz, s, h ) );
}`,
			};
			this.terrain.finalizeMaterial();
			// surf-zone foam look (whitewater, lace) used by the water shader
			this.surfFoam = new SurfFoam( { shoreSim: this.shoreSim } );
			this.surface.foamShading = ( args ) => this.surfFoam.shading( args );

		}

		// how much of the underwater lighting each group needs (sampler budget, see UnderwaterLighting)
		const underwaterMode = ( root, m ) => root && root.traverse( ( o ) => {

			if ( o.material ) for ( const mat of Array.isArray( o.material ) ? o.material : [ o.material ] ) mat.underwaterLighting = m;

		} );
		underwaterMode( this.village.group, 'lite' );
		underwaterMode( this.boat.group, 'lite' );
		if ( this.vegetation ) underwaterMode( this.vegetation.group, 'none' );

		this.underwaterLighting = installUnderwaterLighting( {
			fft: this.fft, caustics: this.caustics, clouds: this.clouds, terrain: this.terrainGPU,
			shore: this.shore, surface: this.surface, shoreSim: this.shoreSim,
		} );

		// sunlight bounced off the ground (one diffuse bounce, re-baked with the terrain sun shadow)
		installGroundBounce( { terrain: this.terrainGPU, clouds: this.clouds } );
		this.sceneRenderer = new SceneRenderer( engine.meshRenderer, scene, camera );
		// the water's refraction source: the scene below the water only, half resolution
		this.refraction = new RefractionPass( { meshRenderer: engine.meshRenderer, scene, camera, sceneRenderer: this.sceneRenderer, scale: 0.5 } );
		this.sceneRenderer.onBeforeWater = () => this.refraction.render( G.seaLevel.value );
		if ( this.sky.background ) this.sceneRenderer.background = this.sky.background;
		// lanterns, lamp posts, path lights, lit windows, the boat's cabin / navigation lights and the
		// flashlight (L): nearest few packed into one small uniform array each frame
		this.localLights = new LocalLights();
		addVillageLights( this.localLights, this.village );
		this.boatLights = addBoatLights( this.localLights, this.boat );
		this.caves = await CaveSystem.load( { scene, terrain: this.terrainData, colliders: this.colliders, localLights: this.localLights } );
		this.monorail = new MonorailSystem( { scene, cave: this.caves, localLights: this.localLights } );
		// rough, large or heavily overdrawn surfaces (ground, rocks, debris, foliage) take the local
		// lights as Lambert only; the village, pier and boat get the full BRDF (glints on wet wood, metal)
		for ( const root of [ this.terrain.mesh, this.rocks.group, this.debris && this.debris.group, this.vegetation && this.vegetation.group ] ) if ( root ) root.traverse( ( o ) => {

			if ( o.material ) for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) m.localLightsCheap = true;

		} );
		// the sea is not drawn inside the boat (its hull volume masks the surface)
		this.sceneRenderer.addHullMask( this.boat.createHullVolumeGeometry(), this.boat.group );
		this.waterMaterial = new WaterMaterial( {
			surface: this.surface, sky: this.sky, sceneCopy: this.sceneRenderer.opaqueCopy, sceneDepthHalf: this.sceneRenderer.opaqueDepthHalf.texture, refraction: this.refraction,
			hullMask: this.sceneRenderer.hullMaskRT.texture, hullMaskActive: this.sceneRenderer.hullMaskActive,
		} );
		this.sceneRenderer.waterMaterial = this.waterMaterial;
		this.waterMaterial.clouds = this.clouds;
		this.ocean = new Mesh( this.oceanLOD.geometry, this.waterMaterial );
		this.ocean.frustumCulled = false;
		this.ocean.receiveShadow = true;
		this.ocean.layers.set( LAYERS.WATER );
		// Thin alpha-tested meshes (nets, cloth, wire traps) are drawn in the late pass: the screen-space
		// AO and the refraction copy only see the opaque pass, so they neither smear dark AO halos over
		// what is behind them nor receive the noisy AO of their own strands. The boat's window glass is
		// blended: in the late pass it goes over the water seen through it (drawn earlier it would be
		// painted over by the water).
		this.scene.traverse( ( o ) => {

			if ( o.isMesh && ( o.name === 'village_fabric' || o.name === 'village_nets' || o.name === 'boat-trap' || o.name === 'boat-glass' ) ) o.layers.set( LAYERS.TRANSPARENT );

		} );
		// Terrain and water place their vertices in the vertex shader (CDLOD), so three's default motion
		// vectors (previous frame = raw grid position) are garbage there. Both are still in the world or
		// nearly so: camera-only reprojection of the real world position is what the temporal resolve needs.
		// ( the water material writes its own velocity + waterline mask outputs )
		useStaticVelocity( this.terrain.mesh );
		useStaticVelocity( this.rocks.group );
		scene.add( this.ocean );

		this.query = new WaterQuery( renderer, this.surface );

		this.marineSnow = new MarineSnow( { fft: this.fft, query: this.query } );
		scene.add( this.marineSnow.mesh );

		// ---- surf: plunging lips along the beach + spray particles (the breakers emit on the GPU;
		// spray.emit() / emitAlongPoints() for boat bow spray and splashes)
		this.spray = new Spray( renderer, { query: this.query, terrain: this.terrainGPU, sceneCopy: this.sceneRenderer.opaqueCopy, clouds: this.clouds } );
		scene.add( this.spray.mesh );
		this.kaiju = new KaijuEncounter( { scene, terrain: this.terrainData, spray: this.spray } );
		try {

			await this.kaiju.load();

		} catch ( e ) {

			console.warn( 'Godzilla encounter failed to load', e );
			this.kaiju = null;

		}
		if ( this.reef.setSpray ) this.reef.setSpray( this.spray ); // splashes of leaping fish
		this.breakers = new Breakers( renderer, {
			surface: this.surface, shore: this.shore, terrainData: this.terrainData, sky: this.sky,
			spray: this.spray, clouds: this.clouds,
		} );
		scene.add( this.breakers.mesh );
		// dust, pollen, salt aerosol, seed fluff and gnats drifting around the camera
		this.airMotes = new AirMotes( { terrain: this.terrainGPU, clouds: this.clouds, csm: this.csm, reversedDepth: true } );
		scene.add( this.airMotes.mesh );
		this.boatCtl = new BoatController( { model: this.boat, query: this.query, terrain: this.terrainData, colliders: this.colliders, cave: this.caves } );
		this.boatSpray = new BoatSpray( { boat: this.boatCtl, spray: this.spray } );
		// humpback cruising the deep water around the island (model fetched from public/models/whale)
		this.whale = new Whale( { scene, terrain: this.terrainData, query: this.query, spray: this.spray } );
		try {

			await this.whale.load();
			if ( this.reef && this.reef.setWhale ) this.reef.setWhale( this.whale ); // escort fish, foam and slick

		} catch ( e ) {

			console.warn( 'whale model failed to load', e );
			this.whale = null;

		}

		// interactive wake around the boat (Kelvin pattern, bow/stern waves, prop wash foam)
		this.wake = new WakeSim( renderer, { terrainGPU: this.terrainGPU, boat: this.boatCtl, colliders: this.colliders } );
		this.surface.wake = this.wake;
		this.player = new Player( { camera, input: this.input, terrain: this.terrainData, colliders: this.colliders, query: this.query, boat: this.boatCtl, reef: this.reef, spray: this.spray, cave: this.caves, transit: this.monorail } );
		this.avatar = new PlayerAvatar( scene, this.boatCtl );
		this.avatarChooser = new AvatarChooser({ app: this });
		this.thirdIsland = new ThirdIslandSystem( this );
		// The reference-guided candidate is a local experiment. Keep its images and
		// restricted GLB out of production bundles, including opt-in URLs.
		this.aiWarehouse = null;
		if ( import.meta.env.DEV && qs.has( 'aiWarehouse' ) ) {
			const { ImageGuidedWarehouse } = await import( './world/ImageGuidedWarehouse.js' );
			this.aiWarehouse = new ImageGuidedWarehouse( this );
		}
		this.fourthIsland = new FourthIslandSystem( this );
		this.fifthIsland = new IslandFiveSystem( this );
		this.portIsland = new PortIslandSystem( this );
		this.monorail.restorePlayer( this.player );
		if ( this.landscapeSpec || qs.has( 'procedural' ) ) {
			this.procedural = new ProceduralWorld( this, this.landscapeSpec?.seed ?? PROCEDURAL_SEED, { landscapeSpec: this.landscapeSpec, landscapeEdits: this.landscapeDocument?.terrain ?? [], worldId: this.landscapeDocument?.worldId } );
			const saved = this.procedural.savedPosition;
			const spawn = this.landscapeSpec ? landscapePathLayout( this.landscapeSpec, this.landscapeDocument?.terrain ?? [] ).spawn : null;
			const x = saved?.[0] ?? spawn?.x ?? 100, z = saved?.[2] ?? spawn?.z ?? 584;
			const y = saved?.[1] ?? this.player.groundAt( x, z, 1000 );
			this.monorail.teleport( this.player, x, y, z, this.landscapeSpec ? - Math.PI / 2 : Math.PI );
			if ( typeof window !== 'undefined' ) window.__procedural = this.procedural;
		}
		if ( this.landscapeSpec?.structures.some( placement => placement.assetId === 'abandoned-warehouse' ) ) {
			try { this.landscapeWarehouse = new LandscapeWarehouse( this, this.landscapeSpec ); }
			catch ( error ) { this.landscapeWarehouseError = error; console.warn( 'Generated warehouse could not be placed', error ); }
		}
		if ( qs.has( 'landscapeBuilder' ) ) {
			this.landscapeBuilder = new LandscapeBuilder( {
				spec: this.landscapeDocument?.spec ?? this.landscapeSpec ?? readSavedLandscapeSpec() ?? undefined,
				worldDocument: this.landscapeDocument,
				onGetPosition: () => ( { x: this.player.position.x, z: this.player.position.z } ),
				onGoHome: this.landscapeSpec ? () => {
					if ( this.thirdIsland.portalInterior.inside ) { this.thirdIsland.portalInterior.c64.close(); this.thirdIsland.portalInterior.exit(); }
					const x = 100, z = 584;
					this.monorail.teleport( this.player, x, this.player.groundAt( x, z, 1000 ), z, Math.PI );
				} : undefined,
				onGoLandscape: this.landscapeSpec ? () => {
					if ( this.thirdIsland.portalInterior.inside ) { this.thirdIsland.portalInterior.c64.close(); this.thirdIsland.portalInterior.exit(); }
					const spawn = landscapePathLayout( this.landscapeSpec, this.landscapeDocument?.terrain ?? [] ).spawn;
					this.monorail.teleport( this.player, spawn.x, this.player.groundAt( spawn.x, spawn.z, 1000 ), spawn.z, - Math.PI / 2 );
				} : undefined,
			} );
			if ( qs.get( 'generated' ) === '1' && ! this.landscapeSpec ) this.landscapeBuilder.notice( 'Saved landscape is missing or invalid. Review and save the specification before exploring.', true );
			if ( this.landscapeWarehouseError ) this.landscapeBuilder.notice( 'Generated warehouse could not be placed. The original island remains available; move the structure onto dry land and save again.', true );
		}
		this.pistol = new SurvivalPistol( scene );
		// birds, beach crabs, sanderlings (after spray / query / boat, which they use)
		this.wildlife = new Wildlife( {
			scene, renderer, terrain: this.terrainData, terrainGPU: this.terrainGPU, shore: this.shore,
			village: this.village, colliders: this.colliders, vegetation: this.vegetation, boat: this.boatCtl, boatModel: this.boat,
			query: this.query, spray: this.spray, csm: this.csm,
		} );
		this.freeCam = qs.has( 'fly' );

		// ---------------------------------------------------------------- post
		await progress( 0.34, 'Preparing the shaders…' );
		this.underwater = new Underwater( {
			depthTexture: this.sceneRenderer.sceneRT.depthTexture, maskTexture: this.sceneRenderer.waterMaskTexture,
			query: this.query, caustics: this.caustics, fft: this.fft,
		} );
		// the camera's height above the water in the same frame (GPU query): decides the side the surface
		// is seen from where the triangle facing can't be trusted
		this.waterMaterial.cameraWaterHeightNode = this.query.cameraState().x;
		// aerial perspective, marine haze and volumetric sun shafts (post)
		this.haze = qs.has( 'noHaze' ) ? null : new AirHaze( {
			depthTexture: this.sceneRenderer.sceneRT.depthTexture, underwater: this.underwater, atmosphere: this.atmosphere,
			sky: this.sky, clouds: this.clouds, terrain: this.terrainGPU, csm: this.csm,
		} );
		this.post = new PostFX( renderer, { sceneRenderer: this.sceneRenderer, camera, underwater: this.underwater, clouds: this.clouds, sunDir: this.atmosphere.sunDir, haze: this.haze } );
		G.exposure.value = this.settings.exposure;
		// Agent Control: automatic budgets apply to Windows and mobile as well as Linux.
		this.adaptiveResolution = new AdaptiveResolution();
		this.setQuality(qs.get('quality') || 'auto');
		this.setTerrainShading(qs.get('terrainShading'));
		if (qs.has('scale')) {
			this.settings.autoResolution = false;
			this.setRenderScale(Number(qs.get('scale')) || 1);
		}

		// ---------------------------------------------------------------- audio
		// recorded field recordings (public/audio, credits in public/audio/CREDITS.md); ?noAudio turns it off
		this.audio = qs.has( 'noAudio' ) ? null : new SoundScape();
		this.player.audio = this.audio;
		// Esmie is an internal voice for the complete world, independent of location.
		this.esmie = new WarehouseGhost( this );
		// the fishing game (rod, bites, catch, cooler, fish stand)
		this.game = new Game( this );
		this.needs = new SurvivalNeeds( this.game );
		this.player.needs = this.needs;
		// the lanterns at Joe's fish stand and Marta's chandlery (lit from dusk like the village lamps);
		// positions are in each stall's frame (x right, z toward the customer), turned by its yaw
		for ( const [ s, lx, ly, lz ] of [ [ STAND, - 0.9, 1.85, 0.1 ], [ CHANDLERY, - 0.75, 1.58, - 1.45 ] ] ) {

			const c = Math.cos( s.yaw ), sn = Math.sin( s.yaw );
			const x = s.x + lx * c + lz * sn, z = s.z - lx * sn + lz * c;
			this.localLights.add( { position: new Vector3( x, this.terrainData.heightAt( s.x, s.z ) + ly, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );

		}

		this.boatCtl.onSlam = ( s ) => this.audio && this.audio.hullSlap( s );
		engine.domElement.addEventListener( 'click', () => {

			if ( window.__ui && window.__ui.isPointerOverUI ) return;
			this.input.requestLock();
			if ( this.audio ) this.audio.resume();

		} );

		this.profiler = new Profiler( renderer );
		this.profiler.track( 'fft rows', this.fft.rowKernel );
		this.profiler.track( 'fft columns', this.fft.columnKernel );
		this.profiler.track( 'sky view', this.atmosphere.skyViewKernel );

		this.updateSun();
		installDebugViews( this );
		window.__app = this;
		this.gpu = GPU; // console / test access

		// ---- compile pipelines asynchronously (keeps the page responsive), then prime a few
		// frames behind the loading screen so any remaining first-use stalls happen there
		// stage weights: in the browser the pipeline compile below takes far longer than everything before it
		await progress( 0.36, 'Compiling shaders…', 0.95 );
		await this.precompile();
		await progress( 0.96, 'Warming up…' );
		for ( let i = 0; i < 2; i ++ ) {

			this.frame( 1 / 60 );
			await GPU.queue.onSubmittedWorkDone();

		}
		if ( this.qs.has( 'view' ) ) window.__view?.( this.qs.get( 'view' ) );

	}

	// Build every pipeline up front, then wait for the GPU (keeps first-use compiles behind the loading
	// screen). The precompile frame visits every mesh of every pass, hidden or out of view, and the
	// pipelines compile in parallel in the background (GPU.renderPipeline); the refraction pass and
	// the hull mask are forced on so their variants are built too.
	async precompile() {

		const mr = this.engine.meshRenderer;
		const refr = this.refraction.enabled;
		const terrainSimple = this.terrain.simpleShading;
		// compute / post pipelines were requested while the systems were built: let them finish first
		// (the frame below would otherwise compile each one again, synchronously); the post chain
		// builds its passes on first use, so build it now
		if ( ! this.post._built ) {

			this.post._build();
			this.post._outW = 0; // as PostFX.beginFrame: size the new targets

		}

		await GPU.pipelinesReady();
		mr.precompiling = true;
		this.refraction.enabled = true;
		const sr = this.sceneRenderer, hm = sr.hullMaskRT;
		if ( sr.hullMasks.length ) mr.render( sr.hullMaskScene, {
			label: 'hull mask', kind: 'color', camera: this.camera, colorViews: [ hm.texture.view() ], colorFormats: hm.formats,
			clearColors: [ [ 0, 0, 0, 0 ] ], depthView: hm.depthTexture.view(), depthFormat: DEPTH_FORMAT, clearDepth: 0, cull: false,
		} );
		try {

			// both water variants: with the hull-mask discard (a hull on screen) and without
			for ( const simple of [ false, true ] ) for ( const hull of [ 0, 1 ] ) {

				this.terrain.simpleShading = simple;
				this.waterMaterial.hullOverride = hull;
				this.frame( 1 / 60 );

			}

		} catch ( e ) {

			console.warn( 'precompile failed', e );

		}

		this.waterMaterial.hullOverride = null;
		this.terrain.simpleShading = terrainSimple;
		mr.precompiling = false;
		this.refraction.enabled = refr;
		await GPU.pipelinesReady();
		await GPU.queue.onSubmittedWorkDone();

	}

	// ---------------------------------------------------------------- sun / sky

	updateSun() {

		const s = this.settings;
		const dir = sunDirectionFromTime( s.timeOfDay ).applyAxisAngle( _up, MathUtils.degToRad( s.sunAzimuth || 0 ) );
		// the sky is always scattered sunlight, even with the sun below the horizon (twilight)
		this.atmosphere.sunDir.value.copy( dir );
		// below the horizon the moon takes over as the key light
		const night = MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
		G.night.value = night;
		this.sky.starIntensity.value = night;
		const moon = new Vector3( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
		this.sky.moonDir.value.copy( moon );

		// key light: the sun until it is well below the horizon (it gives no direct light in
		// twilight anyway), then the moon
		const light = dir.y > - 0.07 ? dir : moon;
		G.sunDir.value.copy( light );

	}

	applyAtmosphereReadback() {

		const a = this.atmosphere;
		if ( ! a.sunTransmittance ) return;
		const sunTrue = a.sunDir.value;
		const sunUp = sunTrue.y > - 0.07; // same switch as updateSun()
		const T = a.sunTransmittance;
		const horizonFade = MathUtils.smoothstep( sunTrue.y, - 0.03, 0.02 );
		let c;
		if ( sunUp ) c = new Color( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( SUN_ILLUMINANCE * horizonFade );
		else c = new Color( 0.6, 0.7, 1.0 ).multiplyScalar( 0.12 * G.night.value );
		G.sunColor.value.copy( c );
		const irr = a.skyIrradiance;
		const nightAmb = 0.012 * G.night.value;
		G.skyIrradiance.value.setRGB( irr[ 0 ] + nightAmb * 0.6, irr[ 1 ] + nightAmb * 0.7, irr[ 2 ] + nightAmb );
		G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );

	}

	// T: let the day run (about 8 minutes per day) or stop it
	toggleTime() {

		const s = this.settings;
		s.clockMode = 'manual';
		s.localTime = false;
		if ( s.timeSpeed !== 0 ) {

			this._timeSpeed = s.timeSpeed;
			s.timeSpeed = 0;

		} else {

			s.timeSpeed = this._timeSpeed || 0.05;

		}

		if ( this.ui ) {

			this.ui.s.advance = s.timeSpeed !== 0;
			this.ui.ui.refresh();
			this.ui.ui.toast( s.timeSpeed !== 0 ? 'Time running' : 'Time paused' );

		}

	}

	// Free (debug) camera on F; the walker / boat resumes where it was left.
	setFreeCam( on ) {

		if ( on === this.freeCam ) return;
		this.freeCam = on;
		if ( on ) {

			const e = new Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
			this.fly.setPose( this.camera.position.clone(), e.y, e.x );
			this.fly.velocity.set( 0, 0, 0 );

		} else if ( this.player.mode !== 'boat' && this.player.mode !== 'deck' ) {

			this.dropPlayerAtCamera();

		}

	}

	// Leaving the free camera: the player continues from where the camera is, facing the same way,
	// and falls from there (swimming at once if the camera is under water).
	dropPlayerAtCamera() {

		const p = this.player, c = this.camera.position;
		const e = new Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
		p.yaw = e.y;
		p.pitch = MathUtils.clamp( e.x, - 1.5, 1.5 );
		p.velocity.set( 0, 0, 0 );
		const ground = Math.max( this.terrainData.heightAt( c.x, c.z ), this.colliders.groundHeightAt( c.x, c.z, c.y ) );
		const water = this.cameraWaterHeight ?? 0;
		if ( c.y < water ) {

			p.mode = 'swim';
			p.position.set( c.x, Math.max( c.y - 0.16, ground + 0.3 ), c.z );

		} else {

			// drop from where the camera is: gravity brings you down onto the ground or a deck, or into
			// the sea (the walker starts swimming once it is out of its depth)
			p.mode = 'walk';
			p.position.set( c.x, Math.max( c.y - 1.62, ground ), c.z );
			p.grounded = false;

		}

		p.waterH = water;
		p.waterMean = water;

	}

	// ---------------------------------------------------------------- loop

	start() {

		this.engine.start( ( dt, t, timing ) => this.frame( dt, t, timing ) );

	}

	updateFPS( timing ) {
		// Direct app.frame(dt) calls are controlled simulation/render work, not
		// display samples. Their dt (often zero) must not drive FPS or adaptation.
		if ( ! timing ) return;
		const f = this._fps || ( this._fps = { el: document.getElementById( 'fps' ), meter: new FrameRate() } );
		if ( timing.reset ) {
			f.meter.reset();
			this.adaptiveResolution.reset();
		}
		if ( ! timing.valid ) return;
		const dt = timing.wallDt;
		if (this.settings.autoResolution && !this.qs.has('bench') && !document.hidden) {
			const scale = this.adaptiveResolution.update(dt, this.settings.renderScale, QUALITY[this.settings.qualityProfile].scale);
			if (scale !== this.settings.renderScale) this.setRenderScale(scale);
		}

		const sample = f.meter.update( dt );
		if ( sample ) {

			let text = `${ sample.fps.toFixed( 0 ) } fps · ${ sample.meanMs.toFixed( 1 ) } ms · max ${ sample.worstMs.toFixed( 1 ) } ms`;
			if ( this.profiler && this.profiler.enabled ) {

				const p = this.profiler.result;
				text += ` · GPU partial sample (${ this.profiler.nodes.size } tracked passes): c ${ p.compute.toFixed( 2 ) } r ${ p.render.toFixed( 2 ) } ms`;

			}

			if ( f.el ) f.el.textContent = text;
			this.fps = sample.fps;
			this.frameStats = sample;

		}

	}

	frame( dt, _elapsed, timing = this.engine?.activeFrameTiming ) {

		const t0 = performance.now();
		this._frame( dt, timing );
		const ms = performance.now() - t0;
		this.cpuMs = this.cpuMs === undefined ? ms : this.cpuMs * 0.95 + ms * 0.05;

	}

	_frame( dt, timing ) {

		GPU.beginFrame();
		FrameUniforms.fields.frameIndex.value = GPU.frame;
		const s = this.settings;
		this.updateFPS( timing );
		G.dt.value = dt;
		G.time.value += dt;
		if ( s.clockMode === 'local' ) {
			const now = new Date();
			s.timeOfDay = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
		} else if ( s.timeSpeed !== 0 ) s.timeOfDay = ( s.timeOfDay + dt * s.timeSpeed + 24 ) % 24;

		// ---- player / boat (boat physics first so the cameras follow this frame's pose)
		if ( this.input.hit( 'KeyK' ) ) this.avatarChooser.show();
		if ( this.input.hit( 'KeyF' ) && !this.thirdIsland.active ) this.setFreeCam( ! this.freeCam );
		if ( this.input.hit( 'KeyT' ) ) {
			if ( this.networkDemo?.online ) this.networkDemo.openTalk();
			else this.toggleTime();
		}
		if ( this.input.hit( 'KeyL' ) ) {

			const on = this.localLights.toggleFlashlight();
			if ( this.ui ) this.ui.ui.toast( on ? 'Flashlight on' : 'Flashlight off' );

		}

		if ( this.input.hit( 'KeyM' ) && this.audio ) {

			this.audio.setMuted( ! this.audio.muted );
			if ( this.ui ) this.ui.ui.toast( this.audio.muted ? 'Sound off' : 'Sound on' );

		}
		this.boatCtl.update( dt );
		this.caves.update( dt );
		this.boatSpray.update( dt );
		if ( this.kaiju ) this.kaiju.update( dt );
		this.wake.update( dt );
		if ( this.freeCam ) {

			this.fly.update( dt );
			// Named review views are user-facing inspection cameras. Keep them above the
			// terrain or water so descending cannot expose the underside of the world.
			if ( this.qs.has( 'view' ) ) {

				const c = this.camera.position;
				const terrain = this.terrainData.heightAt( c.x, c.z );
				const collider = this.colliders.groundHeightAt( c.x, c.z, 1000 );
				const floor = reviewCameraMinimumHeight( terrain, collider, this.cameraWaterHeight ?? 0 );
				if ( c.y < floor ) {

					c.y = floor;
					this.fly.velocity.y = Math.max( 0, this.fly.velocity.y );

				}

			}

		}
		else if ( this.monorail.state !== 'riding' && !this.thirdIsland.active && !this.portIsland.driving ) this.player.update( dt );
		if ( ! this.freeCam && !this.thirdIsland.active ) this.monorail.update( dt, this.player, this.input, this.camera, ( message ) => this.ui?.ui.toast( message ) );
		this.thirdIsland.update( dt );
		this.aiWarehouse?.update();
		this.fourthIsland.update( dt );
		this.fifthIsland.update( dt );
		this.portIsland.update( dt );
		if ( this.procedural ) this.procedural.update( dt );
		this.esmie.update( dt );
		this.monorail.marine.update(dt, this.camera.position);
		this.avatar.update( dt, this.player, this.camera, this.freeCam );
		if ( this.portIsland.driving ) this.avatar.group.visible = false;
		if ( this.networkDemo ) this.networkDemo.update( dt );
		this.pistol.update( dt, this.camera, this.input, ! this.freeCam && this.monorail.state !== 'riding' && this.player.mode === 'walk', ( message ) => this.ui?.ui.toast( message ) );
		this.game.update( dt );
		this.needs.update( dt, this.input, ( message ) => this.ui?.ui.toast( message ) );
		this.updateSun();

		this.atmosphere.update( dt, this.camera.position.y );
		this.applyAtmosphereReadback();

		// ---- water simulation
		this.fft.update( dt );
		this.seaDetail.update( dt );
		this.query.setCamera( this.camera.position.x, this.camera.position.z );
		this.boatCtl.queueQueries();
		this.query.update();
		if ( this.query.cpuValid ) {

			const h0 = this.query.cpu[ 0 ];
			const h = Number.isFinite( h0 ) ? h0 : ( this.cameraWaterHeight ?? 0 );
			G.cameraUnderwater.value = this.camera.position.y < h - LENS_REACH ? 1 : 0;
			G.cameraWaterHeight.value = h;
			this.cameraWaterHeight = h;

		}
		const dryTransit = this.monorail.isDryAt( this.camera.position.x, this.camera.position.z, this.camera.position.y );
		this.underwater.enabled.value = dryTransit ? 0 : 1;
		if ( dryTransit ) {
			G.cameraUnderwater.value = 0;
			G.cameraWaterHeight.value = -100;
			this.cameraWaterHeight = -100;
		}

		if ( this.caustics ) this.caustics.update();
		// drawn while any part of the view can be under water (the specks above the surface are dropped)
		this.marineSnow.update( this.camera, this.camera.position.y < ( this.cameraWaterHeight ?? 0 ) + LENS_REACH );
		this.airMotes.update( dt, this.camera, this.cameraWaterHeight ?? 0 );
		if ( this.shoreSim ) this.shoreSim.update();
		this.underwaterLighting.update( this.camera );
		this.breakers.update( this.camera );
		this.spray.update();
		if ( this.clouds ) this.clouds.update( dt, this.camera );
		this.environment.update( dt );

		// ---- world
		this.oceanLOD.update( this.camera );
		this.terrain.update( this.camera );
		// The island heightfield has no excavated rail bore. Keep its surface for
		// outside views, but do not let seabed triangles cross the dry glass tube.
		const insideCave = this.camera.position.x > -333 && !! this.caves.zoneAt( this.camera.position.x, this.camera.position.z ) &&
			this.camera.position.y < this.terrainData.heightAt( this.camera.position.x, this.camera.position.z ) - 1.5;
		this.terrain.mesh.visible = ! dryTransit && ! insideCave;
		this.rocks.group.visible = ! insideCave;
		if ( this.vegetation ) this.vegetation.group.visible = ! insideCave;
		if ( this.debris?.group ) this.debris.group.visible = ! insideCave;
		this.rocks.update( this.camera );
		this.debris.update( this.camera );
		this.reef.update( dt, this.camera.position );
		this.village.update( dt );
		if ( this.vegetation ) this.vegetation.update( dt, this.camera );
		if ( this.whale ) this.whale.update( dt, this.camera );
		this.boat.update( dt );
		this.wildlife.update( dt, this.camera, this.freeCam ? null : this.player );
		this.localLights.update( this.camera, dt );
		const beam = this.boatLights[ 0 ];
		const beamOther = this.boatLights[ 1 ];
		const beamStrength = Math.max( 0, Math.min( 1, ( G.night.value - 0.15 ) / 0.6 ) );
		this.waterMaterial.uniforms.boatBeamPos.value.set( ( beam.position.x + beamOther.position.x ) * 0.5, ( beam.position.y + beamOther.position.y ) * 0.5, ( beam.position.z + beamOther.position.z ) * 0.5, beamStrength );
		this.waterMaterial.uniforms.boatBeamDir.value.set( beam.dir.x, beam.dir.y, beam.dir.z, beam.range );

		// ---- render
		G.exposure.value = s.exposure;
		updateCameraVelocity( this.camera );
		this.post.lens.update( dt, this.camera.position.y < ( this.cameraWaterHeight ?? 0 ) );
		if ( this.post.flare ) {

			this.post.flare.setDepthHeight( this.sceneRenderer.sceneRT.height );
			this.post.flare.update( this.camera, dt, { aboveWater: this.camera.position.y > ( this.cameraWaterHeight ?? 0 ) - 0.02 } );

		}

		// the post chain sets the TAAU jitter + internal size and writes the camera into the frame
		// uniforms (setFrameCamera); shadows then render with this frame's sun and camera
		this.post.beginFrame();
		this.underwater.updateCamera( this.camera );
		// World simulation is complete. Main-scene transforms remain stable across
		// shadow, opaque, refraction and transparent passes. Portraits and later
		// auxiliary renders stay outside this optional optimization scope.
		this.engine.meshRenderer.withSceneTransforms( this.scene, () => {

			this.shadows.render( this.scene, this.engine.meshRenderer, this.shadows.update( this.camera, G.sunDir.value ) );
			this.sceneRenderer.render();

		} );
		if ( this.post.flare ) this.post.flare.kernel.dispatch( 1 );
		this.post.render();
		this.post.endFrame();
		this.game?.salvage?.renderCamera( performance.now() );
		GPU.submit();
		this.profiler.update( dt );

		this.updateAudio( dt );
		if ( this.ui ) this.ui.update( dt );
		this.input.endFrame();

	}

	// Agent Control: manual resolution changes remain available beside the adaptive profile.
	setQuality(name = 'auto') {
		const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
		const profile = qualityFor(name, mobile), q = QUALITY[profile];
		this.settings.quality = name;
		this.settings.qualityProfile = profile;
		this.settings.autoResolution = name === 'auto';
		this.engine.maxOutputPixels = q.pixels;
		this.engine.resize();
		this.refraction.scale = q.refraction;
		this.shadows.enabled = q.shadows;
		this.waterMaterial.params.ssr.value = q.reflections ? 1 : 0;
		this.setRenderScale(q.scale);
		this.adaptiveResolution?.reset();
	}

	setTerrainShading( value ) {

		const mode = value === 'simple' ? 'simple' : 'full';
		const changed = this.settings.terrainShading !== mode;
		this.settings.terrainShading = mode;
		this.terrain.simpleShading = mode === 'simple';
		if ( changed ) this.post?.taau?.resetHistory();
		return mode;

	}

	setRenderScale( v ) {

		const scale = MathUtils.clamp( Math.round( v * 20 ) / 20, 0.5, 1 );
		this.settings.renderScale = scale;
		this.post.setScale( scale );
		if ( this.clouds ) this.clouds.resolutionScale = scale;

	}

	updateAudio( dt ) {

		if ( ! this.audio || ! this.audio.enabled ) return;
		const cam = this.camera;
		const p = cam.position;
		const f = this._af || ( this._af = { fwd: new Vector3(), up: new Vector3() } );
		cam.getWorldDirection( f.fwd );
		f.up.set( 0, 1, 0 ).applyQuaternion( cam.quaternion );
		const h = this.cameraWaterHeight ?? 0;
		const coast = this.terrainData.coastDistance( p.x, p.z ).d;
		this.audio.update( dt, {
			listener: { position: p, forward: f.fwd, up: f.up },
			underwater: p.y < h ? 1 : 0,
			depthBelowSurface: Math.max( 0, h - p.y ),
			surfIntensity: Math.min( 1, this.shore.amplitude.value / 0.6 ),
			distanceToShore: Math.abs( coast ),
			coastDistance: coast,
			waveHeight: this.shore.amplitude.value * 2,
			windSpeed: G.windSpeed.value,
			windDir: G.windDir.value,
			daylight: 1 - G.night.value,
			nearPier: Math.abs( p.x - WORLD.pier.x ) < 12 && p.z > WORLD.pier.zStart - 5 && p.z < WORLD.pier.zEnd + 8,
			boat: {
				active: this.boatCtl.driven, rpm: this.boatCtl.rpm, throttle: this.boatCtl.throttle, speed: this.boatCtl.velocity.length(),
				position: this.boat.group.position, listenerInside: this.player.mode === 'boat' && this.player.camMode === 'first',
			},
		} );

	}

}
