"""Render a neutral front/three-quarter QA image from the Sidekick test blend."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pose-axis", choices=("X", "Y", "Z"))
    parser.add_argument("--pose-angle", type=float, default=0.0)
    parser.add_argument("--leg-axis", choices=("X", "Y", "Z"))
    parser.add_argument("--leg-angle", type=float, default=0.0)
    return parser.parse_args(raw)


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    options = args()
    bpy.ops.wm.open_mainfile(filepath=str(options.blend.expanduser().resolve()))

    if options.pose_axis:
        rig = bpy.data.objects.get("SidekickRig")
        axis = {"X": 0, "Y": 1, "Z": 2}[options.pose_axis]
        for bone_name, sign in (("upperarm_l", 1.0), ("upperarm_r", -1.0)):
            bone = rig.pose.bones[bone_name]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler[axis] = math.radians(options.pose_angle * sign)
    if options.leg_axis:
        rig = bpy.data.objects.get("SidekickRig")
        axis = {"X": 0, "Y": 1, "Z": 2}[options.leg_axis]
        for bone_name, sign in (("thigh_l", 1.0), ("thigh_r", -1.0)):
            bone = rig.pose.bones[bone_name]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler[axis] = math.radians(options.leg_angle * sign)

    camera_data = bpy.data.cameras.new("QA_Camera")
    camera = bpy.data.objects.new("QA_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (2.65, -5.8, 2.15)
    camera_data.lens = 58
    point_at(camera, Vector((0.0, 0.0, 0.9)))
    bpy.context.scene.camera = camera

    for name, location, energy, size in (
        ("Key", (-3.0, -4.0, 5.0), 900.0, 4.0),
        ("Fill", (4.0, -2.0, 3.0), 600.0, 3.0),
        ("Rim", (0.0, 4.0, 4.0), 700.0, 3.0),
    ):
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        point_at(light, Vector((0.0, 0.0, 0.9)))

    bpy.ops.mesh.primitive_plane_add(size=20, location=(0.0, 0.0, 0.0))
    floor = bpy.context.object
    floor.name = "QA_Floor"
    floor_material = bpy.data.materials.new("QA_Floor")
    floor_material.diffuse_color = (0.11, 0.14, 0.18, 1.0)
    floor.data.materials.append(floor_material)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.035, 0.045, 0.06)
    scene.render.filepath = str(options.output.expanduser().resolve())
    options.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"SIDEKICK_RENDER_OK output={options.output}")


if __name__ == "__main__":
    main()
