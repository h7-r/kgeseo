"""Measure shoulder continuity for two non-destructive rig candidates.

It measures actual deformed mesh edges.  A sharp weight boundary produces an
unusually stretched edge band at the shoulder even when the shirt centre stays
still; smooth skinning keeps that band continuous.
"""

from math import radians
from pathlib import Path
import os

import bpy


WORK = Path(os.environ["AVATAR_COMPARE_BLEND"])
MESH_NAME = os.environ["AVATAR_COMPARE_MESH"]
RIG_NAME = os.environ["AVATAR_COMPARE_RIG"]
LABEL = os.environ.get("AVATAR_COMPARE_LABEL", WORK.stem)
UPPER_ANGLE = float(os.environ.get("AVATAR_COMPARE_UPPER", "35"))
FOREARM_ANGLE = float(os.environ.get("AVATAR_COMPARE_FOREARM", "45"))


def positions(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        return [vertex.co.copy() for vertex in evaluated_mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def percentile(values, fraction):
    if not values:
        return 1.0
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    mesh = bpy.data.objects[MESH_NAME]
    rig = bpy.data.objects[RIG_NAME]
    reset_pose(rig)
    rest = positions(mesh)
    # Unique edges in the two shoulder/sleeve bands.  Ignore microscopic
    # decimation edges because their ratios are numerically unhelpful.
    edges = set()
    for polygon in mesh.data.polygons:
        indices = polygon.vertices[:]
        for start, end in zip(indices, indices[1:] + indices[:1]):
            edges.add(tuple(sorted((start, end))))
    shoulder_edges = []
    for first, second in edges:
        midpoint = (rest[first] + rest[second]) * 0.5
        length = (rest[first] - rest[second]).length
        if (
            length >= 0.003
            and 0.08 <= abs(midpoint.x) <= 0.40
            and -0.04 <= midpoint.z <= 0.35
        ):
            shoulder_edges.append((first, second, length))
    core = [
        vertex.index
        for vertex in mesh.data.vertices
        if abs(vertex.co.x) < 0.16 and -0.30 < vertex.co.z < 0.16
    ]

    for name, degrees in (
        ("upper_arm.L", -UPPER_ANGLE),
        ("upper_arm.R", UPPER_ANGLE),
        ("forearm.L", -FOREARM_ANGLE),
        ("forearm.R", FOREARM_ANGLE),
    ):
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.y = radians(degrees)
    bpy.context.view_layer.update()
    after = positions(mesh)
    ratios = [(after[first] - after[second]).length / length for first, second, length in shoulder_edges]
    core_delta = max(((after[index] - rest[index]).length for index in core), default=0.0)
    print(
        f"{LABEL}: shoulder edges={len(ratios)}; "
        f"stretch p95={percentile(ratios, .95):.3f} p99={percentile(ratios, .99):.3f} "
        f"max={max(ratios, default=1.0):.3f}; core torso movement={core_delta:.6f}m"
    )


if __name__ == "__main__":
    main()
