"""Inspect a Synty Sidekick FBX with Blender in background mode.

Usage:
  blender --background --factory-startup --python inspect_sidekick_fbx.py -- file.fbx
"""

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        raise SystemExit("FBX path is required")

    source = Path(args[0]).expanduser().resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source), automatic_bone_orientation=False)

    result = {
        "source": str(source),
        "objects": [],
        "armatures": [],
        "meshes": [],
    }
    for obj in bpy.context.scene.objects:
        result["objects"].append(
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent else None,
                "location": [round(value, 6) for value in obj.location],
                "scale": [round(value, 6) for value in obj.scale],
            }
        )
        if obj.type == "ARMATURE":
            result["armatures"].append(
                {
                    "name": obj.name,
                    "bones": [bone.name for bone in obj.data.bones],
                }
            )
        elif obj.type == "MESH":
            world_corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
            bounds_min = [min(corner[index] for corner in world_corners) for index in range(3)]
            bounds_max = [max(corner[index] for corner in world_corners) for index in range(3)]
            result["meshes"].append(
                {
                    "name": obj.name,
                    "vertices": len(obj.data.vertices),
                    "polygons": len(obj.data.polygons),
                    "uv_layers": [layer.name for layer in obj.data.uv_layers],
                    "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
                    "vertex_groups": [group.name for group in obj.vertex_groups],
                    "shape_keys": (
                        [key.name for key in obj.data.shape_keys.key_blocks]
                        if obj.data.shape_keys
                        else []
                    ),
                    "modifiers": [
                        {
                            "name": modifier.name,
                            "type": modifier.type,
                            "object": getattr(modifier, "object", None).name
                            if getattr(modifier, "object", None)
                            else None,
                        }
                        for modifier in obj.modifiers
                    ],
                    "bounds": {
                        "min": [round(value, 6) for value in bounds_min],
                        "max": [round(value, 6) for value in bounds_max],
                    },
                }
            )

    print("SIDEKICK_INSPECTION_BEGIN")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("SIDEKICK_INSPECTION_END")


if __name__ == "__main__":
    main()
