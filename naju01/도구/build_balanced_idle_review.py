"""Make a review-only relaxed idle from the balanced skin candidate."""

from math import radians
from pathlib import Path

import bpy


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_balanced_skin_QA.blend")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_avatar_balanced_skin_idle_QA.blend")
PREVIEW = Path("/Users/derrick/Downloads/NAJU_balanced_skin_idle_preview.png")


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()


def key_pose(rig, frame, spine, chest, head, hips):
    reset_pose(rig)
    rotations = {
        "spine": spine,
        "chest": chest,
        "neck": (0.0, 0.0, 0.0),
        "head": head,
        # The source A-pose needs these offsets for relaxed arms alongside the
        # shorts.  They are held steady through the idle, not swung outward.
        "upper_arm.L": (0.0, -50.0, 0.0),
        "upper_arm.R": (0.0, 50.0, 0.0),
        "forearm.L": (0.0, -50.0, 0.0),
        "forearm.R": (0.0, 50.0, 0.0),
    }
    for name, values in rotations.items():
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = tuple(radians(value) for value in values)
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    hip_bone = rig.pose.bones["hips"]
    hip_bone.location = hips
    hip_bone.keyframe_insert(data_path="location", frame=frame)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects["NAJU_BALANCED_SKIN_RIG"]
    rig.animation_data_create()
    action = bpy.data.actions.new("Idle_Balanced_Skin_Review")
    action.use_fake_user = True
    action["loop"] = True
    action["in_place"] = True
    rig.animation_data.action = action
    key_pose(rig, 1, (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0))
    key_pose(rig, 25, (0.35, 0, -0.25), (0.75, 0, 0.35), (-0.35, 0, 0.35), (-0.003, 0, 0.002))
    key_pose(rig, 49, (0.10, 0, -0.10), (0.25, 0, 0.10), (-0.10, 0, -0.15), (0.002, 0, 0))
    key_pose(rig, 73, (0.30, 0, 0.20), (0.65, 0, -0.30), (-0.30, 0, -0.35), (0.003, 0, 0.002))
    key_pose(rig, 97, (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0))
    action.frame_range = (1, 97)

    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 97
    scene.frame_set(1)
    scene.render.filepath = str(PREVIEW)
    bpy.ops.render.render(write_still=True)
    rig.show_in_front = True
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(f"BALANCED_IDLE_REVIEW_READY output={OUTPUT} action={action.name}")


if __name__ == "__main__":
    main()
