"""Render two opposing contact poses from the in-place Walk action."""

from pathlib import Path

import bpy
from mathutils import Vector


WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_animated_work.blend")
OUT_A = Path("/Users/derrick/Downloads/NAJU_avatar_walk_frame_01.png")
OUT_B = Path("/Users/derrick/Downloads/NAJU_avatar_walk_frame_17.png")


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    scene = bpy.context.scene
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    rig.animation_data.action = bpy.data.actions["Walk"]
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_WORLD")
    scene.world.color = (0.035, 0.045, 0.07)
    camera_data = bpy.data.cameras.new("WALK_QA_CAMERA")
    camera_data.lens = 55
    camera = bpy.data.objects.new("WALK_QA_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0, -4.0, 0.0)
    point_at(camera, (0, 0, 0.0))
    scene.camera = camera
    for name, location, energy, size in (
        ("WALK_QA_KEY", (-2.5, -3.0, 3.5), 1000, 3.0),
        ("WALK_QA_FILL", (2.5, -2.0, 1.5), 600, 2.5),
        ("WALK_QA_RIM", (0.0, 2.0, 3.0), 800, 2.0),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        point_at(light, (0, 0, 0))
    for frame, path in ((1, OUT_A), (17, OUT_B)):
        scene.frame_set(frame)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    print(f"NAJU_WALK_QA_READY {OUT_A} {OUT_B}")


if __name__ == "__main__":
    main()
