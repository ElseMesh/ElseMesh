/**
 * Update world components after refreshing the active camera once.
 * The fifth argument tells runtimes that camera.matrixWorld and its inverse
 * are current, avoiding a forced subtree walk for each component.
 */
export function updateWorldComponentRuntimes( components, dt, camera, player, updateArgument, cameraWorldUpdated = false ) {
	const hasCameraRefresh = typeof camera?.updateMatrixWorld === 'function';
	if ( ! cameraWorldUpdated && hasCameraRefresh ) camera.updateMatrixWorld( true );
	const matricesCurrent = cameraWorldUpdated || hasCameraRefresh;
	for ( const component of components || [] ) component.update?.( dt, camera, player, updateArgument, matricesCurrent );
}
