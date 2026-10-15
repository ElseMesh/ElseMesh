import { canonicalLandscapeSpec, DEFAULT_LANDSCAPE_SPEC } from './LandscapeSpec.js';
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = (a,b,v) => {const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const mix = (a,b,t) => a+(b-a)*t;
function hash(x,z,seed) {
	let h=(Math.imul(x,0x1f123bb5)^Math.imul(z,0x5f356495)^seed)>>>0;
	h=Math.imul(h^(h>>>16),0x7feb352d)>>>0;
	h=Math.imul(h^(h>>>15),0x846ca68b)>>>0;
	return ((h^(h>>>16))>>>0)/4294967295;
}
function noise(x,z,seed) {
	const ix=Math.floor(x),iz=Math.floor(z),tx=smooth(0,1,x-ix),tz=smooth(0,1,z-iz);
	return mix(mix(hash(ix,iz,seed),hash(ix+1,iz,seed),tx),mix(hash(ix,iz+1,seed),hash(ix+1,iz+1,seed),tx),tz);
}
function baseHeightAt(x,z,s) {
	const bottom=s.waterLevel-90;
	if (!Number.isFinite(x)||!Number.isFinite(z)) return bottom;
	const u=(x-s.origin.x)/(s.width/2),v=(z-s.origin.z)/(s.length/2);
	if (Math.abs(u)>=1||Math.abs(v)>=1) return bottom;
	// Keep the entire warped shelf inside the exact finite rectangle, with a
	// zero derivative at its seabed boundary so neighbouring chunks join cleanly.
	const n=noise(u*3+19,v*3+23,s.seed),r=Math.max(Math.hypot(u,v)+(n-.5)*.055,Math.max(Math.abs(u),Math.abs(v))*.99);
	const land=smooth(.86,.68,r),shelf=smooth(.99,.87,r);
	const hills=s.features.includes('hills') ? noise(u*5+31,v*5+37,s.seed^0x1567)*.19 : .04;
	const ridge=s.features.includes('mountain-ridge') ? (1-smooth(.02,.4,Math.abs(v+.16+u*.28)))*(1-smooth(.15,.7,Math.abs(u-.08)))*.75 : 0;
	const interior=smooth(.77,.48,r);
	const terrainScale=s.terrainType==='temperate-hills'?.55:1;
	const relief=(s.maxElevation-s.waterLevel)*clamp(.035+(hills+ridge)*(.4+s.elevation.ruggedness)*terrainScale,0,1)*interior;
	return Math.min(s.maxElevation,bottom+88*shelf+land*(s.features.includes('beach')?4:7)+relief);
}
function access(s) {
	const placement=s.structures.find(p=>p.assetId==='abandoned-warehouse');
	const {x,z,yawRadians=0}=placement??s.origin;
	// Source warehouse yaw is PI/2. Its open west gate is (-24.3,-4)
	// relative to source centre, so rotate that source-frame offset by the
	// placement's turn from PI/2, preserving the gate's lateral alignment.
	const scale=placement?.scale??1,turn=yawRadians-Math.PI/2;
	const start=Math.min(120,s.width/2-Math.abs(x-s.origin.x)-34,s.length/2-Math.abs(z-s.origin.z)-34);
	return {x,z,start,end:24.3*scale,lateral:-4*scale,cos:Math.cos(turn),sin:Math.sin(turn),padEnabled:!!placement,
		enabled:!!placement&&(s.paths.enabled||s.roads.enabled),width:Math.max(s.paths.enabled?s.paths.width:0,s.roads.enabled?s.roads.width:0)};
}
export function landscapePathDistance(x,z,input = DEFAULT_LANDSCAPE_SPEC) {
	const s=canonicalLandscapeSpec(input);
	const a=access(s);
	if (!a.enabled||!Number.isFinite(x)||!Number.isFinite(z)) return Infinity;
	const dx=x-a.x,dz=z-a.z,u=dx*a.cos-dz*a.sin,v=dx*a.sin+dz*a.cos;
	return Math.hypot(u-clamp(u,-a.start,-a.end),v-a.lateral);
}
export function landscapePathLayout(input = DEFAULT_LANDSCAPE_SPEC) {
	const s=canonicalLandscapeSpec(input),a=access(s),{x,z}=a;
	const height=baseHeightAt(x,z,s);
	const spawn={x:x-a.start*a.cos+a.lateral*a.sin,y:height,z:z+a.start*a.sin+a.lateral*a.cos};
	const gate={x:x-a.end*a.cos+a.lateral*a.sin,y:height,z:z+a.end*a.sin+a.lateral*a.cos};
	return {enabled:a.enabled,spawn,gate,points:a.enabled?[{x:spawn.x,z:spawn.z},{x:gate.x,z:gate.z}]:[],width:a.width,
		pad:{enabled:a.padEnabled,x,z,radius:35,height}};
}
export function landscapeSurfaceAt(x,z,input = DEFAULT_LANDSCAPE_SPEC) {
	const s=canonicalLandscapeSpec(input),a=access(s),distance=landscapePathDistance(x,z,s);
	if(s.roads.enabled&&distance<=s.roads.width/2)return 'road';
	if(s.paths.enabled&&distance<=s.paths.width/2)return 'path';
	if(a.padEnabled&&Math.hypot(x-a.x,z-a.z)<=35)return 'building-pad';
	return null;
}
export function landscapeHeightAt(x,z,input = DEFAULT_LANDSCAPE_SPEC) {
	const s=canonicalLandscapeSpec(input),h=baseHeightAt(x,z,s);
	if (!Number.isFinite(x)||!Number.isFinite(z)) return h;
	const a=access(s),pad=a.padEnabled?1-smooth(35,55,Math.hypot(x-a.x,z-a.z)):0;
	const path=a.enabled?1-smooth(a.width/2,30,landscapePathDistance(x,z,s)):0;
	return mix(h,baseHeightAt(a.x,a.z,s),Math.max(pad,path));
}
export function createLandscapeHeight(input = DEFAULT_LANDSCAPE_SPEC) {
	const s=canonicalLandscapeSpec(input);
	return (x,z) => landscapeHeightAt(x,z,s);
}
// Pure classification hook for later vegetation and path builders. Forest here
// describes a biome mask; it does not claim that tree geometry has been placed.
export function landscapeSampleAt(x,z,input = DEFAULT_LANDSCAPE_SPEC) {
	const s=canonicalLandscapeSpec(input),height=landscapeHeightAt(x,z,s);
	const inside=Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x-s.origin.x)<=s.width/2&&Math.abs(z-s.origin.z)<=s.length/2;
	const dx=(landscapeHeightAt(x+1,z,s)-landscapeHeightAt(x-1,z,s))/2;
	const dz=(landscapeHeightAt(x,z+1,s)-landscapeHeightAt(x,z-1,s))/2;
	const slope=Math.hypot(dx,dz);
	const relative=(height-s.waterLevel)/(s.maxElevation-s.waterLevel);
	const biome=height<=s.waterLevel?'sea':height<s.waterLevel+5?'beach':relative>.6?'mountain-ridge':s.features.includes('forest')&&relative>.08&&slope<.7?'forest':'hills';
	return {height,biome,slope,inside,grade:Math.atan(slope)*180/Math.PI,surface:landscapeSurfaceAt(x,z,s)};
}
// Identical formula and integer noise in WGSL. CPU doubles versus GPU f32
// introduce small rounding differences; callers should compare with tolerance.
export function landscapeHeightWGSL(input = DEFAULT_LANDSCAPE_SPEC, {functionName='landscapeHeightAt'} = {}) {
	const s=canonicalLandscapeSpec(input);
	const a=access(s);
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(functionName)) throw new TypeError('Invalid WGSL function name.');
	const f=n => Number.isInteger(n)?`${n}.0`:`${n}`;
	return `
fn landscapeHash(x:i32,z:i32,seed:u32)->f32 {
 var h=(u32(x)*0x1f123bb5u)^(u32(z)*0x5f356495u)^seed;
 h=(h^(h>>16u))*0x7feb352du;
 h=(h^(h>>15u))*0x846ca68bu;
 return f32(h^(h>>16u))/4294967295.0;
}
fn landscapeSmooth(a:f32,b:f32,v:f32)->f32 {let t=clamp((v-a)/(b-a),0.0,1.0);return t*t*(3.0-2.0*t);}
fn landscapeNoise(p:vec2f,seed:u32)->f32 {
 let i=vec2i(floor(p));let t=vec2f(landscapeSmooth(0.0,1.0,fract(p.x)),landscapeSmooth(0.0,1.0,fract(p.y)));
 return mix(mix(landscapeHash(i.x,i.y,seed),landscapeHash(i.x+1,i.y,seed),t.x),mix(landscapeHash(i.x,i.y+1,seed),landscapeHash(i.x+1,i.y+1,seed),t.x),t.y);
}
fn ${functionName}(p:vec2f)->f32 {
 let q=(p-vec2f(${f(s.origin.x)},${f(s.origin.z)}))/vec2f(${f(s.width/2)},${f(s.length/2)});
 if(abs(q.x)>=1.0||abs(q.y)>=1.0){return ${f(s.waterLevel-90)};}
 let n=landscapeNoise(q*3.0+vec2f(19.0,23.0),${s.seed}u);
 let r=max(length(q)+(n-0.5)*0.055,max(abs(q.x),abs(q.y))*0.99);
 let land=landscapeSmooth(0.86,0.68,r);let shelf=landscapeSmooth(0.99,0.87,r);
 let hills=${s.features.includes('hills')?`landscapeNoise(q*5.0+vec2f(31.0,37.0),${(s.seed^0x1567)>>>0}u)*0.19`:'0.04'};
 let ridge=${s.features.includes('mountain-ridge')?'(1.0-landscapeSmooth(0.02,0.4,abs(q.y+0.16+q.x*0.28)))*(1.0-landscapeSmooth(0.15,0.7,abs(q.x-0.08)))*0.75':'0.0'};
 let relief=${f(s.maxElevation-s.waterLevel)}*clamp(0.035+(hills+ridge)*${f(.4+s.elevation.ruggedness)}*${s.terrainType==='temperate-hills'?'0.55':'1.0'},0.0,1.0)*landscapeSmooth(0.77,0.48,r);
 let h=min(${f(s.maxElevation)},${f(s.waterLevel-90)}+88.0*shelf+land*${s.features.includes('beach')?'4.0':'7.0'}+relief);
 let delta=p-vec2f(${f(a.x)},${f(a.z)});
 let local=vec2f(delta.x*${f(a.cos)}-delta.y*${f(a.sin)},delta.x*${f(a.sin)}+delta.y*${f(a.cos)});
 let pad=${a.padEnabled?'1.0-landscapeSmooth(35.0,55.0,length(delta))':'0.0'};
 let path=${a.enabled?`1.0-landscapeSmooth(${f(a.width/2)},30.0,length(vec2f(local.x-clamp(local.x,${f(-a.start)},${f(-a.end)}),local.y-(${f(a.lateral)}))))`:'0.0'};
 return mix(h,${f(baseHeightAt(a.x,a.z,s))},max(pad,path));
}
`;
}
