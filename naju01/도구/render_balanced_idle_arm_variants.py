"""Render two closer-to-body relaxed-arm options without changing the QA blend."""

from math import radians
from pathlib import Path

import bpy


SOURCE = Path("/Users/derrick/Downloads/NAJU_avatar_balanced_skin_QA.blend")
OUT_DIR = Path("/Users/derrick/Downloads")


def reset(rig):
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()


def render(scene, rig, label, upper, forearm):
    reset(rig)
    for name, degrees in (
        ("upper_arm.L", -upper), ("upper_arm.R", upper),
        ("forearm.L", -forearm), ("forearm.R", forearm),
    ):
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.y = radians(degrees)
    bpy.context.view_layer.update()
    scene.render.filepath = str(OUT_DIR / f"NAJU_balanced_idle_{label}.png")
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects["NAJU_BALANCED_SKIN_RIG"]
    scene = bpy.context.scene
    render(scene, rig, "A_42_48", 42, 48)
    render(scene, rig, "B_50_50", 50, 50)
    render(scene, rig, "C_62_52", 62, 52)
    render(scene, rig, "D_70_55", 70, 55)
    render(scene, rig, "E_50_0", 50, 0)
    render(scene, rig, "F_70_0", 70, 0)
    render(scene, rig, "G_neg30_0", -30, 0)
    render(scene, rig, "H_neg50_0", -50, 0)
    print("BALANCED_IDLE_VARIANTS_READY")


if __name__ == "__main__":
    main()
