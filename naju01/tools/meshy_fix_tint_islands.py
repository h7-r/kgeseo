# 살/상의/하의 표식(_TINT)에 섞여 있는 **섬**을 지운다.
#
#   Blender --background --factory-startup --python naju01/tools/meshy_fix_tint_islands.py -- \
#     --glb public/models/meshy-both-female.glb --out public/models/meshy-both-female.glb
#
# [무엇이 문제였나]
#   여성 기본 착장의 **등 허리께 두 군데**가 상의인데 '하의'로 표식돼 있었다. 셰이더는 표식대로
#   하의 색을 곱하므로 셔츠에 다른 색 얼룩 두 개가 생긴다. 하의 색을 상의와 다르게 고르면
#   그 두 군데만 엉뚱한 색으로 물든다(뚫려 보인다는 말이 이것이다 — 구멍은 아니다).
#
# [어떻게]
#   표식은 **넓은 덩어리**여야 한다. 같은 표식끼리 모서리로 이어 덩어리를 찾고, 터무니없이
#   작은 덩어리는 둘레의 이웃 표식으로 바꾼다.
#   ※ 살 표식은 원래 덩어리가 여럿이다 — 머리·목은 소매·바지에 막혀 팔·다리와 끊긴다.
#     그래서 '작다'는 기준은 절대 개수와 그 표식 전체 대비 비율을 **둘 다** 본다.
#   ※ 목선 눈금(1.0~2.0 사이 값)은 반올림해서 덩어리만 나누고, **값은 섬에만 쓴다.**
#     그래서 meshy_round_collar.py 가 심어 둔 눈금이 뭉개지지 않는다.
#   ※ ★ 먼저 **자리로 용접**해야 한다. GLB 는 UV·법선 이음매마다 정점을 쪼개 두므로,
#     그대로 모서리를 타면 UV 조각 하나하나가 따로 노는 덩어리가 된다(실측 — 그냥 돌렸더니
#     덩어리가 수백 개로 쪼개져 정점 11,595 개를 엉뚱하게 바꿨다).
import argparse
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--jpeg", type=int, default=85)
# 이 개수보다 작고, 그 표식 전체의 이 비율보다 작으면 섬으로 본다.
parser.add_argument("--max-verts", type=int, default=400)
parser.add_argument("--max-share", type=float, default=0.10)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")
me = body.data
attr = me.attributes.get("_TINT") or me.attributes.get("_tint")
if attr is None:
    print("ISLE_SKIP no _TINT")
    sys.exit(0)

N = len(me.vertices)
values = np.array([attr.data[i].value for i in range(N)], dtype=np.float32)
# 1 = 살, 2 = 상의, 3 = 하의. 목선 눈금은 반올림해 어느 쪽인지만 본다.
category = np.where(values < 1.5, 1, np.where(values < 2.5, 2, 3)).astype(np.int8)
category[values < 0.5] = 0  # 표식 없음 — 건드리지 않는다

# ── 자리로 용접 ─────────────────────────────────────────────
positions = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
keys = np.round(positions / 1e-5).astype(np.int64)
_, first_idx, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
inverse = inverse.ravel()
M = len(first_idx)
print(f"ISLE_WELD 정점 {N} → 용접 {M}")

# 용접된 정점의 갈래 — 같은 자리의 쪼개진 정점은 표식이 같다(한 덩어리에서 나왔다).
category_w = np.zeros(M, dtype=np.int8)
category_w[inverse] = category

edge_pairs = np.array([list(e.vertices) for e in me.edges], dtype=np.int64)
edge_pairs = inverse[edge_pairs]
A = np.r_[edge_pairs[:, 0], edge_pairs[:, 1]]
B = np.r_[edge_pairs[:, 1], edge_pairs[:, 0]]
valid = A != B
A, B = A[valid], B[valid]
order = np.argsort(A, kind="stable")
a_sorted, b_sorted = A[order], B[order]
starts = np.searchsorted(a_sorted, np.arange(M))
ends = np.searchsorted(a_sorted, np.arange(M), side="right")


def find_clusters(member):
    """속함[i] 가 True 인 (용접된) 정점들을 모서리로 이어 덩어리 번호를 매긴다."""
    labels = np.full(M, -1, dtype=np.int64)
    next_label = 0
    for seed in np.where(member)[0]:
        if labels[seed] >= 0:
            continue
        stack = [seed]
        labels[seed] = next_label
        while stack:
            v = stack.pop()
            for k in range(starts[v], ends[v]):
                u = b_sorted[k]
                if member[u] and labels[u] < 0:
                    labels[u] = next_label
                    stack.append(u)
        next_label += 1
    return labels, next_label


changed = 0
for c in (1, 2, 3):
    member = category_w == c
    total = int(member.sum())
    if total < 50:
        continue
    labels, count = find_clusters(member)
    sizes = np.bincount(labels[member], minlength=count)
    for g in range(count):
        n = int(sizes[g])
        if n == 0 or n > args.max_verts or n > total * args.max_share:
            continue
        island = member & (labels == g)
        # 둘레 이웃 중 가장 흔한 표식으로 바꾼다.
        rim = []
        for v in np.where(island)[0]:
            for k in range(starts[v], ends[v]):
                u = b_sorted[k]
                if not island[u] and category_w[u] > 0:
                    rim.append(category_w[u])
        if not rim:
            continue
        new_value = int(np.bincount(np.array(rim, dtype=np.int64)).argmax())
        if new_value == c:
            continue
        # 용접 전 정점 전부에 쓴다(쪼개진 쌍둥이가 안 바뀌면 그 자리에 솔기가 남는다).
        for v in np.where(island[inverse])[0]:
            attr.data[int(v)].value = float(new_value)
        changed += n
        print(f"ISLE_FIX 표식{c}→{새값} 정점={n}")

print(f"ISLE_OK 바꾼정점={바꾼수}")
if changed == 0:
    # 바뀐 게 없으면 내보내지 않는다. 다시 내보내면 텍스처가 JPEG 로 한 번 더 구워져
    # 화질만 떨어지고 10~15MB 짜리 파일이 괜히 커밋에 올라간다.
    print("ISLE_NOCHANGE")
    sys.exit(0)

# ※ 내보내기 옵션은 meshy_mark_tint.py 와 같아야 한다(export_extras 를 빠뜨리면 파츠 표식이 날아간다).
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
