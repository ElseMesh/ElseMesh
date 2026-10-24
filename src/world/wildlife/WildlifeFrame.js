import { smooth } from './WildlifeMath.js';

// Shared visibility and distance scaling for renderer adapters. The callback receives the
// simulation-owned pose and a per-frame scale; callers must not mutate the pose.
export function forEachVisibleWildlifeBird( runtime, camera, visit ) {

	const cp = camera.position;
	for ( const agent of runtime.birds.agents ) {

		if ( ! agent.visible ) continue;
		const pose = agent.f.P;
		const far = agent.kind === 'frigate' ? 1400 : agent.kind === 'pelican' ? 800 : 550;
		const distance = Math.hypot( pose.pos[ 0 ] - cp.x, pose.pos[ 1 ] - cp.y, pose.pos[ 2 ] - cp.z );
		if ( distance <= far ) visit( pose, pose.scale * smooth( far, far * 0.8, distance ), agent );

	}

	const drawDistance = runtime.shorebirds.drawDistance;
	for ( const bird of runtime.shorebirds.birds ) {

		const pose = bird.f.P;
		const distance = Math.hypot( pose.pos[ 0 ] - cp.x, pose.pos[ 1 ] - cp.y, pose.pos[ 2 ] - cp.z );
		if ( distance <= drawDistance ) visit( pose, pose.scale * smooth( drawDistance, drawDistance * 0.8, distance ), bird );

	}

}
