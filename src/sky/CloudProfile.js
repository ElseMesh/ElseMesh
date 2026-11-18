// Renderer-neutral atmospheric cloud inputs. WebGPU and WebGL presenters may
// approximate the field differently, but their world-level profile starts from
// the same coverage and vertical extent.
export const CLOUD_PROFILE = Object.freeze( {
	coverage: 0.45,
	densityScale: 0.07,
	bottom: 750,
	top: 2400,
} );
