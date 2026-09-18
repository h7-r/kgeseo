"""Paint the mouth out of the Meshy face texture.

The smile is not geometry — Meshy bakes it into the body texture — so it is
removed by repainting those texels with the skin around them.  The mouth is
found from the mesh, not by guessing at the image: the head vertices give the
chin and the nose tip, the band between them that faces forward is the mouth
area, and its UV triangles are rasterised into a mask.  Inside the mask only
texels that differ from the surrounding skin are replaced, so the chin shading
and the jaw line survive.

Usage:
  Blender --background --factory-startup --python meshy_erase_mouth.py -- \
    --blend ~/Downloads/MESHY_rigged.blend --out-blend ~/Downloads/MESHY_nomouth.blend \
    --labels Male --report naju01/캐릭터작업/meshy-parts/mouth.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


def arguments() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--blend", type=Path, required=True)
    p.add_argument("--out-blend", type=Path, required=True)
    p.add_argument("--labels", nargs="+", default=["Male", "Female"])
    p.add_argument("--report", type=Path, default=None)
    # 입술은 코끝보다 아래에 있다. 이 높이(턱=0, 코끝=1)까지만 살펴본다.
    p.add_argument("--high", type=float, default=1.0)
    # 입술만 고르는 붉기 — 그 모델의 살빛보다 이만큼 더 붉은 texel 만 지운다.
    # 고정값을 쓰면 안 된다: 살빛의 r-g 가 모델마다 0.11~0.17 로 달라, 0.18 로 묶었더니
    # 어떤 모델은 얼굴 음영이 통째로 칠해졌다. 눈썹·눈동자는 거의 검어서 r-g 가
    # 0 에 가깝고 흰자는 회색이라 어느 쪽 규칙에도 걸리지 않는다.
    p.add_argument("--redness", type=float, default=0.06)
    # 위 규칙에 아무것도 안 걸리는 모델이 있다(입술이 덜 붉다). 그때만 쓰는 예비 규칙 —
    # 살빛보다 조금 더 붉으면서 **더 어두운** 곳.
    p.add_argument("--fallback-redness", type=float, default=0.06)
    p.add_argument("--fallback-darkness", type=float, default=0.15)
    return p.parse_args(raw)


def head_mesh(label: str):
    rig = bpy.data.objects.get(f"ChibiRig_{label}") or bpy.data.objects.get(f"Rig_{label}")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]
    body = [o for o in meshes if str(o.get("slot", o.get("chibi_part", ""))) == "body"]
    return rig, (body[0] if body else meshes[0])


def mouth_vertices(obj, rig, high: float) -> tuple[set[int], dict]:
    """Vertex indices of the head below the nose — both cheeks, the jaw and the mouth.

    The band is not narrowed to the face side: the UV islands are scattered all
    over the atlas and the facing direction cannot be read off the head shape
    reliably, so the mouth is picked out of this band by colour instead.
    """
    head_bone = rig.data.bones.get("head")
    neck_bone = rig.data.bones.get("neck_01")
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    chin_z = (rig.matrix_world @ head_bone.head_local).z if head_bone else max(p.z for p in points) * 0.85
    if neck_bone is not None:
        chin_z = min(chin_z, (rig.matrix_world @ neck_bone.head_local).z + (chin_z - (rig.matrix_world @ neck_bone.head_local).z) * 0.5)
    head = [(i, p) for i, p in enumerate(points) if p.z > chin_z]
    if not head:
        return set(), {}
    # 얼굴이 향하는 쪽 = 머리 정중앙에서 가장 멀리 나온 방향(코끝).
    centre_y = sum(p.y for _, p in head) / len(head)
    front = -1.0 if min(p.y for _, p in head) - centre_y < centre_y - max(p.y for _, p in head) else 1.0
    nose = max(head, key=lambda ip: ip[1].y * front)[1]
    chin = min(head, key=lambda ip: ip[1].z)[1]
    span = nose.z - chin.z
    if span <= 0:
        return set(), {}
    z1 = chin.z + span * high
    picked = {i for i, p in head if p.z < z1}
    info = {"chin_z": round(chin.z, 4), "nose_z": round(nose.z, 4),
            "band": [round(chin.z, 4), round(z1, 4)], "vertices": len(picked)}
    return picked, info


def uv_mask(obj, picked: set[int], width: int, height: int) -> np.ndarray:
    """Rasterise the UV triangles whose corners are all in `picked`."""
    mesh = obj.data
    layer = mesh.uv_layers.active
    mask = np.zeros((height, width), dtype=bool)
    if layer is None:
        return mask
    uvs = layer.data
    for poly in mesh.polygons:
        loops = list(poly.loop_indices)
        # 면 하나라도 걸치면 칠한다 — 정점이 전부 들어오는 면만 쓰면 입술 가장자리가 남는다.
        if not any(mesh.loops[l].vertex_index in picked for l in loops):
            continue
        pts = np.array([[uvs[l].uv[0] * width, uvs[l].uv[1] * height] for l in loops])
        x0, y0 = np.floor(pts.min(axis=0)).astype(int)
        x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, width), min(y1, height)
        if x1 <= x0 or y1 <= y0:
            continue
        # 폴리곤 하나가 차지하는 칸은 작아서 경계 상자로 칠해도 충분하다.
        mask[y0:y1, x0:x1] = True
    return mask


def erase(image, mask: np.ndarray, args) -> dict:
    width, height = image.size
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    pixels = buffer.reshape(height, width, 4)
    if not mask.any():
        return {"painted": 0, "mask": 0}
    red = pixels[..., 0] - pixels[..., 1]
    value = pixels[..., :3].mean(axis=-1)
    skin_red = float(np.median(red[mask]))
    skin_value = float(np.median(value[mask]))
    # 고정 여유값은 모델마다 안 맞는다(어떤 모델은 입술이 덜 붉어 하나도 안 걸리고,
    # 어떤 모델은 얼굴 음영까지 걸린다). 그 모델에서 가장 붉은 쪽과 살빛의 중간을
    # 문턱으로 삼으면 대비가 약한 입술도, 진한 입술도 같이 잡힌다.
    peak = float(np.percentile(red[mask], 99.99))
    rule = "adaptive"
    threshold = skin_red + max(args.redness, (peak - skin_red) * 0.5)
    paint = mask & (red > threshold)
    if not paint.any():
        rule = "fallback"
        paint = mask & (red > skin_red + args.fallback_redness) & (value < skin_value - args.fallback_darkness)
    skin = np.median(pixels[mask & ~paint][:, :3], axis=0)
    if not paint.any():
        return {"painted": 0, "mask": int(mask.sum()), "skin_redness": round(skin_red, 4),
                "max_redness": round(float(red[mask].max()), 4)}
    # 입술을 덮은 뒤 가장자리에 남는 옅은 테두리까지 같이 지운다.
    grown = paint.copy()
    for shift in (1, 2, 3):
        grown[shift:, :] |= paint[:-shift, :]
        grown[:-shift, :] |= paint[shift:, :]
        grown[:, shift:] |= paint[:, :-shift]
        grown[:, :-shift] |= paint[:, shift:]
    grown &= mask
    pixels[grown, :3] = skin
    image.pixels.foreach_set(pixels.reshape(-1))
    image.update()
    # 고친 화소는 blend 에 저장했다 다시 열면 원본 파일에서 되읽혀 사라진다.
    # 지금 버퍼를 다시 packed 파일로 굽는다.
    image.pack()
    return {"painted": int(grown.sum()), "mask": int(mask.sum()), "rule": rule,
            "skin_redness": round(skin_red, 4), "threshold": round(float(threshold), 4),
            "peak_redness": round(peak, 4),
            "color": [round(float(c), 4) for c in skin]}


def main() -> None:
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.expanduser().resolve()))
    report = {}
    for label in args.labels:
        rig, obj = head_mesh(label)
        picked, info = mouth_vertices(obj, rig, args.high)
        entry = dict(info)
        material = obj.material_slots[0].material if obj.material_slots else None
        image = None
        if material and material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    links = [l for l in material.node_tree.links
                             if l.from_node is node and "Base Color" in l.to_socket.name]
                    if links or image is None:
                        image = node.image
                    if links:
                        break
        if picked and image is not None:
            entry["image"] = image.name
            entry.update(erase(image, uv_mask(obj, picked, *image.size), args))
        report[label] = entry
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out_blend.expanduser().resolve()))
    if args.report:
        args.report.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("MESHY_ERASE_MOUTH_OK", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
