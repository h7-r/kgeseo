"""Create a shoulder-weight candidate with a protected torso core.

Starts from a clean automatic-weight bind and reduces arm influences only in the
middle of the shirt, using a wide smooth transition rather than deleting an
entire hard band.  It never saves over either source or the prior QA baseline.
"""

from math import radians
from pathlib import Path

import bpy


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_auto_weight_baseline_QA.blend")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_avatar_balanced_skin_QA.blend")
OUT_DIR = Path("/Users/derrick/Downloads")
CORE_X = 0.16
FULL_ARM_X = 0.30
ARM_GROUPS = {
    "upper_arm.L", "forearm.L", "hand.L",
    "upper_arm.R", "forearm.R", "hand.R",
}


def smoothstep(start, end, value):
    value = max(0.0, min(1.0, (value - start) / (end - start)))
    return value * value * (3.0 - 2.0 * value)


def reset_pose(rig):
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def apply_torso_protection(mesh):
    groups = mesh.vertex_groups
    arm_group_indices = {group.index for group in groups if group.name in ARM_GROUPS}
    changed = 0
    removed = 0
    for vertex in mesh.data.vertices:
        influence = smoothstep(CORE_X, FULL_ARM_X, abs(vertex.co.x))
        # Make a plain snapshot first: Blender mutates vertex.groups as each
        # group is edited, so iterating that live collection can skip entries.
        assignments = [
            (assignment.group, assignment.weight)
            for assignment in vertex.groups
            if assignment.group in arm_group_indices
        ]
        for group_index, weight in assignments:
            group = groups[group_index]
            new_weight = weight * influence
            if new_weight <= 1e-6:
                group.remove([vertex.index])
                removed += 1
            else:
                group.add([vertex.index], new_weight, "REPLACE")
            changed += 1
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    return changed, removed


def render(scene, rig, filename, rotations=()):
    reset_pose(rig)
    for name, degrees in rotations:
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.y = radians(degrees)
    bpy.context.view_layer.update()
    scene.render.filepath = str(OUT_DIR / filename)
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    mesh = bpy.data.objects["NAJU_AUTO_WEIGHT_MESH"]
    rig = bpy.data.objects["NAJU_AUTO_WEIGHT_RIG"]
    mesh.name = "NAJU_BALANCED_SKIN_MESH"
    mesh.data.name = "NAJU_BALANCED_SKIN_MESH_DATA"
    rig.name = "NAJU_BALANCED_SKIN_RIG"
    rig.data.name = "NAJU_BALANCED_SKIN_RIG_DATA"

    changed, removed = apply_torso_protection(mesh)
    mesh["pipeline_stage"] = "auto_weight_with_smooth_torso_arm_transition"
    mesh["torso_core_x"] = CORE_X
    mesh["full_arm_weight_x"] = FULL_ARM_X
    mesh["modified_arm_assignments"] = changed
    mesh["removed_core_arm_assignments"] = removed

    scene = bpy.context.scene
    render(scene, rig, "NAJU_balanced_skin_rest.png")
    render(
        scene,
        rig,
        "NAJU_balanced_skin_relaxed_idle.png",
        (("upper_arm.L", -35), ("upper_arm.R", 35), ("forearm.L", -45), ("forearm.R", 45)),
    )
    render(scene, rig, "NAJU_balanced_skin_left_arm_pos30.png", (("upper_arm.L", 30),))

    reset_pose(rig)
    rig.show_in_front = True
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(
        f"BALANCED_SKIN_QA_READY changed={changed} removed={removed} "
        f"core_x={CORE_X} full_arm_x={FULL_ARM_X} output={OUTPUT}"
    )


if __name__ == "__main__":
    main()
