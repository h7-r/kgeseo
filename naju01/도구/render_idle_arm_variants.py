"""Render lower-arm variations for an arm-down idle pose; source is untouched."""

from math import radians
from pathlib import Path

import bpy
from mathutils import Vector


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
OUT_DIR = Path("/Users/derrick/Downloads")


def aim(object_, target):
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()


def reset(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0, 0, 0)


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_WORLD")
    scene.world.color = (0.035, 0.045, 0.07)
    camera = bpy.data.objects.new("QA_CAMERA", bpy.data.cameras.new("QA_CAMERA"))
    scene.collection.objects.link(camera)
    camera.data.lens = 56
    camera.location = (0, -4.0, 0.0)
    aim(camera, (0, 0, 0.02))
    scene.camera = camera
    for name, location, energy in (
        ("QA_KEY", (-2.5, -3.0, 3.5), 1000),
        ("QA_FILL", (2.5, -2.0, 1.5), 600),
        ("QA_RIM", (0.0, 2.0, 3.0), 800),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        scene.collection.objects.link(light)
        light.data.energy = energy
        light.data.size = 2.5
        light.location = location
        aim(light, (0, 0, 0))
    return scene


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    scene = setup_scene()
    # All variants share the proven arm-down upper-arm position.  Only the
    # lower-arm sign changes, making the comparison meaningful.
    variants = {
        "A_lower_rest": (-68, 68, 0, 0),
        "B_lower_same": (-68, 68, -28, 28),
        "C_lower_opposite": (-68, 68, 28, -28),
        "E_idle_natural": (-55, 55, 30, -30),
        "F_clearance_best": (-35, 35, -45, 45),
        "D_arm_close": (-86, 86, 32, -32),
    }
    for label, (upper_left, upper_right, left, right) in variants.items():
        reset(rig)
        rig.pose.bones["upper_arm.L"].rotation_euler.y = radians(upper_left)
        rig.pose.bones["upper_arm.R"].rotation_euler.y = radians(upper_right)
        rig.pose.bones["forearm.L"].rotation_euler.y = radians(left)
        rig.pose.bones["forearm.R"].rotation_euler.y = radians(right)
        bpy.context.view_layer.update()
        scene.render.filepath = str(OUT_DIR / f"NAJU_idle_arm_{label}.png")
        bpy.ops.render.render(write_still=True)
        print(label, upper_left, upper_right, left, right, scene.render.filepath)


if __name__ == "__main__":
    main()
