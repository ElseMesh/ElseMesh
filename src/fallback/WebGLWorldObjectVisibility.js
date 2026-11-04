// Hide a portal placeholder when one of its authored replacements is resident.
// The WebGPU package loader applies this rule while adding package objects; the
// WebGL fallback keeps its roots in a map and applies the same rule here.
export function hideReplacedWorldObjects( objectRecords, objectRoots ) {

	const replacedIDs = new Set();
	for ( const object of objectRecords || [] ) {
		if ( object.replacesObjectId && objectRoots.has( object.id ) ) replacedIDs.add( object.replacesObjectId );
	}
	for ( const id of replacedIDs ) {
		const root = objectRoots.get( id );
		if ( root ) root.visible = false;
	}

}
