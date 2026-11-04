# ElseMesh KTX2 encoder

This format-neutral native library wraps the pinned Basis Universal encoder
for ElseMesh providers. It accepts RGBA8 pixels and writes UASTC KTX2 through
a C ABI callback in 16 KiB chunks. The callback must consume each chunk before
returning and must not re-enter the encoder. The library serializes calls and
uses one Basis worker thread to bound concurrent CPU and memory use.

By default the API generates a mip chain from the supplied source image. Flags
select sRGB input or normal-map mip renormalization; bit 2 disables generated
mips so the KTX2 contains only the supplied source level. This is an encoder
primitive for independently addressable source-mip tiers. Selecting source
mips, assigning content identity, caching, and transport remain the caller's
responsibility; HogwartsBridge does not yet use the single-level option.

Build from the persistent ElseMesh external build tree after recursively
syncing the initialized `third_party/basis_universal` submodule:

```sh
cd /var/tmp/builds/rebroad/src/elsemesh.build
cmake -S native/ktx2 -B native/ktx2 \
  -DBASISU_SOURCE_DIR="$PWD/third_party/basis_universal" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build native/ktx2 --target elsemesh_ktx2 -j2
ctest --test-dir native/ktx2 --output-on-failure
```

The public C interface is in `include/elsemesh_ktx2.h`. HogwartsBridge invokes
it directly. A future `worldd` integration should link this same library
instead of implementing or launching a second encoder; see
[`docs/world-network-design.md`](../../docs/world-network-design.md).
