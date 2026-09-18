"""Render the relaxed idle arm pose against the untouched auto-weight baseline."""

from math import radians
from pathlib import Path

import bpy


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_auto_weight_baseline_QA.blend")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_auto_weight_relaxed_idle_qa.png")


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects["NAJU_AUTO_WEIGHT_RIG"]
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis.identity()
    # The source is in an A-pose.  These rotations lower the arms to a normal
    # relaxed stance while retaining the mesh's shoulder blend.
    for name, degrees in (
        ("upper_arm.L", -35),
        ("upper_arm.R", 35),
        ("forearm.L", -45),
        ("forearm.R", 45),
    ):
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.y = radians(degrees)
    bpy.context.view_layer.update()
    bpy.context.scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(write_still=True)
    print(f"AUTO_WEIGHT_RELAXED_IDLE_RENDER={OUTPUT}")


if __name__ == "__main__":
    main()
