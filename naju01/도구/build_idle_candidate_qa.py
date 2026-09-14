"""Build and render a gentle in-place idle candidate without touching source work."""

from math import radians
from pathlib import Path

import bpy
from mathutils import Vector


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
QA_BLEND = Path("/Users/derrick/Downloads/NAJU_avatar_idle_candidate_QA.blend")
OUT_DIR = Path("/Users/derrick/Downloads")


def aim(object_, target):
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0, 0, 0)
        bone.location = (0, 0, 0)


def pose(rig, frame, rotations, locations=None):
    reset_pose(rig)
    for name, values in rotations.items():
        rig.pose.bones[name].rotation_euler = tuple(radians(value) for value in values)
    for name, values in (locations or {}).items():
        rig.pose.bones[name].location = values
    for name in set(rotations) | set(locations or {}):
        bone = rig.pose.bones[name]
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)
        bone.keyframe_insert(data_path="location", frame=frame)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    rig.animation_data_create()
    action = bpy.data.actions.new("Idle_Candidate")
    action.use_fake_user = True
    action["loop"] = True
    action["in_place"] = True
    rig.animation_data.action = action

    # 4-second 24fps loop. The body breathes and shifts weight by millimetres;
    # there is no Meshy T-pose, big head nod, or root-motion drift.
    poses = [
        (1,  {"spine": (0.0, 0.0, 0.0), "chest": (0.0, 0.0, 0.0), "neck": (0.0, 0.0, 0.0), "head": (0.0, 0.0, 0.0), "upper_arm.L": (0.0, -35.0, 0.0), "upper_arm.R": (0.0, 35.0, 0.0), "forearm.L": (0.0, -45.0, 0.0), "forearm.R": (0.0, 45.0, 0.0)}, {"hips": (0.0, 0.0, 0.0)}),
        (25, {"spine": (0.4, 0.0, -0.35), "chest": (1.1, 0.0, 0.55), "neck": (-0.25, 0.0, 0.15), "head": (-0.55, 0.0, 0.55), "upper_arm.L": (0.0, -35.0, 0.0), "upper_arm.R": (0.0, 35.0, 0.0), "forearm.L": (0.0, -45.0, 0.0), "forearm.R": (0.0, 45.0, 0.0)}, {"hips": (-0.004, 0.0, 0.003)}),
        (49, {"spine": (0.1, 0.0, -0.15), "chest": (0.35, 0.0, 0.10), "neck": (0.0, 0.0, -0.10), "head": (-0.15, 0.0, -0.25), "upper_arm.L": (0.0, -35.0, 0.0), "upper_arm.R": (0.0, 35.0, 0.0), "forearm.L": (0.0, -45.0, 0.0), "forearm.R": (0.0, 45.0, 0.0)}, {"hips": (0.003, 0.0, 0.0)}),
        (73, {"spine": (0.35, 0.0, 0.25), "chest": (0.9, 0.0, -0.45), "neck": (-0.2, 0.0, -0.1), "head": (-0.45, 0.0, -0.5), "upper_arm.L": (0.0, -35.0, 0.0), "upper_arm.R": (0.0, 35.0, 0.0), "forearm.L": (0.0, -45.0, 0.0), "forearm.R": (0.0, 45.0, 0.0)}, {"hips": (0.004, 0.0, 0.003)}),
        (97, {"spine": (0.0, 0.0, 0.0), "chest": (0.0, 0.0, 0.0), "neck": (0.0, 0.0, 0.0), "head": (0.0, 0.0, 0.0), "upper_arm.L": (0.0, -35.0, 0.0), "upper_arm.R": (0.0, 35.0, 0.0), "forearm.L": (0.0, -45.0, 0.0), "forearm.R": (0.0, 45.0, 0.0)}, {"hips": (0.0, 0.0, 0.0)}),
    ]
    for frame, rotations, locations in poses:
        pose(rig, frame, rotations, locations)
    # Blender 5 stores curves under action slots/layers rather than the former
    # Action.fcurves API.  The default Bezier interpolation is sufficient here.
    action.frame_range = (1, 97)

    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 97
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
    camera.hide_viewport = True
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
        light.hide_viewport = True

    # Keep the QA viewport useful to a human reviewer: show the rig, not the
    # camera/light helpers used only for renders.
    rig.show_in_front = True
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig

    bpy.ops.wm.save_as_mainfile(filepath=str(QA_BLEND))
    for frame, suffix in ((1, "start"), (25, "inhale"), (49, "weight_shift"), (73, "release")):
        scene.frame_set(frame)
        scene.render.filepath = str(OUT_DIR / f"NAJU_avatar_idle_candidate_{suffix}.png")
        bpy.ops.render.render(write_still=True)
    print(f"NAJU_IDLE_QA_READY blend={QA_BLEND} action={action.name}")


if __name__ == "__main__":
    main()
