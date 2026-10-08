# 상의 밑단·허리 주름의 법선 능선을 눕혀 등 쪽에 흰 띠가 둘러진 것처럼 보이지 않게 한다.
#
#   Blender --background --factory-startup --python naju01/tools/meshy_soften_hem.py -- \
#     --glb public/models/meshy-both-female.glb --out public/models/meshy-both-female.glb
#
# 밑단 접힘이 폭 1cm 의 가파른 법선 능선이라 툰 재질에서 통째로 제일 밝은 계단으로 튄다.
# 정점 자리는 그대로 두고 법선만 눕혀 실루엣은 안 바뀌고 툰 계단만 주변과 이어진다.
#   1) 상의(_TINT = 2) 정점만 고른다 — 손가락·얼굴 같은 다른 각진 곳은 건드리지 않는다.
#   2) 상의 안에서만 여러 겹 넓게 평균낸 「완만한 법선」을 구한다(1링 차이로는 이 접힘이 안 잡힌다).
#   3) 제 법선이 완만한 법선과 벌어진 만큼만 그쪽으로 눕힌다.
# 고른 정점에 붙은 루프만 바꿔 다른 곳의 split normal 은 그대로 남긴다.
import argparse
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--jpeg", type=int, default=85)
# 완만한 법선을 만들 때 몇 겹까지 번지게 할지. 접힘 폭(약 1cm)보다 넉넉해야 한다.
parser.add_argument("--spread", type=int, default=14)
# 이 각도(도)까지는 그대로 두고, --to 에서 완전히 눕힌다.
parser.add_argument("--from", dest="angle_from", type=float, default=8.0)
parser.add_argument("--to", dest="angle_to", type=float, default=26.0)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")
me = body.data

attr = me.attributes.get("_TINT") or me.attributes.get("_tint")
if attr is None:
    print("HEM_SKIP no _TINT")
    sys.exit(0)
tint = np.array([attr.data[i].value for i in range(len(me.vertices))], dtype=np.float32)
top = (tint >= 1.5) & (tint < 2.5)
if top.sum() < 200:
    print(f"HEM_SKIP top={int(top.sum())}")
    sys.exit(0)

# 지금 쓰이는 코너 법선(Meshy 가 구워 온 것)을 그대로 읽어 둔다.
loop_normals = np.array([v.vector[:] for v in me.corner_normals], dtype=np.float64)
loop_verts = np.array([l.vertex_index for l in me.loops], dtype=np.int64)

N = len(me.vertices)
vert_normals = np.zeros((N, 3), dtype=np.float64)
np.add.at(vert_normals, loop_verts, loop_normals)
lengths = np.linalg.norm(vert_normals, axis=1, keepdims=True)
vert_normals = np.divide(vert_normals, np.maximum(lengths, 1e-9))

# 1링 이웃 — 모서리로 만든다.
edge_pairs = np.array([list(e.vertices) for e in me.edges], dtype=np.int64)
A = np.r_[edge_pairs[:, 0], edge_pairs[:, 1]]
B = np.r_[edge_pairs[:, 1], edge_pairs[:, 0]]


def neighbour_mean(n, within=None):
    use = np.ones(len(A), dtype=bool) if within is None else (within[A] & within[B])
    total = np.zeros_like(n)
    np.add.at(total, A[use], n[B[use]])
    count = np.zeros(N)
    np.add.at(count, A[use], 1.0)
    total += n  # 제 법선도 한 표 — 이웃이 없는 섬이 0 이 되지 않는다
    count += 1.0
    total /= np.maximum(count, 1.0)[:, None]
    norms = np.linalg.norm(total, axis=1, keepdims=True)
    return np.divide(total, np.maximum(norms, 1e-9))


# ── 완만한 법선 ────────────────────────────────────────────
# 상의 안에서만 번지게 한다. 맨살·하의 법선이 섞이면 밑단이 몸쪽으로 말려 들어간다.
smooth = vert_normals.copy()
for _ in range(args.spread):
    smooth = neighbour_mean(smooth, top)
smooth[~top] = vert_normals[~top]

deviation = np.degrees(np.arccos(np.clip((vert_normals * smooth).sum(axis=1), -1.0, 1.0)))
weight = np.clip((deviation - args.angle_from) / max(args.angle_to - args.angle_from, 1e-6), 0.0, 1.0)
weight[~top] = 0.0
new_normals = vert_normals + (smooth - vert_normals) * weight[:, None]
norms = np.linalg.norm(new_normals, axis=1, keepdims=True)
new_normals = np.divide(new_normals, np.maximum(norms, 1e-9))

picked = weight > 0.01
moved = np.degrees(np.arccos(np.clip((vert_normals[picked] * new_normals[picked]).sum(axis=1), -1.0, 1.0)))
print(f"HEM_PICK 상의={int(top.sum())} 눕힘={int(picked.sum())} 최대벌어짐={deviation[top].max():.1f}도")
print(f"HEM_SOFT 평균{moved.mean():.1f}도 최대{moved.max():.1f}도 움직임")
if picked.sum() < 20:
    print("HEM_SKIP nothing to soften")
    sys.exit(0)

# 목록을 통째로 넘기되 고른 정점의 루프만 바꾸고 나머지는 읽은 값 그대로 둔다.
loops_to_change = picked[loop_verts]
loop_normals[loops_to_change] = new_normals[loop_verts[loops_to_change]]
me.normals_split_custom_set([tuple(v) for v in loop_normals])
print(f"HEM_OK 루프={int(loops_to_change.sum())}/{len(loop_normals)}")

# 내보내기 옵션은 meshy_mark_tint.py 와 같아야 한다(export_extras 를 빠뜨리면 파츠 표식이 날아간다).
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
