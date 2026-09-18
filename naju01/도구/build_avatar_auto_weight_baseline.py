"""Build a disposable, unmodified-auto-weight baseline for skinning QA.

This deliberately does *not* use the old torso-arm weight deletion.  It creates
a separate blend from the preserved high source, so the current rig and source
remain untouched while the actual shoulder deformation is inspected first.
"""

from math import radians
from pathlib import Path
import sys

import bpy
from mathutils import Vector


TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.append(str(TOOLS))
from build_avatar_game_rig import create_rig  # noqa: E402


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_high_source_work.blend")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_avatar_auto_weight_baseline_QA.blend")
OUT_DIR = Path("/Users/derrick/Downloads")
DECIMATE_RATIO = 0.035


def aim(object_, target):
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()


def add_render_setup(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("AUTO_WEIGHT_QA_WORLD")
    scene.world.color = (0.035, 0.045, 0.07)
    camera = bpy.data.objects.new("AUTO_WEIGHT_QA_CAMERA", bpy.data.cameras.new("AUTO_WEIGHT_QA_CAMERA"))
    scene.collection.objects.link(camera)
    camera.data.lens = 56
    camera.location = (0, -4.0, 0.0)
    aim(camera, (0, 0, 0.02))
    scene.camera = camera
    for name, location, energy in (
        ("AUTO_WEIGHT_QA_KEY", (-2.5, -3.0, 3.5), 1000),
        ("AUTO_WEIGHT_QA_FILL", (2.5, -2.0, 1.5), 600),
        ("AUTO_WEIGHT_QA_RIM", (0.0, 2.0, 3.0), 800),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        scene.collection.objects.link(light)
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = 2.5
        light.location = location
        aim(light, (0, 0, 0))
        light.hide_viewport = True
    camera.hide_viewport = True


def reset_pose(rig):
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis.identity()
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

    collection = bpy.data.collections.new("NAJU_AUTO_WEIGHT_BASELINE")
    bpy.context.scene.collection.children.link(collection)
    mesh = source.copy()
    mesh.data = source.data.copy()
    mesh.name = "NAJU_AUTO_WEIGHT_MESH"
    mesh.data.name = "NAJU_AUTO_WEIGHT_MESH_DATA"
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

    rig = create_rig(collection)
    rig.name = "NAJU_AUTO_WEIGHT_RIG"
    rig.data.name = "NAJU_AUTO_WEIGHT_RIG_DATA"
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    mesh["pipeline_stage"] = "auto_weight_baseline_no_torso_weight_removal"
    mesh["triangles"] = len(mesh.data.polygons)

    scene = bpy.context.scene
    add_render_setup(scene)
    reset_pose(rig)
    scene.render.filepath = str(OUT_DIR / "NAJU_auto_weight_baseline_rest.png")
    bpy.ops.render.render(write_still=True)
    for label, degrees in (("neg30", -30), ("pos30", 30)):
        reset_pose(rig)
        bone = rig.pose.bones["upper_arm.L"]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.y = radians(degrees)
        bpy.context.view_layer.update()
        scene.render.filepath = str(OUT_DIR / f"NAJU_auto_weight_baseline_left_arm_{label}.png")
        bpy.ops.render.render(write_still=True)

    reset_pose(rig)
    rig.show_in_front = True
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(f"AUTO_WEIGHT_BASELINE_READY mesh_triangles={len(mesh.data.polygons)} output={OUTPUT}")


if __name__ == "__main__":
    main()
