import {Matrix4, Vector3} from '../engine/index.js';

// Sweep a sphere centre through a rigid portal frame. Inputs remain untouched.
// Only positive-to-negative local Z is an entry; the mapped velocity points
// away from the destination plane, so it cannot immediately cross back.
export function sweptPortalCrossing({start,end,velocity,source,destination,radius=.15,aperture=1.22}) {
	const inverse=new Matrix4().copy(source).invert();
	const a=start.clone().applyMatrix4(inverse),b=end.clone().applyMatrix4(inverse);
	if(!(a.z>0&&b.z<=0))return null;
	const fraction=a.z/(a.z-b.z),localPoint=a.clone().lerp(b,fraction);
	if(radius>aperture||Math.hypot(localPoint.x,localPoint.y)>aperture-radius)return null;
	const mapping=new Matrix4().multiplyMatrices(destination,new Matrix4().makeRotationY(Math.PI)).multiply(inverse);
	const crossingPoint=start.clone().lerp(end,fraction).applyMatrix4(mapping);
	// Transform as a displacement, preserving speed (transformDirection normalises).
	const origin=new Vector3().applyMatrix4(mapping);
	const mappedVelocity=velocity.clone().applyMatrix4(mapping).sub(origin);
	return {crossingPoint,velocity:mappedVelocity,remainingFraction:1-fraction,fraction,mapping};
}

export function crossPortalSegment({previous,next,velocity,source,destination,radius=.14,apertureRadius=1.22,crossed=false}) {
	if(crossed)return null;
	const result=sweptPortalCrossing({start:previous,end:next,velocity,source,destination,radius,aperture:apertureRadius});
	return result?{position:result.crossingPoint,velocity:result.velocity,remainingFraction:result.remainingFraction}:null;
}
