"""Build a fresh QA rig with shoulder joints fitted to the sleeve line.

The prior rig started the upper-arm bones too close to the chest centre, which
makes a vertical neutral arm pose pass through the torso.  This candidate moves
the shoulder joints outward before binding, then applies only a smooth torso
core protection to the automatic weights.  Source files are never overwritten.
"""

from math import sqrt
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_high_source_work.blend")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_avatar_fitted_rig_QA.blend")
OUT_DIR = Path("/Users/derrick/Downloads")
DECIMATE_RATIO = 0.035
CORE_X = 0.16
FULL_ARM_X = 0.30
ARM_GROUPS = {
    "upper_arm.L", "forearm.L", "hand.L",
    "upper_arm.R", "forearm.R", "hand.R",
}


def add_bone(bones, name, head, tail, parent=None):
    bone = bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = bones[parent]


def create_fitted_rig(collection):
    data = bpy.data.armatures.new("NAJU_FITTED_RIG_DATA")
    rig = bpy.data.objects.new("NAJU_FITTED_RIG", data)
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = data.edit_bones
    add_bone(bones, "root", (0, 0, -0.95), (0, 0, -0.66))
    add_bone(bones, "hips", (0, 0, -0.66), (0, 0, -0.32), "root")
    add_bone(bones, "spine", (0, 0, -0.32), (0, 0, 0.08), "hips")
    add_bone(bones, "chest", (0, 0, 0.08), (0, 0, 0.30), "spine")
    add_bone(bones, "neck", (0, 0, 0.30), (0, 0, 0.46), "chest")
    add_bone(bones, "head", (0, 0, 0.46), (0, 0, 0.83), "neck")
    for side, sign in (("L", -1), ("R", 1)):
        # These heads sit on the visible shoulder/sleeve pivot rather than at
        # the centre of the shirt.  The arm chain can now hang at the hip.
        add_bone(bones, f"upper_arm.{side}", (sign * 0.205, 0, 0.275), (sign * 0.350, 0, 0.035), "chest")
        add_bone(bones, f"forearm.{side}", (sign * 0.350, 0, 0.035), (sign * 0.405, 0, -0.235), f"upper_arm.{side}")
        add_bone(bones, f"hand.{side}", (sign * 0.405, 0, -0.235), (sign * 0.405, 0, -0.445), f"forearm.{side}")
        add_bone(bones, f"thigh.{side}", (sign * 0.18, 0, -0.34), (sign * 0.18, 0, -0.65), "hips")
        add_bone(bones, f"shin.{side}", (sign * 0.18, 0, -0.65), (sign * 0.18, 0, -0.89), f"thigh.{side}")
        add_bone(bones, f"foot.{side}", (sign * 0.18, 0, -0.89), (sign * 0.18, -0.16, -0.95), f"shin.{side}")
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in data.bones:
        bone.use_deform = True
    rig.show_in_front = True
    return rig


def smoothstep(start, end, value):
    value = max(0.0, min(1.0, (value - start) / (end - start)))
    return value * value * (3.0 - 2.0 * value)


def protect_torso_core(mesh):
    groups = mesh.vertex_groups
    arm_indices = {group.index for group in groups if group.name in ARM_GROUPS}
    for vertex in mesh.data.vertices:
        strength = smoothstep(CORE_X, FULL_ARM_X, abs(vertex.co.x))
        assignments = [
            (assignment.group, assignment.weight)
            for assignment in vertex.groups
            if assignment.group in arm_indices
        ]
        for group_index, weight in assignments:
            group = groups[group_index]
            new_weight = weight * strength
            if new_weight <= 1e-6:
                group.remove([vertex.index])
            else:
                group.add([vertex.index], new_weight, "REPLACE")
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def aim(object_, target):
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()


def render_setup(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FITTED_RIG_QA_WORLD")
    scene.world.color = (0.035, 0.045, 0.07)
    camera = bpy.data.objects.new("FITTED_RIG_QA_CAMERA", bpy.data.cameras.new("FITTED_RIG_QA_CAMERA"))
    scene.collection.objects.link(camera)
    camera.data.lens = 56
    camera.location = (0, -4.0, 0.0)
    aim(camera, (0, 0, 0.02))
    camera.hide_viewport = True
    scene.camera = camera
    for name, location, energy in (
        ("FITTED_RIG_QA_KEY", (-2.5, -3.0, 3.5), 1000),
        ("FITTED_RIG_QA_FILL", (2.5, -2.0, 1.5), 600),
        ("FITTED_RIG_QA_RIM", (0.0, 2.0, 3.0), 800),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        scene.collection.objects.link(light)
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = 2.5
        light.location = location
        aim(light, (0, 0, 0))
        light.hide_viewport = True


def reset_pose(rig):
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def matrix_with_axis(rest_bone, location, target_axis):
    rest_orientation = rest_bone.matrix_local.to_3x3()
    align = rest_orientation.col[1].normalized().rotation_difference(target_axis)
    orientation = align.to_matrix() @ rest_orientation
    return Matrix.LocRotScale(location, orientation.to_quaternion(), None)


def neutral_arm_chain(rig, side):
    sign = -1.0 if side == "L" else 1.0
    # The new, outer shoulder pivot allows a near-vertical arm to remain on the
    # silhouette instead of passing through the torso.
    target = Vector((sign * 0.10, 0, -sqrt(1.0 - 0.10 ** 2))).normalized()
    upper = rig.pose.bones[f"upper_arm.{side}"]
    forearm = rig.pose.bones[f"forearm.{side}"]
    hand = rig.pose.bones[f"hand.{side}"]
    upper.matrix = matrix_with_axis(upper.bone, upper.bone.head_local.copy(), target)
    bpy.context.view_layer.update()
    forearm.matrix = matrix_with_axis(forearm.bone, upper.tail.copy(), target)
    bpy.context.view_layer.update()
    hand.matrix = matrix_with_axis(hand.bone, forearm.tail.copy(), target)
    bpy.context.view_layer.update()


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    source = bpy.data.objects.get("mesh_node")
    if not source:
        raise RuntimeError("Preserved high-source mesh not found")
    source_collection = bpy.data.collections.get("NAJU_HIGH_SOURCE")
    if source_collection:
        source_collection.hide_viewport = True
        source_collection.hide_render = True
    collection = bpy.data.collections.new("NAJU_FITTED_RIG_QA")
    bpy.context.scene.collection.children.link(collection)
    mesh = source.copy()
    mesh.data = source.data.copy()
    mesh.name = "NAJU_FITTED_RIG_MESH"
    mesh.data.name = "NAJU_FITTED_RIG_MESH_DATA"
    mesh.parent = None
    mesh.matrix_world = source.matrix_world.copy()
    collection.objects.link(mesh)
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    decimate = mesh.modifiers.new("QA_GAME_TRIANGLE_BUDGET", "DECIMATE")
    decimate.decimate_type = "COLLAPSE"
    decimate.ratio = DECIMATE_RATIO
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    for polygon in mesh.data.polygons:
        polygon.use_smooth = True

    rig = create_fitted_rig(collection)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    protect_torso_core(mesh)
    mesh["pipeline_stage"] = "fitted_shoulders_auto_weight_smooth_torso_protection"
    mesh["triangle_count"] = len(mesh.data.polygons)

    scene = bpy.context.scene
    render_setup(scene)
    reset_pose(rig)
    scene.render.filepath = str(OUT_DIR / "NAJU_fitted_rig_rest.png")
    bpy.ops.render.render(write_still=True)
    neutral_arm_chain(rig, "L")
    neutral_arm_chain(rig, "R")
    scene.render.filepath = str(OUT_DIR / "NAJU_fitted_rig_neutral_pose.png")
    bpy.ops.render.render(write_still=True)

    reset_pose(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(f"FITTED_RIG_QA_READY triangles={len(mesh.data.polygons)} output={OUTPUT}")


if __name__ == "__main__":
    main()
