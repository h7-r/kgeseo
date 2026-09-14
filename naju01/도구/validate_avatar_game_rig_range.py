"""Read-only range-of-motion QA for the derived NAJU game rig.

The source .blend is opened in a background Blender process and is never saved.
Each test resets pose transforms before it moves one body region, then checks that
the intended region moves while the torso remains stable.
"""

from math import radians
from pathlib import Path

import bpy


WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
REPORT = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_range_validation.txt")


def positions(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        return [vertex.co.copy() for vertex in evaluated_mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def max_delta(before, after, indices):
    return max(((before[index] - after[index]).length for index in indices), default=0.0)


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def test(name, rig, mesh, before, move, moving_indices, protected_indices):
    reset_pose(rig)
    move()
    bpy.context.view_layer.update()
    after = positions(mesh)
    moving = max_delta(before, after, moving_indices)
    protected = max_delta(before, after, protected_indices)
    passed = moving > 0.025 and protected < 0.003
    return name, moving, protected, passed


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    mesh = bpy.data.objects["NAJU_GAME_AVATAR_MESH"]
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    reset_pose(rig)
    rest = positions(mesh)

    vertices = mesh.data.vertices
    torso = [v.index for v in vertices if abs(v.co.x) < 0.24 and -0.36 < v.co.z < 0.36]
    # The collar/neck seam is allowed to follow a head turn.  The chest below it
    # is the protected torso region that must remain still.
    torso_core = [v.index for v in vertices if abs(v.co.x) < 0.24 and -0.36 < v.co.z < 0.18]
    collar = [v.index for v in vertices if abs(v.co.x) < 0.24 and 0.18 <= v.co.z < 0.36]
    left_arm = [v.index for v in vertices if v.co.x < -0.29 and -0.50 < v.co.z < 0.42]
    right_arm = [v.index for v in vertices if v.co.x > 0.29 and -0.50 < v.co.z < 0.42]
    legs = [v.index for v in vertices if abs(v.co.x) < 0.43 and v.co.z < -0.33]
    head = [v.index for v in vertices if v.co.z > 0.38]

    tests = [
        test(
            "idle upper-arm rest ±35°",
            rig,
            mesh,
            rest,
            lambda: (
                setattr(rig.pose.bones["upper_arm.L"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["upper_arm.L"].rotation_euler, "y", radians(-35)),
                setattr(rig.pose.bones["upper_arm.R"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["upper_arm.R"].rotation_euler, "y", radians(35)),
            ),
            left_arm + right_arm,
            torso,
        ),
        test(
            "elbow bend ±45°",
            rig,
            mesh,
            rest,
            lambda: (
                setattr(rig.pose.bones["forearm.L"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["forearm.L"].rotation_euler, "y", radians(-45)),
                setattr(rig.pose.bones["forearm.R"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["forearm.R"].rotation_euler, "y", radians(45)),
            ),
            left_arm + right_arm,
            torso,
        ),
        test(
            "combined idle arm rest (upper ±35°, forearm ∓45°)",
            rig,
            mesh,
            rest,
            lambda: (
                setattr(rig.pose.bones["upper_arm.L"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["upper_arm.L"].rotation_euler, "y", radians(-35)),
                setattr(rig.pose.bones["upper_arm.R"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["upper_arm.R"].rotation_euler, "y", radians(35)),
                setattr(rig.pose.bones["forearm.L"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["forearm.L"].rotation_euler, "y", radians(-45)),
                setattr(rig.pose.bones["forearm.R"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["forearm.R"].rotation_euler, "y", radians(45)),
            ),
            left_arm + right_arm,
            torso,
        ),
        test(
            "knee bend ±35°",
            rig,
            mesh,
            rest,
            lambda: (
                setattr(rig.pose.bones["shin.L"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["shin.L"].rotation_euler, "x", radians(35)),
                setattr(rig.pose.bones["shin.R"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["shin.R"].rotation_euler, "x", radians(-35)),
            ),
            legs,
            torso,
        ),
        test(
            "head turn 30°",
            rig,
            mesh,
            rest,
            lambda: (
                setattr(rig.pose.bones["head"], "rotation_mode", "XYZ"),
                setattr(rig.pose.bones["head"].rotation_euler, "z", radians(30)),
            ),
            head,
            torso_core,
        ),
    ]
    # Record collar falloff separately so that a future mesh change cannot hide
    # a large shirt pull by simply broadening the protected-region exception.
    reset_pose(rig)
    head_bone = rig.pose.bones["head"]
    head_bone.rotation_mode = "XYZ"
    head_bone.rotation_euler.z = radians(30)
    bpy.context.view_layer.update()
    collar_after = positions(mesh)
    collar_delta = max_delta(rest, collar_after, collar)
    reset_pose(rig)

    lines = ["NAJU Avatar Range-of-Motion Validation", "source: NAJU_avatar_game_rig_work.blend"]
    for name, moving, protected, passed in tests:
        lines.append(
            f"{name}: moved region {moving:.6f} m; torso spill {protected:.6f} m; {'PASS' if passed else 'CHECK'}"
        )
    lines.append(f"head turn collar/neck blend (informational): {collar_delta:.6f} m")
    complete = all(row[3] for row in tests)
    lines.append(f"overall: {'PASS' if complete else 'CHECK'}")
    report = "\n".join(lines) + "\n"
    REPORT.write_text(report, encoding="utf-8")
    print(report)
    if not complete:
        raise RuntimeError("Range-of-motion QA needs correction before animation work")


if __name__ == "__main__":
    main()
