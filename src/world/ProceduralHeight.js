// Experimental outer world. The authored 2048 m heightmap and the station island
// occupy the protected square. Generated island footprints never enter it.
export const PROCEDURAL_VERSION = 1;
export const PROCEDURAL_SEED = 73129;
export const PROCEDURAL_CELL = 1024;
export const PROTECTED_EXTENT = 1536;
export const CHUNK_SIZE = 256;
const INV_U32 = 1 / 4294967295;

export function hash2(x, z, seed = PROCEDURAL_SEED) {
	let h = (Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(seed, 0x2c1b3c6d)) >>> 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x7feb352d) >>> 0;
	h ^= h >>> 15;
	h = Math.imul(h, 0x846ca68b) >>> 0;
	return (h ^ (h >>> 16)) >>> 0;
}

const smooth = (a, b, v) => {
	const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

export function islandForCell(ix, iz, seed = PROCEDURAL_SEED) {
	const x = (ix + 0.5) * PROCEDURAL_CELL + (hash2(ix, iz, seed + 1) * INV_U32 - 0.5) * 256;
	const z = (iz + 0.5) * PROCEDURAL_CELL + (hash2(ix, iz, seed + 2) * INV_U32 - 0.5) * 256;
	if (Math.abs(x) <= 2048 && Math.abs(z) <= 2048) return null;
	if (ix !== 0 || iz !== 2) {
		if (hash2(ix, iz, seed + 3) * INV_U32 >= 0.68) return null;
	}
	return { x, z, radius: 220 + 50 * hash2(ix, iz, seed + 4) * INV_U32, ix, iz };
}

// A whole island, its shallow shelf, and its deep-water return fit inside one
// cell. Consequently adjacent cells and 256 m chunks share exact edge samples.
export function proceduralHeightAt(x, z, seed = PROCEDURAL_SEED) {
	if (!Number.isFinite(x) || !Number.isFinite(z)) return -90;
	if (Math.abs(x) <= PROTECTED_EXTENT && Math.abs(z) <= PROTECTED_EXTENT) return -90;
	const ix = Math.floor(x / PROCEDURAL_CELL), iz = Math.floor(z / PROCEDURAL_CELL);
	const island = islandForCell(ix, iz, seed);
	if (!island) return -90;
	const r = Math.hypot(x - island.x, z - island.z) / island.radius;
	if (r >= 1.38) return -90;
	const shelf = -90 + 72 * (1 - smooth(1, 1.38, r));
	const land = 28 * (1 - smooth(0.55, 0.95, r));
	const hill = 13 * Math.pow(Math.max(0, 1 - r), 2);
	const relief = Math.pow(Math.max(0, 1 - r), 2) * (4 * Math.sin(x * 0.022) * Math.cos(z * 0.018) + 2 * Math.sin((x + z) * 0.047));
	return shelf + land + hill + relief;
}

// The same integer hash and height expression run in WGSL for water depth and
// GPU queries. The CPU is authoritative for mesh and collision generation.
export function proceduralHeightWGSL(seed = PROCEDURAL_SEED) {
	return /* wgsl */`
fn proceduralHash(ix: i32, iz: i32, salt: i32) -> u32 {
  var h = (u32(ix) * 0x1f123bb5u) ^ (u32(iz) * 0x5f356495u) ^ (u32(salt) * 0x2c1b3c6du);
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  return h ^ (h >> 16u);
}
fn proceduralSmooth(a: f32, b: f32, v: f32) -> f32 {
  let t = clamp((v-a)/(b-a), 0.0, 1.0);
  return t*t*(3.0-2.0*t);
}
fn proceduralHeightAt(p: vec2f) -> f32 {
  if (abs(p.x)<=1536.0 && abs(p.y)<=1536.0) { return -90.0; }
  let ix = i32(floor(p.x / 1024.0));
  let iz = i32(floor(p.y / 1024.0));
  let x = (f32(ix)+0.5)*1024.0 + (f32(proceduralHash(ix,iz,${seed + 1})) / 4294967295.0-0.5)*256.0;
  let z = (f32(iz)+0.5)*1024.0 + (f32(proceduralHash(ix,iz,${seed + 2})) / 4294967295.0-0.5)*256.0;
  if (abs(x)<=2048.0 && abs(z)<=2048.0) { return -90.0; }
  if (!(ix==0 && iz==2) && f32(proceduralHash(ix,iz,${seed + 3}))/4294967295.0>=0.68) { return -90.0; }
  let radius = 220.0 + 50.0*f32(proceduralHash(ix,iz,${seed + 4}))/4294967295.0;
  let r = length(p-vec2f(x,z))/radius;
  if (r>=1.38) { return -90.0; }
  let shelf = -90.0+72.0*(1.0-proceduralSmooth(1.0,1.38,r));
  let land = 28.0*(1.0-proceduralSmooth(0.55,0.95,r));
  let hill = 13.0*pow(max(0.0,1.0-r),2.0);
  let relief = pow(max(0.0,1.0-r),2.0)*(4.0*sin(p.x*0.022)*cos(p.y*0.018)+2.0*sin((p.x+p.y)*0.047));
  return shelf+land+hill+relief;
}
`;
}
