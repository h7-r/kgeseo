# 티셔츠 목선을 둥근 라운드넥으로 다시 그린다 — 목둘레가 찢어진 것처럼 보이던 것을 고친다.
#
#   Blender --background --factory-startup --python naju01/도구/meshy_round_collar.py -- \
#     --glb public/models/meshy-both-female.glb --out public/models/meshy-both-female.glb
#
# [무엇이 찢어져 보였나]
#   몸과 옷이 한 메시라 목선은 **텍스처의 색 경계**다. 그 경계가 삼각형 배치를 따라 들쭉날쭉해서,
#   음영을 계단으로 만드는 툰 재질에서 살빛 쐐기가 흰 셔츠 위로 삐죽삐죽 튀어나와 보였다.
#   정점 표식(_TINT)의 경계도 같이 들쭉날쭉했다.
#
# [예전 방식과 무엇이 다른가]
#   예전에는 **텍스처 색**(채도)으로 살/옷을 가르고 각도 구간마다 '옷 비율 50% 높이'를 찾았다.
#   그런데 가르려는 그 색 경계가 바로 망가진 대상이라, 가슴팍 그늘이 살로 잡히면서 목선이
#   통째로 내려앉아 턱받이처럼 넓어졌다(실측 — 선z 가 1.046~1.079 로 잡혀 더 나빠졌다).
#
#   지금은 **정점 표식 _TINT 를 기준**으로 삼는다. 표식은 meshy_mark_tint.py 가 구워 둔 것이라
#   큰 덩어리(목=살 1, 셔츠=상의 2)는 정확하고, 망가진 곳은 경계 한 줄뿐이다.
#     ① 살↔옷이 갈리는 **모서리의 중점**을 모아 목선 점구름을 만든다.
#     ② 거기에 **구(球)를 최소제곱으로 맞춘다.** 구와 몸이 만나는 선은 정의상 매끄러운 닫힌
#        곡선이고, 어깨 위로 자연스럽게 흘러내려 라운드넥 모양이 된다(원기둥이나 높이 자르기로는
#        어깨에서 선이 꺾인다).
#     ③ 구 표면에서 ±2cm 껍질 안에서만 텍스처를 다시 칠하고 _TINT 를 다시 매긴다.
#        껍질 밖은 손대지 않으므로 얼굴·가슴팍 음영은 그대로다.
#
#   텍스처와 표식이 **같은 곡선**을 쓰는 것이 핵심이다. 둘이 어긋나면 한쪽을 고쳐도 톱니가 남는다.
import argparse
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--jpeg", type=int, default=85)
# 목선을 이만큼(m) 내리거나(+) 올린다(−). 구의 반지름을 키우고 줄이는 것이라 둘레가 함께 움직인다.
parser.add_argument("--drop", type=float, default=0.0)
# 텍스처를 다시 칠할 껍질 두께(m). 이보다 멀면 원래 색을 그대로 둔다.
parser.add_argument("--shell", type=float, default=0.020)
# 경계를 이 폭(m)으로 섞는다. 텍셀 단위로 딱 자르면 확대했을 때 톱니가 보인다.
parser.add_argument("--feather", type=float, default=0.005)
# 목선 고리를 모을 때 목 축에서 가로로 이만큼 안쪽만 본다. 넓히면 어깨·소매 둘레가 섞인다.
parser.add_argument("--ring", type=float, default=0.11)
# 목뼈에서 아래로 이만큼까지만 본다. 상의만 입은 착장(top)은 **배가 드러나** 밑단에도 살↔옷
#   경계가 있는데, 넉넉히 잡으면 그 고리까지 한 구에 맞추려다 엉뚱한 구가 나온다
#   (남성 top 에서 R 이 10~11cm 로 부풀어 가슴에 흰 얼룩을 칠했다).
parser.add_argument("--below", type=float, default=0.10)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")


def 기본색이미지(material):
    if not material or not material.use_nodes:
        return None
    bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        link = next((l for l in bsdf.inputs["Base Color"].links), None)
        if link and link.from_node.type == "TEX_IMAGE":
            return link.from_node.image
    return next((n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


image = next((기본색이미지(m) for m in body.data.materials if 기본색이미지(m)), None)
if image is None:
    print("COLLAR_SKIP no image")
    sys.exit(0)

me = body.data
attr = me.attributes.get("_TINT") or me.attributes.get("_tint")
if attr is None:
    print("COLLAR_SKIP no _TINT")
    sys.exit(0)

uv = me.uv_layers.active.data
M = body.matrix_world
w, h = image.size
px = np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)

pos = np.array([list(M @ v.co) for v in me.vertices], dtype=np.float32)
표식 = np.array([attr.data[i].value for i in range(len(me.vertices))], dtype=np.float32)

rig = body.parent
neck = rig.matrix_world @ rig.data.bones["neck_01"].head_local
목 = np.array([neck.x, neck.y, neck.z], dtype=np.float32)

# ── ① 살↔옷 모서리의 중점 모으기 ────────────────────────────
# 목선은 **목 축을 둘러싸는 고리**다. 목뼈에서 18cm 안이면서 목 축에서 가로로 11cm 안쪽만 본다.
#   가로 제한이 없으면 소매 둘레(겨드랑이)의 살↔옷 경계까지 딸려 와 구가 통째로 커진다
#   (남성 top 에서 R 이 11cm 로 부풀어 등판 셔츠까지 구 안에 들어갔다).
살 = 표식 < 1.5
옷 = (표식 >= 1.5) & (표식 < 2.5)  # 2 = 상의. 3(하의)은 목선과 무관하다.
가로 = np.hypot(pos[:, 0] - 목[0], pos[:, 1] - 목[1])
가까움 = (np.linalg.norm(pos - 목, axis=1) < 0.18) & (가로 < args.ring) \
    & (pos[:, 2] > 목[2] - args.below)
점 = []
for e in me.edges:
    a, b = e.vertices
    if 살[a] == 살[b] or not (가까움[a] and 가까움[b]):
        continue
    if not ((옷[a] or 옷[b]) and (살[a] or 살[b])):
        continue
    # 표식이 1~2 사이 눈금을 갖고 있으면(이전에 한 번 고친 모델) 1.5 지점을 정확히 집는다.
    t = (1.5 - 표식[a]) / (표식[b] - 표식[a]) if abs(표식[b] - 표식[a]) > 1e-6 else 0.5
    t = float(np.clip(t, 0.0, 1.0))
    점.append(pos[a] + (pos[b] - pos[a]) * t)
점 = np.array(점, dtype=np.float64)
if len(점) < 60:
    print(f"COLLAR_SKIP edges={len(점)}")
    sys.exit(0)

# ── ② 구 맞추기 ─────────────────────────────────────────────
# |p−C|² = R²  →  2C·p + (R²−|C|²) = |p|²  로 펴면 미지수 넷짜리 선형 문제다.
# 들쭉날쭉한 점이 섞여 있으니 두 번 다시 맞추며 멀리 튄 점을 버린다(IRLS).
def 구맞추기(P):
    A = np.c_[2 * P, np.ones(len(P))]
    b = (P ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    C = sol[:3]
    R2 = sol[3] + (C ** 2).sum()
    return C, float(np.sqrt(max(R2, 1e-9)))


쓸점 = 점
for _ in range(3):
    C, R = 구맞추기(쓸점)
    d = np.abs(np.linalg.norm(쓸점 - C, axis=1) - R)
    남김 = d < max(0.006, float(np.percentile(d, 80)))
    if 남김.sum() < 60:
        break
    쓸점 = 쓸점[남김]
C, R = 구맞추기(쓸점)
R += args.drop
퍼짐 = float(np.std(np.linalg.norm(쓸점 - C, axis=1) - R))
print(f"COLLAR_FIT 점={len(점)}→{len(쓸점)} R={R:.4f} 중심z={C[2]:.3f} 퍼짐={퍼짐*1000:.1f}mm")
if not (0.02 < R < 0.25):
    print("COLLAR_SKIP radius")
    sys.exit(0)

# ── ③ 껍질 안만 다시 칠한다 ─────────────────────────────────
# 구에서 잰 부호 있는 거리. 음수 = 구 안(목·머리 쪽) = 살, 양수 = 구 밖(셔츠).
#   ※ 머리는 구에서 멀리 밖에 있어 '옷'으로 잡히지만, 껍질(±shell) 밖이라 손대지 않는다.
def 거리(P):
    return np.linalg.norm(P - C[None, :], axis=-1) - R


# ★ 구 표면은 목선에서 한 번, **목 기둥이 구를 빠져나가는 곳**에서 한 번, 두 군데서 몸과 만난다.
#   목이 구 반지름보다 가늘어서 생기는 일이다. 그냥 두면 목 한가운데에 흰 띠가 둘러진다(실제로 그랬다).
#   그래서 ①에서 모은 **진짜 목선 점들 가까이**만 고친다 — 목 기둥 쪽 교차선은 거기서 한참 떨어져 있다.
곁 = 0.025
# 대표색을 뽑는 띠는 더 넉넉히 본다. 목 기둥은 구 안쪽으로 최대 (R − 목반지름) 만큼 들어가 있어서
#   2.5cm 로 재면 **살색을 한 텍셀도 못 찾는다**(meshy-top-female 에서 실제로 0 개가 나왔다).
곁색 = 0.060


def 목선근처(P, 곁=곁):
    쪽 = P.reshape(-1, 1, 3) - 쓸점.reshape(1, -1, 3)
    return (np.einsum("ijk,ijk->ij", 쪽, 쪽).min(axis=1) <= 곁 * 곁).reshape(P.shape[:-1])


v거리미리 = 거리(pos)

# 텍셀마다 3D 좌표를 구한다 — 목 둘레 면만 래스터라이즈한다.
tex = np.full((h, w, 3), np.nan, dtype=np.float32)
for poly in me.polygons:
    p = pos[list(poly.vertices)]
    if np.linalg.norm(p - 목, axis=1).min() > 0.22:
        continue
    pts = [(uv[li].uv.x % 1.0 * w, uv[li].uv.y % 1.0 * h) for li in poly.loop_indices]
    for k in range(1, len(pts) - 1):
        tri = [pts[0], pts[k], pts[k + 1]]
        v3 = [p[0], p[k], p[k + 1]]
        x0, x1 = max(0, int(min(q[0] for q in tri)) - 1), min(w - 1, int(max(q[0] for q in tri)) + 1)
        y0, y1 = max(0, int(min(q[1] for q in tri)) - 1), min(h - 1, int(max(q[1] for q in tri)) + 1)
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = tri
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        l1 = ((bx - X) * (cy - Y) - (cx - X) * (by - Y)) / det
        l2 = ((cx - X) * (ay - Y) - (ax - X) * (cy - Y)) / det
        l3 = 1 - l1 - l2
        mask = (l1 >= -0.35) & (l2 >= -0.35) & (l3 >= -0.35)  # 이음새 텍셀까지 덮는다
        for c in range(3):
            W = l1 * v3[0][c] + l2 * v3[1][c] + l3 * v3[2][c]
            sub = tex[y0:y1 + 1, x0:x1 + 1, c]
            sub[mask] = W[mask]

있음 = ~np.isnan(tex[..., 2])
if not 있음.any():
    print("COLLAR_SKIP no texels")
    sys.exit(0)

s = np.full((h, w), np.nan, dtype=np.float32)
s[있음] = 거리(tex[있음])
# ★ 맞춘 구가 **살과 옷을 실제로 갈라 주는지** 확인한다.
#   목선이 앞뒤로 높이가 크게 다른 옷(남성 top 이 그랬다)은 점들이 반지름 11cm 짜리 큰 구에
#   잘 얹히지만, 그 구는 **등판 셔츠까지 안쪽에 넣어 버린다.** 그대로 칠하면 가슴에 흰 얼룩이
#   생긴다(실제로 그렇게 나왔다). 맞지 않으면 손대지 않고 넘어간다.
# 검사는 **실제로 칠하는 범위**(곁)에서만 한다. 넓게 보면 목선보다 위쪽 목 기둥(맨살인데 구 밖)이
#   섞여 들어가 멀쩡한 구도 떨어뜨린다(남성 both 가 그랬다 — 바깥옷 0.62).
곁검사 = (np.abs(v거리미리) > 0.004) & (np.abs(v거리미리) < 0.025) & (살 | 옷) & 목선근처(pos)
안쪽 = 곁검사 & (v거리미리 < 0)
바깥 = 곁검사 & (v거리미리 > 0)
if 안쪽.sum() < 30 or 바깥.sum() < 30:
    print(f"COLLAR_SKIP sides in={int(안쪽.sum())} out={int(바깥.sum())}")
    sys.exit(0)
맞음 = (살[안쪽].mean() + 옷[바깥].mean()) / 2
print(f"COLLAR_CHECK 안쪽살={살[안쪽].mean():.2f} 바깥옷={옷[바깥].mean():.2f}")
if 맞음 < 0.80:
    print("COLLAR_SKIP sphere does not separate skin from cloth")
    sys.exit(0)

껍질 = 있음 & (np.abs(s) <= args.shell)
껍질[껍질] = 목선근처(tex[껍질])
if 껍질.sum() < 200:
    print(f"COLLAR_SKIP shell={int(껍질.sum())}")
    sys.exit(0)

# 대표색 — 껍질 **바로 바깥**의 살(안쪽)과 옷(바깥쪽) 중앙값. 껍질 안은 이미 망가진 색이라 쓰면 안 된다.
rgb = px[..., :3]
살띠 = 있음 & (s < -args.shell) & (s > -args.shell - 0.025)
옷띠 = 있음 & (s > args.shell) & (s < args.shell + 0.025)
살띠[살띠] = 목선근처(tex[살띠], 곁색)
옷띠[옷띠] = 목선근처(tex[옷띠], 곁색)
if 살띠.sum() < 50 or 옷띠.sum() < 50:
    print(f"COLLAR_SKIP bands skin={int(살띠.sum())} cloth={int(옷띠.sum())}")
    sys.exit(0)
살색 = np.median(rgb[살띠], axis=0)
옷색 = np.median(rgb[옷띠], axis=0)

높낮이 = np.clip(s / args.feather * 0.5 + 0.5, 0.0, 1.0)  # 0 = 살(구 안), 1 = 옷(구 밖)
섞기 = 높낮이 * 높낮이 * (3 - 2 * 높낮이)
새색 = 살색[None, None, :] + (옷색 - 살색)[None, None, :] * 섞기[..., None]
px[껍질, :3] = 새색[껍질]
print(f"COLLAR_BLEND 텍셀={int(껍질.sum())} 살={살색.round(3).tolist()} 옷={옷색.round(3).tolist()}")

# ── ④ 정점 표식도 같은 구로 다시 매긴다 ─────────────────────
# 셰이더(naju01/src/툰재질.js)는 삼각형 안에서 보간한 _tint 의 **1.5 등고선**으로 살/옷을 가른다.
# 여기서 1.5 를 구 표면에 정확히 맞춰 두면 그 등고선이 텍스처 경계와 겹친다.
폭 = 0.030
v거리 = v거리미리
고칠v = (np.abs(v거리) <= 폭 / 2) & 가까움 & (살 | 옷)
고칠v[고칠v] = 목선근처(pos[고칠v])
새표식 = 1.5 + np.clip(v거리 / 폭, -0.5, 0.5)
바뀜 = 0
for i in np.where(고칠v)[0]:
    if abs(표식[i] - 새표식[i]) > 1e-3:
        attr.data[int(i)].value = float(새표식[i])
        바뀜 += 1
print(f"COLLAR_TINT 고침={바뀜}/{int(고칠v.sum())}")

image.pixels = px.reshape(-1).tolist()
image.file_format = "JPEG"
bpy.context.scene.render.image_settings.quality = args.jpeg
print("COLLAR_OK")

# ※ 내보내기 옵션은 meshy_mark_tint.py 와 같아야 한다. export_extras 를 빠뜨리면 파츠 표식
#   (slot·variant)이 통째로 날아가 헤어가 전부 보이고 신발 판정이 죽는다(실제로 그랬다).
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
