#!/usr/bin/env python3
"""Exercise the typed action runner inside Blender with a checked-in GLB."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ACTION_RUNNER = ROOT / "tools/blender/world_actions.py"
SOURCE_PATH = ROOT / "worlds/tidewater/world-source.json"
OBJECT_ID = "tw-object:blender-runtime-check"
MESH_ID = "tw-object:blender-generated-check"


def temporary_root():
    prefix = os.environ.get("PREFIX", "")
    candidate = pathlib.Path(prefix) / "tmp" if prefix.startswith("/data/data/") else pathlib.Path("/var/tmp")
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def run(command, environment):
    result = subprocess.run(command, cwd=ROOT, env=environment, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError("command failed: %s\n%s%s" % (" ".join(map(str, command)), result.stdout, result.stderr))
    return result.stdout + result.stderr


def main():
    blender = os.environ.get("BLENDER_EXECUTABLE") or shutil.which("blender")
    if not blender:
        raise SystemExit("Blender not found; set BLENDER_EXECUTABLE to a Blender executable")
    blender = str(pathlib.Path(blender).resolve())
    source_bytes = SOURCE_PATH.read_bytes()
    source = json.loads(source_bytes)
    if any(record["id"] in {OBJECT_ID, MESH_ID} for record in source["objects"]):
        raise SystemExit("runtime-check object ID already exists in the example source")
    asset_ids = list(dict.fromkeys(
        record["assetId"] for record in source["objects"]
        if record["id"].startswith("tw-object:scanned-debris-")
    ))
    if len(asset_ids) < 2:
        raise SystemExit("runtime check needs two source assets to exercise asset replacement")
    asset_id, replacement_asset_id = asset_ids[:2]
    asset_path = ROOT / "worlds/tidewater/assets" / asset_id.removeprefix("sha256:")
    plan = {
        "protocol": "elsemesh.blender-actions/1",
        "sourceHash": "sha256:" + hashlib.sha256(source_bytes).hexdigest(),
        "actions": [{
            "op": "object.add",
            "object": {
                "id": OBJECT_ID,
                "kind": "asset-instance",
                "label": "Blender runtime check",
                "assetId": asset_id,
                "priority": "visible",
                "transform": {"position": [0, 0, 0], "yaw": 0},
                "scale": [1, 1, 1],
                "collision": {"shape": "none", "enabled": False},
            },
        }, {
            "op": "object.update",
            "id": OBJECT_ID,
            "fields": {"assetId": replacement_asset_id},
        }, {
            "op": "mesh.create",
            "object": {
                "id": MESH_ID,
                "kind": "asset-instance",
                "label": "AI-created sample prop",
                "priority": "visible",
                "transform": {"position": [2, 0, -1], "yaw": 0.25},
                "scale": [1, 1, 1],
                    "collision": {"shape": "box", "enabled": True, "center": [0, 0.5, 0], "halfExtents": [0.5, 0.5, 0.5], "walkable": False, "solid": True},
            },
            "parts": [
                {"shape": "box", "dimensions": [1, 1, 1], "position": [0, 0, 0], "material": "wood"},
                {"shape": "cylinder", "dimensions": [0.25, 0.2, 0.25], "position": [0.2, 0.55, 0], "material": "metal"},
            ],
        }],
    }

    with tempfile.TemporaryDirectory(prefix="elsemesh-blender-actions-", dir=temporary_root()) as temporary:
        work = pathlib.Path(temporary)
        plan_path = work / "plan.json"
        candidate_source = work / "candidate.world-source.json"
        candidate_blend = work / "candidate.blend"
        candidate_assets = work / "candidate-assets"
        plan_path.write_text(json.dumps(plan), encoding="utf-8")
        environment = os.environ.copy()
        environment.update({
            "BLENDER_SYSTEM_RESOURCES": str(pathlib.Path(blender).resolve().parents[1] / "share/blender"),
            "BLENDER_SYSTEM_SCRIPTS": str(pathlib.Path(blender).resolve().parents[1] / "share/blender/scripts"),
            "BLENDER_SYSTEM_DATAFILES": str(pathlib.Path(blender).resolve().parents[1] / "share/blender/datafiles"),
            "BLENDER_USER_CONFIG": str(work / "config"),
            "BLENDER_USER_SCRIPTS": str(work / "scripts"),
            "BLENDER_USER_DATAFILES": str(work / "datafiles"),
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        run([
            blender, "--background", "--factory-startup", "--python", str(ACTION_RUNNER), "--",
            "--plan", str(plan_path), "--source", str(SOURCE_PATH),
            "--assets", str(asset_path.parent), "--out-source", str(candidate_source),
            "--out-blend", str(candidate_blend), "--out-assets", str(candidate_assets),
        ], environment)

        candidate = json.loads(candidate_source.read_text(encoding="utf-8"))
        if not any(record["id"] == OBJECT_ID for record in candidate["objects"]):
            raise RuntimeError("candidate source is missing the new stable-ID object")
        placed_record = next(record for record in candidate["objects"] if record["id"] == OBJECT_ID)
        if placed_record["assetId"] != replacement_asset_id:
            raise RuntimeError("candidate source did not retain the replacement asset ID")
        mesh_record = next((record for record in candidate["objects"] if record["id"] == MESH_ID), None)
        if not mesh_record or not mesh_record["assetId"].startswith("sha256:"):
            raise RuntimeError("candidate source is missing the generated content-addressed mesh")
        generated_asset = candidate_assets / mesh_record["assetId"].removeprefix("sha256:")
        if not generated_asset.is_file() or "sha256:" + hashlib.sha256(generated_asset.read_bytes()).hexdigest() != mesh_record["assetId"]:
            raise RuntimeError("generated GLB does not match the candidate source content hash")
        package_assets = work / "package-assets"
        package_assets.mkdir()
        asset_ids = {record["assetId"] for record in candidate["objects"]}
        for component in candidate.get("components", []):
            if component.get("placementAssetId"):
                asset_ids.add(component["placementAssetId"])
            asset_ids.update(bed["assetId"] for bed in component.get("beds", []))
        for content_id in asset_ids:
            digest = content_id.removeprefix("sha256:")
            candidate_asset = candidate_assets / digest
            original_asset = ROOT / "worlds/tidewater/assets" / digest
            target = candidate_asset if candidate_asset.is_file() else original_asset
            if not target.is_file():
                raise RuntimeError("candidate package is missing an asset: " + content_id)
            (package_assets / digest).symlink_to(target)
        candidate_manifest = work / "candidate.manifest.json"
        run([
            "node", str(ROOT / "tools/world-source-to-manifest.mjs"),
            "--source", str(candidate_source), "--owner", "runtime-test-owner",
            "--assets", str(package_assets), "--out", str(candidate_manifest),
        ], environment)
        manifest = json.loads(candidate_manifest.read_text(encoding="utf-8"))
        if not any(asset["id"] == mesh_record["assetId"] for asset in manifest["assets"]):
            raise RuntimeError("runtime manifest omitted the generated GLB asset")
        if candidate_blend.stat().st_size < 100_000:
            raise RuntimeError("candidate Blender file is unexpectedly small")
        expression = "import bpy; ids = {o.get('elsemesh_action_id') for o in bpy.data.objects}; assert '%s' in ids and '%s' in ids; print('reopened-world-action-ok')" % (OBJECT_ID, MESH_ID)
        output = run([blender, "--background", "--factory-startup", str(candidate_blend), "--python-expr", expression], environment)
        if "reopened-world-action-ok" not in output:
            raise RuntimeError("reopened Blender file did not confirm the stable-ID object")
        print("Blender runtime actions passed: imported and replaced a hash-verified GLB, created and hashed a bounded mesh GLB, wrote all candidate artifacts, and reopened both stable IDs")


if __name__ == "__main__":
    main()
