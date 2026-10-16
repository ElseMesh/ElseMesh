// Local-development ONLY: opt-in authenticated remote-world 3D proxy rendering.
// Never auto-connect to an address from an arbitrary public-page URL.
import { browserIdentity } from './BrowserIdentity.js';
import { FederationView } from './FederationView.js';
import { FederationScenePreview } from './FederationScenePreview.js';

export function allowFederationPreviewOrigin(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}
export async function installLocalFederationPreview(app, params, host = location.hostname) {
  if (!allowFederationPreviewOrigin(host)) throw new Error('Remote-world preview is local-only');
  const endpoint = params.get('endpoint');
  const expectedOwnerNodeId = params.get('owner');
  const worldId = params.get('world');
  const regionId = params.get('region');
  const playerId = params.get('player');
  const coords = (params.get('center') || '0,0,0').split(',').map(Number);
  const radius = Number(params.get('radius') || 100);
  if (![endpoint, expectedOwnerNodeId, worldId, regionId, playerId].every(Boolean) ||
      !Array.isArray(coords) || coords.length !== 3 || !coords.every(Number.isFinite) ||
      !Number.isFinite(radius) || radius < 1 || radius > 250)
    throw new Error('Missing pinned remote-world preview identity or invalid interest bounds');
  // Browser locally holds a non-exportable Ed25519 private key for this demo role.
  const identity = await browserIdentity('guest');
  const preview = new FederationScenePreview(app.engine.scene, app.engine.camera, { center: coords });
  let view;
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999;padding:8px 12px;' +
    'background:#152630e8;color:#d5fff7;font:12px system-ui;pointer-events:none';
  status.textContent = 'Authenticated remote 3D proxies: connecting (local test)';
  document.body.append(status);
  try {
    view = new FederationView({ endpoint, ownerNodeId: expectedOwnerNodeId,
      worldId, regionId, playerId, identity });
    view.onEvent(event => {
      if (event.type === 'snapshot') {
        try {
          preview.applyVerifiedSnapshot(event.packet);
          status.textContent = 'Remote world proxies: ' + event.packet.entities.length +
            '/' + event.packet.visibleCount + ' visible entities' +
            (event.packet.truncated ? ' (limited view)' : '') + ' (not full terrain)';
        } catch {
          preview.disconnect();
          status.textContent = 'Remote proxy state rejected';
        }
      } else if (event.type === 'disconnected' || event.type === 'denied') {
        preview.disconnect();
        status.textContent = 'Remote world unavailable (' + event.code + ')';
      } else if (event.type === 'reconnecting') {
        preview.disconnect();
        status.textContent = 'Remote world reconnecting; stale proxies hidden';
      }
    });
    await view.watch(coords, radius);
    view.start();
    return {
      view, preview, status,
      update() { if (preview.group.visible) preview.updateCamera(); },
      dispose() { view.stop(); preview.dispose(); status.remove(); },
    };
  } catch (error) {
    view?.stop();
    preview.dispose();
    status.remove();
    throw error;
  }
}
