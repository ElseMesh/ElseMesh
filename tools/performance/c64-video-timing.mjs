// Give readable BASIC line entry and the resulting sprite motion distinct holds.
// This duplicates captured frames for playback; it does not interpolate them.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const out=resolve(process.argv[2]||'artifacts/c64-sprite-video');
const capture=JSON.parse(await readFile(join(out,'capture.json'),'utf8'));
const lines=['ffconcat version 1.0'];
for(let i=0;i<capture.frames.length;i++){
	const label=capture.frames[i].label;
	const duration=label==='program-list' ? 1.8 : label==='sprite-finished' ? 2.0 : label.startsWith('type-') ? 0.65 : label==='c64-login' ? 0.8 : label==='c64-open' ? 0.9 : label==='warehouse-entered' ? 0.6 : label==='sprite-running' ? 0.24 : 0.18;
	lines.push(`file 'frame-${String(i).padStart(3,'0')}.png'`,`duration ${duration}`);
}
lines.push(`file 'frame-${String(capture.frames.length-1).padStart(3,'0')}.png'`);
await writeFile(join(out,'frames.ffconcat'),lines.join('\n')+'\n');
console.log(`Wrote ${capture.frames.length} timed frames`);
