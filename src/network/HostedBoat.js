import { Vector3 } from '../engine/index.js';
import { BoatModel } from '../world/BoatModel.js';
import { BoatController } from '../player/BoatController.js';

// The signed component selects this bundled, reviewed boat implementation. World data supplies
// only its berth through a referenced static preview object; it cannot provide executable code or
// physics parameters.
export class HostedBoat {

	constructor( { root, component, object } ) {

		this.root = root;
		this.component = component;
		this.objectID = object.id;
		this.homePosition = new Vector3( ...object.transform.position );
		this.homeHeading = object.transform.yaw || 0;
		this.model = new BoatModel();
		this.model.group.name = `hosted-boat:${component.id}`;
		this.model.group.position.copy( this.homePosition );
		this.model.group.rotation.y = this.homeHeading;
		root.add( this.model.group );

		this.previewObject = root.children.find( ( child ) => child.userData.worldObjectId === object.id ) || null;
		this.previewWasVisible = this.previewObject?.visible ?? false;
		if ( this.previewObject ) this.previewObject.visible = false;
		this.controller = null;
		this.active = false;

	}

	activate( { query, colliders } ) {

		if ( ! this.controller ) this.controller = new BoatController( {
			design: this.model.design,
			query,
			terrain: this.root.userData.terrainData || null,
			colliders,
			initialPosition: this.homePosition,
			initialHeading: this.homeHeading,
		} );
		this.controller.model = this.model;
		this.controller.query = query;
		this.controller.colliders = colliders;
		this.active = true;
		return this.controller;

	}

	deactivate() {

		if ( this.controller ) {
			this.controller.driven = false;
			this.controller.throttle = 0;
			this.controller.throttleTarget = 0;
			this.controller.steer = 0;
			this.controller._acc = 0;
		}
		this.active = false;

	}

	update( dt ) {

		if ( this.controller ) this.model.sync( this.controller );
		this.model.update( dt );

	}

	dispose() {

		this.deactivate();
		this.root.remove( this.model.group );
		if ( this.previewObject ) this.previewObject.visible = this.previewWasVisible;
		this.model.dispose();

	}

}
