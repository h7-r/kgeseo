"""리깅한 기본 blend 에 뽑아 둔 머리카락 조각을 Head 뼈에 묶어 붙인다.

머리카락 GLB 는 meshy_extract_hair.py 가 이미 머리에 맞춰 두었으므로, 몸통과 같은
바닥 맞춤 오프셋만 주고 slot/variant 를 달아 런타임이 머리 모양을 바꿀 수 있게 한다.

Usage:
  Blender --background --factory-startup --python meshy_add_hair.py -- \
    --blend /tmp/meshy_dressed.blend --label Male \
    --hair naju01/character-work/meshy-parts/hair_m1/hair.glb=0 \
           naju01/character-work/meshy-parts/hair_m2/hair.glb=1 \
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--hair", nargs="+", required=True, help="path=variant pairs")
    parser.add_argument("--out-blend", type=Path, required=True)
    return parser.parse_args(raw)


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
