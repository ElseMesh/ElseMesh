import assert from 'node:assert/strict';

class Element {
	constructor( tag ) {
		this.tagName = tag.toUpperCase(); this.children = []; this.style = { setProperty: ( key, value ) => { this.style[ key ] = value; } }; this.attributes = {}; this.className = '';
		this.classList = { toggle: ( name, on ) => { const names = new Set( this.className.split( /\s+/ ).filter( Boolean ) ); if ( on ) names.add( name ); else names.delete( name ); this.className = [ ...names ].join( ' ' ); } };
		this.width = 0; this.height = 0; this.clientWidth = 160;
	}
	set innerHTML( value ) {
		this._html = value;
		if ( this.className.includes( 'em-world-nav-marker' ) ) {
			this.firstChild = new Element( 'b' ); this.lastChild = new Element( 'i' ); this.append( this.firstChild, this.lastChild );
		} else if ( this.className.includes( 'em-world-nav' ) ) {
			this.view = new Element( 'div' ); this.view.className = 'em-world-nav-view';
			this.canvas = new Element( 'canvas' ); this.marks = new Element( 'div' ); this.marks.className = 'em-world-nav-marks'; this.view.append( this.canvas, this.marks ); this.append( this.view );
		}
	}
	get innerHTML() { return this._html; }
	setAttribute( key, value ) { this.attributes[ key ] = value; }
	append( ...els ) { for ( const el of els ) { el.parent = this; this.children.push( el ); } }
	remove() { if ( this.parent ) this.parent.children = this.parent.children.filter( el => el !== this ); }
	querySelector( selector ) { if ( selector.includes( 'em-world-nav-view' ) ) return this.view; if ( selector === 'canvas' ) return this.canvas; if ( selector.includes( 'em-world-nav-marks' ) ) return this.marks; return null; }
	getContext() { return { drawImage: ( source ) => { this.drawnSource = source; } }; }
}

globalThis.document = { head: new Element( 'head' ), createElement: tag => new Element( tag ) };
const { WorldNavigator } = await import( '../src/ui/WorldNavigator.js' );
const parent = new Element( 'main' );
const nav = new WorldNavigator( parent, { labels: [ { text: 'N', x: 0, z: -1 }, { text: 'E', x: 1, z: 0 } ] } );
const map = new Element( 'canvas' ); map.width = map.height = 128;
nav.setMap( map, { minX: -64, maxX: 64, minZ: -64, maxZ: 64 } );
nav.update( { position: { x: 0, z: 0 }, forward: { x: 1, z: 0 }, markers: [ { id: 'keep', position: { x: 10, z: 0 }, label: 'H', highlighted: true } ] } );
assert.equal( nav.canvas.drawnSource, map, 'engine widget displays the world-supplied map canvas' );
assert.match( nav.canvas.style.transform, /rotate\(/, 'the engine rotates the supplied map to the world-supplied heading' );
assert.equal( nav.labelsDOM.map( label => label.textContent ).join( '' ), 'NE', 'the world chooses compass labels' );
assert.equal( nav.markers.size, 1, 'the engine creates markers from world data' );
assert.equal( nav.markers.get( 'keep' ).el.className.includes( 'is-hot' ), true, 'world data can highlight a marker' );
nav.update( { position: { x: 0, z: 0 }, markers: [] } );
assert.equal( nav.markers.size, 0, 'markers absent from new world data are removed' );
assert.throws( () => nav.setMap( map, { minX: 0, maxX: 10, minZ: 0, maxZ: 20 } ), /same world scale/, 'map bounds must preserve the supplied raster aspect ratio' );
nav.destroy();
console.log( 'World navigation widget accepts world maps, directions, player pose, and markers' );
