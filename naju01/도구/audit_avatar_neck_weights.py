"""Read-only report for head/neck influence leaking into the torso."""

from pathlib import Path

import bpy


WORK = Path("/Users/derrick/Downloads/NAJU_avatar_game_rig_work.blend")


def influence_vertices(mesh, group_name, minimum):
    index = next(group.index for group in mesh.vertex_groups if group.name == group_name)
    result = []
    for vertex in mesh.data.vertices:
        weight = next((item.weight for item in vertex.groups if item.group == index), 0.0)
        if weight > minimum:
            result.append((vertex, weight))
    return result


def bounds(items):
    return (
        tuple(round(min(vertex.co[index] for vertex, _ in items), 4) for index in range(3)),
        tuple(round(max(vertex.co[index] for vertex, _ in items), 4) for index in range(3)),
    )


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK))
    mesh = bpy.data.objects["NAJU_GAME_AVATAR_MESH"]
    torso = [
        vertex
        for vertex in mesh.data.vertices
        if abs(vertex.co.x) < 0.24 and -0.36 < vertex.co.z < 0.36
    ]
    torso_ids = {vertex.index for vertex in torso}
    print("NECK_WEIGHT_AUDIT")
    for name in ("neck", "head"):
        all_strong = influence_vertices(mesh, name, 0.5)
        group_index = next(group.index for group in mesh.vertex_groups if group.name == name)
        torso_hits = []
        for vertex in mesh.data.vertices:
            if vertex.index not in torso_ids:
                continue
            weight = next((item.weight for item in vertex.groups if item.group == group_index), 0.0)
            if weight > 0.001:
                torso_hits.append((vertex, weight))
        print(
            name,
            "strong_count=", len(all_strong),
            "strong_bounds=", bounds(all_strong),
            "torso_count=", len(torso_hits),
            "torso_bounds=", bounds(torso_hits) if torso_hits else None,
            "torso_weight_range=",
            (round(min(weight for _, weight in torso_hits), 4), round(max(weight for _, weight in torso_hits), 4))
            if torso_hits
            else None,
        )


if __name__ == "__main__":
    main()
