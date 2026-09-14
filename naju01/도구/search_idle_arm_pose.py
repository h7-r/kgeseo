"""Read-only search for a close-to-body idle arm pose without mesh collision."""

from pathlib import Path
from statistics import mean

import bpy
from mathutils import kdtree


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")


def evaluated(mesh):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    object_ = mesh.evaluated_get(depsgraph)
    result = object_.to_mesh()
    try:
        return [vertex.co.copy() for vertex in result.vertices]
    finally:
        object_.to_mesh_clear()


def reset(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0, 0, 0)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    mesh = bpy.data.objects["NAJU_GAME_AVATAR_MESH"]
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    arm_names = {"upper_arm.L", "forearm.L", "hand.L"}
    group_names = {group.index: group.name for group in mesh.vertex_groups}
    left_arm = []
    for vertex in mesh.data.vertices:
        strongest = max(vertex.groups, key=lambda item: item.weight, default=None)
        if strongest and group_names[strongest.group] in arm_names:
            left_arm.append(vertex.index)
    torso = [
        vertex.index
        for vertex in mesh.data.vertices
        if abs(vertex.co.x) < 0.24 and -0.28 < vertex.co.z < 0.26
    ]
    results = []
    for upper in range(20, 91, 5):
        for lower in range(-45, 46, 5):
            reset(rig)
            rig.pose.bones["upper_arm.L"].rotation_euler.y = -upper * 0.01745329252
            rig.pose.bones["upper_arm.R"].rotation_euler.y = upper * 0.01745329252
            rig.pose.bones["forearm.L"].rotation_euler.y = lower * 0.01745329252
            rig.pose.bones["forearm.R"].rotation_euler.y = -lower * 0.01745329252
            bpy.context.view_layer.update()
            posed = evaluated(mesh)
            tree = kdtree.KDTree(len(torso))
            for slot, index in enumerate(torso):
                tree.insert(posed[index], slot)
            tree.balance()
            # Shoulder contact is expected. Below z=.12, require a gap so that
            # the hand/forearm do not merge visually into the shirt.
            lower_arm = [index for index in left_arm if posed[index].z < 0.12]
            gaps = [tree.find(posed[index])[2] for index in lower_arm]
            average_x = mean(abs(posed[index].x) for index in lower_arm)
            results.append((average_x, min(gaps), upper, lower))
    reset(rig)
    # A minimum 12 mm model-space clearance avoids the visible glued-arm look.
    valid = [row for row in results if row[1] >= 0.012]
    valid.sort()
    print("IDLE_ARM_POSE_SEARCH: average |x|, torso clearance, upper, forearm")
    for row in valid[:12]:
        print(f"{row[0]:.5f} {row[1]:.5f} upper={row[2]} lower={row[3]}")


if __name__ == "__main__":
    main()
