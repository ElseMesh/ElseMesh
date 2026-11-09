const MAX_NODES = 64;
const MAX_DEPTH = 12;

/** Validate and compile a bounded, renderer-neutral expression over RGBA density channels. */
export function compileGroundCoverDensityExpression( expression ) {

	let nodeCount = 0;
	const channels = new Set();
	const fail = message => { throw new Error( `Invalid ground-cover density expression: ${message}` ); };
	const record = value => value && typeof value === 'object' && ! Array.isArray( value );
	const keys = ( value, expected ) => Object.keys( value ).length === expected.length && expected.every( key => Object.hasOwn( value, key ) );

	function compile( node, depth ) {

		if ( ! record( node ) || ++ nodeCount > MAX_NODES || depth > MAX_DEPTH ) fail( 'expression exceeds its structural bounds' );
		if ( node.op === 'channel' ) {
			if ( ! keys( node, [ 'op', 'index' ] ) || ! Number.isInteger( node.index ) || node.index < 0 || node.index > 3 ) fail( 'channel node must reference an RGBA index' );
			channels.add( node.index );
			return values => values[ node.index ];
		}
		if ( node.op === 'constant' ) {
			if ( ! keys( node, [ 'op', 'value' ] ) || ! Number.isFinite( node.value ) || Math.abs( node.value ) > 1e6 ) fail( 'constant node value is invalid' );
			return () => node.value;
		}
		if ( ! [ 'add', 'subtract', 'multiply', 'divide', 'min', 'max' ].includes( node.op ) || ! keys( node, [ 'op', 'left', 'right' ] ) ) fail( 'binary operation is unknown or malformed' );
		const left = compile( node.left, depth + 1 ), right = compile( node.right, depth + 1 );
		switch ( node.op ) {
			case 'add': return values => left( values ) + right( values );
			case 'subtract': return values => left( values ) - right( values );
			case 'multiply': return values => left( values ) * right( values );
			case 'divide': return values => { const divisor = right( values ); return Math.abs( divisor ) > 1e-8 ? left( values ) / divisor : 0; };
			case 'min': return values => Math.min( left( values ), right( values ) );
			case 'max': return values => Math.max( left( values ), right( values ) );
		}

	}

	const evaluate = compile( expression, 0 );
	if ( channels.size === 0 ) fail( 'expression must reference at least one density channel' );
	return Object.freeze( { channels: Object.freeze( [ ...channels ] ), evaluate: values => Math.max( 0, Math.min( 1, evaluate( values ) ) ) } );

}
