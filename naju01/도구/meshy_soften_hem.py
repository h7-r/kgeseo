# 상의 밑단·허리 주름의 **법선 능선**을 눕힌다 — 등 쪽에 흰 띠가 둘러진 것처럼 보이던 것을 고친다.
#
#   Blender --background --factory-startup --python naju01/도구/meshy_soften_hem.py -- \
#     --glb public/models/meshy-both-female.glb --out public/models/meshy-both-female.glb
#
# [무엇이 하얗게 보였나]
#   텍스처 탓이 아니다. 조명을 뺀 그림(MeshBasicMaterial)에서는 셔츠 색이 **완전히 균일**하다.
#   Meshy 가 만든 밑단·허리 접힘이 폭 1cm 짜리 **날카로운 법선 능선**이라, 거기만 빛을 정면으로
#   받는다. 툰 재질은 명암을 계단으로 끊으므로 그 띠가 통째로 제일 밝은 계단으로 튀어
#   **옷 바깥으로 흰 띠가 삐져나온 것처럼** 보였다(법선 그림에서 초록 능선 두 줄로 확인).
#
# [어떻게]
#   모양(정점 자리)은 그대로 두고 **법선만** 누인다. 실루엣과 옷 두께는 하나도 안 변하고,
#   툰 계단만 주변 셔츠와 이어진다.
#     ① 상의(_TINT = 2) 정점만 고른다 — 손가락·얼굴 같은 다른 각진 곳은 건드리지 않는다.
#     ② 상의 안에서만 법선을 **여러 겹 넓게** 평균낸 「완만한 법선」을 따로 구한다.
#     ③ 제 법선이 그 완만한 법선과 많이 벌어진 만큼만 그쪽으로 눕힌다.
#        접힘은 많이 벌어지므로 크게 눕고, 평평한 등판은 거의 그대로다.
#   ※ 1링 이웃과의 차이(날카로운 능선)로 고르면 안 된다 — 이 접힘은 **폭 1cm 에 걸친 완만한
#     면**이라 1링으로는 거의 안 잡힌다(실측: 상의 정점 11,612 중 298 개만 잡혀 띠가 그대로 남았다).
#   루프(코너) 법선 목록을 통째로 다시 쓰되 **고른 정점에 붙은 루프만** 바꾼다. 그래야 다른
#   곳의 날카로운 경계(split normal)가 그대로 남는다.
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
parser.add_argument("--from", dest="부터", type=float, default=8.0)
parser.add_argument("--to", dest="까지", type=float, default=26.0)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")
me = body.data

attr = me.attributes.get("_TINT") or me.attributes.get("_tint")
if attr is None:
    print("HEM_SKIP no _TINT")
    sys.exit(0)
표식 = np.array([attr.data[i].value for i in range(len(me.vertices))], dtype=np.float32)
상의 = (표식 >= 1.5) & (표식 < 2.5)
if 상의.sum() < 200:
    print(f"HEM_SKIP top={int(상의.sum())}")
    sys.exit(0)

# 지금 쓰이는 코너 법선(Meshy 가 구워 온 것)을 그대로 읽어 둔다.
루프법선 = np.array([v.vector[:] for v in me.corner_normals], dtype=np.float64)
루프정점 = np.array([l.vertex_index for l in me.loops], dtype=np.int64)

N = len(me.vertices)
정점법선 = np.zeros((N, 3), dtype=np.float64)
np.add.at(정점법선, 루프정점, 루프법선)
길이 = np.linalg.norm(정점법선, axis=1, keepdims=True)
정점법선 = np.divide(정점법선, np.maximum(길이, 1e-9))

# 1링 이웃 — 모서리로 만든다.
모서리 = np.array([list(e.vertices) for e in me.edges], dtype=np.int64)
A = np.r_[모서리[:, 0], 모서리[:, 1]]
B = np.r_[모서리[:, 1], 모서리[:, 0]]


def 이웃평균(n, 안에서=None):
    쓸 = np.ones(len(A), dtype=bool) if 안에서 is None else (안에서[A] & 안에서[B])
    합 = np.zeros_like(n)
    np.add.at(합, A[쓸], n[B[쓸]])
    수 = np.zeros(N)
    np.add.at(수, A[쓸], 1.0)
    합 += n  # 제 법선도 한 표 — 이웃이 없는 섬이 0 이 되지 않는다
    수 += 1.0
    합 /= np.maximum(수, 1.0)[:, None]
    길 = np.linalg.norm(합, axis=1, keepdims=True)
    return np.divide(합, np.maximum(길, 1e-9))


# ── 완만한 법선 ────────────────────────────────────────────
# 상의 안에서만 번지게 한다. 맨살·하의 법선이 섞이면 밑단이 몸쪽으로 말려 들어간다.
넓평균 = 정점법선.copy()
for _ in range(args.spread):
    넓평균 = 이웃평균(넓평균, 상의)
넓평균[~상의] = 정점법선[~상의]

벌어짐 = np.degrees(np.arccos(np.clip((정점법선 * 넓평균).sum(axis=1), -1.0, 1.0)))
무게 = np.clip((벌어짐 - args.부터) / max(args.까지 - args.부터, 1e-6), 0.0, 1.0)
무게[~상의] = 0.0
새법선 = 정점법선 + (넓평균 - 정점법선) * 무게[:, None]
길 = np.linalg.norm(새법선, axis=1, keepdims=True)
새법선 = np.divide(새법선, np.maximum(길, 1e-9))

고를것 = 무게 > 0.01
움직임 = np.degrees(np.arccos(np.clip((정점법선[고를것] * 새법선[고를것]).sum(axis=1), -1.0, 1.0)))
print(f"HEM_PICK 상의={int(상의.sum())} 눕힘={int(고를것.sum())} 최대벌어짐={벌어짐[상의].max():.1f}도")
print(f"HEM_SOFT 평균{움직임.mean():.1f}도 최대{움직임.max():.1f}도 움직임")
if 고를것.sum() < 20:
    print("HEM_SKIP nothing to soften")
    sys.exit(0)

# ★ 고른 정점에 붙은 루프만 갈아 끼운다. 목록을 통째로 넘기되 나머지는 읽은 값 그대로라
#   다른 곳의 split normal 이 뭉개지지 않는다.
바꿀루프 = 고를것[루프정점]
루프법선[바꿀루프] = 새법선[루프정점[바꿀루프]]
me.normals_split_custom_set([tuple(v) for v in 루프법선])
print(f"HEM_OK 루프={int(바꿀루프.sum())}/{len(루프법선)}")

# ※ 내보내기 옵션은 meshy_mark_tint.py 와 같아야 한다(export_extras 를 빠뜨리면 파츠 표식이 날아간다).
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
