// Stable type IDs and model-variant counts for tidewater.reef-placement/1.
// Keep this renderer-free registry append-only; changing an existing entry requires a new format.
export const REEF_TYPE_VARIANT_COUNTS = Object.freeze( {
	slab: 2, rock: 2, boulder: 1, lobes: 1, brain: 1, brainWide: 1, starlet: 1, knobby: 1, pillar: 1,
	elkhorn: 2, staghorn: 2, finger: 1, fire: 1, plate: 1, rod: 2, whip: 1, barrel: 1, tube: 1,
	vase: 1, rope: 1, urchin: 1, anemone: 1, rubble: 1, grass: 1, fan: 2, plume: 2, lettuce: 2,
	wallPlate: 2, wire: 2, blackCoral: 1, ear: 2, barrelDeep: 1, fanDeep: 2, meadow: 3, halimeda: 2,
	penicillus: 1, bayRock: 2, baySlab: 2, bayBoulder: 1, shoreRock: 2, starfish: 2, cucumber: 2,
	conch: 1, sargassum: 2,
} );

export const REEF_TYPE_NAMES = Object.freeze( Object.keys( REEF_TYPE_VARIANT_COUNTS ) );
