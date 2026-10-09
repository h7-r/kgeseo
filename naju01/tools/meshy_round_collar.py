# 티셔츠 목선을 둥근 라운드넥으로 다시 그린다 — 목둘레가 찢어진 것처럼 보이던 것을 고친다.
#
#   Blender --background --factory-startup --python naju01/tools/meshy_round_collar.py -- \
#     --glb public/models/meshy-both-female.glb --out public/models/meshy-both-female.glb
#
# 몸과 옷이 한 메시라 목선은 텍스처의 색 경계인데, 그 경계가 삼각형을 따라 들쭉날쭉해
# 툰 재질에서 살빛 쐐기가 셔츠 위로 튀어나와 보인다. 망가진 색 경계 대신 정점 표식 _TINT
# (큰 덩어리는 정확하다)를 기준으로 삼는다.
#   1) 살↔옷이 갈리는 모서리의 중점을 모아 목선 점구름을 만든다.
#   2) 구를 최소제곱으로 맞추고, 목 축 둘레 각도의 낮은 차수 푸리에 곡선으로 다듬는다.
#   3) 곡선 둘레 껍질 안에서만 텍스처를 다시 칠하고 _TINT 를 다시 매긴다.
# 텍스처와 표식이 같은 곡선을 써야 한다. 둘이 어긋나면 한쪽을 고쳐도 톱니가 남는다.
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
parser.add_argument("--shell", type=float, default=0.026)
# 경계를 이 폭(m)으로 섞는다. 텍셀 단위로 딱 자르면 확대했을 때 톱니가 보인다.
parser.add_argument("--feather", type=float, default=0.005)
# 목선 고리를 모을 때 목 축에서 가로로 이만큼 안쪽만 본다. 넓히면 어깨·소매 둘레가 섞인다.
parser.add_argument("--ring", type=float, default=0.11)
# 목뼈에서 아래로 이만큼까지만 본다. 배가 드러나는 착장은 밑단에도 살↔옷 경계가 있어
#   넉넉히 잡으면 그 고리까지 한 구에 맞추려다 엉뚱한 구가 나온다.
parser.add_argument("--below", type=float, default=0.10)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")


def base_color_image(material):
    if not material or not material.use_nodes:
        return None
    bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        link = next((l for l in bsdf.inputs["Base Color"].links), None)
        if link and link.from_node.type == "TEX_IMAGE":
            return link.from_node.image
    return next((n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


image = next((base_color_image(m) for m in body.data.materials if base_color_image(m)), None)
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
tint = np.array([attr.data[i].value for i in range(len(me.vertices))], dtype=np.float32)

rig = body.parent
neck = rig.matrix_world @ rig.data.bones["neck_01"].head_local
neck_pos = np.array([neck.x, neck.y, neck.z], dtype=np.float32)

# ── 1) 살↔옷 모서리의 중점 모으기 ──
# 목선은 목 축을 둘러싼 고리다. 가로 제한이 없으면 소매 둘레의 경계까지 딸려 와 구가 커진다.
skin = tint < 1.5
cloth = (tint >= 1.5) & (tint < 2.5)  # 2 = 상의. 3(하의)은 목선과 무관하다.
horiz = np.hypot(pos[:, 0] - neck_pos[0], pos[:, 1] - neck_pos[1])
near_neck = (np.linalg.norm(pos - neck_pos, axis=1) < 0.18) & (horiz < args.ring) \
    & (pos[:, 2] > neck_pos[2] - args.below)
points = []
for e in me.edges:
    a, b = e.vertices
    if skin[a] == skin[b] or not (near_neck[a] and near_neck[b]):
        continue
    if not ((cloth[a] or cloth[b]) and (skin[a] or skin[b])):
        continue
    # 표식이 1~2 사이 눈금을 갖고 있으면(이전에 한 번 고친 모델) 1.5 지점을 정확히 집는다.
    t = (1.5 - tint[a]) / (tint[b] - tint[a]) if abs(tint[b] - tint[a]) > 1e-6 else 0.5
    t = float(np.clip(t, 0.0, 1.0))
    points.append(pos[a] + (pos[b] - pos[a]) * t)
points = np.array(points, dtype=np.float64)
if len(points) < 60:
    print(f"COLLAR_SKIP edges={len(points)}")
    sys.exit(0)

# ── 2) 구 맞추기 ──
# |p−C|² = R²  →  2C·p + (R²−|C|²) = |p|²  로 펴면 미지수 넷짜리 선형 문제다.
# 들쭉날쭉한 점이 섞여 있으니 두 번 다시 맞추며 멀리 튄 점을 버린다(IRLS).
def fit_sphere(P):
    A = np.c_[2 * P, np.ones(len(P))]
    b = (P ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    C = sol[:3]
    R2 = sol[3] + (C ** 2).sum()
    return C, float(np.sqrt(max(R2, 1e-9)))


inliers = points
for _ in range(3):
    C, R = fit_sphere(inliers)
    d = np.abs(np.linalg.norm(inliers - C, axis=1) - R)
    keep = d < max(0.006, float(np.percentile(d, 80)))
    if keep.sum() < 60:
        break
    inliers = inliers[keep]
C, R = fit_sphere(inliers)
R += args.drop
spread = float(np.std(np.linalg.norm(inliers - C, axis=1) - R))
print(f"COLLAR_FIT 점={len(points)}→{len(inliers)} R={R:.4f} 중심z={C[2]:.3f} 퍼짐={spread*1000:.1f}mm")
if not (0.02 < R < 0.25):
    print("COLLAR_SKIP radius")
    sys.exit(0)

# ── 3) 목선을 매끄러운 닫힌 곡선으로 ──
# 「가장 가까운 점」으로 거리를 재면 보로노이 칸을 따라 경계가 각지게 나온다. 그래서 목 축 둘레
# 각도 θ 로 r(θ)·z(θ) 를 낮은 차수 푸리에 급수로 맞춰, 정의상 매끄럽고 닫힌 곡선을 쓴다.
ORDER = 3


def design(angle):
    cols = [np.ones_like(angle)]
    for k in range(1, ORDER + 1):
        cols += [np.cos(k * angle), np.sin(k * angle)]
    return np.stack(cols, axis=-1)


def fit_curve(P):
    angle = np.arctan2(P[:, 1] - neck_pos[1], P[:, 0] - neck_pos[0])
    X = design(angle)
    r = np.hypot(P[:, 0] - neck_pos[0], P[:, 1] - neck_pos[1])
    coef_r, *_ = np.linalg.lstsq(X, r, rcond=None)
    coef_z, *_ = np.linalg.lstsq(X, P[:, 2], rcond=None)
    return coef_r, coef_z


# 흩어진 점을 한 번 더 걸러 가며 맞춘다 — 원래 경계의 톱니가 그대로 곡선을 흔들지 않게.
curve_points = inliers
for _ in range(3):
    coef_r, coef_z = fit_curve(curve_points)
    angle = np.arctan2(curve_points[:, 1] - neck_pos[1], curve_points[:, 0] - neck_pos[0])
    X = design(angle)
    err = np.hypot(np.hypot(curve_points[:, 0] - neck_pos[0], curve_points[:, 1] - neck_pos[1]) - X @ coef_r,
                   curve_points[:, 2] - X @ coef_z)
    keep = err < max(0.004, float(np.percentile(err, 85)))
    if keep.sum() < 60:
        break
    curve_points = curve_points[keep]
coef_r, coef_z = fit_curve(curve_points)
coef_z[0] += args.drop
angle = np.arctan2(curve_points[:, 1] - neck_pos[1], curve_points[:, 0] - neck_pos[0])
X = design(angle)
curve_spread = float(np.std(np.hypot(np.hypot(curve_points[:, 0] - neck_pos[0], curve_points[:, 1] - neck_pos[1]) - X @ coef_r,
                               curve_points[:, 2] - X @ coef_z)))
print(f"COLLAR_CURVE 점={len(inliers)}→{len(curve_points)} 퍼짐={curve_spread*1000:.1f}mm")


def collar_point(angle):
    X = design(angle)
    r = X @ coef_r
    return np.stack([neck_pos[0] + r * np.cos(angle), neck_pos[1] + r * np.sin(angle), X @ coef_z], axis=-1)


# ── 목선을 가로지르는 방향 ──
# 구의 바깥 방향은 목 뒤에서 위로 크게 들려 목덜미가 옷으로 잡힌다. 그래서 각도 구간마다
# 살 쪽 무게중심 → 옷 쪽 무게중심을 재고, 같은 푸리에 기저로 매끄럽게 편다.
N_BINS = 72


def crossing_direction():
    angle_v = np.arctan2(pos[:, 1] - neck_pos[1], pos[:, 0] - neck_pos[0])
    qv = collar_point(angle_v)
    near_line = near_neck & (np.linalg.norm(pos - qv, axis=1) < 0.030) & (skin | cloth)
    bin_v = ((angle_v + np.pi) / (2 * np.pi) * N_BINS).astype(np.int32).clip(0, N_BINS - 1)
    centers = (np.arange(N_BINS) + 0.5) / N_BINS * 2 * np.pi - np.pi
    d = np.full((N_BINS, 3), np.nan)
    for b in range(N_BINS):
        here = near_line & (bin_v == b)
        inner = here & skin
        outer = here & cloth
        if inner.sum() < 5 or outer.sum() < 5:
            continue
        v = pos[outer].mean(axis=0) - pos[inner].mean(axis=0)
        length = np.linalg.norm(v)
        if length > 1e-6:
            d[b] = v / length
    filled = ~np.isnan(d[:, 0])
    if filled.sum() < N_BINS // 3:
        return None, 0
    # 빈 칸은 둘레를 따라 이어 채운다.
    for c in range(3):
        d[~filled, c] = np.interp(centers[~filled], centers[filled], d[filled, c], period=2 * np.pi)
    X = design(centers)
    coef_d = np.linalg.lstsq(X, d, rcond=None)[0]
    return coef_d, int(filled.sum())


coef_d, filled_count = crossing_direction()
if coef_d is None:
    print(f"COLLAR_SKIP bins={filled_count}")
    sys.exit(0)
print(f"COLLAR_DIR 채운칸={filled_count}/{N_BINS}")


def from_collar(P):
    """(목선에서의 부호 있는 거리, 목선까지의 거리). 둘 다 미터. 양수면 옷 쪽이다."""
    flat = np.ascontiguousarray(P).reshape(-1, 3)
    angle = np.arctan2(flat[:, 1] - neck_pos[1], flat[:, 0] - neck_pos[0])
    q = collar_point(angle)
    X = design(angle)
    d = X @ coef_d
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    offset = flat - q
    out_shape = P.shape[:-1]
    return (np.einsum("ij,ij->i", offset, d).reshape(out_shape),
            np.linalg.norm(offset, axis=1).reshape(out_shape))


# 목선에서 이만큼까지 고친다. 좁으면 들쭉날쭉한 표식이 남고, 넓으면 상관없는 데까지 칠해진다.
REACH = 0.035
REACH_COLOR = 0.060

dist_v, reach_v = from_collar(pos)

# 맞춘 목선이 살과 옷을 실제로 갈라 주는지 확인한다. 목선 앞뒤 높이가 크게 다른 옷은
#   큰 구에 잘 얹히지만 등판 셔츠까지 안쪽에 넣어 버려, 그대로 칠하면 가슴에 얼룩이 생긴다.
check_zone = (np.abs(dist_v) > 0.004) & (np.abs(dist_v) < 0.025) & (skin | cloth) & (reach_v <= REACH)
inside = check_zone & (dist_v < 0)
outside = check_zone & (dist_v > 0)
if inside.sum() < 30 or outside.sum() < 30:
    print(f"COLLAR_SKIP sides in={int(inside.sum())} out={int(outside.sum())}")
    sys.exit(0)
agreement = (skin[inside].mean() + cloth[outside].mean()) / 2
print(f"COLLAR_CHECK 안쪽살={skin[inside].mean():.2f} 바깥옷={cloth[outside].mean():.2f}")
if agreement < 0.80:
    print("COLLAR_SKIP sphere does not separate skin from cloth")
    sys.exit(0)

# 텍셀마다 3D 좌표를 구한다 — 목 둘레 면만 래스터라이즈한다.
tex = np.full((h, w, 3), np.nan, dtype=np.float32)
for poly in me.polygons:
    p = pos[list(poly.vertices)]
    if np.linalg.norm(p - neck_pos, axis=1).min() > 0.22:
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

covered = ~np.isnan(tex[..., 2])
if not covered.any():
    print("COLLAR_SKIP no texels")
    sys.exit(0)

s = np.full((h, w), np.nan, dtype=np.float32)
reach_map = np.full((h, w), np.inf, dtype=np.float32)
s[covered], reach_map[covered] = from_collar(tex[covered])
shell_mask = covered & (np.abs(s) <= args.shell) & (reach_map <= REACH)
if shell_mask.sum() < 200:
    print(f"COLLAR_SKIP shell={int(shell_mask.sum())}")
    sys.exit(0)

# 대표색 — 껍질 바로 바깥의 살·옷 중앙값. 껍질 안은 이미 망가진 색이다.
rgb = px[..., :3]
skin_band = covered & (s < -args.shell) & (s > -args.shell - 0.025)
cloth_band = covered & (s > args.shell) & (s < args.shell + 0.025)
skin_band &= reach_map <= REACH_COLOR
cloth_band &= reach_map <= REACH_COLOR
if skin_band.sum() < 50 or cloth_band.sum() < 50:
    print(f"COLLAR_SKIP bands skin={int(skin_band.sum())} cloth={int(cloth_band.sum())}")
    sys.exit(0)
skin_color = np.median(rgb[skin_band], axis=0)
cloth_color = np.median(rgb[cloth_band], axis=0)

side_t = np.clip(s / args.feather * 0.5 + 0.5, 0.0, 1.0)  # 0 = 살(구 안), 1 = 옷(구 밖)
blend = side_t * side_t * (3 - 2 * side_t)
new_color = skin_color[None, None, :] + (cloth_color - skin_color)[None, None, :] * blend[..., None]
px[shell_mask, :3] = new_color[shell_mask]
print(f"COLLAR_BLEND 텍셀={int(shell_mask.sum())} 살={skin_color.round(3).tolist()} 옷={cloth_color.round(3).tolist()}")

# ── 4) 정점 표식도 같은 곡선으로 다시 매긴다 ──
# 껍질 안만 매기면 그 밖의 들쭉날쭉한 쐐기가 남으므로 목선 둘레 전체를 매기고 멀리는 1.0·2.0 으로 자른다.
# 셰이더(naju01/src/avatar/toonMaterial.ts)는 보간한 _tint 의 1.5 등고선으로 살/옷을 가르므로
# 1.5 를 목선에 맞추면 그 등고선이 텍스처 경계와 겹친다.
BLEND_WIDTH = 0.030
signed_v = dist_v
fix_v = near_neck & (skin | cloth) & (reach_v <= REACH)
new_tint = 1.5 + np.clip(signed_v / BLEND_WIDTH, -0.5, 0.5)
changed = 0
for i in np.where(fix_v)[0]:
    if abs(tint[i] - new_tint[i]) > 1e-3:
        attr.data[int(i)].value = float(new_tint[i])
        changed += 1
print(f"COLLAR_TINT 고침={changed}/{int(fix_v.sum())}")

image.pixels = px.reshape(-1).tolist()
image.file_format = "JPEG"
bpy.context.scene.render.image_settings.quality = args.jpeg
print("COLLAR_OK")

# 내보내기 옵션은 meshy_mark_tint.py 와 같아야 한다. export_extras 를 빠뜨리면 slot·variant 표식이
#   날아가 머리카락이 전부 보이고 신발 판정이 죽는다.
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
