# 살/상의/하의 표식(_TINT)에 섞여 있는 **섬**을 지운다.
#
#   Blender --background --factory-startup --python naju01/도구/meshy_fix_tint_islands.py -- \
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
값 = np.array([attr.data[i].value for i in range(N)], dtype=np.float32)
# 1 = 살, 2 = 상의, 3 = 하의. 목선 눈금은 반올림해 어느 쪽인지만 본다.
갈래 = np.where(값 < 1.5, 1, np.where(값 < 2.5, 2, 3)).astype(np.int8)
갈래[값 < 0.5] = 0  # 표식 없음 — 건드리지 않는다

# ── 자리로 용접 ─────────────────────────────────────────────
자리 = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
키 = np.round(자리 / 1e-5).astype(np.int64)
_, 대표, 되돌림 = np.unique(키, axis=0, return_index=True, return_inverse=True)
되돌림 = 되돌림.ravel()
M = len(대표)
print(f"ISLE_WELD 정점 {N} → 용접 {M}")

# 용접된 정점의 갈래 — 같은 자리의 쪼개진 정점은 표식이 같다(한 덩어리에서 나왔다).
갈래w = np.zeros(M, dtype=np.int8)
갈래w[되돌림] = 갈래

모서리 = np.array([list(e.vertices) for e in me.edges], dtype=np.int64)
모서리 = 되돌림[모서리]
A = np.r_[모서리[:, 0], 모서리[:, 1]]
B = np.r_[모서리[:, 1], 모서리[:, 0]]
쓸 = A != B
A, B = A[쓸], B[쓸]
차례 = np.argsort(A, kind="stable")
A정렬, B정렬 = A[차례], B[차례]
시작 = np.searchsorted(A정렬, np.arange(M))
끝 = np.searchsorted(A정렬, np.arange(M), side="right")


def 덩어리찾기(속함):
    """속함[i] 가 True 인 (용접된) 정점들을 모서리로 이어 덩어리 번호를 매긴다."""
    번호 = np.full(M, -1, dtype=np.int64)
    다음 = 0
    for 씨 in np.where(속함)[0]:
        if 번호[씨] >= 0:
            continue
        쌓기 = [씨]
        번호[씨] = 다음
        while 쌓기:
            v = 쌓기.pop()
            for k in range(시작[v], 끝[v]):
                u = B정렬[k]
                if 속함[u] and 번호[u] < 0:
                    번호[u] = 다음
                    쌓기.append(u)
        다음 += 1
    return 번호, 다음


바꾼수 = 0
for c in (1, 2, 3):
    속함 = 갈래w == c
    전체 = int(속함.sum())
    if 전체 < 50:
        continue
    번호, 수 = 덩어리찾기(속함)
    크기 = np.bincount(번호[속함], minlength=수)
    for g in range(수):
        n = int(크기[g])
        if n == 0 or n > args.max_verts or n > 전체 * args.max_share:
            continue
        섬 = 속함 & (번호 == g)
        # 둘레 이웃 중 가장 흔한 표식으로 바꾼다.
        둘레 = []
        for v in np.where(섬)[0]:
            for k in range(시작[v], 끝[v]):
                u = B정렬[k]
                if not 섬[u] and 갈래w[u] > 0:
                    둘레.append(갈래w[u])
        if not 둘레:
            continue
        새값 = int(np.bincount(np.array(둘레, dtype=np.int64)).argmax())
        if 새값 == c:
            continue
        # 용접 전 정점 전부에 쓴다(쪼개진 쌍둥이가 안 바뀌면 그 자리에 솔기가 남는다).
        for v in np.where(섬[되돌림])[0]:
            attr.data[int(v)].value = float(새값)
        바꾼수 += n
        print(f"ISLE_FIX 표식{c}→{새값} 정점={n}")

print(f"ISLE_OK 바꾼정점={바꾼수}")
if 바꾼수 == 0:
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
