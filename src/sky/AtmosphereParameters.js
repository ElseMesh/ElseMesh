// Renderer-neutral atmosphere inputs shared by WebGPU and WebGL implementations.
export const ATMOSPHERE_GROUND_RADIUS_KM = 6360.0;
export const ATMOSPHERE_TOP_RADIUS_KM = 6460.0;
export const ATMOSPHERE_VIEW_HEIGHT_OFFSET_KM = 0.002;

export const SUN_ILLUMINANCE = 11.0;
export const SUN_ANGULAR_RADIUS = 0.004675 * 1.15;
export const RAYLEIGH_SCALE = 1.0;
export const MIE_SCALE = 1.0;
export const MIE_ASYMMETRY_G = 0.8;
export const OZONE_SCALE = 1.0;
export const ATMOSPHERE_GROUND_ALBEDO = Object.freeze( [ 0.06, 0.08, 0.1 ] );
export const RAYLEIGH_SCALE_HEIGHT_KM = 8.0;
export const MIE_SCALE_HEIGHT_KM = 1.2;
export const OZONE_LAYER_CENTER_KM = 25.0;
export const OZONE_LAYER_HALF_WIDTH_KM = 15.0;
export const RAYLEIGH_SCATTERING_COEFFICIENTS = Object.freeze( [ 5.802e-3, 13.558e-3, 33.1e-3 ] );
export const MIE_SCATTERING_COEFFICIENT = 3.996e-3;
export const MIE_EXTINCTION_COEFFICIENT = 4.440e-3;
export const OZONE_ABSORPTION_COEFFICIENTS = Object.freeze( [ 0.650e-3, 1.881e-3, 0.085e-3 ] );
