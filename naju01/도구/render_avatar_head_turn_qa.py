"""Render a non-destructive head-turn pose to inspect neck/chest deformation."""

from math import radians
from pathlib import Path

import bpy
from mathutils import Vector


WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
QA_BLEND = Path("/Users/derrick/Downloads/NAJU_avatar_head_turn_QA.blend")
QA_RENDER = Path("/Users/derrick/Downloads/NAJU_avatar_head_turn_QA.png")


def aim(object_, target):
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    head = rig.pose.bones["head"]
    head.rotation_mode = "XYZ"
    head.rotation_euler.z = radians(30)
    bpy.context.view_layer.update()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(QA_RENDER)
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
        light.data.shape = "DISK"
        light.data.size = 2.5
        light.location = location
        aim(light, (0, 0, 0))

    bpy.ops.wm.save_as_mainfile(filepath=str(QA_BLEND))
    bpy.ops.render.render(write_still=True)
    print(f"NAJU_HEAD_QA_READY blend={QA_BLEND} image={QA_RENDER}")


if __name__ == "__main__":
    main()
