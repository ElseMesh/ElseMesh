/** Map north-up world X/Z coordinates into image coordinates. World +X is east; world -Z is north. */
export function navigationMapPosition( bounds, position, imageWidth = 1, imageHeight = 1 ) {
	if ( ! bounds || ! position || ! Number.isFinite( position.x ) || ! Number.isFinite( position.z ) ) return null;
	if ( ! Number.isFinite( imageWidth ) || ! Number.isFinite( imageHeight ) || imageWidth <= 0 || imageHeight <= 0 ) return null;
	const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
	if ( ! Number.isFinite( width ) || ! Number.isFinite( depth ) || width <= 0 || depth <= 0 ) return null;
	const x = ( position.x - bounds.minX ) / width;
	const y = ( position.z - bounds.minZ ) / depth;
	// Match the crop produced by object-fit: cover in the square map panel.
	const displayedX = 0.5 + ( x - 0.5 ) * Math.max( 1, imageWidth / imageHeight );
	const displayedY = 0.5 + ( y - 0.5 ) * Math.max( 1, imageHeight / imageWidth );
	return { x: displayedX, y: displayedY, visible: x >= 0 && x <= 1 && y >= 0 && y <= 1 && displayedX >= 0 && displayedX <= 1 && displayedY >= 0 && displayedY <= 1 };
}

export function normalizeNavigationHeading( degrees ) {
	if ( ! Number.isFinite( degrees ) ) return 0;
	return ( degrees % 360 + 360 ) % 360;
}
