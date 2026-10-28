"""Apply a constrained, data-only editing plan in an isolated Blender copy.

The plan format accepts bounded primitive-mesh creation, stable-ID asset placement,
and portal operations. It never evaluates Python, expressions, file paths, shell
commands, or Blender operator names.
Run from Blender with:
  blender working-copy.blend --background --python tools/blender/world_actions.py -- \
    --plan plan.json --source world-source.json --assets assets/ \
    --out-source candidate.world-source.json --out-blend candidate.blend \
    --out-assets candidate-assets/  # required when the plan contains mesh.create
"""
import argparse
import hashlib
import json
import math
import pathlib
import re
import sys
import os
import tempfile

PROTOCOL = "elsemesh.blender-actions/1"
MAX_PLAN_BYTES = 16 * 1024 * 1024
MAX_ASSET_BYTES = 128 * 1024 * 1024
MAX_ACTIONS = 256
MAX_CREATED_MESHES = 16
MAX_MESH_PARTS = 12
MAX_TOTAL_MESH_PARTS = 96
OBJECT_ID = re.compile(r"^elsemesh-object:[\w.-]{1,128}$")
PORTAL_ID = re.compile(r"^elsemesh-portal:[\w.-]{1,128}$")
ASSET_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
OBJECT_FIELDS = {"label", "assetId", "lods", "priority", "streamingBounds", "transform", "scale", "collision"}
PORTAL_FIELDS = {"destinationWorldId", "destinationPeerId", "destinationGateway", "entry", "exit", "openView", "enabled", "visual", "back"}
PRIORITIES = {"portal-preview", "visible", "nearby", "background"}
MESH_SHAPES = {"box", "cylinder", "uv-sphere"}
MESH_MATERIALS = {"wood", "stone", "paint", "metal"}
PENDING_ASSET_ID = "sha256:" + "0" * 64


def read_bytes(path, maximum):
    path = pathlib.Path(path)
    if not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("input must be a regular file within its size limit")
    data = path.read_bytes()
    if len(data) > maximum:
        raise ValueError("input grew beyond its size limit while being read")
    return data


def vector(value, name, maximum=1000000):
    if not isinstance(value, list) or len(value) != 3 or any(not finite_number(x) or abs(x) > maximum for x in value):
        raise ValueError("%s must be a bounded finite 3-vector" % name)


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def require_keys(record, required, allowed, name):
    if not isinstance(record, dict) or not set(required).issubset(record) or not set(record).issubset(allowed):
        raise ValueError("invalid %s fields" % name)


def validate_source(source):
    if not isinstance(source, dict) or source.get("protocol") != "elsemesh.world-source/3":
        raise ValueError("unsupported world source protocol")
    rules = source.get("rules")
    if (not isinstance(rules, dict) or not isinstance(rules.get("maxVisitors"), int)
            or isinstance(rules.get("maxVisitors"), bool) or not 1 <= rules["maxVisitors"] <= 128
            or not finite_number(rules.get("spawnRadius")) or not 0 <= rules["spawnRadius"] <= 100):
        raise ValueError("source must define maxVisitors (1-128) and spawnRadius (0-100 meters)")
    if not isinstance(source.get("objects"), list) or not isinstance(source.get("portals"), list):
        raise ValueError("source objects and portals must be arrays")
    seen = set()
    for record in source["objects"]:
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not OBJECT_ID.fullmatch(record["id"]) or record["id"] in seen:
            raise ValueError("invalid or duplicate object ID")
        require_keys(record, {"id", "kind", "label", "assetId", "transform", "scale", "collision"},
                     {"id", "kind", "label", "assetId", "lods", "priority", "streamingBounds", "transform", "scale", "collision", "replacesObjectId"}, "source object")
        seen.add(record["id"])
        if not isinstance(record["label"], str) or len(record["label"]) > 160:
            raise ValueError("object label must be a string no longer than 160 characters")
        if not ASSET_ID.fullmatch(record.get("assetId") or ""):
            raise ValueError("object %s requires an imported content-addressed asset" % record["id"])
        if record.get("priority", "visible") not in PRIORITIES:
            raise ValueError("invalid object streaming priority")
        if record.get("kind") != "asset-instance":
            raise ValueError("unsupported object kind")
        transform = record.get("transform")
        require_keys(transform, {"position", "yaw"}, {"position", "yaw", "rotation"}, "object transform")
        if not isinstance(transform, dict) or not finite_number(transform.get("yaw")):
            raise ValueError("object %s has an invalid transform" % record["id"])
        vector(transform.get("position"), "object position")
        if "rotation" in transform:
            rotation = transform["rotation"]
            if not isinstance(rotation, list) or len(rotation) != 4 or any(not finite_number(value) for value in rotation) or abs(math.hypot(*rotation) - 1) > 1e-4:
                raise ValueError("object rotation must be a normalized four-component quaternion")
        vector(record.get("scale"), "object scale")
        if any(scale <= 0 or scale > 1000 for scale in record["scale"]):
            raise ValueError("object scale is outside the supported range")
        bounds = record.get("streamingBounds")
        if bounds is not None:
            require_keys(bounds, {"center", "radius"}, {"center", "radius"}, "streaming bounds")
            vector(bounds["center"], "streaming bounds center", maximum=10000)
            if not finite_number(bounds["radius"]) or not 0 < bounds["radius"] <= 10000:
                raise ValueError("streaming bounds radius is outside the supported range")
        if "lods" in record:
            levels = record["lods"]
            if bounds is None or not isinstance(levels, list) or not 1 <= len(levels) <= 3:
                raise ValueError("object LODs require bounds and one to three levels")
            referenced = {record["assetId"]}
            threshold = 1
            for level in levels:
                require_keys(level, {"assetId", "maxScreenFraction"}, {"assetId", "maxScreenFraction"}, "object LOD")
                asset = level["assetId"]
                size = level["maxScreenFraction"]
                if not isinstance(asset, str) or not ASSET_ID.fullmatch(asset) or asset in referenced or not finite_number(size) or not 0 < size < threshold:
                    raise ValueError("object LOD references and thresholds must be distinct and decreasing")
                referenced.add(asset)
                threshold = size
        collision = record.get("collision")
        require_keys(collision, {"shape", "enabled"}, {"shape", "enabled", "center", "halfExtents", "boxes", "rows", "columns", "walkable", "solid"}, "collision")
        if not isinstance(collision, dict) or not isinstance(collision.get("enabled"), bool):
            raise ValueError("object %s requires collision intent" % record["id"])
        if "rotation" in transform and collision["enabled"]:
            raise ValueError("object rotation cannot be used with collision")
        if collision["enabled"]:
            shape = collision.get("shape")
            if shape == "box":
                vector(collision.get("center"), "collision center")
                vector(collision.get("halfExtents"), "collision half extents")
                if any(x <= 0 or x > 1000 for x in collision["halfExtents"]):
                    raise ValueError("collision half extents are outside the supported range")
                if not isinstance(collision.get("walkable"), bool) or not isinstance(collision.get("solid"), bool):
                    raise ValueError("box collision requires walkable and solid flags")
            elif shape == "compound":
                boxes = collision.get("boxes")
                if not isinstance(boxes, list) or not 1 <= len(boxes) <= 2048:
                    raise ValueError("compound collision requires 1 to 2048 boxes")
                for box in boxes:
                    if not isinstance(box, dict):
                        raise ValueError("compound collision box must be an object")
                    vector(box.get("center"), "compound collision center")
                    vector(box.get("halfExtents"), "compound collision half extents")
                    if any(x <= 0 or x > 1000 for x in box["halfExtents"]):
                        raise ValueError("compound collision half extents are outside the supported range")
                    if not finite_number(box.get("yaw")) or abs(box["yaw"]) > 360:
                        raise ValueError("compound collision yaw is outside the supported range")
                    if not isinstance(box.get("walkable"), bool) or not isinstance(box.get("solid"), bool):
                        raise ValueError("compound collision requires walkable and solid flags")
            elif shape == "heightfield":
                if collision.get("walkable") is not True or collision.get("solid") is not True:
                    raise ValueError("heightfield collision must be walkable and solid")
            else:
                raise ValueError("unsupported enabled collision shape")
    for record in source["portals"]:
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not PORTAL_ID.fullmatch(record["id"]) or record["id"] in seen:
            raise ValueError("invalid or duplicate portal ID")
        seen.add(record["id"])
        for key in ("entry", "exit"):
            point = record.get(key)
            if not isinstance(point, dict) or not finite_number(point.get("yaw")):
                raise ValueError("portal %s has an invalid %s transform" % (record["id"], key))
            vector(point.get("position"), "portal %s position" % key)
        if not isinstance(record.get("destinationWorldId"), str) or not record["destinationWorldId"].startswith("world:"):
            raise ValueError("portal %s requires a destination world" % record["id"])
        if not isinstance(record.get("openView"), bool) or not isinstance(record.get("enabled"), bool):
            raise ValueError("portal %s requires boolean openView and enabled" % record["id"])
        if "back" in record:
            if "elsemesh.portal-two-sided/1" not in source.get("rules", {}).get("requiredFeatures", []):
                raise ValueError("portal back requires elsemesh.portal-two-sided/1")
            validate_portal_back(record["back"])
        visual = record.get("visual")
        if visual is not None and (not isinstance(visual, str) or visual not in {"timber", "stone", "metal"}):
            raise ValueError("portal %s visual must be timber, stone, or metal" % record["id"])
    return source


def validate_portal_back(back):
    from urllib.parse import urlparse
    fields = {"destinationWorldId", "destinationPeerId", "destinationGateway", "exit", "openView", "enabled"}
    if not isinstance(back, dict) or set(back) - fields or not re.fullmatch(r"world:[\w.-]{1,128}", str(back.get("destinationWorldId", ""))):
        raise ValueError("invalid portal back fields or destination")
    if "destinationPeerId" in back and (not isinstance(back["destinationPeerId"], str) or not re.fullmatch(r"[A-Za-z0-9]{20,256}", back["destinationPeerId"])):
        raise ValueError("invalid portal back peer")
    if "destinationGateway" in back:
        gateway = back["destinationGateway"]
        if not isinstance(gateway, str):
            raise ValueError("invalid portal back gateway")
        parsed = urlparse(gateway)
        if parsed.scheme not in {"https", "wss"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("invalid portal back gateway")
    point = back.get("exit")
    if not isinstance(point, dict) or set(point) != {"position", "yaw"} or not finite_number(point.get("yaw")) or abs(point["yaw"]) > 360:
        raise ValueError("invalid portal back exit")
    vector(point.get("position"), "portal back exit position")
    if any(abs(n) > 1e6 for n in point["position"]) or not isinstance(back.get("openView"), bool) or not isinstance(back.get("enabled"), bool):
        raise ValueError("invalid portal back flags or position")
    return back


def validate_plan(plan, source_bytes):
    source_hash = "sha256:" + hashlib.sha256(source_bytes).hexdigest()
    if not isinstance(plan, dict) or plan.get("protocol") != PROTOCOL or plan.get("sourceHash") != source_hash:
        raise ValueError("action plan does not match this world source snapshot")
    actions = plan.get("actions")
    if not isinstance(actions, list) or len(actions) > MAX_ACTIONS:
        raise ValueError("action plan has an invalid actions list")
    source = validate_source(json.loads(source_bytes, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite JSON number"))))
    source = json.loads(json.dumps(source))
    records = {record["id"]: record for record in source["objects"] + source["portals"]}
    normalized = []
    created_meshes = 0
    total_mesh_parts = 0
    for action in actions:
        if not isinstance(action, dict) or not isinstance(action.get("op"), str):
            raise ValueError("each Blender action must be a typed object")
        op = action["op"]
        if op == "object.add":
            require_keys(action, {"op", "object"}, {"op", "object"}, op)
            record = action["object"]
            if not isinstance(record, dict) or not OBJECT_ID.fullmatch(record.get("id", "")) or record["id"] in records:
                raise ValueError("object.add requires a new stable object ID")
            validate_source({**source, "objects": [*source["objects"], record]})
            records[record["id"]] = record
            source["objects"].append(record)
            normalized.append(action)
        elif op == "mesh.create":
            require_keys(action, {"op", "object", "parts"}, {"op", "object", "parts"}, op)
            record = action["object"]
            if not isinstance(record, dict) or record.get("kind") != "asset-instance" or "assetId" in record or not OBJECT_ID.fullmatch(record.get("id", "")) or record["id"] in records:
                raise ValueError("mesh.create requires a new stable asset-instance ID and derives its assetId")
            record = {**record, "assetId": PENDING_ASSET_ID}
            validate_source({**source, "objects": [*source["objects"], record]})
            parts = action["parts"]
            if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_MESH_PARTS:
                raise ValueError("mesh.create requires 1 to %d bounded primitive parts" % MAX_MESH_PARTS)
            for part in parts:
                require_keys(part, {"shape", "dimensions", "position", "material"}, {"shape", "dimensions", "position", "material"}, "mesh part")
                if part["shape"] not in MESH_SHAPES or part["material"] not in MESH_MATERIALS:
                    raise ValueError("mesh part uses an unsupported primitive or material preset")
                vector(part["dimensions"], "mesh dimensions", maximum=5)
                if any(size < 0.05 for size in part["dimensions"]):
                    raise ValueError("mesh dimensions must be at least 0.05 meters")
                vector(part["position"], "mesh part position", maximum=5)
            created_meshes += 1
            total_mesh_parts += len(parts)
            if created_meshes > MAX_CREATED_MESHES or total_mesh_parts > MAX_TOTAL_MESH_PARTS:
                raise ValueError("mesh creation exceeds the per-plan geometry budget")
            records[record["id"]] = record
            source["objects"].append(record)
            normalized.append(action)
        elif op == "object.update":
            require_keys(action, {"op", "id", "fields"}, {"op", "id", "fields"}, op)
            target = records.get(action["id"])
            fields = action["fields"]
            if target not in source["objects"] or not isinstance(fields, dict) or not fields or not set(fields).issubset(OBJECT_FIELDS):
                raise ValueError("object.update targets a source object and allows only editable fields")
            updated = {**target, **fields}
            validate_source({**source, "objects": [updated if x["id"] == target["id"] else x for x in source["objects"]]})
            target.update(fields)
            normalized.append(action)
        elif op == "object.remove":
            require_keys(action, {"op", "id"}, {"op", "id"}, op)
            if action["id"] not in records or records[action["id"]] not in source["objects"]:
                raise ValueError("object.remove requires an existing source object")
            source["objects"] = [x for x in source["objects"] if x["id"] != action["id"]]
            del records[action["id"]]
            normalized.append(action)
        elif op == "portal.add":
            require_keys(action, {"op", "portal"}, {"op", "portal"}, op)
            record = action["portal"]
            if not isinstance(record, dict) or not PORTAL_ID.fullmatch(record.get("id", "")) or record["id"] in records:
                raise ValueError("portal.add requires a new stable portal ID")
            validate_source({**source, "portals": [*source["portals"], record]})
            records[record["id"]] = record
            source["portals"].append(record)
            normalized.append(action)
        elif op == "portal.update":
            require_keys(action, {"op", "id", "fields"}, {"op", "id", "fields"}, op)
            target = records.get(action["id"])
            fields = action["fields"]
            if target not in source["portals"] or not isinstance(fields, dict) or not fields or not set(fields).issubset(PORTAL_FIELDS):
                raise ValueError("portal.update targets a source portal and allows only editable fields")
            updated = {**target, **fields}
            validate_source({**source, "portals": [updated if x["id"] == target["id"] else x for x in source["portals"]]})
            target.update(fields)
            normalized.append(action)
        elif op == "portal.remove":
            require_keys(action, {"op", "id"}, {"op", "id"}, op)
            if action["id"] not in records or records[action["id"]] not in source["portals"]:
                raise ValueError("portal.remove requires an existing source portal")
            source["portals"] = [x for x in source["portals"] if x["id"] != action["id"]]
            del records[action["id"]]
            normalized.append(action)
        else:
            raise ValueError("unsupported Blender action: %s" % op)
    return source, normalized


def blender_position(position):
    return (position[0], -position[2], position[1])


def find_preview(bpy, kind, stable_id):
    return next((obj for obj in bpy.data.objects if
                 (obj.get("elsemesh_action_kind") == kind and obj.get("elsemesh_action_id") == stable_id) or
                 (obj.get("thruhold_kind") == kind and obj.get("thruhold_id") == stable_id)), None)


def remove_preview(bpy, root):
    if root is None:
        return
    descendants = {root}
    while True:
        children = {obj for obj in bpy.data.objects if obj.parent in descendants}
        new = children - descendants
        if not new:
            break
        descendants.update(new)
    for obj in descendants:
        bpy.data.objects.remove(obj, do_unlink=True)


def remove_preview_contents(bpy, root):
    """Remove an object's imported mesh hierarchy while preserving its stable-ID marker."""
    if root is None:
        return
    descendants = {obj for obj in bpy.data.objects if obj.parent == root}
    while True:
        children = {obj for obj in bpy.data.objects if obj.parent in descendants}
        new = children - descendants
        if not new:
            break
        descendants.update(new)
    for obj in descendants:
        bpy.data.objects.remove(obj, do_unlink=True)


def import_asset_objects(bpy, asset_id, assets_dir):
    asset = pathlib.Path(assets_dir) / asset_id.split(":", 1)[1]
    asset_bytes = read_bytes(asset, MAX_ASSET_BYTES)
    if "sha256:" + hashlib.sha256(asset_bytes).hexdigest() != asset_id:
        raise ValueError("object asset is missing, oversized, or has a bad content hash")
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=str(asset))
    except Exception:
        for obj in set(bpy.data.objects) - before:
            bpy.data.objects.remove(obj, do_unlink=True)
        raise
    imported = [obj for obj in bpy.data.objects if obj not in before]
    if not imported:
        raise ValueError("asset import produced no Blender objects")
    return imported


def attach_imported_objects(imported, root, collection):
    for obj in imported:
        for old_collection in list(obj.users_collection):
            old_collection.objects.unlink(obj)
        collection.objects.link(obj)
        obj.parent = root
        obj.matrix_parent_inverse.identity()


def create_mesh_asset(bpy, action, collection, asset_dir):
    record = action["object"]
    root = bpy.data.objects.new(record.get("label") or record["id"], None)
    collection.objects.link(root)
    root["elsemesh_action_kind"] = "object"
    root["elsemesh_action_id"] = record["id"]
    root["thruhold_kind"] = "object"
    root["thruhold_id"] = record["id"]
    root["thruhold_record"] = json.dumps({**record, "assetId": PENDING_ASSET_ID}, separators=(",", ":"))
    root.location = blender_position(record["transform"]["position"])
    root.rotation_euler[2] = float(record["transform"].get("yaw", 0))
    root.scale = record["scale"]

    material_presets = {
        "wood": ((0.28, 0.12, 0.035, 1), 0.82, 0.0),
        "stone": ((0.32, 0.35, 0.36, 1), 0.9, 0.0),
        "paint": ((0.04, 0.24, 0.72, 1), 0.38, 0.0),
        "metal": ((0.38, 0.42, 0.45, 1), 0.28, 0.72),
    }
    generated_materials = {}
    meshes = []
    for index, part in enumerate(action["parts"]):
        if part["shape"] == "box":
            bpy.ops.mesh.primitive_cube_add(size=1.0)
        elif part["shape"] == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.5, depth=1.0)
        else:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.5)
        mesh = bpy.context.object
        mesh.name = "%s part %02d" % (record["id"], index + 1)
        for old_collection in list(mesh.users_collection):
            old_collection.objects.unlink(mesh)
        collection.objects.link(mesh)
        mesh.parent = root
        mesh.matrix_parent_inverse.identity()
        mesh.location = blender_position(part["position"])
        mesh.dimensions = part["dimensions"]
        if part["shape"] != "box":
            for polygon in mesh.data.polygons:
                polygon.use_smooth = True
        material = generated_materials.get(part["material"])
        if material is None:
            material = bpy.data.materials.new("ElseMesh preset " + part["material"])
            material.use_nodes = True
            color, roughness, metallic = material_presets[part["material"]]
            material.diffuse_color = color
            shader = material.node_tree.nodes.get("Principled BSDF")
            shader.inputs["Base Color"].default_value = color
            shader.inputs["Roughness"].default_value = roughness
            shader.inputs["Metallic"].default_value = metallic
            generated_materials[part["material"]] = material
        mesh.data.materials.clear()
        mesh.data.materials.append(material)
        meshes.append(mesh)

    if not meshes:
        raise ValueError("mesh.create produced no geometry")
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    staged_asset = pathlib.Path(asset_dir) / ("candidate-%s.glb" % record["id"].split(":", 1)[1])
    bpy.ops.export_scene.gltf(filepath=str(staged_asset), export_format="GLB", use_selection=True)
    asset_bytes = read_bytes(staged_asset, MAX_ASSET_BYTES)
    asset_id = "sha256:" + hashlib.sha256(asset_bytes).hexdigest()
    os.replace(staged_asset, pathlib.Path(asset_dir) / asset_id.split(":", 1)[1])
    finalized = {**record, "assetId": asset_id}
    root["thruhold_record"] = json.dumps(finalized, separators=(",", ":"))
    return asset_id


def apply_to_blender(actions, assets_dir, output_assets_dir=None):
    import bpy

    created_assets = {}
    collection = bpy.data.collections.get("ElseMesh AI Preview")
    if collection is None:
        collection = bpy.data.collections.new("ElseMesh AI Preview")
        bpy.context.scene.collection.children.link(collection)
    for action in actions:
        op = action["op"]
        if op == "mesh.create":
            if output_assets_dir is None:
                raise ValueError("mesh.create requires --out-assets for generated content-addressed assets")
            asset_id = create_mesh_asset(bpy, action, collection, output_assets_dir)
            created_assets[action["object"]["id"]] = asset_id
        elif op == "object.add":
            record = action["object"]
            if find_preview(bpy, "object", record["id"]) is not None:
                raise ValueError("object.add already exists in the Blender scene: " + record["id"])
            imported = import_asset_objects(bpy, record["assetId"], assets_dir)
            root = bpy.data.objects.new(record.get("label") or record["id"], None)
            collection.objects.link(root)
            attach_imported_objects(imported, root, collection)
            root["elsemesh_action_kind"] = "object"
            root["elsemesh_action_id"] = record["id"]
            root["thruhold_kind"] = "object"
            root["thruhold_id"] = record["id"]
            root["thruhold_record"] = json.dumps(record, separators=(",", ":"))
            root.location = blender_position(record["transform"]["position"])
            root.rotation_euler[2] = float(record["transform"].get("yaw", 0))
            root.scale = record["scale"]
        elif op == "object.update":
            root = find_preview(bpy, "object", action["id"])
            if root is None:
                raise ValueError("object.update has no matching Blender source marker: " + action["id"])
            fields = action["fields"]
            imported = import_asset_objects(bpy, fields["assetId"], assets_dir) if "assetId" in fields else None
            if imported:
                remove_preview_contents(bpy, root)
                attach_imported_objects(imported, root, collection)
            if "transform" in fields:
                root.location = blender_position(fields["transform"]["position"])
                root.rotation_euler[2] = float(fields["transform"].get("yaw", 0))
            if "scale" in fields:
                root.scale = fields["scale"]
            if "label" in fields:
                root.name = fields["label"]
            try:
                record = json.loads(root.get("thruhold_record", "{}"))
            except (TypeError, json.JSONDecodeError):
                record = {}
            record.update(fields)
            root["thruhold_record"] = json.dumps(record, separators=(",", ":"))
        elif op == "object.remove":
            root = find_preview(bpy, "object", action["id"])
            if root is None:
                raise ValueError("object.remove has no matching Blender source marker: " + action["id"])
            remove_preview(bpy, root)
        elif op == "portal.add":
            record = action["portal"]
            if find_preview(bpy, "portal", record["id"]) is not None:
                raise ValueError("portal.add already exists in the Blender scene: " + record["id"])
            marker = bpy.data.objects.new(record["id"], None)
            collection.objects.link(marker)
            marker.empty_display_type = "ARROWS"
            marker.location = blender_position(record["entry"]["position"])
            marker.rotation_euler[2] = float(record["entry"].get("yaw", 0))
            marker["elsemesh_action_kind"] = "portal"
            marker["elsemesh_action_id"] = record["id"]
            marker["thruhold_kind"] = "portal"
            marker["thruhold_id"] = record["id"]
            marker["thruhold_record"] = json.dumps(record, separators=(",", ":"))
        elif op == "portal.update":
            marker = find_preview(bpy, "portal", action["id"])
            if marker is None:
                raise ValueError("portal.update has no matching Blender source marker: " + action["id"])
            fields = action["fields"]
            if "entry" in fields:
                entry = fields["entry"]
                marker.location = blender_position(entry["position"])
                marker.rotation_euler[2] = float(entry.get("yaw", 0))
            record = json.loads(marker.get("thruhold_record", "{}"))
            record.update(fields)
            marker["thruhold_record"] = json.dumps(record, separators=(",", ":"))
        elif op == "portal.remove":
            marker = find_preview(bpy, "portal", action["id"])
            if marker is None:
                raise ValueError("portal.remove has no matching Blender source marker: " + action["id"])
            remove_preview(bpy, marker)
    return created_assets


def render_review_preview(bpy, actions, output_path):
    """Render an offline geometry-focused preview without saving temporary camera settings."""
    from mathutils import Vector

    output = pathlib.Path(output_path).resolve()
    if os.path.lexists(output):
        raise ValueError("review preview output already exists")
    scene = bpy.context.scene
    changed_ids = set()
    for action in actions:
        if action["op"] in {"mesh.create", "object.add"}:
            changed_ids.add(action["object"]["id"])
        elif action["op"] == "object.update":
            changed_ids.add(action["id"])

    def descends_from(obj, root):
        current = obj
        while current is not None:
            if current == root:
                return True
            current = current.parent
        return False

    scene_meshes = [obj for obj in scene.objects if obj.type == "MESH" and not obj.hide_render]
    roots = [find_preview(bpy, "object", stable_id) for stable_id in changed_ids]
    roots = [root for root in roots if root is not None]
    focused_meshes = [obj for obj in scene_meshes if any(descends_from(obj, root) for root in roots)]
    render_meshes = focused_meshes or scene_meshes
    if not render_meshes:
        return False

    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners = []
    for obj in render_meshes:
        evaluated = obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not corners:
        return False
    minimum = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    center = (minimum + maximum) * 0.5
    radius = max((point - center).length for point in corners)
    extent = max(maximum[axis] - minimum[axis] for axis in range(3))
    if not math.isfinite(radius) or not math.isfinite(extent) or extent <= 0:
        return False

    output.parent.mkdir(parents=True, exist_ok=True)
    fd, staged_name = tempfile.mkstemp(prefix=".elsemesh-preview-", suffix=".png", dir=output.parent)
    os.close(fd)
    staged = pathlib.Path(staged_name)
    staged.unlink()
    camera_data = bpy.data.cameras.new("ElseMesh Temporary Review Camera")
    camera = bpy.data.objects.new("ElseMesh Temporary Review Camera", camera_data)
    scene.collection.objects.link(camera)
    old_camera = scene.camera
    old_render = (scene.render.engine, scene.render.filepath, scene.render.resolution_x,
                  scene.render.resolution_y, scene.render.resolution_percentage,
                  scene.render.image_settings.file_format, scene.render.film_transparent)
    shading = scene.display.shading
    old_shading = (shading.light, shading.color_type, shading.background_type,
                   shading.show_shadows, shading.show_cavity)
    old_world_color = tuple(scene.world.color) if scene.world else None
    try:
        direction = Vector((1.0, -1.0, 0.72)).normalized()
        camera.location = center + direction * max(radius * 4.0, 4.0)
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = max(extent * 2.4, 0.5)
        camera_data.clip_start = 0.01
        camera_data.clip_end = max(radius * 20.0, 100.0)
        scene.camera = camera
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.filepath = str(staged)
        scene.render.resolution_x = 640
        scene.render.resolution_y = 420
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.film_transparent = False
        shading.light = "STUDIO"
        shading.color_type = "MATERIAL"
        shading.background_type = "WORLD"
        shading.show_shadows = True
        shading.show_cavity = True
        if scene.world is not None:
            scene.world.color = (0.025, 0.035, 0.05)
        bpy.ops.render.render(write_still=True)
        if not staged.is_file() or staged.stat().st_size < 24:
            raise RuntimeError("Blender did not produce a review preview image")
        os.replace(staged, output)
        return True
    finally:
        scene.camera = old_camera
        (scene.render.engine, scene.render.filepath, scene.render.resolution_x,
         scene.render.resolution_y, scene.render.resolution_percentage,
         scene.render.image_settings.file_format, scene.render.film_transparent) = old_render
        (shading.light, shading.color_type, shading.background_type,
         shading.show_shadows, shading.show_cavity) = old_shading
        if scene.world is not None and old_world_color is not None:
            scene.world.color = old_world_color
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)
        staged.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--assets", required=True)
    parser.add_argument("--out-assets")
    parser.add_argument("--out-source", required=True)
    parser.add_argument("--out-blend", required=True)
    parser.add_argument("--out-preview", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    plan_bytes = read_bytes(args.plan, MAX_PLAN_BYTES)
    source_bytes = read_bytes(args.source, MAX_PLAN_BYTES)
    plan = json.loads(plan_bytes, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite JSON number")))
    source, actions = validate_plan(plan, source_bytes)
    output_source = pathlib.Path(args.out_source).resolve()
    output_blend = pathlib.Path(args.out_blend).resolve()
    output_preview = pathlib.Path(args.out_preview).resolve()
    mesh_actions = [action for action in actions if action["op"] == "mesh.create"]
    output_assets = pathlib.Path(args.out_assets).resolve() if args.out_assets else None
    if bool(mesh_actions) != bool(output_assets):
        raise ValueError("--out-assets is required exactly when the plan contains mesh.create")
    if os.path.lexists(output_source) or os.path.lexists(output_blend) or os.path.lexists(output_preview):
        raise ValueError("candidate output paths must not already exist")
    outputs = [output_source, output_blend, output_preview]
    if len(set(outputs)) != len(outputs):
        raise ValueError("candidate source, Blender scene, and preview outputs must use separate paths")
    if output_assets is not None:
        if os.path.lexists(output_assets):
            raise ValueError("candidate asset directory must not already exist")
        input_assets = pathlib.Path(args.assets).resolve()
        if output_assets == input_assets or output_assets in input_assets.parents or input_assets in output_assets.parents:
            raise ValueError("candidate assets must be separate from the read-only input asset store")
        if any(output_assets == output or output_assets in output.parents or output in output_assets.parents for output in outputs):
            raise ValueError("candidate assets, source, and Blender outputs must use separate paths")
    bpy = sys.modules.get("bpy")
    if bpy is None:
        raise RuntimeError("This action runner must execute inside Blender")
    staged_assets = None
    if output_assets is not None:
        output_assets.parent.mkdir(parents=True, exist_ok=True)
        staged_assets = pathlib.Path(tempfile.mkdtemp(prefix=".elsemesh-assets-", dir=output_assets.parent))
    try:
        created_assets = apply_to_blender(actions, args.assets, staged_assets)
    except Exception:
        if staged_assets is not None:
            import shutil
            shutil.rmtree(staged_assets, ignore_errors=True)
        raise
    for record in source["objects"]:
        if record["id"] in created_assets:
            record["assetId"] = created_assets[record["id"]]
    validate_source(source)
    bpy.data.texts.get("ElseMeshThruHoldSource") or bpy.data.texts.new("ElseMeshThruHoldSource")
    text = bpy.data.texts["ElseMeshThruHoldSource"]
    text.clear()
    text.write(json.dumps(source, indent=2) + "\n")
    output_source.parent.mkdir(parents=True, exist_ok=True)
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    source_fd, staged_source_name = tempfile.mkstemp(prefix=".elsemesh-source-", dir=output_source.parent)
    os.close(source_fd)
    blend_fd, staged_blend_name = tempfile.mkstemp(prefix=".elsemesh-blend-", suffix=".blend", dir=output_blend.parent)
    os.close(blend_fd)
    staged_blend = pathlib.Path(staged_blend_name)
    staged_blend.unlink()
    committed_blend = False
    committed_source = False
    committed_assets = False
    preview_rendered = False
    try:
        pathlib.Path(staged_source_name).write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8", newline="\n")
        preview_rendered = render_review_preview(bpy, actions, output_preview)
        bpy.ops.wm.save_as_mainfile(filepath=str(staged_blend))
        if staged_assets is not None:
            os.replace(staged_assets, output_assets)
            committed_assets = True
        os.replace(staged_blend, output_blend)
        committed_blend = True
        os.replace(staged_source_name, output_source)
        committed_source = True
    except Exception:
        pathlib.Path(staged_source_name).unlink(missing_ok=True)
        staged_blend.unlink(missing_ok=True)
        if committed_source:
            output_source.unlink(missing_ok=True)
        if committed_blend:
            output_blend.unlink(missing_ok=True)
        if preview_rendered:
            output_preview.unlink(missing_ok=True)
        if committed_assets:
            import shutil
            shutil.rmtree(output_assets, ignore_errors=True)
        raise
    finally:
        if staged_assets is not None and staged_assets.exists():
            import shutil
            shutil.rmtree(staged_assets, ignore_errors=True)
    print("Wrote unsigned candidate source and Blender scene; review both before publication.")


if __name__ == "__main__" and "bpy" in sys.modules:
    main()
