# Grass density asset, version 1

`grass-density/1` is the portable RGBA density mask used by the trusted Tidewater grass renderer. It carries no executable behavior, geometry, or placement code. The static vegetation component references the content-addressed asset through optional `grassMaskAssetId`; using that field requires `tidewater.static-grass/1` in the world's signed `requiredFeatures` list.

The 16-byte little-endian header contains the ASCII `TGD1` signature, a `uint32` square resolution, and `float32` world-space terrain size and origin. The remaining bytes are exactly `resolution × resolution × 4` RGBA8 texels. Channels encode dune grass, meadow grass, sea oats, and beach creeper in that order. Resolution is 2–2048, size is finite and positive, origin is finite, and the complete asset is limited to 16 MiB.

The exporter derives the mask from authored terrain and placement inputs. A client samples the packaged terrain heightfield and this mask to render the existing camera-following grass field. It does not regenerate island terrain or derive grass from local procedural noise. Without `grassMaskAssetId`, static vegetation retains its prior behavior and creates no grass.
