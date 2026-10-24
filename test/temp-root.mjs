import { tmpdir } from 'node:os';
import path from 'node:path';

export const testTempRoot = process.platform === 'android' && process.env.PREFIX
	? path.join( process.env.PREFIX, 'tmp' )
	: process.platform === 'linux' ? '/var/tmp' : tmpdir();
