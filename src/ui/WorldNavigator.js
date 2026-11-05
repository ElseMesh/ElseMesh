// Renderer-neutral navigation HUD. A world supplies a raster map and plain
// world-space navigation data; this class owns the DOM presentation/layout.
const CSS = `
.em-world-nav { position:absolute; right:var(--em-edge); bottom:var(--em-edge); width:calc(184 * var(--em-u)); height:calc(184 * var(--em-u)); border-radius:50%; padding:calc(5 * var(--em-u)); pointer-events:none; overflow:hidden; }
.em-world-nav-view { position:relative; width:100%; height:100%; border-radius:50%; overflow:hidden; background:#0b2c48; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),inset 0 0 18px rgba(0,0,0,.45); }
.em-world-nav-map { position:absolute; left:0; top:0; transform-origin:0 0; }
.em-world-nav-marks { position:absolute; inset:0; }
.em-world-nav-marker { position:absolute; left:0; top:0; width:0; height:0; }
.em-world-nav-marker > i { position:absolute; left:0; top:0; display:grid; place-items:center; width:calc(20 * var(--em-u)); height:calc(20 * var(--em-u)); margin:calc(-10 * var(--em-u)); border-radius:50%; font:700 calc(10 * var(--em-u)) var(--em-font); font-style:normal; color:#0b1418; background:var(--em-nav-marker-color,#f2efe6); box-shadow:0 1px 3px rgba(0,0,0,.55),0 0 0 1.5px rgba(255,255,255,.85); }
.em-world-nav-marker > i svg { width:64%; height:64%; }
.em-world-nav-marker > b { position:absolute; left:0; top:0; width:0; height:0; border-left:calc(5 * var(--em-u)) solid transparent; border-right:calc(5 * var(--em-u)) solid transparent; border-bottom:calc(7 * var(--em-u)) solid rgba(255,255,255,.9); margin:calc(-19 * var(--em-u)) 0 0 calc(-5 * var(--em-u)); transform-origin:calc(5 * var(--em-u)) calc(19 * var(--em-u)); display:none; }
.em-world-nav-marker.is-edge > b { display:block; }
.em-world-nav-marker.is-edge > i { transform:scale(.82); }
.em-world-nav-marker.is-hot > i { animation:em-world-nav-pulse 1.3s ease-in-out infinite; }
@keyframes em-world-nav-pulse { 60% { box-shadow:0 1px 3px rgba(0,0,0,.55),0 0 0 1.5px rgba(255,255,255,.85),0 0 0 calc(10 * var(--em-u)) rgba(255,255,255,0); } }
.em-world-nav-player { position:absolute; left:50%; top:50%; width:0; height:0; }
.em-world-nav-player svg { position:absolute; width:calc(18 * var(--em-u)); height:calc(18 * var(--em-u)); left:calc(-9 * var(--em-u)); top:calc(-10 * var(--em-u)); filter:drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
.em-world-nav-label { position:absolute; left:0; top:0; width:calc(18 * var(--em-u)); height:calc(18 * var(--em-u)); margin:calc(-9 * var(--em-u)); display:grid; place-items:center; border-radius:50%; font:700 calc(9 * var(--em-u)) var(--em-font); color:#0b1418; background:rgba(255,255,255,.9); box-shadow:0 1px 2px rgba(0,0,0,.5); }
.em-world-nav-ring { position:absolute; left:0; top:0; width:calc(24 * var(--em-u)); height:calc(24 * var(--em-u)); margin:calc(-12 * var(--em-u)); border-radius:50%; border:1.5px solid rgba(var(--em-aqua-rgb),.9); animation:em-world-nav-ring 2.2s ease-in-out infinite; }
@keyframes em-world-nav-ring { to { transform:scale(1.15); border-color:rgba(var(--em-aqua-rgb),0); } }
.em-root[data-panel='open'] .em-world-nav { right:calc(var(--em-panel-w) + 2 * var(--em-3)); }
@media (max-height:860px) { .em-world-nav { right:calc(var(--em-edge) + 58 * var(--em-u)); } }
@media (max-width:640px) { .em-world-nav { width:calc(128 * var(--em-u)); height:calc(128 * var(--em-u)); } }
@media (prefers-reduced-motion:reduce) { .em-world-nav-marker.is-hot > i,.em-world-nav-ring { animation:none; } }
`;

export class WorldNavigator {
	constructor( parent, { labels = [ { text: 'N', x: 0, z: -1 } ], radius = 110 } = {} ) {
		if ( ! parent?.append ) throw new Error( 'WorldNavigator requires a DOM parent' );
		if ( ! WorldNavigator._style && typeof document !== 'undefined' ) { const style = document.createElement( 'style' ); style.textContent = CSS; document.head.append( style ); WorldNavigator._style = style; }
		this.radius = radius; this.labels = labels.map( label => ( { ...label } ) ); this.markers = new Map(); this.labelsDOM = [];
		this.el = document.createElement( 'div' ); this.el.className = 'em-world-nav em-glass'; this.el.setAttribute( 'aria-hidden', 'true' );
		this.el.innerHTML = '<div class="em-world-nav-view"><canvas class="em-world-nav-map"></canvas><div class="em-world-nav-marks"></div><div class="em-world-nav-player"><svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" stroke="#0b1418" stroke-width="1.4" stroke-linejoin="round"/></svg></div></div>';
		parent.append( this.el ); this.view = this.el.querySelector( '.em-world-nav-view' ); this.canvas = this.el.querySelector( 'canvas' ); this.marks = this.el.querySelector( '.em-world-nav-marks' );
		this._viewSize = -1; this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver( () => { this._viewSize = this.view.clientWidth; } ) : null; this._ro?.observe( this.view );
		this.setLabels( this.labels );
	}
	setLabels( labels = [] ) {
		this.labels = labels.map( item => ( { text: String( item.text ?? '' ), x: Number( item.x ) || 0, z: Number( item.z ) || 0 } ) );
		for ( const el of this.labelsDOM ) el.remove(); this.labelsDOM = this.labels.map( item => { const el = document.createElement( 'span' ); el.className = 'em-world-nav-label'; el.textContent = item.text; this.marks.append( el ); return el; } );
	}
	setMap( source, bounds ) {
		if ( ! source || ! bounds || !( bounds.maxX > bounds.minX ) || !( bounds.maxZ > bounds.minZ ) ) throw new Error( 'WorldNavigator map requires a canvas source and valid x/z bounds' );
		const ppmX = source.width / ( bounds.maxX - bounds.minX ), ppmZ = source.height / ( bounds.maxZ - bounds.minZ );
		if ( Math.abs( ppmX - ppmZ ) > Math.max( ppmX, ppmZ ) * 0.01 ) throw new Error( 'WorldNavigator map pixels must have the same world scale on X and Z' );
		this.canvas.width = source.width; this.canvas.height = source.height; this.canvas.style.width = `${source.width}px`; this.canvas.style.height = `${source.height}px`; this._bounds = { ...bounds }; this._mapReady = false;
		const ctx = this.canvas.getContext( '2d' ); ctx.drawImage( source, 0, 0 ); this._mapReady = true;
	}
	_set( el, prop, value ) { const key = `__nav_${prop}`; if ( el[ key ] !== value ) { el[ key ] = value; el.style[ prop ] = value; } }
	update( { position, forward = { x: 0, z: -1 }, radius = this.radius, markers = [], overlays = [] } = {} ) {
		if ( ! position || ! this._mapReady ) return;
		if ( this._viewSize < 0 || ! this._ro ) this._viewSize = this.view.clientWidth;
		const size = this._viewSize; if ( ! size ) return; const R = size / 2;
		let fx = forward.x, fz = forward.z, fl = Math.hypot( fx, fz ); if ( fl < 1e-4 ) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
		const rx = -fz, rz = fx, range = Math.max( 1, radius ), kpm = R / range, b = this._bounds;
		const ppmX = this.canvas.width / ( b.maxX - b.minX ), ppmZ = this.canvas.height / ( b.maxZ - b.minZ ), rot = -Math.PI / 2 - Math.atan2( fz, fx ), scale = kpm / ppmX;
		this._set( this.canvas, 'transform', `translate(${R}px,${R}px) rotate(${rot}rad) scale(${scale}) translate(${- ( position.x - b.minX ) * ppmX}px,${- ( position.z - b.minZ ) * ppmZ}px)` );
		const place = ( el, x, z, inset = 12, arrow = null ) => { let sx = ( x * rx + z * rz ) * kpm, sy = -( x * fx + z * fz ) * kpm; const r = Math.hypot( sx, sy ), max = R - inset, edge = r > max; if ( edge ) { sx *= max / r; sy *= max / r; } this._set( el, 'transform', `translate(${R + sx}px,${R + sy}px)` ); if ( arrow && edge ) this._set( arrow, 'transform', `rotate(${Math.atan2(sx,-sy)}rad)` ); return edge; };
		const keep = new Set();
		for ( const marker of markers ) {
			if ( ! marker?.id || ! marker.position ) continue; keep.add( marker.id ); let entry = this.markers.get( marker.id );
			if ( ! entry ) { const el = document.createElement( 'div' ); el.className = 'em-world-nav-marker'; el.innerHTML = '<b></b><i></i>'; this.marks.append( el ); entry = { el, arrow: el.firstChild, icon: el.lastChild }; this.markers.set( marker.id, entry ); }
			const icon = marker.icon ?? marker.label ?? '', color = marker.color ?? '#f2efe6', hidden = !!marker.hidden;
			if ( entry.iconValue !== icon ) { entry.icon.innerHTML = icon; entry.iconValue = icon; }
			if ( entry.color !== color ) { entry.el.style.setProperty( '--em-nav-marker-color', color ); entry.color = color; }
			if ( entry.hidden !== hidden ) { entry.el.hidden = hidden; entry.hidden = hidden; }
			entry.el.classList.toggle( 'is-hot', !!marker.highlighted ); if ( marker.hidden ) continue;
			entry.el.classList.toggle( 'is-edge', place( entry.el, marker.position.x - position.x, marker.position.z - position.z, 12, entry.arrow ) );
		}
		for ( const [ id, entry ] of this.markers ) if ( !keep.has( id ) ) { entry.el.remove(); this.markers.delete( id ); }
		this.labelsDOM.forEach( ( el, i ) => place( el, this.labels[ i ].x * 1e6, this.labels[ i ].z * 1e6, 9 ) );
		for ( let i = 0; i < overlays.length; i ++ ) { let el = this._overlays?.[ i ]; if ( !el ) { this._overlays ||= []; el = document.createElement( 'span' ); el.className = 'em-world-nav-ring'; this.marks.append( el ); this._overlays[ i ] = el; } place( el, overlays[ i ].x - position.x, overlays[ i ].z - position.z, 14 ); }
		for ( let i = overlays.length; this._overlays && i < this._overlays.length; i ++ ) this._overlays[ i ].remove(); if ( this._overlays ) this._overlays.length = overlays.length;
	}
	destroy() { this._ro?.disconnect(); this.el.remove(); this.markers.clear(); }
}
