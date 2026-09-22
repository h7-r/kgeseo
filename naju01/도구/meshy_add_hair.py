"""Add extracted Meshy hair pieces to the rigged base blend (head-bone bound).

The hair GLB from meshy_extract_hair.py is already aligned and seated on the base
head in the raw Meshy coordinates; this only applies the same grounding offset the
base body got, binds it rigidly to the Head bone and tags it with slot/variant so the
runtime can switch styles.

Usage:
  Blender --background --factory-startup --python meshy_add_hair.py -- \
    --blend /tmp/meshy_dressed.blend --label Male \
    --hair naju01/캐릭터작업/meshy-parts/hair_m1/hair.glb=0 \
           naju01/캐릭터작업/meshy-parts/hair_m2/hair.glb=1 \
    --out-blend /tmp/meshy_dressed.blend
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshy_extract_hair as H  # noqa: E402


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--blend", type=Path, required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--hair", nargs="+", required=True, help="path=variant pairs")
    p.add_argument("--out-blend", type=Path, required=True)
    return p.parse_args(raw)


def main():
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.expanduser().resolve()))
    label = args.label
    body = bpy.data.objects[f"Body_{label}"]
    rig = bpy.data.objects[f"Rig_{label}"]
    offset = Vector(body.get("meshy_offset", (0, 0, 0)))
    report = {}
    for pair in args.hair:
        path, _, variant = pair.rpartition("=")
        obj = H.import_glb(Path(path), f"Hair{variant}_{label}")
        obj.data.transform(Matrix.Translation(offset))
        obj.data.update()
        group = obj.vertex_groups.new(name="Head")
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        obj.modifiers.new("Armature", "ARMATURE").object = rig
        obj.parent = rig
        obj["slot"] = "hair"
        obj["variant"] = int(variant)
        report[obj.name] = {"vertices": len(obj.data.vertices), "faces": len(obj.data.polygons)}
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out_blend.expanduser().resolve()))
    print("HAIR_ADD_OK", json.dumps(report))


if __name__ == "__main__":
    main()
