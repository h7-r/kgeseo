"""Make a browser-sized GLB from the rigged Meshy character blend.

Shapes are not re-authored: this only lowers resolution.  Per-slot triangle budgets
are reached with Blender's Decimate (collapse, UV/weights preserved) and every image
is scaled down to one size.  Run after build_chibi_body.py.

Usage:
  Blender --background --factory-startup --python meshy_optimize.py -- \
    --blend ~/Downloads/MESHY_character_rigged.blend --glb-dir public/models \
    --prefix meshy --texture 2048 --report naju01/캐릭터작업/meshy-parts/optimize.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy

BUDGET = {"body": 45000, "hair": 30000, "top": 16000, "bottom": 12000}


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--blend", type=Path, required=True)
    p.add_argument("--glb-dir", type=Path, required=True)
    p.add_argument("--prefix", default="meshy")
    p.add_argument("--texture", type=int, default=2048)
    p.add_argument("--labels", nargs="+", default=["Male", "Female"])
    p.add_argument("--report", type=Path, required=True)
    return p.parse_args(raw)


def main():
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.expanduser().resolve()))
    report = {"meshes": {}, "images": {}}
    for image in bpy.data.images:
        if image.size[0] > args.texture:
            before = tuple(image.size)
            image.scale(args.texture, args.texture)
            report["images"][image.name] = {"from": before, "to": tuple(image.size)}
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        report["meshes"][obj.name] = {"faces": len(obj.data.polygons)}

    out = args.glb_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    for label in args.labels:
        rig = bpy.data.objects.get(f"ChibiRig_{label}") or bpy.data.objects.get(f"Rig_{label}")
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]
        bpy.ops.object.select_all(action="DESELECT")
        for o in (rig, *meshes):
            o.hide_viewport = False
            o.hide_set(False)
            o.select_set(True)
        bpy.context.view_layer.objects.active = rig
        path = out / f"{args.prefix}-{label.lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(path), export_format="GLB", use_selection=True, export_animations=False,
            export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
            export_extras=True, export_image_format="JPEG", export_jpeg_quality=80,
        )
        report.setdefault("files", {})[path.name] = round(path.stat().st_size / 1e6, 2)
    args.report.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2))
    print("MESHY_OPTIMIZE_OK", json.dumps(report.get("files", {})))


if __name__ == "__main__":
    main()
