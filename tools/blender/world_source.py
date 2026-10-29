"""Import/export ElseMesh ThruHold source JSON from Blender.

Run: blender --background scene.blend --python tools/blender/world_source.py -- import world.json
     blender --background scene.blend --python tools/blender/world_source.py -- export world.json
The source document is retained in a Blender text block named ElseMeshThruHoldSource.
"""
import json
import math
import os
import pathlib
import sys
import bpy
TOOL_DIR = str(pathlib.Path(__file__).resolve().parent)
if TOOL_DIR not in sys.path:
    sys.path.insert(0, TOOL_DIR)
from world_identity import is_world_id

PROTOCOL = "elsemesh.world-source/3"
TEXT_NAME = "ElseMeshThruHoldSource"
PREVIOUS_TEXT_NAME = "ThruholdWorldSource"
LEGACY_TEXT_NAME = "TidewaterWorldSource"


def args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) != 2 or values[0] not in {"import", "export"}:
        raise SystemExit("expected: import|export path.json")
    return values[0], pathlib.Path(values[1])


def validate(source):
    if source.get("protocol") != PROTOCOL:
        raise ValueError("unsupported ThruHold source protocol")
    if not is_world_id(source.get("worldId")):
        raise ValueError("missing worldId")
    if not isinstance(source.get("objects"), list) or not isinstance(source.get("portals"), list):
        raise ValueError("objects and portals must be arrays")
    rules = source.get("rules")
    if (not isinstance(rules, dict) or not isinstance(rules.get("maxVisitors"), int)
            or isinstance(rules.get("maxVisitors"), bool) or not 1 <= rules["maxVisitors"] <= 128
            or not isinstance(rules.get("spawnRadius"), (int, float)) or isinstance(rules.get("spawnRadius"), bool)
            or not math.isfinite(rules["spawnRadius"]) or not 0 <= rules["spawnRadius"] <= 100):
        raise ValueError("rules must define maxVisitors (1-128) and spawnRadius (0-100 meters)")
    hosts = source.get("hosts", [])
    if not isinstance(hosts, list) or len(hosts) > 256:
        raise ValueError("hosts must be an array of at most 256 grants")
    seen_hosts = set()
    for grant in hosts:
        if not isinstance(grant, dict):
            raise ValueError("host grant must be an object")
        peer_id = grant.get("peerId")
        scopes = grant.get("scopes")
        if (not isinstance(peer_id, str) or not 20 <= len(peer_id) <= 256 or not peer_id.isascii() or not peer_id.isalnum()
                or peer_id in seen_hosts or not isinstance(scopes, list) or not 1 <= len(scopes) <= 2
                or any(not isinstance(scope, str) or scope not in {"content-cache", "failover-authority"} for scope in scopes)
                or len(set(scopes)) != len(scopes)
                or not _positive_int(grant.get("epoch")) or not _positive_int(grant.get("expiresAt"))):
            raise ValueError("invalid or duplicate owner host grant")
        failover = "failover-authority" in scopes
        after, duration = grant.get("failoverAfter"), grant.get("failoverSeconds")
        if failover and (not _positive_int(after) or not _positive_int(duration) or duration > 3600 or after > grant["expiresAt"] - duration):
            raise ValueError("invalid host grant failover window")
        if not failover and (after is not None or duration is not None):
            raise ValueError("failover window without failover permission")
        seen_hosts.add(peer_id)
    for portal in source["portals"]:
        visual = portal.get("visual") if isinstance(portal, dict) else None
        if not isinstance(portal, dict) or visual is not None and (not isinstance(visual, str) or visual not in {"timber", "stone", "metal"}):
            raise ValueError("portal visual must be timber, stone, or metal when specified")
        if "back" in portal:
            if "elsemesh.portal-two-sided/1" not in source.get("rules", {}).get("requiredFeatures", []):
                raise ValueError("portal back requires elsemesh.portal-two-sided/1")
            from world_actions import validate_portal_back
            validate_portal_back(portal["back"])
    return source


def _positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 < value <= 9007199254740991


def to_blender(p):
    # ElseMesh right-handed Y-up -> Blender right-handed Z-up.
    return (p[0], -p[2], p[1])


def to_world_coordinates(p):
    return (p[0], p[2], -p[1])


def metadata_items(source):
    return [("object", item) for item in source["objects"]] + [("portal", item) for item in source["portals"]]


def import_source(path):
    source = validate(json.loads(path.read_text(encoding="utf-8")))
    collection = bpy.data.collections.get("ElseMesh ThruHold Source") or bpy.data.collections.get("Thruhold World Source") or bpy.data.collections.get("Tidewater World Source")
    if collection is None:
        collection = bpy.data.collections.new("ElseMesh ThruHold Source")
        bpy.context.scene.collection.children.link(collection)
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for kind, item in metadata_items(source):
        empty = bpy.data.objects.new(item.get("label") or item["id"], None)
        collection.objects.link(empty)
        empty.empty_display_type = "CUBE" if kind == "object" else "ARROWS"
        empty.location = to_blender(item.get("transform", item.get("entry"))["position"])
        empty["thruhold_kind"] = kind
        empty["thruhold_id"] = item["id"]
        empty["thruhold_record"] = json.dumps(item, separators=(",", ":"))
        if kind == "object":
            empty.scale = item.get("scale", (1, 1, 1))
            empty.rotation_euler[2] = float(item["transform"].get("yaw", 0))
    text = bpy.data.texts.get(TEXT_NAME) or bpy.data.texts.get(PREVIOUS_TEXT_NAME) or bpy.data.texts.get(LEGACY_TEXT_NAME) or bpy.data.texts.new(TEXT_NAME)
    text.clear()
    text.write(json.dumps(source, indent=2) + "\n")
    bpy.context.scene["thruhold_world_id"] = source["worldId"]
    print("Imported %d objects and %d portals" % (len(source["objects"]), len(source["portals"])))


def export_source(path):
    text = bpy.data.texts.get(TEXT_NAME) or bpy.data.texts.get(PREVIOUS_TEXT_NAME) or bpy.data.texts.get(LEGACY_TEXT_NAME)
    if text is None:
        raise ValueError("ElseMeshThruHoldSource text block is missing; import a source file first")
    source = validate(json.loads(text.as_string()))
    objects, portals = [], []
    for obj in bpy.data.objects:
        raw = obj.get("thruhold_record") or obj.get("tidewater_record")
        if not raw:
            continue
        item = json.loads(raw)
        kind = obj.get("thruhold_kind") or obj.get("tidewater_kind")
        position = list(to_world_coordinates(obj.location))
        if kind == "object":
            item["transform"]["position"] = position
            item["transform"]["yaw"] = float(obj.rotation_euler[2])
            item["scale"] = list(obj.scale)
            objects.append(item)
        elif kind == "portal":
            item["entry"]["position"] = position
            # Preserve portal yaw from the record; Blender portal markers currently expose location only.
            portals.append(item)
    changed = objects != source["objects"] or portals != source["portals"]
    source["objects"], source["portals"] = objects, portals
    if changed:
        epoch = os.environ.get("SOURCE_DATE_EPOCH")
        if epoch is not None:
            try:
                timestamp = __import__("datetime").datetime.fromtimestamp(int(epoch), __import__("datetime").timezone.utc)
            except (ValueError, OverflowError, OSError) as error:
                raise ValueError("SOURCE_DATE_EPOCH must be a valid Unix timestamp") from error
        else:
            timestamp = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        source["updatedAt"] = timestamp.isoformat().replace("+00:00", "Z")
    validate(source)
    path.write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
    print("Exported %d objects and %d portals to %s" % (len(objects), len(portals), path))


mode, target = args()
if mode == "import":
    import_source(target)
else:
    export_source(target)
