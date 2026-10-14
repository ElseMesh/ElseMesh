import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMap } from '../src/vendor/basic-m6502/runtime/memory-map.js';
import { readSprite0 } from '../src/world/C64SpritePreview.js';
import { Interpreter } from '../src/vendor/basic-m6502/interpreter.js';

test('sprite preview reads pointer, bitmap, enable, position, high X bit and colour from POKE memory', () => {
	const memory=new MemoryMap();
	memory.poke(2040,13);memory.poke(832,0b10000001);memory.poke(834,0b00000001);
	memory.poke(53248,44);memory.poke(53249,100);memory.poke(53287,7);
	assert.equal(readSprite0(memory).pixels.reduce((a,b)=>a+b,0),0);
	memory.poke(53269,1);memory.poke(53264,1);
	const sprite=readSprite0(memory);
	assert.deepEqual([sprite.enabled,sprite.x,sprite.y,sprite.pointer,sprite.colour],[true,300,100,13,'#edf171']);
	assert.equal(sprite.pixels[0],1);
	assert.equal(sprite.pixels[7],1);
	assert.equal(sprite.pixels[23],1);
	assert.equal(sprite.pixels[1],0);
});

test('BASIC listing moves sprite 0 with real POKE instructions', async () => {
	const output=[];
	const console={print:s=>output.push(String(s)),printLine:s=>output.push(String(s)),clearScreen(){},getPosition(){return 0;},setPosition(){},get lineLength(){return 40;},get columnWidth(){return 10;}};
	const interpreter=new Interpreter(console);
	for(const line of [
		'10 POKE 2040,13','20 FOR I=0 TO 62','30 POKE 832+I,255','40 NEXT I',
		'50 POKE 53269,1','60 POKE 53287,7','70 POKE 53249,120',
		'80 FOR X=40 TO 220 STEP 5','90 POKE 53248,X','100 NEXT X','110 PRINT PEEK(53248)',
	])await interpreter.processInput(line);
	await interpreter.processInput('RUN');
	assert.equal(interpreter.memoryMap.peek(53248),220);
	assert.equal(readSprite0(interpreter.memoryMap).pixels.reduce((a,b)=>a+b,0),504);
	assert.ok(output.some(line=>line.includes('220')));
});
