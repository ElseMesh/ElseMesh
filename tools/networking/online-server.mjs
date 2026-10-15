import { createServer } from 'node:http';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ONLINE_ROLES, PLAYER_IDS, MAX_ROOM_PLAYERS, validateState } from '../../src/network/PlayerProtocol.js';
import { validateSpeechEvent } from '../../src/network/SpeechProtocol.js';
import { loadPrivateSpeechProvider } from './SpeechProvider.mjs';
import { HelicopterLease } from '../../src/network/HelicopterLease.js';
import { ItemEconomy } from '../../src/game/ItemEconomy.js';
import { roomSecurity, sendBounded, roomForHostKey } from './RoomSecurity.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'video/webm' };
const ROOM = /^[a-f0-9]{32}$/;

export async function createOnlineServer({ root = resolve('dist'), host = '127.0.0.1', port = 5200, speechProvider = null, publicOrigin = null, production = false } = {}) {
	const security = roomSecurity({ host, publicOrigin, production });
	root = await realpath(resolve(root));
	const rooms = new Map();
	let pendingSpeech = 0;
	const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
	const server = createServer({ headersTimeout: 10_000, requestTimeout: 15_000, maxHeaderSize: 8192 }, async (request, response) => {
		if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
		try {
			const pathname = new URL(request.url, 'http://localhost').pathname;
			const target = await realpath(resolve(root, `.${decodeURIComponent(pathname === '/' ? '/play-online.html' : pathname)}`));
			const rel = relative(root, target);
			if (rel.startsWith('..') || rel.includes(':') || rel === '' || extname(target) === '') { response.writeHead(404).end(); return; }
			const info = await stat(target);
			if (!info.isFile()) { response.writeHead(404).end(); return; }
			// Agent Control: stream large models, revalidate reusable assets, and compress text bundles.
			const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
			const immutable = /^assets[\\/].+-[\w-]{8,}\.(js|css)$/.test(rel);
			const headers = { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
				'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
				ETag: etag, Vary: 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
				'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" };
			if (request.headers['if-none-match']?.split(',').map(v => v.trim()).includes(etag)) { response.writeHead(304, headers).end(); return; }
			const acceptsGzip = (request.headers['accept-encoding'] || '').split(',').some(token => {
				const [coding, ...params] = token.trim().split(';');
				const q = params.find(p => p.trim().startsWith('q='));
				return coding === 'gzip' && (!q || Number(q.trim().slice(2)) > 0);
			});
			const gzip = acceptsGzip && /\.(js|css|html|json|svg)$/.test(target);
			if (gzip) headers['Content-Encoding'] = 'gzip'; else headers['Content-Length'] = info.size;
			response.writeHead(200, headers);
			if (request.method === 'HEAD') { response.end(); return; }
			if (gzip) await pipeline(createReadStream(target), createGzip(), response);
			else await pipeline(createReadStream(target), response);
		} catch { if (!response.headersSent) response.writeHead(404).end(); else response.destroy(); }
	});
	server.maxConnections = 512;

	server.on('upgrade', (request, socket, head) => {
		try {
			const url = new URL(request.url, 'http://localhost');
			if (url.pathname !== '/ws' || !security.accept(request, server.address().port)) throw new Error('Bad origin');
			if (wss.clients.size >= 500) throw new Error('Server full');
			if (url.search) throw new Error('Credentials must not be sent in URLs');
			wss.handleUpgrade(request, socket, head, (client) => {
				client.on('error', () => client.terminate());
				const joinTimeout = setTimeout(() => client.terminate(), 5000);
				joinTimeout.unref();
				client.once('close', () => clearTimeout(joinTimeout));
				client.once('message', (bytes, isBinary) => {
				clearTimeout(joinTimeout);
				let join;
				try { if (isBinary) throw new Error(); join = JSON.parse(bytes.toString()); } catch { client.close(1008, 'Invalid join'); return; }
				const { room, role: requestedRole, hostKey } = join || {};
				if (join?.type !== 'join' || !ROOM.test(room || '') || !['loz', 'ed', 'guest'].includes(requestedRole) || (requestedRole === 'loz' && !ROOM.test(hostKey || ''))) { client.close(1008, 'Invalid join'); return; }
				if (requestedRole === 'loz' && roomForHostKey(hostKey) !== room) { client.close(1008, 'Host key rejected'); return; }
				client.alive = true;
				client.on('pong', () => { client.alive = true; });
				let peers = rooms.get(room);
				if (!peers) { if (rooms.size >= 500) { client.close(1013, 'Server full'); return; } peers = new Map(); peers.speechIds = new Set(); peers.lastSpeech = new Map(); peers.latestStates = new Map(); peers.speechQueue = Promise.resolve(); rooms.set(room, peers); }
				if (requestedRole === 'loz' && peers.hostKey && peers.hostKey !== hostKey) { client.close(1008, 'Host key rejected'); return; }
				const role = requestedRole === 'guest' ? ONLINE_ROLES.slice(1).find((slot) => !peers.has(slot)) : requestedRole;
				if (!role || peers.has(role) || peers.size >= MAX_ROOM_PLAYERS) { client.close(1008, 'Room full or role taken'); return; }
				if (role === 'loz') peers.hostKey = hostKey;
				peers.set(role, client);
				peers.helicopter ||= new HelicopterLease();
				peers.economy ||= new ItemEconomy();
				peers.economy.join(role);
				let lastPlayer = null;
				let nodeId = null, windowStart = Date.now(), sent = 0, lastSequence = -1;
				const broadcast = (packet) => {
					const data = JSON.stringify(packet);
					for (const peer of peers.values()) sendBounded(peer, data);
				};
				client.send(JSON.stringify({ type: 'welcome', role, playerId: PLAYER_IDS[role], capacity: MAX_ROOM_PLAYERS }));
					// Initial snapshot for late joiners and reconnects. Expire old poses.
					for (const [peerRole, snapshot] of peers.latestStates) {
						if (peerRole !== role && Date.now() - snapshot.acceptedAt <= 8000)
							sendBounded(client, JSON.stringify({ type: 'state', state: snapshot.state }));
					}
				client.send(JSON.stringify(peers.helicopter.packet()));
				broadcast(peers.economy.packet());
				const notify = () => {
					broadcast({ type: 'peer-status', connected: peers.size > 1, count: peers.size, capacity: MAX_ROOM_PLAYERS, roles: [...peers.keys()] });
				};
				notify();
				client.on('message', (bytes, isBinary) => {
					try {
						if (isBinary) { client.close(1003, 'Text messages required'); return; }
						const now = Date.now();
						if (now - windowStart >= 1000) { windowStart = now; sent = 0; }
						if (++sent > 20) return;
						const packet = JSON.parse(bytes.toString());
						if(packet.type==='economy-action'){
							const result=peers.economy.act(role,packet);
							sendBounded(client, JSON.stringify({type:'economy-result',action:packet.action,litres:packet.litres,...result}));
							if(result.ok)broadcast(peers.economy.packet());
							return;
						}
						if (packet.type === 'helicopter-action') {
							if(packet.action==='release' && packet.state) peers.helicopter.update(role,packet.state);
							const accepted = peers.helicopter.action(role, packet.action, lastPlayer);
							sendBounded(client, JSON.stringify({type:'helicopter-result',action:packet.action,accepted}));
							broadcast(peers.helicopter.packet()); return;
						}
						if (packet.type === 'state') {
							const state = validateState(packet.state);
							if (state.playerId !== PLAYER_IDS[role] || (role !== 'loz' && state.mode === 'boat') || (nodeId && nodeId !== state.nodeId)) return;
							nodeId ||= state.nodeId;
							if (state.mode === 'helicopter' && peers.helicopter.owner !== role) return;
							if (state.sequence <= lastSequence) return;
							lastSequence = state.sequence;
							lastPlayer = state;
							peers.latestStates.set(role, { state, acceptedAt: now });
							peers.economy.position(role, state, now);
							if (role === 'loz' && state.boat) peers.economy.boat(state.boat, now);
							if (now - (peers.lastEconomyTick || 0) >= 200) {
								peers.lastEconomyTick = now;
								const economyRevision = peers.economy.revision;
								peers.economy.tick(now);
								if (peers.economy.revision !== economyRevision) broadcast(peers.economy.packet());
							}
							if (state.helicopter && peers.helicopter.update(role,state.helicopter)) broadcast(peers.helicopter.packet());
							const data = JSON.stringify({ type: 'state', state });
							for (const peer of peers.values()) if (peer !== client) sendBounded(peer, data);
						} else if (packet.type === 'speech') {
							const event = validateSpeechEvent(packet.event);
							if (!nodeId || event.nodeId !== nodeId || event.speakerPlayerId !== PLAYER_IDS[role] || peers.size < 2) return;
							if (peers.speechIds.has(event.messageId) || now - (peers.lastSpeech.get(role) || 0) < 1500) return;
							peers.speechIds.add(event.messageId);
							if (peers.speechIds.size > 128) peers.speechIds.delete(peers.speechIds.values().next().value);
							peers.lastSpeech.set(role, now);
							broadcast({ type: 'speech', event, acceptedAt: now });
							if (!speechProvider) { broadcast({ type: 'speech-error', messageId: event.messageId, reason: 'provider_unavailable' }); return; }
							if ((peers.pendingSpeech || 0) >= 4 || pendingSpeech >= 8) { broadcast({ type: 'speech-error', messageId: event.messageId, reason: 'provider_busy' }); return; }
							peers.pendingSpeech = (peers.pendingSpeech || 0) + 1;
							pendingSpeech++;
							peers.speechQueue = peers.speechQueue.then(async () => {
								try {
									if (rooms.get(room) !== peers) return;
									const result = await speechProvider.synthesize(event.text, event.voiceProfile);
									if (!result) { broadcast({ type: 'speech-error', messageId: event.messageId, reason: 'voice_unconfigured' }); return; }
									if (rooms.get(room) !== peers) return;
									broadcast({ type: 'speech-audio', messageId: event.messageId, speakerPlayerId: event.speakerPlayerId, voiceProfile: event.voiceProfile, provider: result.provider, mime: result.mime, audio: result.audio.toString('base64'), synthesisMs: result.synthesisMs, durationSeconds: result.durationSeconds, readyAt: Date.now() });
								} catch (error) {
									console.warn('Speech synthesis failed');
									broadcast({ type: 'speech-error', messageId: event.messageId, reason: 'provider_failed' });
								} finally { peers.pendingSpeech--; pendingSpeech--; }
							});
						}
					} catch { /* Reject malformed or incompatible state. */ }
				});
				client.on('close', () => {
					if (peers.get(role) !== client) return;
					peers.delete(role);
					peers.latestStates.delete(role);
					peers.economy.disconnect(role);broadcast(peers.economy.packet());
					peers.helicopter.disconnect(role); broadcast(peers.helicopter.packet());
					if (peers.size) { broadcast({ type: 'peer-left', role, playerId: PLAYER_IDS[role] }); notify(); }
					else rooms.delete(room);
				});
				});
			});
		} catch { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); }
	});

	await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
	const heartbeat = setInterval(() => {
		for (const client of wss.clients) {
			if (!client.alive) { client.terminate(); continue; }
			client.alive = false; client.ping();
		}
	}, 30_000);
	heartbeat.unref();
	return { server, wss, address: server.address(), close: async () => {
		clearInterval(heartbeat);
		for (const client of wss.clients) client.terminate();
		await new Promise((ok) => wss.close(ok));
		await new Promise((ok) => server.close(ok));
	} };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const root = resolve(fileURLToPath(new URL('../../dist/', import.meta.url)));
	const speechProvider = await loadPrivateSpeechProvider(process.env.ELSEMESH_SPEECH_CONFIG);
	const result = await createOnlineServer({ root, host: process.env.ELSEMESH_ONLINE_HOST || '127.0.0.1', port: Number(process.env.ELSEMESH_ONLINE_PORT || 5200), speechProvider,
		publicOrigin: process.env.ELSEMESH_PUBLIC_ORIGIN || null, production: process.env.NODE_ENV === 'production' });
	console.log(`ElseMesh online rooms listening at http://${result.address.address}:${result.address.port}`);
}
