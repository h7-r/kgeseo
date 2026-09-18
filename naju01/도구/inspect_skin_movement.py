"""Print the vertex with the largest protected-torso movement for a QA blend."""

from math import radians
import os
from pathlib import Path

import bpy


WORK = Path(os.environ["AVATAR_INSPECT_BLEND"])
MESH_NAME = os.environ["AVATAR_INSPECT_MESH"]
RIG_NAME = os.environ["AVATAR_INSPECT_RIG"]


def positions(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        return [vertex.co.copy() for vertex in evaluated_mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    mesh = bpy.data.objects[MESH_NAME]
    rig = bpy.data.objects[RIG_NAME]
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    before = positions(mesh)
    for name, degrees in (("upper_arm.L", -35), ("upper_arm.R", 35), ("forearm.L", -45), ("forearm.R", 45)):
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.y = radians(degrees)
    bpy.context.view_layer.update()
    after = positions(mesh)
    protected = [
        vertex.index for vertex in mesh.data.vertices
        if abs(vertex.co.x) < 0.16 and -0.30 < vertex.co.z < 0.16
    ]
    index = max(protected, key=lambda item: (after[item] - before[item]).length)
    vertex = mesh.data.vertices[index]
    weights = sorted(
        ((mesh.vertex_groups[item.group].name, item.weight) for item in vertex.groups),
        key=lambda item: item[1],
        reverse=True,
    )
    print("max protected movement", (after[index] - before[index]).length, "vertex", index, "local", tuple(vertex.co))
    print("weights", weights)


if __name__ == "__main__":
    main()
