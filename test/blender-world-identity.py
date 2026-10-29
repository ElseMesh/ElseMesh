import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLENDER_TOOLS = ROOT / "tools" / "blender"
sys.path.insert(0, str(BLENDER_TOOLS))
sys.modules.setdefault("bpy", types.ModuleType("bpy"))
sys.dont_write_bytecode = True

import world_actions
import world_source
from world_identity import is_world_id


class BlenderWorldIdentityTests(unittest.TestCase):
    def setUp(self):
        self.source = {
            "protocol": "elsemesh.world-source/3",
            "worldId": "elsemesh:source",
            "rules": {
                "maxVisitors": 16,
                "spawnRadius": 8,
                "requiredFeatures": ["elsemesh.portal-two-sided/1"],
            },
            "objects": [],
            "portals": [
                {
                    "id": "elsemesh-portal:crossing",
                    "destinationWorldId": "elsemesh:destination",
                    "entry": {"position": [0, 0, 0], "yaw": 0},
                    "exit": {"position": [1, 0, 0], "yaw": 0},
                    "openView": True,
                    "enabled": True,
                    "back": {
                        "destinationWorldId": "elsemesh:return",
                        "exit": {"position": [2, 0, 0], "yaw": 0},
                        "openView": True,
                        "enabled": True,
                    },
                }
            ],
        }

    def test_shared_world_id_validator_accepts_only_canonical_ids(self):
        self.assertTrue(is_world_id("elsemesh:valid_id-1.2"))
        for value in (
            "world:legacy",
            "elsemesh:world:legacy",
            "elsemesh-world:legacy",
            "em-world:legacy",
            "elsemesh:",
            "elsemesh:" + "x" * 129,
        ):
            with self.subTest(value=value):
                self.assertFalse(is_world_id(value))

    def test_blender_source_and_action_validators_accept_v3_portal_ids(self):
        self.assertIs(world_source.validate(self.source), self.source)
        self.assertIs(world_actions.validate_source(self.source), self.source)

    def test_blender_source_and_action_validators_reject_old_world_ids(self):
        for old_id in ("world:legacy", "elsemesh:world:legacy"):
            with self.subTest(old_id=old_id):
                source = {**self.source, "worldId": old_id}
                with self.assertRaisesRegex(ValueError, "worldId"):
                    world_source.validate(source)

                source = {**self.source, "portals": [dict(self.source["portals"][0], destinationWorldId=old_id)]}
                with self.assertRaisesRegex(ValueError, "destination world"):
                    world_actions.validate_source(source)

                portal = self.source["portals"][0]
                source = {
                    **self.source,
                    "portals": [dict(portal, back={**portal["back"], "destinationWorldId": old_id})],
                }
                with self.assertRaisesRegex(ValueError, "portal back"):
                    world_source.validate(source)
                with self.assertRaisesRegex(ValueError, "portal back"):
                    world_actions.validate_source(source)


if __name__ == "__main__":
    unittest.main()
