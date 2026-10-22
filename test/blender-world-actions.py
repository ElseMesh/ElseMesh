import hashlib
import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("world_actions", ROOT / "tools/blender/world_actions.py")
world_actions = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(world_actions)


class BlenderWorldActionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source_bytes = (ROOT / "worlds/tidewater/world-source.json").read_bytes()
        cls.source = json.loads(cls.source_bytes)

    def plan(self, actions, source_bytes=None):
        source_bytes = source_bytes or self.source_bytes
        return {
            "protocol": world_actions.PROTOCOL,
            "sourceHash": "sha256:" + hashlib.sha256(source_bytes).hexdigest(),
            "actions": actions,
        }

    def test_matching_empty_plan_preserves_source(self):
        result, actions = world_actions.validate_plan(self.plan([]), self.source_bytes)
        self.assertEqual(result, self.source)
        self.assertEqual(actions, [])

    def test_add_and_update_asset_object(self):
        item = {
            "id": "tw-object:test-prop",
            "kind": "asset-instance",
            "label": "Test prop",
            "assetId": "sha256:" + "a" * 64,
            "priority": "visible",
            "transform": {"position": [1, 2, 3], "yaw": 0},
            "scale": [1, 1, 1],
            "collision": {"shape": "none", "enabled": False},
        }
        actions = [
            {"op": "object.add", "object": item},
            {"op": "object.update", "id": item["id"], "fields": {"label": "Updated prop"}},
        ]
        result, _ = world_actions.validate_plan(self.plan(actions), self.source_bytes)
        self.assertEqual(result["objects"][-1]["label"], "Updated prop")

    def test_update_asset_object_content_reference(self):
        item = {
            "id": "tw-object:test-prop",
            "kind": "asset-instance",
            "label": "Test prop",
            "assetId": "sha256:" + "a" * 64,
            "priority": "visible",
            "transform": {"position": [1, 2, 3], "yaw": 0},
            "scale": [1, 1, 1],
            "collision": {"shape": "none", "enabled": False},
        }
        source = json.loads(self.source_bytes)
        source["objects"].append(item)
        source_bytes = json.dumps(source, separators=(",", ":")).encode()
        new_asset_id = "sha256:" + "b" * 64
        actions = [{"op": "object.update", "id": item["id"], "fields": {"assetId": new_asset_id}}]
        result, _ = world_actions.validate_plan(self.plan(actions, source_bytes), source_bytes)
        self.assertEqual(result["objects"][-1]["assetId"], new_asset_id)

    def test_create_bounded_mesh_asset(self):
        item = {
            "id": "tw-object:generated-prop",
            "kind": "asset-instance",
            "label": "Generated prop",
            "priority": "visible",
            "transform": {"position": [1, 2, 3], "yaw": 0},
            "scale": [1, 1, 1],
            "collision": {"shape": "box", "enabled": True, "center": [0, 0.5, 0], "halfExtents": [0.5, 0.5, 0.5], "walkable": False, "solid": True},
        }
        action = {"op": "mesh.create", "object": item, "parts": [
            {"shape": "box", "dimensions": [1, 1, 1], "position": [0, 0, 0], "material": "wood"},
            {"shape": "cylinder", "dimensions": [0.25, 0.2, 0.25], "position": [0.2, 0.55, 0], "material": "metal"},
        ]}
        result, actions = world_actions.validate_plan(self.plan([action]), self.source_bytes)
        self.assertEqual(result["objects"][-1]["id"], item["id"])
        self.assertEqual(result["objects"][-1]["assetId"], world_actions.PENDING_ASSET_ID)
        self.assertEqual(actions[0]["parts"][1]["material"], "metal")

    def test_rejects_unsafe_or_unbounded_mesh_creation(self):
        item = {
            "id": "tw-object:generated-prop",
            "kind": "asset-instance",
            "label": "Generated prop",
            "transform": {"position": [0, 0, 0], "yaw": 0},
            "scale": [1, 1, 1],
            "collision": {"shape": "none", "enabled": False},
        }
        valid_part = {"shape": "box", "dimensions": [1, 1, 1], "position": [0, 0, 0], "material": "wood"}
        with self.assertRaisesRegex(ValueError, "derives its assetId"):
            world_actions.validate_plan(self.plan([{"op": "mesh.create", "object": {**item, "assetId": world_actions.PENDING_ASSET_ID}, "parts": [valid_part]}]), self.source_bytes)
        with self.assertRaisesRegex(ValueError, "invalid source object fields"):
            world_actions.validate_plan(self.plan([{"op": "mesh.create", "object": {**item, "python": "must never be evaluated"}, "parts": [valid_part]}]), self.source_bytes)
        with self.assertRaisesRegex(ValueError, "unsupported primitive or material"):
            bad_part = {**valid_part, "material": "script"}
            world_actions.validate_plan(self.plan([{"op": "mesh.create", "object": item, "parts": [bad_part]}]), self.source_bytes)
        with self.assertRaisesRegex(ValueError, "at least 0.05"):
            tiny_part = {**valid_part, "dimensions": [0.01, 1, 1]}
            world_actions.validate_plan(self.plan([{"op": "mesh.create", "object": item, "parts": [tiny_part]}]), self.source_bytes)
        with self.assertRaisesRegex(ValueError, "1 to 12 bounded primitive parts"):
            world_actions.validate_plan(self.plan([{"op": "mesh.create", "object": item, "parts": [valid_part] * 13}]), self.source_bytes)
        with self.assertRaisesRegex(ValueError, "invalid mesh part fields"):
            world_actions.validate_plan(self.plan([{"op": "mesh.create", "object": item, "parts": [{**valid_part, "exportPath": "/tmp/anything"}]}]), self.source_bytes)

    def test_caps_total_created_meshes_per_plan(self):
        actions = []
        for index in range(world_actions.MAX_CREATED_MESHES + 1):
            item = {
                "id": "tw-object:generated-%d" % index,
                "kind": "asset-instance",
                "label": "Generated prop",
                "transform": {"position": [0, 0, 0], "yaw": 0},
                "scale": [1, 1, 1],
                "collision": {"shape": "none", "enabled": False},
            }
            actions.append({"op": "mesh.create", "object": item, "parts": [
                {"shape": "box", "dimensions": [1, 1, 1], "position": [0, 0, 0], "material": "wood"},
            ]})
        with self.assertRaisesRegex(ValueError, "per-plan geometry budget"):
            world_actions.validate_plan(self.plan(actions), self.source_bytes)

    def test_rejects_stale_source_hash(self):
        plan = self.plan([])
        plan["sourceHash"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "does not match"):
            world_actions.validate_plan(plan, self.source_bytes)

    def test_rejects_invalid_collision_update(self):
        object_id = self.source["objects"][0]["id"]
        actions = [{"op": "object.update", "id": object_id, "fields": {"collision": {"enabled": True}}}]
        with self.assertRaises(ValueError):
            world_actions.validate_plan(self.plan(actions), self.source_bytes)

    def test_rejects_invalid_compound_collision(self):
        source = json.loads(self.source_bytes)
        compound = next(item for item in source["objects"] if item["collision"].get("shape") == "compound")
        compound["collision"]["boxes"][0]["yaw"] = 361
        source_bytes = json.dumps(source, separators=(",", ":")).encode()
        with self.assertRaisesRegex(ValueError, "compound collision yaw"):
            world_actions.validate_plan(self.plan([], source_bytes), source_bytes)

    def test_rejects_arbitrary_action(self):
        with self.assertRaisesRegex(ValueError, "unsupported Blender action"):
            world_actions.validate_plan(self.plan([{"op": "python.exec", "code": "pass"}]), self.source_bytes)

    def test_accepts_and_rejects_portal_frame_styles(self):
        source = json.loads(self.source_bytes)
        source["portals"][0]["visual"] = "timber"
        source_bytes = json.dumps(source, separators=(",", ":")).encode()
        result, _ = world_actions.validate_plan(self.plan([], source_bytes), source_bytes)
        self.assertEqual(result["portals"][0]["visual"], "timber")
        source["portals"][0]["visual"] = "glass"
        bad_bytes = json.dumps(source, separators=(",", ":")).encode()
        with self.assertRaisesRegex(ValueError, "visual must be"):
            world_actions.validate_plan(self.plan([], bad_bytes), bad_bytes)


if __name__ == "__main__":
    unittest.main()
