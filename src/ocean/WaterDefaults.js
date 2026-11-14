// Renderer-neutral optical defaults shared by WebGPU and WebGL water paths.
export const WATER_IOR = 1.333;
export const WATER_ABSORPTION = Object.freeze( [ 0.42, 0.075, 0.035 ] );
export const WATER_SCATTERING = Object.freeze( [ 0.012, 0.018, 0.024 ] );
export const WATER_BACKSCATTER = 0.035;
export const WATER_ROUGHNESS = 0.035;
export const WATER_REFLECTION_STRENGTH = 1.0;
export const SHORE_WATER_TURBIDITY = 0.16;
