"""Non-destructive deformation validation for the derived NAJU avatar rig."""

from pathlib import Path
from math import radians

import bpy
from mathutils import Vector


WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
REPORT = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_validation.txt")


def evaluated_positions(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return [vertex.co.copy() for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def max_displacement(before, after, indices):
    return max((before[index] - after[index]).length for index in indices) if indices else 0.0


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    mesh = bpy.data.objects["NAJU_GAME_AVATAR_MESH"]
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    bpy.context.view_layer.objects.active = rig

    rest = evaluated_positions(mesh)
    torso = [v.index for v in mesh.data.vertices if abs(v.co.x) < 0.24 and -0.36 < v.co.z < 0.36]
    left_arm = [v.index for v in mesh.data.vertices if v.co.x < -0.29 and -0.50 < v.co.z < 0.42]
    right_arm = [v.index for v in mesh.data.vertices if v.co.x > 0.29 and -0.50 < v.co.z < 0.42]

    # Simulate a useful, moderate arms-up pose, then measure the mesh response.
    left_upper = rig.pose.bones["upper_arm.L"]
    right_upper = rig.pose.bones["upper_arm.R"]
    left_upper.rotation_mode = "XYZ"
    right_upper.rotation_mode = "XYZ"
    left_upper.rotation_euler.y = radians(-35)
    right_upper.rotation_euler.y = radians(35)
    bpy.context.view_layer.update()
    posed = evaluated_positions(mesh)

    torso_delta = max_displacement(rest, posed, torso)
    left_delta = max_displacement(rest, posed, left_arm)
    right_delta = max_displacement(rest, posed, right_arm)
    passed = torso_delta < 0.002 and left_delta > 0.04 and right_delta > 0.04
    text = (
        "NAJU Avatar Rig Deformation Validation\n"
        f"pose: both upper arms rotated 35 degrees\n"
        f"central torso vertices: {len(torso)}, max displacement: {torso_delta:.6f} m\n"
        f"left arm vertices: {len(left_arm)}, max displacement: {left_delta:.6f} m\n"
        f"right arm vertices: {len(right_arm)}, max displacement: {right_delta:.6f} m\n"
        f"result: {'PASS' if passed else 'CHECK'}\n"
    )
    REPORT.write_text(text, encoding="utf-8")
    print(text)
    if not passed:
        raise RuntimeError("Rig deformation validation did not meet the torso-isolation threshold")


if __name__ == "__main__":
    main()
