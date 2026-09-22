"""Clothing selection on a dressed Meshy variant, reviewed visually.

A garment face is one whose base-colour differs from this model's own skin colour
(sampled on the cheeks and forearms) by more than `--skin-distance`, inside the
clothing height band.  Per-model edits.json can remove/add boxes exactly like the
hair tool, and the result is rendered with the selection in red for review.

  {"remove": [{"min": [x,y,z], "max": [...], "note": "..."}],
   "add": [...], "min_island_faces": 300, "bands": {"top": [z0, z1], "bottom": [z0, z1]}}

Usage:
  Blender --background --factory-startup --python meshy_cloth_select.py -- \
    --model ~/Downloads/Meshy_AI_Bald_Cartoon_Boy_in_W_0917064538_texture.glb \
    --edits naju01/캐릭터작업/meshy-parts/outfit_m/edits.json \
    --out-dir naju01/캐릭터작업/meshy-parts/outfit_m/select
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
    p.add_argument("--skin-distance", type=float, default=0.22)
    # edits.json의 skin_distance가 있으면 그 값을 쓴다(모델별 검토 결과 보존).
    return p.parse_args(raw)


def inside(c: Vector, box) -> bool:
    return all(box["min"][i] <= c[i] <= box["max"][i] for i in range(3))


def face_colours(obj):
    """(face index -> linear RGB) sampled at the face centre of the base-colour map."""
    import numpy as np

    pixels = H.base_color_pixels(obj)
    uv = obj.data.uv_layers.active.data
    colours = {}
    for poly in obj.data.polygons:
        u = sum(uv[li].uv.x for li in poly.loop_indices) / poly.loop_total
        v = sum(uv[li].uv.y for li in poly.loop_indices) / poly.loop_total
        px = pixels[min(1023, max(0, int(v % 1 * 1024))), min(1023, max(0, int(u % 1 * 1024)))]
        colours[poly.index] = np.array(px, dtype=float)
    return colours


def main():
    args = arguments()
    out = args.out_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    edits = json.loads(args.edits.read_text()) if args.edits.exists() else {}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = H.import_glb(args.model, "Model")
    verts = obj.data.vertices
    zs = [v.co.z for v in verts]
    ground, top = min(zs), max(zs)
    h = top - ground
    centres = {p.index: sum((verts[i].co for i in p.vertices), Vector()) / len(p.vertices)
               for p in obj.data.polygons}
    colours = face_colours(obj)

    # Skin reference: cheeks and forearms of this same model.
    import numpy as np

    skin_faces = [i for i, c in centres.items()
                  if (top - h * 0.24 < c.z < top - h * 0.16 and abs(c.x) < h * 0.07 and c.y < -h * 0.03)
                  or (abs(c.x) > h * 0.17 and ground + h * 0.42 < c.z < ground + h * 0.52)]
    skin = np.median(np.array([colours[i] for i in skin_faces]), axis=0)

    # 기본 밴드: 무릎 위(발·다리 아래쪽 제외)부터 목 아래까지.
    bands = edits.get("bands", {"cloth": [ground + h * 0.26, top - h * 0.24]})
    selected = set()
    for index, c in centres.items():
        if not any(lo <= c.z <= hi for lo, hi in bands.values()):
            continue
        if float(np.linalg.norm(colours[index] - skin)) > edits.get("skin_distance", args.skin_distance):
            selected.add(index)
    # 옷 안쪽의 프린트·음영이 피부색에 가까워 생기는 구멍을 메운다(헤어와 같은 방식).
    selected = H.fill_enclosed(obj, selected, ground + h * 0.20)
    for box in edits.get("remove", []):
        selected -= {i for i in selected if inside(centres[i], box)}
    for box in edits.get("add", []):
        selected |= {i for i, c in centres.items() if inside(c, box)}

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
    min_faces = edits.get("min_island_faces", 300)
    groups = []
    for island in islands:
        if len(island) < min_faces:
            selected -= set(island)
            continue
        zs_i = [centres[i].z for i in island]
        groups.append({"faces": len(island), "z": [round(min(zs_i), 3), round(max(zs_i), 3)]})
    (out / "selection.json").write_text(json.dumps(sorted(selected)))
    (out / "islands.json").write_text(json.dumps({"skin_rgb": [round(float(x), 3) for x in skin],
                                                   "islands": sorted(groups, key=lambda g: -g["faces"])}, indent=2))

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
    scene.render.resolution_x, scene.render.resolution_y = 620, 720
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    body = Vector((0, 0, ground + h * 0.5))
    torso = Vector((0, 0, ground + h * 0.62))
    for name, angle, centre, scale in (("front", 0, body, h * 1.05), ("side", math.pi / 2, body, h * 1.05),
                                       ("back", math.pi, body, h * 1.05), ("torso", 0, torso, h * 0.55),
                                       ("torso_side", math.pi / 2, torso, h * 0.55)):
        d = Vector((math.sin(angle), -math.cos(angle), 0))
        cam.location = centre + d * 5
        cam.rotation_euler = (math.pi / 2, 0, angle)
        cam.data.ortho_scale = scale
        scene.render.filepath = str(out / f"{name}.png")
        bpy.ops.render.render(write_still=True)
    print("CLOTH_SELECT_OK", json.dumps({"faces": len(selected), "islands": len(groups)}))


if __name__ == "__main__":
    main()
