// Bound leased data requests across component runtimes, leaving transport
// capacity for lease control. Running requests are never preempted.
export class PriorityRequestQueue {
	constructor( limit ) {
		this.limit = limit;
		this.active = 0;
		this.waiting = [];
	}

	run( signal, priority, task ) {
		return new Promise( ( resolve, reject ) => {
			if ( signal?.aborted ) { reject( signal.reason ); return; }
			const entry = { signal, priority, task, resolve, reject };
			entry.abort = () => {
				const index = this.waiting.indexOf( entry );
				if ( index >= 0 ) { this.waiting.splice( index, 1 ); reject( signal.reason ); }
			};
			signal?.addEventListener( 'abort', entry.abort, { once: true } );
			const index = this.waiting.findIndex( waiting => waiting.priority > priority );
			if ( index < 0 ) this.waiting.push( entry );
			else this.waiting.splice( index, 0, entry );
			this.pump();
		} );
	}

	pump() {
		while ( this.active < this.limit && this.waiting.length ) {
			const entry = this.waiting.shift();
			entry.signal?.removeEventListener( 'abort', entry.abort );
			if ( entry.signal?.aborted ) { entry.reject( entry.signal.reason ); continue; }
			this.active ++;
			Promise.resolve().then( entry.task ).then( entry.resolve, entry.reject ).finally( () => {
				this.active --;
				this.pump();
			} );
		}
	}
}
