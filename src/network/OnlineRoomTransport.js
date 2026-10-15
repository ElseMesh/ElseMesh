const ROOM = /^[a-f0-9]{32}$/;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15000;

// Bounded exponential retry with full jitter, to avoid synchronized reconnect storms.
export function reconnectDelay(attempt, random = Math.random) {
	const capped = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(8, Math.max(0, attempt)));
	return Math.max(100, Math.floor(capped * Math.max(0, Math.min(1, random()))));
}

export class OnlineRoomTransport {
	constructor(room, role, hostKey = null, options = {}) {
		if (!ROOM.test(room) || !['loz', 'ed', 'guest'].includes(role) || (role === 'loz' && !ROOM.test(hostKey || ''))) throw new Error('Invalid room or role');
		this.handlers = new Set();
		this.economyHandlers = new Set();
		this.helicopterHandlers = new Set();
		this.speechHandlers = new Set();
		this.audioHandlers = new Set();
		this.errorHandlers = new Set();
		this.leaveHandlers = new Set();
		this.connected = false;
		this.online = false;
		this.status = 'Connecting';
		this.count = 0;
		this.capacity = 10;
		this.role = null;
		this.requestedRole = role;
		this.room = room;
		this.hostKey = hostKey;
		this.closed = false;
		this.attempt = 0;
		this.timer = null;
		this.generation = 0;
		this.lastState = null;
		this.now = options.now || Date.now;
		this.random = options.random || Math.random;
		this.makeSocket = options.makeSocket || (url => new WebSocket(url));
		this.setTimer = options.setTimer || setTimeout;
		this.clearTimer = options.clearTimer || clearTimeout;
		this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
		this.readySettled = false;
		this.open();
	}
	open() {
		if (this.closed) return;
		const generation = ++this.generation;
		const url = new URL('/ws', location.href);
		url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		let socket;
		try { socket = this.makeSocket(url); }
		catch { this.scheduleRetry(); return; }
		this.socket = socket;
		const current = () => !this.closed && this.generation === generation && this.socket === socket;
		socket.onmessage = ({ data }) => {
			if (!current()) return;
			try {
				if (typeof data !== 'string' || data.length > 3_000_000) return;
				const packet = JSON.parse(data);
				if (packet.type === 'economy' || packet.type === 'economy-result') {
					if (packet.type === 'economy') this.economy = packet;
					for (const fn of this.economyHandlers) fn(packet);
				} else if (packet.type === 'helicopter' || packet.type === 'helicopter-result') {
					if (packet.type === 'helicopter') this.helicopter = packet;
					for (const fn of this.helicopterHandlers) fn(packet);
				} else if (packet.type === 'welcome') {
					if (typeof packet.role !== 'string' || !Number.isSafeInteger(packet.capacity)) return;
					this.role = packet.role;
					this.online = true;
					this.attempt = 0;
					this.capacity = packet.capacity;
					this.status = 'Connected; synchronizing';
					if (!this.readySettled) { this.readySettled = true; this.resolveReady(packet.role); }
					// A fast reconnect may precede the next local simulation tick. Never
					// resurrect stale movement from a long-offline browser session.
					if (this.lastState && this.now() - this.lastState.timestamp <= 3000) this.send(this.lastState);
				} else if (packet.type === 'peer-status') {
					this.connected = !!packet.connected;
					this.count = packet.count;
					this.status = `${packet.count}/${packet.capacity} players connected`;
				} else if (packet.type === 'state') {
					for (const fn of this.handlers) fn(packet.state);
				} else if (packet.type === 'peer-left') {
					for (const fn of this.leaveHandlers) fn(packet.playerId);
				} else if (packet.type === 'speech') {
					for (const fn of this.speechHandlers) fn(packet.event, packet.acceptedAt);
				} else if (packet.type === 'speech-audio') {
					for (const fn of this.audioHandlers) fn(packet);
				} else if (packet.type === 'speech-error') {
					for (const fn of this.errorHandlers) fn(packet);
				}
			} catch { /* Ignore malformed server data. */ }
		};
		socket.onopen = () => {
			if (!current()) return;
			socket.send(JSON.stringify({ type: 'join', room: this.room, role: this.requestedRole,
				...(this.requestedRole === 'loz' ? { hostKey: this.hostKey } : {}) }));
			this.status = 'Joining world';
		};
		socket.onclose = (event) => {
			if (!current()) return;
			this.online = false;
			this.connected = false;
			this.role = null;
			this.count = 0;
			// 1008 is a policy/authorisation denial. Never retry against it.
			if (event.code === 1008 || event.code === 1003 || event.code === 1009) {
				this.status = 'World refused connection';
				if (!this.readySettled) { this.readySettled = true; this.rejectReady(new Error('World refused connection')); }
				return;
			}
			this.scheduleRetry();
		};
		socket.onerror = () => { if (current()) this.status = 'Network connection interrupted'; };
	}
	scheduleRetry() {
		if (this.closed || this.timer != null) return;
		const delay = reconnectDelay(this.attempt++, this.random);
		this.status = 'Connection lost — reconnecting';
		this.timer = this.setTimer(() => { this.timer = null; this.open(); }, delay);
	}
	onState(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
	onEconomy(fn) { this.economyHandlers.add(fn); if (this.economy) fn(this.economy); return () => this.economyHandlers.delete(fn); }
	economyAction(action) {
		if (!this.online || this.socket.readyState !== 1 || (this.socket.bufferedAmount ?? 0) > 256 * 1024) return false;
		this.socket.send(JSON.stringify({ type: 'economy-action', ...action })); return true;
	}
	onHelicopter(fn) { this.helicopterHandlers.add(fn); if (this.helicopter) fn(this.helicopter); return () => this.helicopterHandlers.delete(fn); }
	helicopterAction(action, state) {
		if (!this.online || this.socket.readyState !== 1 || (this.socket.bufferedAmount ?? 0) > 256 * 1024) return false;
		this.socket.send(JSON.stringify({ type: 'helicopter-action', action, state })); return true;
	}
	onSpeech(fn) { this.speechHandlers.add(fn); return () => this.speechHandlers.delete(fn); }
	onSpeechAudio(fn) { this.audioHandlers.add(fn); return () => this.audioHandlers.delete(fn); }
	onSpeechError(fn) { this.errorHandlers.add(fn); return () => this.errorHandlers.delete(fn); }
	onPeerLeft(fn) { this.leaveHandlers.add(fn); return () => this.leaveHandlers.delete(fn); }
	send(state) {
		if (state) this.lastState = state;
		// Movement is replaceable: skip obsolete samples instead of growing a
		// reliable WebSocket queue behind a congested connection.
		if (this.online && this.socket.readyState === 1 && (this.socket.bufferedAmount ?? 0) <= 64 * 1024) {
			this.socket.send(JSON.stringify({ type: 'state', state }));
			return true;
		}
		return false;
	}
	sendSpeech(event) {
		if (!this.connected || !this.online || this.socket.readyState !== 1) return false;
		this.socket.send(JSON.stringify({ type: 'speech', event })); return true;
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		if (this.timer != null) { this.clearTimer(this.timer); this.timer = null; }
		this.connected = false;
		this.online = false;
		this.status = 'Disconnected';
		if (!this.readySettled) { this.readySettled = true; this.rejectReady(new Error('Connection closed')); }
		this.socket?.close();
	}
}
