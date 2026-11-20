import { planOctahedralCanopyInstances, writeOctahedralCanopyDrawPlan } from './OctahedralCanopyRuntime.js';

/** Shared camera-driven canopy presentation state consumed by both backend adapters. */
export class OctahedralCanopyPresentationRuntime {
	constructor( descriptor, instanceSet, { applyDrawPlan = null, drawBuffers = {}, dispose = null } = {} ) {
		if ( typeof applyDrawPlan !== 'function' ) throw new Error( 'Octahedral canopy presentation requires a backend draw-plan consumer' );
		if ( ! drawBuffers || typeof drawBuffers !== 'object' ) throw new Error( 'Octahedral canopy presentation requires reusable draw buffers' );
		this.descriptor = descriptor;
		this.instanceSet = instanceSet;
		this.applyDrawPlan = applyDrawPlan;
		this.disposeBackend = dispose;
		this.cameraPosition = [ NaN, NaN, NaN ];
		this.drawBuffers = drawBuffers;
		this.disposed = false;
	}

	update( _dt, camera ) {
		if ( this.disposed ) return false;
		const position = camera?.position;
		const x = position?.x ?? position?.[ 0 ];
		const y = position?.y ?? position?.[ 1 ];
		const z = position?.z ?? position?.[ 2 ];
		if ( ! Number.isFinite( x ) || ! Number.isFinite( y ) || ! Number.isFinite( z ) ) throw new Error( 'Octahedral canopy runtime requires a finite camera position' );
		if ( x === this.cameraPosition[ 0 ] && y === this.cameraPosition[ 1 ] && z === this.cameraPosition[ 2 ] ) return false;
		this.cameraPosition[ 0 ] = x;
		this.cameraPosition[ 1 ] = y;
		this.cameraPosition[ 2 ] = z;
		const plan = planOctahedralCanopyInstances( this.descriptor, this.instanceSet, this.cameraPosition );
		writeOctahedralCanopyDrawPlan( plan, this.drawBuffers );
		this.applyDrawPlan( plan, this.drawBuffers );
		return true;
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.disposeBackend?.();
		this.applyDrawPlan = null;
		this.disposeBackend = null;
		this.descriptor = null;
		this.instanceSet = null;
		this.drawBuffers = null;
	}
}
