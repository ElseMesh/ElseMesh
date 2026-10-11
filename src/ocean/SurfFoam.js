import { Texture, ShaderModule, commonModule } from '../engine/webgpu.js';
import { makeFoamLaceData } from './FoamLaceData.js';

// Surf-zone foam: the lace texture shared by the shore simulation, and the foam look used by the
// water shader (hooks called from WaterSurface.fragment and WaterMaterial.shade).
//
// Whitewater is a volume of bubbles: a dense mat that is bright from every side, with a lumpy,
// bubbly surface (darker in its own dips), tearing into patches and then into lace (thin bubble
// strands around clear holes) as it decays. Thin foam is translucent over the water colour.
//
// WGSL (this.module, prefix surfFoam; deps: shoreSim.module, shore.module):
//   struct SurfFoamArgs { coverage, foam, footprint, depth, bubbles: f32, lagXZ: vec2f, normal: vec3f,
//                         baseNormal: vec3f, fresh, sim: f32, simState: vec4f, roller: f32, P: vec3f }
//     (P: world position of the fragment — the pattern lives in world space; set it!)
//   struct SurfFoamInfo { foam, density, height, surf, ww, relief, selfShadow, cavity: f32,
//                         reliefPat, reliefK, thinPat, thinK, bubPat, bubK: f32 }
//     (height / relief = pattern x weight; the *Pat / *K split is what the lighting differentiates)
//   fn surfFoamShading( a: SurfFoamArgs ) -> SurfFoamInfo
//   fn surfFoamLight( info: SurfFoamInfo, N: vec3f, L: vec3f, V: vec3f, sun: vec3f, P: vec3f ) -> vec3f
//   fn surfFoamFlowLace( q: vec2f, flow: vec2f, salt: f32 ) -> vec4f

export const LACE_TILE = 3.5; // metres per tile of the lace texture

// Tileable lace texture (generated once on the CPU, with CPU mipmaps: no GPU pipeline needed)
//   R: distance to the nearest bubble strand (warped cell edges + noise contours), 0 on a strand,
//      1 in the middle of a hole: thresholding it by the foam amount gives a dense mat, foam with
//      holes, lace and thin strands as the foam decays
//   G: small bubbles clustered along the strands
//   B: soft mottling (foam density variation)
//   A: per-cell random value (staggers when stranded foam pops)
let cachedLace = null;

export function makeLaceTexture( size = 512 ) {

	if ( cachedLace ) return cachedLace;
	const t0 = performance.now();
	const data = makeFoamLaceData( size );
	const mips = [ { data, width: size, height: size } ];
	let src = data, s = size;
	while ( s > 1 ) {

		const h = s >> 1;
		const dst = new Uint8Array( h * h * 4 );
		for ( let y = 0; y < h; y ++ ) for ( let x = 0; x < h; x ++ ) for ( let c = 0; c < 4; c ++ ) {

			const a = src[ ( ( 2 * y ) * s + 2 * x ) * 4 + c ], b = src[ ( ( 2 * y ) * s + 2 * x + 1 ) * 4 + c ];
			const d = src[ ( ( 2 * y + 1 ) * s + 2 * x ) * 4 + c ], e = src[ ( ( 2 * y + 1 ) * s + 2 * x + 1 ) * 4 + c ];
			dst[ ( y * h + x ) * 4 + c ] = ( a + b + d + e + 2 ) >> 2;

		}

		mips.push( { data: dst, width: h, height: h } );
		src = dst;
		s = h;

	}

	// sampled with smpAnisoRepeat (linear, mipmapped, repeat)
	const tex = new Texture( { label: 'surfLace', width: size, height: size, format: 'rgba8unorm', mips: mips.length, usage: [ 'sample', 'copyDst' ] } );
	for ( let m = 0; m < mips.length; m ++ ) tex.upload( mips[ m ].data, { mip: m } );
	tex.userData = { ms: performance.now() - t0, size };
	// the same pattern for shaders with no sampler to spare: nearest, read with loads, filtered by
	// hand (see shoreSimLaceLoad)
	const near = new Texture( { label: 'surfLaceNearest', width: size, height: size, format: 'rgba8unorm', data, usage: [ 'sample', 'copyDst' ] } );
	tex.userData.nearest = near;
	tex.userData.mips = mips;
	cachedLace = tex;
	return tex;

}

// Foam look hooks for the water shader.
//   surface.foamShading = surfFoam   (WaterSurface.fragment calls surfFoamShading)
//   surfFoamLight( info, N, L, V, sun, P )   (WaterMaterial.shade)
//
// The pattern lives in world space, never in the coordinates of the displaced surface (those are
// squeezed and stretched by the big horizontal motion of the shore waves and would draw the foam
// into streaks). It is carried by the water with a dual-phase flow map: two copies of the pattern,
// half a cycle apart, each advected by the local flow (from ShoreSim) for one cycle and then
// re-placed at random, cross-faded so neither is ever stretched for long and the resets never show.
// Steep whitewater faces (bore / roller fronts) use a vertical projection that rolls down the face.
export class SurfFoam {

	constructor( { shoreSim } ) {

		this.sim = shoreSim;
		this.bump = 0.7; // relief of the whitewater and of thick foam (normal perturbation strength)
		this.period = 1.2; // s, flow map cycle
		this.maxFlow = 2.5; // m/s, the pattern lags behind faster flow (bounds the distortion per cycle)
		this.module = new ShaderModule( {
			name: 'surfFoam',
			deps: [ commonModule, shoreSim.module, shoreSim.shore.module ],
			bindings: { surfFoamLaceTex: { texture: shoreSim.lace } },
			code: this._code(),
		} );

	}

	_code() {

		const f = ( x ) => {

			const s = String( x );
			return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

		};

		return /* wgsl */`
struct SurfFoamArgs {
	coverage: f32,
	foam: f32,
	footprint: f32,
	depth: f32,
	bubbles: f32,
	lagXZ: vec2f,
	normal: vec3f,
	baseNormal: vec3f,
	fresh: f32,
	sim: f32,
	simState: vec4f,
	roller: f32,
	P: vec3f,
};

struct SurfFoamInfo {
	foam: f32,
	density: f32,
	height: f32,
	surf: f32,
	ww: f32,
	relief: f32,
	selfShadow: f32,
	cavity: f32,
	// relief split into world-space patterns and their weights: the weights come from values
	// interpolated across the water mesh (fresh whitewater, depth, footprint), so the screen-space
	// gradient of a weight is constant per triangle; differentiating the product drew every mesh
	// triangle as a flat facet into the foam. Only the patterns are differentiated.
	reliefPat: f32, // whitewater lumps (m), relief = reliefPat * reliefK
	reliefK: f32,
	thinPat: f32, // thin foam: height = thinPat * thinK + bubPat * bubK
	thinK: f32,
	bubPat: f32,
	bubK: f32,
};

// Henyey-Greenstein phase (1/sr)
fn surfFoamPhaseHG( cosT: f32, g: f32 ) -> f32 {
	let g2 = g * g;
	return ( ( 1.0 - g2 ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g2 - cosT * 2.0 * g, 1e-4 ), 1.5 );
}

fn surfFoamHash11( x: f32 ) -> f32 { return fract( sin( x * 91.7 + 17.3 ) * 43758.5453 ); }

// Lace distance (0 on a bubble strand .. 1 in a hole) at pattern coordinates q (m), carried by
// flow (m/s in the same coordinates) with the dual-phase flow map. salt decorrelates layers.
fn surfFoamFlowLace( q: vec2f, flow: vec2f, salt: f32 ) -> vec4f {
	let t = frame.time / ${ f( this.period ) };
	let v = clamp( flow, vec2f( - ${ f( this.maxFlow ) } ), vec2f( ${ f( this.maxFlow ) } ) ) * ${ f( this.period ) };
	var out = vec4f( 0.0 );
	for ( var k = 0; k < 2; k++ ) {
		let tk = t + ( f32( k ) * 0.5 + salt * 0.37 );
		let ph = fract( tk );
		let cycle = floor( tk ) + ( f32( k ) * 13.1 + salt * 5.7 );
		let jitter = vec2f( surfFoamHash11( cycle ), surfFoamHash11( cycle + 0.5 ) ) * 7.0;
		let p = ( q - v * ( ph - 0.5 ) ) / ${ f( LACE_TILE ) } + jitter;
		let w = 1.0 - abs( ph * 2.0 - 1.0 );
		out += textureSample( surfFoamLaceTex, smpAnisoRepeat, p ) * w;
	}
	return out; // the two weights always add up to 1
}

fn surfFoamBigAt( qq: vec2f, pflow: vec2f ) -> f32 {
	return sqrt( surfFoamFlowLace( qq / 6.0, pflow / 6.0, 2.0 ).x );
}

// coverage: total foam amount (0..1, all sources); foam: the default (offshore whitecap) foam;
// footprint: pixel size on the surface (m); depth: sea depth; bubbles: fine bubble detail;
// normal: surface normal; fresh: whitewater made by the breaking wave right here (roller,
// plunge point, swash front); sim: foam carried by the water (ShoreSim, already kept off the
// clear face of plunging waves); simState: shoreSimSample() at this pixel; roller: relief of
// the whitewater roller (m)
fn surfFoamShading( a: SurfFoamArgs ) -> SurfFoamInfo {
	// world position of the fragment (the pattern is in world space); a caller that left P unset
	// (zero) gets the rest position instead: close, but the lace then rides the horizontal wave motion
	let P = select( a.P, vec3f( a.lagXZ.x, frame.seaLevel, a.lagXZ.y ), all( a.P == vec3f( 0.0 ) ) );
	let xz = P.xz;
	let coverage = a.coverage;
	var opacity = a.foam;
	var density = sat( coverage );
	var height = 0.0;
	var wwOut = 0.0; // how much of it is whitewater (deeper crevices)
	var wwRelief = 0.0; // relief of the whitewater (m)
	var wwShadow = 1.0; // sun visibility inside the churn
	var wwCav = 1.0; // sky visibility in its crevices
	var reliefPat = 0.0; var reliefK = 0.0;
	var thinPat = 0.0; var thinK = 0.0;
	var bubPat = 0.0; var bubK = 0.0;
	// surf look near the beach, the default whitecap look offshore
	let surf = smoothstep( 7.0, 3.0, a.depth ) * shoreSimInside( shoreSimUvOf( xz ) );
	if ( surf > 0.0 && coverage > 0.04 ) {

		// flow of the water here, from the shore simulation (along the local wave direction)
		let dir = shoreDirAt( xz ).xy;
		let speed = a.simState.w;
		let flow = dir * speed;

		// --- pattern: world-space lace carried by the flow; on steep faces a vertical projection
		// (along the crest x height) rolling down the face with the roller
		// (from the normal of the wave itself: steep ripple facets must not switch the projection,
		// that drew combs of vertical streaks into the foam on flat water and on the swash)
		let steep = smoothstep( 0.82, 0.5, a.baseNormal.y );
		let ww = sat( a.fresh * 1.4 );
		// far pixels (a lace cell under a few pixels) only use the pattern's average (see "far" below):
		// skip the lace and whitewater lump lookups there
		let farOnly = a.footprint >= 0.12;
		var flat = vec4f( 0.5 );
		if ( ! farOnly ) { flat = surfFoamFlowLace( xz, flow, 0.0 ); }
		var lace = flat;
		// lumps of tumbling whitewater (~0.6 m), only where there is whitewater
		var lumps = 0.5;
		let tangent = vec2f( - dir.y, dir.x );
		// (compressed vertically: a front only a metre or two high must not show single lumps as columns)
		// (the along-crest coordinate warped by low-frequency noise: the 3.5 m lace tile must not repeat as a
		// row of identical lumps and spikes along the break)
		let al = dot( xz, tangent );
		let qv = vec2f( al + sin( al * 0.19 + 0.8 ) * 2.1 + sin( al * 0.47 + 2.9 ) * 0.6 + sin( P.y * 1.7 + al * 0.11 ) * 0.5, P.y * 1.1 );
		if ( steep > 0.01 && ! farOnly ) {
			let vert = surfFoamFlowLace( qv, vec2f( 0.0, -0.9 ), 1.0 );
			lace = mix( flat, vert, steep );
		}
		// Churning whitewater is a pile of foam lumps at several scales (tumbling masses ~1.3 m,
		// clumps ~0.5 m, bubble clusters ~0.2 m): a relief (m) for the normals, sunlit caps and
		// self-shadowed crevices (a short march toward the sun through the lump field)
		if ( ww > 0.02 && ! farOnly ) {
			let L = frame.sunDir;
			let pq = mix( xz, qv, steep );
			let pflow = mix( flow, vec2f( 0.0, -0.9 ), steep );
			let big = surfFoamBigAt( pq, pflow );
			let mid = sqrt( surfFoamFlowLace( pq / 2.2, pflow / 2.2, 3.0 ).x );
			lumps = big * 0.6 + mid * 0.4;
			let A = 0.22; // relief of the lumps (m)
			reliefPat = big * A + mid * ( A * 0.45 ) + ( 1.0 - lace.x ) * ( A * 0.12 );
			wwRelief = reliefPat * ww;
			// the sun direction in the pattern's coordinates, and its elevation above the local surface
			let Lp = mix( L.xz, vec2f( dot( L.xz, tangent ), L.y * 1.1 ), steep );
			let Ld = Lp / max( length( Lp ), 1e-3 );
			let NdL = dot( a.normal, L );
			let tanE = NdL / max( length( L - a.normal * NdL ), 0.05 );
			var occ = 0.0;
			let steps = array<f32, 3>( 0.14, 0.34, 0.7 );
			for ( var i = 0; i < 3; i++ ) {
				let d = steps[ i ];
				let hk = surfFoamBigAt( pq + Ld * d, pflow );
				occ = max( occ, smoothstep( 0.0, 0.05, ( hk - big ) * A - tanE * d ) );
			}
			wwShadow = 1.0 - occ * mix( 0.85, 0.7, steep );
			// crevices between the lumps: occluded from the sky too
			wwCav = mix( 0.5, 1.0, smoothstep( 0.05, 0.75, lumps ) );
		}

		// --- whitewater: the aerated mass of a roller / plunge / swash front. Dense and opaque, its
		// surface boiling: lumps with shaded crevices between them, bubble clusters on each; it only
		// tears (and shows water through) at its edges.
		let boil = lace.x * 0.7 + lace.z * 0.3;
		// (the edge of the churn is torn by its lumps: ragged fingers, not a clean boundary)
		let wwEdge = smoothstep( 0.25, 0.75, ww * 1.35 - boil * 0.3 - ( 1.0 - lumps ) * 0.5 );
		let whitewater = ( ww * 0.25 + wwEdge * 0.75 ) * ( ( 1.0 - boil ) * 0.12 + 0.88 );

		// --- foam carried by the water: a lacy web of bubble strands and clusters around holes. With
		// more foam the strands widen into a mat; as it spreads and thins it tears into filaments.
		// (w: strand half-width; the pattern covers 6% of the area at w = 0.1, 34% at 0.3, 82% at 0.6)
		let c = sat( ( a.sim + max( coverage - a.sim - a.fresh, 0.0 ) * 0.5 - 0.05 ) / 0.95 );
		// hole edges are ragged (bubble clusters), hole sizes vary between patches
		let w = max( pow( c, 1.4 ) * 0.9 * ( lace.z * 0.5 + 0.75 ) + ( lace.y - 0.5 ) * 0.06, 0.0 );
		let soft = 0.05 + a.footprint * 4.5;
		let mat = ( 1.0 - smoothstep( w - soft, w + soft, lace.x ) ) * smoothstep( 0.0, 0.05, c );
		// scattered bubbles in the holes next to the strands
		let bub = lace.y * smoothstep( w + 0.25, w, lace.x ) * smoothstep( 0.02, 0.2, c ) * 0.5;
		// thin foam is translucent and uneven, thick foam is opaque
		let inner = sat( ( w - lace.x ) / 0.25 );
		let laceFoam = max( mat * sat( inner * 0.35 + 0.45 + lace.z * 0.3 ), bub );

		// once a lace cell (~0.2 m) covers a few pixels, use the average of the pattern
		let far = smoothstep( 0.03, 0.12, a.footprint );
		let average = max( sat( pow( w, 1.45 ) * 1.9 ) * 0.8, ww * 0.95 );
		let near = max( laceFoam, whitewater );
		opacity = mix( a.foam, mix( near, average, far ), surf );

		// optical thickness (thin foam is translucent, thick foam scatters like snow) and a relief
		// height for the lighting: lumpy boiling whitewater, thick foam higher than its thin edges
		density = max( sat( c * 1.3 ) * ( inner * 0.5 + 0.5 ), ww );
		let reliefThin = inner * sat( c * 1.5 );
		let relief = reliefThin * ( 1.0 - ww );
		wwOut = ww * ( 1.0 - far * 0.6 );
		// far away the lumps average out: a mean shadowing of the churn instead
		wwShadow = mix( wwShadow, 0.82, far );
		wwCav = mix( wwCav, 0.8, far );
		wwRelief *= 1.0 - far;
		height = ( relief + a.bubbles * 0.15 ) * surf * ( 1.0 - far );
		reliefK = ww * ( 1.0 - far );
		thinPat = reliefThin;
		thinK = ( 1.0 - ww ) * surf * ( 1.0 - far );
		bubPat = a.bubbles * 0.15;
		bubK = surf * ( 1.0 - far );
	}

	return SurfFoamInfo( opacity, density, height, surf, wwOut, wwRelief, wwShadow, wwCav, reliefPat, reliefK, thinPat, thinK, bubPat, bubK );
}

// Foam radiance: a dense scatterer, wrapped diffuse sun (light diffuses through the bubbles),
// sky ambient, darker in the dips of the bubbly relief, glowing at thin edges when backlit.
fn surfFoamLight( info: SurfFoamInfo, N: vec3f, L: vec3f, V: vec3f, sun: vec3f, P: vec3f ) -> vec3f {
	let ww = info.ww;
	let cavity = info.cavity;
	// relief normal from the screen-space gradient of the height (Mikkelsen surface gradient): the
	// thin-foam relief (in units of ~3 cm) plus the whitewater lumps (m)
	// (gradients of the world-space patterns only, scaled by their weights: see SurfFoamInfo)
	let kb = ${ f( this.bump * 0.04 ) };
	let dpx = dpdx( P );
	let dpy = dpdy( P );
	let dhdx = dpdx( info.reliefPat ) * info.reliefK + ( dpdx( info.thinPat ) * info.thinK + dpdx( info.bubPat ) * info.bubK ) * kb;
	let dhdy = dpdy( info.reliefPat ) * info.reliefK + ( dpdy( info.thinPat ) * info.thinK + dpdy( info.bubPat ) * info.bubK ) * kb;
	let r1 = cross( dpy, N );
	let r2 = cross( N, dpx );
	let det = dot( dpx, r1 );
	let grad = ( r1 * dhdx + r2 * dhdy ) * sign( det );
	let Nf = normalize( N * abs( det ) - grad + N * 1e-6 );
	let NdL = dot( Nf, L );
	// foam lets light diffuse into it (wrapped lighting); churning whitewater much less so: its sides
	// facing away from the sun are shaded grey-blue by the sky, its caps sunlit, its crevices in the
	// shadow of the lumps around them
	let wrap = mix( 0.45, 0.12, ww );
	let diff = sat( NdL * ( 1.0 - wrap ) + wrap ) * mix( 1.0, info.selfShadow, ww );
	// dips between the lumps are shaded by the lumps around them (sky occlusion)
	let ao = mix( mix( 1.0, info.height * 0.3 + 0.76, info.surf ), cavity, ww );
	// light through thin aerated water (torn edges, thin foam, spray-soaked lips): green-white,
	// strongly forward scattered
	let thin = ( 1.0 - info.density ) * 0.8 + ww * ( 1.0 - cavity ) * 0.3;
	let trans = surfFoamPhaseHG( dot( - V, L ), 0.55 ) * thin * 1.3;
	let transCol = mix( vec3f( 1.0 ), vec3f( 0.6, 0.92, 0.82 ), ww * 0.7 + 0.3 );
	// light bounced around inside the churn (from its sunlit lumps) keeps the shaded foam from going
	// as dark and as blue as the open sky alone would make it
	let sky = frame.skyIrradiance;
	let skyGrey = vec3f( dot( sky, vec3f( 0.2126, 0.7152, 0.0722 ) ) );
	let amb = mix( sky, skyGrey, ww * 0.35 ) * ao + sun * ( ww * 0.05 ) * ao;
	return ( sun * ( diff * mix( 1.0, sqrt( cavity ), ww ) / PI + transCol * trans ) + amb ) * 0.86;
}
`;

	}

	// The former TSL hook ( surface.foamShading = ( args ) => surfFoam.shading( args ) ) is now the WGSL
	// surfFoamShading( SurfFoamArgs ) / surfFoamLight(); this returns the module that defines them.
	shading() {

		return this.module;

	}

}
