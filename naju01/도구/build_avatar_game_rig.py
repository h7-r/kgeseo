"""Build a non-destructive game-ready derivative from the preserved high source.

The source collection stays hidden and untouched.  The derived collection uses
about 3.5% of the original triangles (roughly 100k) and receives a fresh,
simple deformation rig.  It deliberately removes arm-bone weights from the
central torso so arm posing cannot pull the shirt/body with it.
"""

from pathlib import Path

import bpy


SOURCE_WORK = Path("/Users/derrick/Downloads/NAJU_avatar_high_source_work.blend")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
DECIMATE_RATIO = 0.035
TORSO_HALF_WIDTH = 0.265


def add_bone(edit_bones, name, head, tail, parent=None):
    bone = edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = edit_bones[parent]
    return bone


def create_rig(collection):
    arm_data = bpy.data.armatures.new("NAJU_GAME_RIG_DATA")
    rig = bpy.data.objects.new("NAJU_GAME_RIG", arm_data)
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = arm_data.edit_bones
    add_bone(bones, "root", (0, 0, -0.95), (0, 0, -0.66))
    add_bone(bones, "hips", (0, 0, -0.66), (0, 0, -0.32), "root")
    add_bone(bones, "spine", (0, 0, -0.32), (0, 0, 0.08), "hips")
    add_bone(bones, "chest", (0, 0, 0.08), (0, 0, 0.30), "spine")
    add_bone(bones, "neck", (0, 0, 0.30), (0, 0, 0.46), "chest")
    add_bone(bones, "head", (0, 0, 0.46), (0, 0, 0.83), "neck")
    for side, sign in (("L", -1), ("R", 1)):
        add_bone(bones, f"upper_arm.{side}", (sign * 0.12, 0, 0.28), (sign * 0.33, 0, 0.07), "chest")
        add_bone(bones, f"forearm.{side}", (sign * 0.33, 0, 0.07), (sign * 0.43, 0, -0.22), f"upper_arm.{side}")
        add_bone(bones, f"hand.{side}", (sign * 0.43, 0, -0.22), (sign * 0.45, 0, -0.43), f"forearm.{side}")
        add_bone(bones, f"thigh.{side}", (sign * 0.18, 0, -0.34), (sign * 0.18, 0, -0.65), "hips")
        add_bone(bones, f"shin.{side}", (sign * 0.18, 0, -0.65), (sign * 0.18, 0, -0.89), f"thigh.{side}")
        add_bone(bones, f"foot.{side}", (sign * 0.18, 0, -0.89), (sign * 0.18, -0.16, -0.95), f"shin.{side}")
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in arm_data.bones:
        bone.use_deform = True
    rig.show_in_front = True
    return rig


def remove_torso_arm_weights(mesh):
    arm_groups = [
        mesh.vertex_groups.get(name)
        for name in ("upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R")
    ]
    torso_indices = [v.index for v in mesh.data.vertices if abs(v.co.x) < TORSO_HALF_WIDTH]
    for group in arm_groups:
        if group and torso_indices:
            group.remove(torso_indices)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_WORK))
    source = bpy.data.objects.get("mesh_node")
    if not source:
        raise RuntimeError("Preserved high-source mesh not found")

    source_collection = bpy.data.collections.get("NAJU_HIGH_SOURCE")
    if source_collection:
        source_collection.hide_viewport = True
        source_collection.hide_render = True

    derived_collection = bpy.data.collections.get("NAJU_GAME_DERIVED")
    if not derived_collection:
        derived_collection = bpy.data.collections.new("NAJU_GAME_DERIVED")
        bpy.context.scene.collection.children.link(derived_collection)

    mesh = source.copy()
    mesh.data = source.data.copy()
    mesh.name = "NAJU_GAME_AVATAR_MESH"
    mesh.data.name = "NAJU_GAME_AVATAR_MESH_DATA"
    derived_collection.objects.link(mesh)
    mesh.parent = None
    mesh.matrix_world = source.matrix_world.copy()

    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    decimate = mesh.modifiers.new("GAME_TRIANGLE_BUDGET", "DECIMATE")
    decimate.decimate_type = "COLLAPSE"
    decimate.ratio = DECIMATE_RATIO
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    for polygon in mesh.data.polygons:
        polygon.use_smooth = True

    rig = create_rig(derived_collection)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    auto_weighted = True
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except RuntimeError as error:
        auto_weighted = False
        print(f"AUTO_WEIGHT_FAILED: {error}")
        bpy.context.view_layer.objects.active = mesh
        modifier = mesh.modifiers.new("NAJU_GAME_RIG_DEFORM", "ARMATURE")
        modifier.object = rig

    if auto_weighted:
        remove_torso_arm_weights(mesh)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)

    mesh["source_triangles"] = 3060876
    mesh["target_ratio"] = DECIMATE_RATIO
    mesh["pipeline_stage"] = "derived_mesh_with_fresh_rig"
    mesh["torso_arm_weight_protection"] = True
    bpy.context.scene["avatar_pipeline_stage"] = "derived_mesh_rigged"
    bpy.context.scene["avatar_game_triangles"] = len(mesh.data.polygons)
    bpy.context.scene["avatar_auto_weights"] = auto_weighted
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(
        "NAJU_GAME_RIG_READY "
        f"triangles={len(mesh.data.polygons)} auto_weights={auto_weighted} output={OUTPUT}"
    )


if __name__ == "__main__":
    main()
