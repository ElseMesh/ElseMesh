"""Generate a distance LOD for an exported world-object GLB.

Example (Blender 4.3.2):
  blender --background --python tools/blender/export-world-object-lod.py -- \
    --source /var/tmp/island-village.glb \
    --out worlds/tidewater/lod-source/village-low.glb \
    --ratio 0.35

The input GLB is retained as the full-detail and collision source. The output is
only a visual alternative; world rules, transforms and collision stay on the
base object. Keep UVs, vertex colors, custom attributes and material extras.
"""

import argparse
import os
import sys

import bpy


def triangle_count():
    return sum(
        sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
    )


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="full-detail source GLB")
    parser.add_argument("--out", required=True, help="output lower-detail GLB")
    parser.add_argument("--ratio", type=float, default=0.35, help="target triangle ratio per mesh (default: 0.35)")
    args = parser.parse_args(arguments)
    if not 0.05 <= args.ratio < 1:
        parser.error("--ratio must be at least 0.05 and less than 1")
    if not os.path.isfile(args.source):
        parser.error(f"source GLB does not exist: {args.source}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("source GLB contains no mesh objects")
    before = triangle_count()
    if before == 0:
        raise RuntimeError("source GLB contains no triangles")

    for obj in meshes:
        modifier = obj.modifiers.new("ElseMesh distance LOD", "DECIMATE")
        modifier.ratio = args.ratio
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    after = triangle_count()
    if after == 0 or after >= before:
        raise RuntimeError(f"LOD did not reduce triangles ({before} -> {after})")
    output = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format="GLB",
        export_apply=True,
        export_extras=True,
        export_attributes=True,
    )
    if not os.path.isfile(output) or os.path.getsize(output) == 0:
        raise RuntimeError("Blender did not write an output GLB")
    print(f"WORLD OBJECT LOD: {before} -> {after} triangles ({after / before:.1%}), {os.path.getsize(output)} bytes")


if __name__ == "__main__":
    main()
