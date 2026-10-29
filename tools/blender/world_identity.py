"""Canonical ElseMesh ThruHold identity validation for Blender tooling."""
import re

WORLD_ID = re.compile(r"^elsemesh:[\w.-]{1,128}$", re.ASCII)


def is_world_id(value):
    return isinstance(value, str) and WORLD_ID.fullmatch(value) is not None
