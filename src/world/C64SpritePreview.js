// A bounded VIC-II sprite 0 preview for the warehouse terminal. The BASIC
// interpreter's memory map remains authoritative; this does not emulate the
// complete video chip or its banking modes.
const COLOURS = [
	'#000000','#ffffff','#813338','#75cec8','#8e3c97','#56ac4d','#2e2c9b','#edf171',
	'#8e5029','#553800','#c46c71','#4a4a4a','#7b7b7b','#a9ff9f','#706deb','#b2b2b2',
];

export function readSprite0(memoryMap) {
	const peek = address => memoryMap.peek(address);
	const enabled = (peek(53269) & 1) !== 0;
	const x = peek(53248) + ((peek(53264) & 1) ? 256 : 0);
	const y = peek(53249);
	const pointer = peek(2040);
	const colour = COLOURS[peek(53287) & 15];
	const pixels = new Uint8Array(24 * 21);
	if (enabled) for (let row = 0; row < 21; row++) for (let byte = 0; byte < 3; byte++) {
		const bits = peek(pointer * 64 + row * 3 + byte);
		for (let bit = 0; bit < 8; bit++) pixels[row * 24 + byte * 8 + bit] = (bits >> (7 - bit)) & 1;
	}
	return {enabled,x,y,pointer,colour,pixels};
}

export function drawSprite0(canvas, memoryMap) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const sprite = readSprite0(memoryMap);
	ctx.fillStyle = '#24468f';
	ctx.fillRect(0,0,320,200);
	ctx.fillStyle = '#5275b3';
	ctx.fillRect(0,20,320,1);
	ctx.fillStyle = '#b9d3ff';
	ctx.font = '11px monospace';
	ctx.fillText(`SPRITE 0  X:${sprite.x}  Y:${sprite.y}`,8,14);
	if (sprite.enabled) {
		// The visible C64 text field starts after the VIC-II borders.
		const left = sprite.x - 24, top = sprite.y - 50;
		ctx.fillStyle = sprite.colour;
		for (let row = 0; row < 21; row++) for (let col = 0; col < 24; col++) {
			if (sprite.pixels[row * 24 + col]) ctx.fillRect(left + col,top + row,1,1);
		}
	}
	return sprite;
}
