export function updateWorldOceanFrame( { dt, camera, waterHeight, marineSnowUnderwater, query, wake, caustics, marineSnow, airMotes, shoreSim, underwaterLighting, breakers, spray } ) {
	wake?.update( dt );
	query?.setCamera( camera.position.x, camera.position.z );
	query?.update();
	caustics?.update();
	marineSnow?.update( camera, marineSnowUnderwater );
	airMotes?.update( dt, camera, waterHeight );
	shoreSim?.update();
	underwaterLighting?.update( camera );
	breakers?.update( camera );
	spray?.update();
}
