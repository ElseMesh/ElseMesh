import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { OnlineRoomTransport, reconnectDelay } from '../src/network/OnlineRoomTransport.js';
import { createOnlineServer } from '../tools/networking/online-server.mjs';
import { makeState } from '../src/network/PlayerProtocol.js';

const HOST_KEY = 'd'.repeat(32);
const ROOM = 'e'.repeat(32);
const player = x => ({ position: { x, y: 2, z: -70 }, yaw: 0, mode: 'walk', velocity: { lengthSq: () => 1 } });

function mockTransport(t) {
	const before = Object.getOwnPropertyDescriptor(globalThis, 'location');
	globalThis.location = new URL('https://example.test/play-online.html');
	t.after(() => before ? Object.defineProperty(globalThis, 'location', before) : delete globalThis.location);
	const sockets = [], timers = [];
	let now = 10000;
	class FakeSocket {
		readyState = 0;
		messages = [];
		constructor(url) { this.url = String(url); sockets.push(this); }
		send(data) { this.messages.push(JSON.parse(data)); }
		open() { this.readyState = 1; this.onopen?.(); }
		receive(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
		close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
	}
	const transport = new OnlineRoomTransport(ROOM, 'guest', null, {
		now: () => now, random: () => 1,
		makeSocket: url => new FakeSocket(url),
		setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
		clearTimer: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
	});
	return { transport, sockets, timers, tick(ms) { now += ms; }, };
}

test('bounded jittered reconnect backoff and manual close prevent retry storms', t => {
	assert.equal(reconnectDelay(0, () => 1), 500);
	assert.equal(reconnectDelay(1, () => 1), 1000);
	assert.equal(reconnectDelay(100, () => 1), 15000);
	assert.equal(reconnectDelay(0, () => 0), 100);
	const e = mockTransport(t);
	assert.equal(e.sockets[0].url, 'wss://example.test/ws');
	e.sockets[0].open();
	assert.equal(e.sockets[0].messages[0].type, 'join');
	e.sockets[0].receive({ type: 'welcome', role: 'guest2', capacity: 10 });
	assert.equal(e.transport.online, true);
	e.sockets[0].close(1006);
	assert.equal(e.transport.online, false);
	assert.equal(e.timers[0].ms, 500);
	e.timers.shift().fn();
	assert.equal(e.sockets.length, 2);
	e.transport.close();
	assert.equal(e.timers.length, 0);
	assert.equal(e.transport.closed, true);
});

test('reconnect resumes recent pose, but does not replay long-stale movement', async t => {
	const e = mockTransport(t);
	const first = e.sockets[0];
	first.open();
	first.receive({ type: 'welcome', role: 'guest2', capacity: 10 });
	await e.transport.ready;
	const state = { timestamp: 10000, sequence: 12, playerId: 'player:guest2' };
	e.transport.send(state);
	assert.equal(first.messages.at(-1).state.sequence, 12);
	first.bufferedAmount = 128 * 1024;
	assert.equal(e.transport.send({ ...state, sequence: 13 }), false, 'congestion drops replaceable movement');
	assert.equal(first.messages.at(-1).state.sequence, 12);
	first.bufferedAmount = 0;
	first.close(1006);
	e.timers.shift().fn();
	const second = e.sockets[1];
	second.open();
	second.receive({ type: 'welcome', role: 'guest2', capacity: 10 });
	assert.equal(second.messages.at(-1).state.sequence, 13, 'latest unsent state is resynchronised');
	second.close(1006);
	e.timers.shift().fn();
	e.tick(5000);
	const third = e.sockets[2];
	third.open();
	third.receive({ type: 'welcome', role: 'guest2', capacity: 10 });
	assert.equal(third.messages.some(m => m.type === 'state'), false);
	e.transport.close();
});

test('policy denial is terminal; no insecure retry after host-key rejection', async t => {
	const e = mockTransport(t);
	e.sockets[0].open();
	e.sockets[0].close(1008);
	await assert.rejects(e.transport.ready, /refused/);
	assert.equal(e.timers.length, 0);
	assert.equal(e.transport.status, 'World refused connection');
});

async function connect(url, origin, join) {
	const ws = new WebSocket(url, { origin });
	const messages = [];
	ws.on('message', bytes => messages.push(JSON.parse(bytes)));
	await once(ws, 'open');
	ws.send(JSON.stringify(join));
	const until = async predicate => {
		const end = Date.now() + 2000;
		while (!messages.some(predicate)) {
			if (Date.now() > end) throw new Error('Timed out waiting for server state');
			await new Promise(resolve => setTimeout(resolve, 5));
		}
		return messages.find(predicate);
	};
	await until(m => m.type === 'welcome');
	return { ws, messages, until };
}

test('late join receives fresh snapshots without waiting for another movement update', async t => {
	const service = await createOnlineServer({ root: process.cwd(), port: 0 });
	t.after(() => service.close());
	const origin = `http://127.0.0.1:${service.address.port}`;
	const url = origin.replace('http', 'ws') + '/ws';
	const a = await connect(url, origin, { type: 'join', room: ROOM, role: 'guest' });
	t.after(() => a.ws.terminate());
	const state = makeState({ playerId: 'player:ed', nodeId: `elsemesh-node:${'a'.repeat(64)}`, sequence: 4, player: player(44) });
	a.ws.send(JSON.stringify({ type: 'state', state }));
	const b = await connect(url, origin, { type: 'join', room: ROOM, role: 'guest' });
	t.after(() => b.ws.terminate());
	const snapshot = await b.until(m => m.type === 'state');
	assert.equal(snapshot.state.sequence, 4);
	assert.equal(snapshot.state.position[0], 44);
});
