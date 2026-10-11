// Optional deployment settings. Keep empty to leave account sign-in disabled.
// Google client IDs are public identifiers; never put a client secret here.
globalThis.ELSEMESH_CONFIG = Object.freeze( {
	accountd: '', // HTTPS URL of the accountd reverse proxy, e.g. https://accounts.example.org
	worldResolver: '', // HTTPS resolver origin for ThruHold IDs and ZeroTier node IDs, e.g. https://worlds.elsemesh.org
	googleClientId: '', // OAuth web client ID for this site's exact origin
} );
