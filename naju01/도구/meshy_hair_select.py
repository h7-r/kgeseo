"""Hair selection on one Meshy model, reviewed visually like Blender edit mode.

Selection = dark base-colour faces above the neck, enclosed light gaps filled, then
per-model manual edits from a JSON file (boxes in the model's own coordinates):
  {"remove": [{"min": [x,y,z], "max": [x,y,z], "note": "..."}],
   "add":    [{"min": [...], "max": [...], "note": "..."}],
   "remove_islands_below": 0.3,   # drop selected islands whose top is below this z
   "min_z": 0.2,                  # colour selection floor (long hair)
   "min_island_faces": 300}
Writes selection.json (face indices) and review renders with the selection in red.

Usage:
  Blender --background --factory-startup --python meshy_hair_select.py -- \
    --model ~/Downloads/Meshy_AI_Mia_0917063210_texture.glb \
    --edits naju01/캐릭터작업/meshy-parts/hair_f2/edits.json \
    --out-dir naju01/캐릭터작업/meshy-parts/hair_f2/select
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshy_extract_hair as H  # noqa: E402


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--edits", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    return p.parse_args(raw)


def inside(c: Vector, box) -> bool:
    return all(box["min"][i] <= c[i] <= box["max"][i] for i in range(3))


def colour_selection(obj, neck_z, min_z=None) -> set[int]:
    import numpy as np

    pixels = H.base_color_pixels(obj)
    uv = obj.data.uv_layers.active.data
    hair = set()
    for poly in obj.data.polygons:
        c = sum((obj.data.vertices[i].co for i in poly.vertices), Vector()) / len(poly.vertices)
        if c.z < (neck_z - 0.10 if min_z is None else min_z):
            continue
        u = sum(uv[li].uv.x for li in poly.loop_indices) / poly.loop_total
        v = sum(uv[li].uv.y for li in poly.loop_indices) / poly.loop_total
        px = pixels[min(1023, max(0, int(v % 1 * 1024))), min(1023, max(0, int(u % 1 * 1024)))]
        if float(np.dot(px, (0.2126, 0.7152, 0.0722))) < 0.45:
            hair.add(poly.index)
    return H.fill_enclosed(obj, hair, neck_z)


def main():
    args = arguments()
    out = args.out_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    edits = json.loads(args.edits.read_text()) if args.edits.exists() else {}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = H.import_glb(args.model, "Model")
    zs = [v.co.z for v in obj.data.vertices]
    top, height = max(zs), max(zs) - min(zs)
    neck_z = top - height * 0.26

    # "min_z": long hair reaching the chest needs a lower cut-off than the neck.
    selected = colour_selection(obj, neck_z, edits.get("min_z"))
    centres = {p.index: sum((obj.data.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices)
               for p in obj.data.polygons}
    for box in edits.get("remove", []):
        selected -= {i for i in selected if inside(centres[i], box)}
    for box in edits.get("add", []):
        selected |= {i for i, c in centres.items() if inside(c, box)}

    # island clean-up on welded geometry
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    seen, islands = set(), []
    for index in selected:
        if index in seen:
            continue
        stack, island = [bm.faces[index]], []
        seen.add(index)
        while stack:
            f = stack.pop()
            island.append(f.index)
            for e in f.edges:
                for nb in e.link_faces:
                    if nb.index in selected and nb.index not in seen:
                        seen.add(nb.index)
                        stack.append(nb)
        islands.append(island)
    bm.free()
    below = edits.get("remove_islands_below")
    min_faces = edits.get("min_island_faces", 300)
    dropped = 0
    for island in islands:
        island_top = max(centres[i].z for i in island)
        if len(island) < min_faces or (below is not None and island_top < below):
            selected -= set(island)
            dropped += 1

    (out / "selection.json").write_text(json.dumps(sorted(selected)))

    # review renders: selected faces red, rest textured
    red = bpy.data.materials.new("Selected")
    red.diffuse_color = (1.0, 0.05, 0.05, 1)
    obj.data.materials.append(red)
    red_index = len(obj.data.materials) - 1
    for poly in obj.data.polygons:
        if poly.index in selected:
            poly.material_index = red_index
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    red.use_nodes = False
    scene.render.resolution_x = scene.render.resolution_y = 700
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    head = Vector((0, 0, top - height * 0.17))
    views = [("front", 0, head, 0.46), ("left", math.pi / 2, head, 0.46), ("back", math.pi, head, 0.46),
             ("right", -math.pi / 2, head, 0.46), ("face", 0, Vector((0, 0, top - height * 0.16)), 0.24),
             ("shoulders", 0, Vector((0, 0, top - height * 0.33)), 0.7)]
    for name, angle, centre, scale in views:
        d = Vector((math.sin(angle), -math.cos(angle), 0))
        cam.location = centre + d * 4
        cam.rotation_euler = (math.pi / 2, 0, angle)
        cam.data.ortho_scale = scale
        scene.render.filepath = str(out / f"{name}.png")
        bpy.ops.render.render(write_still=True)
    print("HAIR_SELECT_OK", json.dumps({"faces": len(selected), "islands_dropped": dropped,
                                         "top": round(top, 4), "height": round(height, 4)}))


if __name__ == "__main__":
    main()
