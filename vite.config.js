import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

// Vite copies public/ verbatim. The candidate is intentionally available in
// local development, but its local-experiment-only files must not be published.
const excludeLocalExperiment = () => {
	let outputDirectory;
	return ({
	name: 'exclude-local-warehouse-experiment',
	apply: 'build',
	configResolved( config ) { outputDirectory = resolve( config.root, config.build.outDir ); },
	async closeBundle() { await rm( resolve( outputDirectory, 'models/experimental' ), { recursive: true, force: true } ); },
	});
};

export default defineConfig( {
	plugins: [ excludeLocalExperiment() ],
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /elsemesh/)
	base: './',
	build: { target: 'esnext', chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: resolve( 'index.html' ), networkDemo: resolve( 'network-demo.html' ), playOnline: resolve( 'play-online.html' ) } } },
	server: { port: 5188, strictPort: true, host: '127.0.0.1' },
} );
