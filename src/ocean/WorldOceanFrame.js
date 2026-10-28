export function updateWorldOceanFrame( { dt, camera, waterHeight, marineSnowUnderwater, query, wake, caustics, marineSnow, airMotes, shoreSim, underwaterLighting, breakers, spray } ) {
	if ( wake ) wake.update( dt );
	query.setCamera( camera.position.x, camera.position.z );
	query.update();
	if ( caustics ) caustics.update();
	marineSnow.update( camera, marineSnowUnderwater );
	airMotes.update( dt, camera, waterHeight );
	if ( shoreSim ) shoreSim.update();
	underwaterLighting.update( camera );
	breakers.update( camera );
	spray.update();
}
