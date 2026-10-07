# 티셔츠 목선을 3D 기준으로 다시 그린다 — 텍스처의 살/옷 경계가 지저분해 툰 재질에서
# 목에 구멍이 난 것처럼 보이던 것을 매끈한 라운드 넥으로 바꾼다.
#
#   Blender --background --factory-startup --python naju01/tools/meshy_round_collar.py -- \
#     --glb public/models/meshy-both-male.glb --out public/models/meshy-both-male.glb
#
# [왜 텍스처인가]
#   몸과 옷이 한 메시라 목선은 **텍스처의 색 경계**가 전부다. 그 경계가 삼각형 배치를 따라
#   들쭉날쭉하고 중간색(살+흰색)이 섞여 있어, 음영을 계단으로 만드는 툰 재질에서 톱니처럼 드러났다.
#   원본 PBR 로 보면 멀쩡하다(그늘이 가려 준다) — 그래서 메시를 고칠 일이 아니다.
#
# [어떻게]
#   목 둘레 면들을 텍셀로 펼쳐 텍셀마다 3D 좌표를 구한다. 목 축 둘레 각도 구간마다 '옷 비율이
#   절반으로 떨어지는 높이'를 찾아 목선으로 삼고, 원주를 따라 매끄럽게 편 뒤 그 선 위는 살색,
#   아래는 옷색으로 다시 칠한다. 경계가 삼각형과 무관한 부드러운 곡선이 된다.
#   (반바지 밑단을 고친 meshy_mark_tint.py 의 `sharpen_boundary` 와 같은 방식이고, 살·흰옷은
#    밝기로 못 가르므로 **채도**로 가른다.)
import argparse
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--jpeg", type=int, default=85)
# 목선을 이만큼(m) 내리거나 올린다(+ 아래 = 넓게 파인 목). 0 이면 지금 경계를 매끈하게만 편다.
parser.add_argument("--drop", type=float, default=0.0)
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
uv = me.uv_layers.active.data
M = body.matrix_world
w, h = image.size
px = np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)

rig = body.parent
neck = rig.matrix_world @ rig.data.bones["neck_01"].head_local
head = rig.matrix_world @ rig.data.bones["head"].head_local
neck_z = float(neck.z)
neck_x, neck_y = float(neck.x), float(neck.y)
# 목선을 찾을 띠 — 목뼈 아래 12cm ~ 위 5cm, 목 축에서 9cm 안.
# 반지름을 크게 잡으면 어깨(승모근)를 덮은 셔츠까지 섞여 목선이 위로 밀리고, 그만큼 목에 흰 얼룩이 생긴다.
z_low, z_high, radius = neck_z - 0.12, neck_z + 0.05, 0.090

pos = np.array([list(M @ v.co) for v in me.vertices], dtype=np.float32)
tex = np.full((h, w, 3), np.nan, dtype=np.float32)

for poly in me.polygons:
    p = pos[list(poly.vertices)]
    if p[:, 2].max() < z_low or p[:, 2].min() > z_high:
        continue
    if np.hypot(p[:, 0] - neck_x, p[:, 1] - neck_y).min() > radius * 1.6:
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

# 살 vs 옷 — 흰 티셔츠와 살빛은 밝기로 못 가른다. 채도로 가른다.
rgb = px[..., :3]
brightness = rgb.max(axis=2)
saturation = brightness - rgb.min(axis=2)
cloth = covered & (saturation < 0.085) & (brightness > 0.45)
skin = covered & (saturation >= 0.085)
band = covered & (tex[..., 2] >= z_low) & (tex[..., 2] <= z_high) \
    & (np.hypot(tex[..., 0] - neck_x, tex[..., 1] - neck_y) <= radius)
if not (cloth & band).any() or not (skin & band).any():
    print("COLLAR_SKIP no boundary")
    sys.exit(0)

# 목 축 둘레 각도 구간마다 '옷 비율 50%' 높이를 찾는다.
NB, SLICE = 24, 0.004
angle = np.arctan2(tex[..., 1] - neck_y, tex[..., 0] - neck_x)
bin_idx = ((angle + np.pi) / (2 * np.pi) * NB).astype(np.int32).clip(0, NB - 1)
collar_line = np.full(NB, np.nan, dtype=np.float32)
z_steps = np.arange(z_low, z_high + SLICE, SLICE)
for b in range(NB):
    in_bin = band & (bin_idx == b)
    if in_bin.sum() < 40:
        continue
    ratios = []
    for z0 in z_steps:
        slab = in_bin & (tex[..., 2] >= z0) & (tex[..., 2] < z0 + SLICE)
        n = slab.sum()
        ratios.append((cloth & slab).sum() / n if n >= 6 else np.nan)
    ratios = np.array(ratios, dtype=np.float32)
    valid = ~np.isnan(ratios)
    if valid.sum() < 4:
        continue
    zs, rs = z_steps[valid], ratios[valid]
    cloth_major = rs > 0.5
    if not cloth_major.any() or cloth_major.all():
        continue
    # 옷 비율이 절반을 넘는 가장 높은 층이 목선이다.
    collar_line[b] = zs[np.where(cloth_major)[0].max()]

good_bins = ~np.isnan(collar_line)
if good_bins.sum() < NB // 2:
    print(f"COLLAR_SKIP bins={int(good_bins.sum())}")
    sys.exit(0)
# 빈 칸은 이웃에서 채우고, 원주를 따라 부드럽게 편다(계단·톱니를 없앤다).
idx = np.arange(NB)
collar_line = np.interp(idx, idx[good_bins], collar_line[good_bins], period=NB)
kernel = np.array([1, 2, 3, 4, 5, 4, 3, 2, 1], dtype=np.float32)
kernel /= kernel.sum()
collar_line = np.convolve(np.r_[collar_line[-4:], collar_line, collar_line[:4]], kernel, mode="same")[4:-4]
collar_line += args.drop

# 대표색 — 목선 바로 위 살, 바로 아래 옷의 중앙값.
skin_color = np.median(rgb[skin & band & (tex[..., 2] > neck_z - 0.02)], axis=0)
cloth_color = np.median(rgb[cloth & band & (tex[..., 2] < neck_z - 0.06)], axis=0)
boundary = np.interp(bin_idx.astype(np.float32), idx, collar_line, period=NB)
# **경계 둘레만** 다시 칠한다(위아래 1.8cm). 띠 전체를 단색으로 덮으면 얼굴·목의 음영까지 평평해지고,
# 좁게 잡으면 원래의 들쭉날쭉한 경계가 밴드 밖에 남아 톱니가 그대로 보인다(실제로 그랬다).
# 경계는 딱 자르지 않고 4mm 폭으로 섞는다 — 텍셀 단위로 딱 자르면 확대했을 때 톱니가 보인다.
fix_band = band & (np.abs(tex[..., 2] - boundary) <= 0.018)
height_t = np.clip((tex[..., 2] - boundary) / 0.004 * 0.5 + 0.5, 0.0, 1.0)  # 0 = 옷, 1 = 살
blend = height_t * height_t * (3 - 2 * height_t)
new_color = cloth_color[None, None, :] + (skin_color - cloth_color)[None, None, :] * blend[..., None]
px[fix_band, :3] = new_color[fix_band]
print(f"COLLAR_BLEND 텍셀={int(fix_band.sum())}")

# 정점 표식(_tint)도 같은 목선으로 다시 매긴다.
#   표식은 정점마다 1(살)·2(옷)이고 셰이더는 삼각형 안에서 보간된 값이 1.5 를 넘는지로 가른다.
#   그래서 경계 정점이 들쭉날쭉하면 **삼각형이 쐐기 모양으로 갈려** 톱니가 보인다(빨강/파랑으로 확인).
#   텍스처만 고치면 이 톱니는 그대로 남는다.
#   그래서 1/2 로 딱 나누지 않고 **목선을 중심으로 이어지는 값**을 쓴다(1.5 가 정확히 목선).
#   셰이더가 삼각형 안에서 보간하므로 1.5 등고선이 목선을 따라 매끄럽게 지나간다.
attr = me.attributes.get("_TINT") or me.attributes.get("_tint")
if attr is not None:
    angle_v = np.arctan2(pos[:, 1] - neck_y, pos[:, 0] - neck_x)
    bin_v = ((angle_v + np.pi) / (2 * np.pi) * NB).astype(np.int32).clip(0, NB - 1)
    boundary_v = np.interp(bin_v.astype(np.float32), idx, collar_line, period=NB)
    radius_v = np.hypot(pos[:, 0] - neck_x, pos[:, 1] - neck_y)
    fix_v = (pos[:, 2] >= z_low) & (pos[:, 2] <= z_high) & (radius_v <= radius)
    blend_width = 0.030
    changed = 0
    for i in np.where(fix_v)[0]:
        new_value = 1.5 + float(np.clip((boundary_v[i] - pos[i, 2]) / blend_width, -0.5, 0.5))
        if abs(attr.data[int(i)].value - new_value) > 1e-3:
            attr.data[int(i)].value = new_value
            changed += 1
    print(f"COLLAR_TINT 고침={changed}/{int(fix_v.sum())}")

image.pixels = px.reshape(-1).tolist()
image.file_format = "JPEG"
bpy.context.scene.render.image_settings.quality = args.jpeg
print(f"COLLAR_OK 선z={collar_line.min():.3f}~{collar_line.max():.3f}")

# ※ 내보내기 옵션은 meshy_mark_tint.py 와 같아야 한다. export_extras 를 빠뜨리면 파츠 표식
#   (slot·variant)이 통째로 날아가 헤어가 전부 보이고 신발 판정이 죽는다(실제로 그랬다).
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
