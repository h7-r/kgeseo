"""Create in-place Idle/Walk/Run actions for the isolated NAJU game rig.

This produces a new animated work file and GLB; the high-detail source and
the unanimated rig work file remain unchanged.
"""

from pathlib import Path
from math import radians

import bpy


SOURCE_WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
ANIMATED_WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_animated_work.blend")
GAME_GLB = Path("/Users/derrick/Downloads/NAJU_avatar_game_animated.glb")
R3F_GLB = Path("/Users/derrick/Documents/GitHub/kgeseo/public/models/naju-avatar-game.glb")


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.location = (0.0, 0.0, 0.0)


def set_rot(rig, values):
    for bone_name, rotation in values.items():
        rig.pose.bones[bone_name].rotation_euler = tuple(radians(value) for value in rotation)


def key_pose(rig, frame, values):
    reset_pose(rig)
    set_rot(rig, values)
    for bone_name in values:
        rig.pose.bones[bone_name].keyframe_insert(data_path="rotation_euler", frame=frame)


def make_action(rig, name, poses, frame_end):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    action["loop"] = True
    action["in_place"] = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame, values in poses:
        key_pose(rig, frame, values)
    action.frame_range = (1, frame_end)
    return action


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_WORK))
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    mesh = bpy.data.objects["NAJU_GAME_AVATAR_MESH"]
    reset_pose(rig)

    idle = make_action(
        rig,
        "Idle",
        [
            (1, {}),
            (25, {"chest": (1.5, 0, 0), "head": (-1.2, 0, 0)}),
            (49, {}),
        ],
        49,
    )

    walk = make_action(
        rig,
        "Walk",
        [
            (1, {"thigh.L": (18, 0, 0), "thigh.R": (-18, 0, 0), "shin.L": (-7, 0, 0), "shin.R": (-22, 0, 0), "upper_arm.L": (-12, 0, 0), "upper_arm.R": (12, 0, 0), "forearm.L": (5, 0, 0), "forearm.R": (-5, 0, 0), "chest": (0, 0, 1.5)}),
            (9, {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (-12, 0, 0), "shin.R": (-12, 0, 0), "upper_arm.L": (0, 0, 0), "upper_arm.R": (0, 0, 0), "chest": (0, 0, 0)}),
            (17, {"thigh.L": (-18, 0, 0), "thigh.R": (18, 0, 0), "shin.L": (-22, 0, 0), "shin.R": (-7, 0, 0), "upper_arm.L": (12, 0, 0), "upper_arm.R": (-12, 0, 0), "forearm.L": (-5, 0, 0), "forearm.R": (5, 0, 0), "chest": (0, 0, -1.5)}),
            (25, {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (-12, 0, 0), "shin.R": (-12, 0, 0), "upper_arm.L": (0, 0, 0), "upper_arm.R": (0, 0, 0), "chest": (0, 0, 0)}),
            (33, {"thigh.L": (18, 0, 0), "thigh.R": (-18, 0, 0), "shin.L": (-7, 0, 0), "shin.R": (-22, 0, 0), "upper_arm.L": (-12, 0, 0), "upper_arm.R": (12, 0, 0), "forearm.L": (5, 0, 0), "forearm.R": (-5, 0, 0), "chest": (0, 0, 1.5)}),
        ],
        33,
    )

    run = make_action(
        rig,
        "Run",
        [
            (1, {"thigh.L": (30, 0, 0), "thigh.R": (-30, 0, 0), "shin.L": (-8, 0, 0), "shin.R": (-36, 0, 0), "upper_arm.L": (-24, 0, 0), "upper_arm.R": (24, 0, 0), "forearm.L": (20, 0, 0), "forearm.R": (-20, 0, 0), "chest": (5, 0, 0), "head": (-3, 0, 0)}),
            (7, {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (-24, 0, 0), "shin.R": (-24, 0, 0), "upper_arm.L": (0, 0, 0), "upper_arm.R": (0, 0, 0), "forearm.L": (10, 0, 0), "forearm.R": (-10, 0, 0), "chest": (3, 0, 0), "head": (-2, 0, 0)}),
            (13, {"thigh.L": (-30, 0, 0), "thigh.R": (30, 0, 0), "shin.L": (-36, 0, 0), "shin.R": (-8, 0, 0), "upper_arm.L": (24, 0, 0), "upper_arm.R": (-24, 0, 0), "forearm.L": (-20, 0, 0), "forearm.R": (20, 0, 0), "chest": (5, 0, 0), "head": (-3, 0, 0)}),
            (19, {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0), "shin.L": (-24, 0, 0), "shin.R": (-24, 0, 0), "upper_arm.L": (0, 0, 0), "upper_arm.R": (0, 0, 0), "forearm.L": (10, 0, 0), "forearm.R": (-10, 0, 0), "chest": (3, 0, 0), "head": (-2, 0, 0)}),
            (25, {"thigh.L": (30, 0, 0), "thigh.R": (-30, 0, 0), "shin.L": (-8, 0, 0), "shin.R": (-36, 0, 0), "upper_arm.L": (-24, 0, 0), "upper_arm.R": (24, 0, 0), "forearm.L": (20, 0, 0), "forearm.R": (-20, 0, 0), "chest": (5, 0, 0), "head": (-3, 0, 0)}),
        ],
        25,
    )

    reset_pose(rig)
    rig.animation_data.action = None
    scene = bpy.context.scene
    scene["avatar_actions"] = ", ".join(action.name for action in (idle, walk, run))
    scene["avatar_pipeline_stage"] = "rigged_with_in_place_locomotion"
    bpy.ops.wm.save_as_mainfile(filepath=str(ANIMATED_WORK))

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(GAME_GLB),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_anim_single_armature=True,
        export_force_sampling=True,
        export_yup=True,
    )
    bpy.ops.export_scene.gltf(
        filepath=str(R3F_GLB),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_anim_single_armature=True,
        export_force_sampling=True,
        export_yup=True,
    )
    print(
        "NAJU_ANIMATIONS_READY "
        f"actions=Idle,Walk,Run work={ANIMATED_WORK} glb={GAME_GLB} r3f_glb={R3F_GLB}"
    )


if __name__ == "__main__":
    main()
