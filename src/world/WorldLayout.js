import { ISLAND_DEFINITION as D } from '../../worlds/tidewater/IslandDefinition.js';
import { createWorldLayout } from './createWorldLayout.js';

// Temporary alias for procedural systems being converted to receive the
// active package layout explicitly.
export const WORLD = createWorldLayout( D );
