// Keep a shared command encoder usable when recording a pass throws. WebGPU requires
// every render pass encoder to end before another command can be recorded.
export function withRenderPass( encoder, descriptor, record ) {

	const pass = encoder.beginRenderPass( descriptor );
	try {
		return record( pass );
	} finally {
		pass.end();
	}

}
