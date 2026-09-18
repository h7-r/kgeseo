"""Read-only topology and skinning audit for the derived NAJU avatar.

This answers a prerequisite question before any further animation work: are the
arms physically connected to the torso, and do their shoulder vertices have a
usable blend of torso/arm weights?  The opened blend is never saved.
"""

from collections import Counter, defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")
REPORT = Path("/Users/derrick/Downloads/NAJU_avatar_mesh_skin_audit.txt")


class UnionFind:
    def __init__(self, size):
        self.parents = list(range(size))

    def find(self, item):
        while self.parents[item] != item:
            self.parents[item] = self.parents[self.parents[item]]
            item = self.parents[item]
        return item

    def union(self, first, second):
        first = self.find(first)
        second = self.find(second)
        if first != second:
            self.parents[second] = first


def dominant_group(vertex, groups):
    if not vertex.groups:
        return "<unweighted>"
    group = max(vertex.groups, key=lambda item: item.weight)
    return groups[group.group].name


def shoulder_report(mesh, rig, side, component_by_vertex):
    bone = rig.data.bones[f"upper_arm.{side}"]
    joint = rig.matrix_world @ bone.head_local
    # This radius covers the shoulder cap and sleeve seam, without swallowing
    # the centre of the shirt or the elbow.
    indices = [
        vertex.index
        for vertex in mesh.data.vertices
        if (mesh.matrix_world @ vertex.co - joint).length <= 0.115
    ]
    groups = mesh.vertex_groups
    component_count = Counter(component_by_vertex[index] for index in indices)
    dominant = Counter(dominant_group(mesh.data.vertices[index], groups) for index in indices)
    mixed = 0
    for index in indices:
        names = {groups[item.group].name for item in mesh.data.vertices[index].groups if item.weight >= 0.10}
        if "chest" in names and f"upper_arm.{side}" in names:
            mixed += 1
    return {
        "joint": joint,
        "count": len(indices),
        "components": component_count,
        "dominant": dominant,
        "mixed": mixed,
    }


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    mesh = bpy.data.objects["NAJU_GAME_AVATAR_MESH"]
    rig = bpy.data.objects["NAJU_GAME_RIG"]
    vertices = mesh.data.vertices

    connectivity = UnionFind(len(vertices))
    for polygon in mesh.data.polygons:
        root = polygon.vertices[0]
        for index in polygon.vertices[1:]:
            connectivity.union(root, index)

    component_vertices = defaultdict(list)
    for vertex in vertices:
        component_vertices[connectivity.find(vertex.index)].append(vertex.index)
    ordered = sorted(component_vertices.values(), key=len, reverse=True)
    component_by_vertex = {}
    for component_id, indices in enumerate(ordered, start=1):
        for index in indices:
            component_by_vertex[index] = component_id

    lines = [
        "NAJU avatar mesh / skin audit (read-only)",
        f"mesh: {mesh.name}",
        f"vertices: {len(vertices):,}; triangles: {len(mesh.data.polygons):,}",
        f"disconnected mesh islands: {len(ordered):,}",
        "",
        "Largest mesh islands (a separate island cannot stretch across a shoulder gap):",
    ]
    for number, indices in enumerate(ordered[:12], start=1):
        points = [vertices[index].co for index in indices]
        low = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
        high = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
        lines.append(
            f"  island {number}: {len(indices):,} vertices; local bounds "
            f"x[{low.x:.3f}, {high.x:.3f}] y[{low.y:.3f}, {high.y:.3f}] z[{low.z:.3f}, {high.z:.3f}]"
        )

    lines.append("")
    for side in ("L", "R"):
        report = shoulder_report(mesh, rig, side, component_by_vertex)
        top_components = ", ".join(
            f"island {component} ({count} vertices)" for component, count in report["components"].most_common(4)
        ) or "none"
        top_groups = ", ".join(
            f"{name} ({count})" for name, count in report["dominant"].most_common(6)
        ) or "none"
        lines.extend(
            [
                f"{side} shoulder joint: ({report['joint'].x:.3f}, {report['joint'].y:.3f}, {report['joint'].z:.3f})",
                f"  vertices within 11.5cm: {report['count']}",
                f"  mesh islands in shoulder area: {top_components}",
                f"  dominant weight groups: {top_groups}",
                f"  chest + upper_arm.{side} blended vertices (each >= 0.10): {report['mixed']}",
            ]
        )

    lines.extend(
        [
            "",
            "Interpretation:",
            "  - A shoulder that occupies separate mesh islands needs topology repair / a bridge mesh before weighting can make it seamless.",
            "  - A connected shoulder with few or no chest+upper-arm blended vertices needs weight-paint correction, not a new animation.",
            "  - This report does not modify the source blend or its actions.",
        ]
    )
    report = "\n".join(lines) + "\n"
    REPORT.write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
