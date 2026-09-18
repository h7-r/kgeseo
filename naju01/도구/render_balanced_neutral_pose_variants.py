"""Pose the arm chains in a true vertical neutral stance for visual QA.

The Meshy source is in an A-pose, so independent local-Euler guesses leave
elbows and hands pointing outward.  This aligns each arm-bone's long axis to a
near-vertical world direction, then tests both inward-palm rolls.
"""

from math import radians, sqrt
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_balanced_skin_QA.blend")
OUT_DIR = Path("/Users/derrick/Downloads")


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def matrix_with_axis(rest_bone, location, target_axis, roll=0.0):
    rest_orientation = rest_bone.matrix_local.to_3x3()
    rest_axis = rest_orientation.col[1].normalized()
    align = rest_axis.rotation_difference(target_axis)
    orientation = align.to_matrix() @ rest_orientation
    if roll:
        orientation = Matrix.Rotation(roll, 3, target_axis) @ orientation
    return Matrix.LocRotScale(location, orientation.to_quaternion(), None)


def vertical_arm_chain(rig, side, hand_roll=0.0):
    sign = -1.0 if side == "L" else 1.0
    # Six degrees away from vertical is enough clearance around the hip while
    # still reading as arms hanging naturally beside the body.
    target = Vector((sign * 0.105, 0.0, -sqrt(1.0 - 0.105 ** 2))).normalized()
    upper = rig.pose.bones[f"upper_arm.{side}"]
    forearm = rig.pose.bones[f"forearm.{side}"]
    hand = rig.pose.bones[f"hand.{side}"]

    upper.matrix = matrix_with_axis(upper.bone, upper.bone.head_local.copy(), target)
    bpy.context.view_layer.update()
    forearm.matrix = matrix_with_axis(forearm.bone, upper.tail.copy(), target)
    bpy.context.view_layer.update()
    hand.matrix = matrix_with_axis(hand.bone, forearm.tail.copy(), target, hand_roll)
    bpy.context.view_layer.update()


def render(scene, rig, label, left_roll=0.0, right_roll=0.0):
    reset_pose(rig)
    vertical_arm_chain(rig, "L", left_roll)
    vertical_arm_chain(rig, "R", right_roll)
    scene.render.filepath = str(OUT_DIR / f"NAJU_neutral_pose_{label}.png")
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects["NAJU_BALANCED_SKIN_RIG"]
    scene = bpy.context.scene
    render(scene, rig, "no_hand_roll")
    render(scene, rig, "palm_in_A", radians(90), radians(-90))
    render(scene, rig, "palm_in_B", radians(-90), radians(90))
    print("BALANCED_NEUTRAL_POSE_VARIANTS_READY")


if __name__ == "__main__":
    main()
