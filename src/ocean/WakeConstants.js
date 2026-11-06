// Shared dimensions and spatial scales for the renderer-specific WakeSim backends.
// Keep these independent of WebGPU/WebGL imports so both backends use one grid.
export const WAKE_GRID_SIZE = 512;
export const WAKE_LOG2_SIZE = 9;
export const WAKE_HALF_SIZE = WAKE_GRID_SIZE / 2;
export const WAKE_GRID_MASK = WAKE_GRID_SIZE - 1;
export const WAKE_CELL_SIZE = 0.4;
export const WAKE_DOMAIN_SIZE = WAKE_GRID_SIZE * WAKE_CELL_SIZE;
export const WAKE_DEPTH_LEVELS = Object.freeze( [ Infinity, 6, 1.8, 0.6 ] );
export const WAKE_SPONGE_CELLS = 22;

export const WAKE_NEAR_FIELD = Object.freeze( {
	width: 32,
	height: 88,
	x0: - 1.6,
	x1: 1.6,
	z0: - 4.4,
	z1: 4.4,
} );
