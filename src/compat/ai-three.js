// AI Portals is pinned to its own vendored Three.js version. Keep the import
// graph isolated from ElseMesh's Three.js and preserve the one legacy constant
// name used by its source modules.
import * as legacyThree from '../../worlds/ai-portals/vendor/three/three.module.min.js';

export * from '../../worlds/ai-portals/vendor/three/three.module.min.js';
export const LinearMipmapLinear = legacyThree.LinearMipmapLinearFilter;
