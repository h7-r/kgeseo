# 팀 캐릭터 전용 바지(스키니 청바지 · 통 큰 바지)를 몸 GLB 에 맞춰 파츠 GLB 로 굽는다(미르 11/8, 검토 22 · 23회차).
# 신발처럼 몸 골격에 묶는 따로 된 파츠다(TeamOutfitLayer 가 attachParts 로 붙인다) — 바지 입은 몸 GLB 를 새로 굽지 않는다.
#
# 모양 — 다리를 감싸는 통(튜브)이다. 몸 표면을 복제해 띄우던 예전 방식(22회차)은 반바지 밑단 단차 · 무릎 · 종아리 굴곡을
# 그대로 따라가 「다리에 페인트를 칠한 것 같다」(미르 11/8)였다:
#   1) 1cm 줄마다 그 높이의 몸(다리 · 골반 · 허리, 팔 · 손 · 발 제외, 자기 쪽 절반) 정점을 모아 2D 볼록 껍질을 만들고,
#      다리 축에서 둘레 N 방향으로 껍질까지의 반지름을 잰다 — 근육 사이 오목이 사라진다.
#   2) 길이 방향으로 기울기 제한 최대 필터 — 엉덩이 · 반바지 밑단 · 무릎의 불룩함이 아래로 완만하게 이어져 단차가 안 보인다.
#      허리 띠는 위로 번지지 않게 셔츠에 딱 붙인다(셔츠를 넣어 입은 모양).
#   3) 여유(ease)를 더한다. 통 큰 바지는 무릎 아래로 일자로 떨어진다.
#   4) 두 다리는 가운데 평면(x = 0)에서 자른다 — 골반 높이에서는 두 통의 안쪽이 같은 평면에 붙은 「벽」이 되어 몸 · 바지
#      안에 숨는다(따로 된 재질 TeamPantsWall — 화면이 외곽선 · 그림자에서 뺀다). 골반 높이는 두 통이 몸 전체 껍질과 가운데
#      평면의 중심을 같이 써 앞뒤 가운데 이음 정점이 똑같고, 가랑이 아래 6cm 동안 다리 축으로 옮긴다. 통 큰 바지는 가랑이
#      아래로 두 다리 사이를 벌린다.
# 메시는 다리마다 줄 × 둘레 N 의 링이라 허리 · 밑단 고리가 반듯하고 구멍 · 실금이 없다.
# 웨이트는 같은 쪽 몸 표면에서, 여유를 넣기 전 껍질 자리의 가장 가까운 점을 찾아 삼각형 무게중심 좌표로 보간한다. 앞뒤
# 가운데 이음 정점은 두 통이 같은 웨이트 · 모프를 써 걸을 때 벌어지지 않는다.
# 모프(체형 슬라이더)는 셰이프 키마다 그 체형의 몸으로 통을 다시 만들어 차이를 쓴다. 음수로도 쓰는 키(골반 · 다리 두께 ·
# 신발 신은 발)는 −1 끝을 「이름__neg」로 따로 굽는다. 다 구운 뒤 체형 조합마다 몸이 바지 밖으로 나오는지 잰다(--report).
# UV 는 다리 둘레(이음은 다리 안쪽) × 높이, 결 무늬 텍스처(회색 — 화면이 하의 색을 곱한다).
#
#   Blender --background --factory-startup --python tools/team_pants_build.py -- \
#     --glb public/models/meshy-both-male.glb --style jeans --out public/models/team-pants-jeans-both-male.glb
# 몸은 반바지를 입은 착장(both = 티 + 반바지, bottom = 반바지)을 쓴다 — 하의 없는 착장(base · top)은 다른 Meshy 캐릭터라 얼굴이
# 달라, 바지를 입히면 머리가 내려앉고 목에 흰 자국이 났다.
import argparse
import json
import math
import random
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True, help="몸 GLB(반바지를 입은 both · bottom 착장)")
parser.add_argument("--style", choices=["jeans", "baggy"], required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--report", help="잰 값을 JSON 으로")
args, _extra = parser.parse_known_args(argv)

STYLE = {
    # hem: 발목 뼈 위 밑단 높이(m) · hem_drop: 밑단을 더 내림(통 큰 바지 기장, 미르 11/8 「좀만 더 길게」)
    # waist: spine_01 위 허리 높이 · band_margin: 허리 띠가 몸 · 셔츠의 가장 바깥에서 떨어지는 거리
    # ease_*: 볼록 껍질에서 바지까지의 여유(엉덩이 · 고관절 · 무릎 · 밑단) · slope_down: 불룩함이 아래로 줄어드는 기울기
    # straight: 무릎 아래에서 아래로 갈수록 줄어드는 기울기 상한(통 큰 바지 일자) · gap: 밑단에서 두 다리 사이 반 간격
    "jeans": {
        "hem": 0.012, "hem_drop": 0.0, "waist": 0.02, "band_margin": 0.004,
        "ease_hip": 0.008, "ease_thigh": 0.010, "ease_knee": 0.009, "ease_hem": 0.008,
        "slope_down": 0.2, "straight": None, "gap": 0.0, "weight_smooth": 2,
    },
    "baggy": {
        "hem": 0.0, "hem_drop": 0.035, "waist": 0.02, "band_margin": 0.005,
        "ease_hip": 0.014, "ease_thigh": 0.03, "ease_knee": 0.042, "ease_hem": 0.05,
        "slope_down": 0.12, "straight": 0.03, "gap": 0.014, "weight_smooth": 6,
    },
}[args.style]
RING = 64  # 둘레 정점 수
ROW = 0.01  # 줄 간격(m)
SLAB = 0.006  # 줄마다 몸 정점을 모으는 두께(위아래)
MIN_EASE = 0.006  # 고른 뒤에도 껍질에서 이만큼은 떨어진다(체형 모프를 섞어 얹을 때의 오차도 이 안에서)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = max(
    (o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys and "legThickness" in o.data.shape_keys.key_blocks),
    key=lambda o: len(o.data.vertices),
)


def head(name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


world = body.matrix_world
points = [world @ v.co for v in body.data.vertices]

# ── 허리 높이 ── spine_01 위. 여자 몸은 속옷 윗선이 더 높아 3cm 더 올린다.
is_female = "female" in body.name.lower()
waist_z = head("spine_01").z + STYLE["waist"] + (0.03 if is_female else 0.0)
tint_attr = body.data.attributes.get("_TINT")
# 아래 깔린 반바지(하의 표식 3)의 허리 밴드 윗선 — 상의가 없으면 그보다 위까지 덮는다(검은 띠가 보였다).
# 몸통 둘레 16구역마다 가장 높은 반바지 정점, 그 중간값(크롭 탑 근처에 잘못 찍힌 표식에 끌려 올라가지 않게)
centre0 = head("pelvis")
shorts_top_z = None
if tint_attr and tint_attr.domain == "POINT":
    tops = {}
    for i, d in enumerate(tint_attr.data):
        if round(d.value) != 3:
            continue
        p = points[i]
        if p.z > head("thigh_l").z + 0.25 or math.hypot(p.x - centre0.x, p.y - centre0.y) > 0.25:
            continue
        k = int((math.atan2(p.y - centre0.y, p.x - centre0.x) + math.pi) / (2 * math.pi) * 16) % 16
        tops[k] = max(tops.get(k, p.z), p.z)
    if len(tops) >= 8:
        ordered = sorted(tops.values())
        shorts_top_z = ordered[len(ordered) // 2]
# 상의가 있는 몸 — 셔츠 밑단 톱니 꼭대기 바로 위(+6mm)까지. 밑단은 앞뒤 높이가 달라 16구역마다 가장 낮은 셔츠 정점을 잰다
shirt_hem_z = None
shirt_lowest_z = None
shirt_body = False
if tint_attr and tint_attr.domain == "POINT":
    shirt = [points[i] for i, d in enumerate(tint_attr.data) if round(d.value) == 2]
    if len(shirt) > 500:
        shirt_body = True
        lowest = min(p.z for p in shirt)
        sectors = {}
        for p in shirt:
            if p.z > lowest + 0.2 or math.hypot(p.x - centre0.x, p.y - centre0.y) > 0.25:
                continue
            k = int((math.atan2(p.y - centre0.y, p.x - centre0.x) + math.pi) / (2 * math.pi) * 16) % 16
            sectors[k] = min(sectors.get(k, p.z), p.z)
        if sectors:
            shirt_hem_z = max(sectors.values())
            waist_z = max(waist_z, shirt_hem_z + 0.006)
            minima = sorted(sectors.values())
            shirt_lowest_z = minima[len(minima) // 2]
if shorts_top_z is not None and not shirt_body:
    waist_z = max(waist_z, shorts_top_z + 0.006)

thigh_z = head("thigh_l").z
knee_z = head("calf_l").z
ankle = {1: head("foot_l"), -1: head("foot_r")}
hem_z = {side: ankle[side].z + STYLE["hem"] - STYLE["hem_drop"] for side in (1, -1)}
# 허리 띠 아래 끝 — 셔츠가 있으면 밑단(구역별 가장 낮은 곳의 중간값) 1.5cm 아래, 없으면 허리 4cm 아래. 고관절 3cm 위로 제한
if shirt_lowest_z is not None:
    band_bottom = max(shirt_lowest_z - 0.015, thigh_z + 0.03)
else:
    band_bottom = max(waist_z - 0.04, thigh_z + 0.03)

# 다리 축 — 고관절 위로는 수직, 그 아래는 thigh → calf → foot 꺾은선(높이로 잇는다)
axis_points = {
    1: [(head("thigh_l").z, head("thigh_l")), (knee_z, head("calf_l")), (ankle[1].z, ankle[1])],
    -1: [(head("thigh_r").z, head("thigh_r")), (head("calf_r").z, head("calf_r")), (ankle[-1].z, ankle[-1])],
}


def leg_axis(side, z):
    pts = axis_points[side]
    if z >= pts[0][0]:
        return pts[0][1]
    for (z0, p0), (z1, p1) in zip(pts, pts[1:]):
        if z1 <= z <= z0:
            return p0.lerp(p1, (z0 - z) / max(1e-6, z0 - z1))
    return pts[-1][1]


# ── 몸에서 바지가 덮을 정점 ── 다리 · 골반 웨이트(허리 띠 높이에서는 몸통 전부), 팔 · 손 · 발은 뺀다
groups = {g.index: g.name for g in body.vertex_groups}
LEG = {i for i, n in groups.items() if n.startswith(("thigh", "calf"))}
FOOT = {i for i, n in groups.items() if n.startswith(("foot", "ball"))}
PELVIS = {i for i, n in groups.items() if n == "pelvis"}
ARM = {i for i, n in groups.items() if n.startswith(("clavicle", "upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky", "prop", "elbow", "shoulder"))}
covered = [False] * len(points)
for v in body.data.vertices:
    p = points[v.index]
    w = {g.group: g.weight for g in v.groups}
    leg = sum(x for g, x in w.items() if g in LEG)
    pelvis = sum(x for g, x in w.items() if g in PELVIS)
    foot = sum(x for g, x in w.items() if g in FOOT)
    armw = sum(x for g, x in w.items() if g in ARM)
    if armw >= 0.1 or foot >= 0.25:
        continue
    torso = p.z >= band_bottom - 0.03 and math.hypot(p.x - centre0.x, p.y - centre0.y) < 0.3
    if (leg + pelvis >= 0.5 or torso) and p.z <= waist_z + SLAB + 0.01:
        covered[v.index] = True

# 가랑이 꼭짓점 — 골반 웨이트가 큰 가운데(|x| < 1cm) 정점의 가장 낮은 높이. 그 위(골반)는 두 다리 통이 몸 전체 껍질을
# 같이 쓰고 둘레 중심을 가운데 평면에 둬, 앞뒤 가운데 이음 정점이 두 통에서 똑같다(예전엔 다리 축에서 쏴 이음이 V 로 벌어져
# 반바지 · 셔츠가 비쳤다). 그 아래 BLEND 동안 중심을 다리 축으로 옮긴다
pelvis_mid = [
    points[v.index].z
    for v in body.data.vertices
    if covered[v.index] and abs(points[v.index].x) < 0.01 and sum(g.weight for g in v.groups if g.group in PELVIS) >= 0.5
]
apex_z = min(pelvis_mid) if pelvis_mid else thigh_z - 0.04
BLEND = 0.06
# 두 다리(반바지) 안쪽이 가운데에서 떨어지기 시작하는 높이 — 통 큰 바지가 이 아래로 두 다리 사이를 벌린다
crotch_z = apex_z
z = apex_z
while z > knee_z:
    inner = [abs(p.x) for i, p in enumerate(points) if covered[i] and abs(p.z - z) < SLAB]
    if inner and min(inner) > 0.003:
        break
    crotch_z = z
    z -= ROW


def ease_at(z):
    if z >= band_bottom:
        return STYLE["band_margin"]
    if z >= band_bottom - 0.03:
        return STYLE["band_margin"] + (STYLE["ease_hip"] - STYLE["band_margin"]) * smoothstep((band_bottom - z) / 0.03)
    if z >= thigh_z:
        t = (band_bottom - 0.03 - z) / max(1e-6, band_bottom - 0.03 - thigh_z)
        return STYLE["ease_hip"] + (STYLE["ease_thigh"] - STYLE["ease_hip"]) * smoothstep(t)
    if z >= knee_z:
        return STYLE["ease_thigh"] + (STYLE["ease_knee"] - STYLE["ease_thigh"]) * smoothstep((thigh_z - z) / (thigh_z - knee_z))
    return STYLE["ease_knee"] + (STYLE["ease_hem"] - STYLE["ease_knee"]) * smoothstep((knee_z - z) / max(1e-6, knee_z - min(hem_z.values())))


def gap_at(z, side=1, j=None):
    # 가운데 평면에서 띄울 거리 — 가랑이 위로는 0(두 통이 붙어 벽이 된다). 그 줄 몸 안쪽 허벅지보다 여유 하한만큼은
    # 안쪽에 둔다(벌린 틈이 몸을 바지 밖으로 내놓지 않게)
    if not STYLE["gap"] or z >= crotch_z:
        return 0.0
    g = STYLE["gap"] * smoothstep((crotch_z - z) / 0.22)
    if j is not None:
        g = min(g, max(0.0, INNER_X[side][j] - MIN_EASE))
    return g


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def hull_radius(hull, cx, cy, ux, uy):
    # 중심에서 방향 u 로 볼록 껍질 경계까지 거리. 중심이 밖이면 받침 함수(가장 먼 투영)로
    best = None
    n = len(hull)
    for a in range(n):
        px, py = hull[a]
        qx, qy = hull[(a + 1) % n]
        ex, ey = qx - px, qy - py
        den = ux * ey - uy * ex
        if abs(den) < 1e-12:
            continue
        wx, wy = px - cx, py - cy
        t = (wx * ey - wy * ex) / den
        s = (wx * uy - wy * ux) / den
        if t > 0 and -1e-9 <= s <= 1 + 1e-9:
            best = t if best is None else max(best, t)
    if best is None:
        best = max((hx - cx) * ux + (hy - cy) * uy for hx, hy in hull)
    return best


def gaussian(values, sigma, cyclic):
    if sigma <= 0:
        return list(values)
    radius = int(math.ceil(sigma * 3))
    kernel = [math.exp(-(d * d) / (2 * sigma * sigma)) for d in range(-radius, radius + 1)]
    n = len(values)
    out = []
    for i in range(n):
        total = 0.0
        weight = 0.0
        for d, k in zip(range(-radius, radius + 1), kernel):
            j = i + d
            if cyclic:
                j %= n
            elif j < 0 or j >= n:
                continue
            total += values[j] * k
            weight += k
        out.append(total / weight)
    return out


def radius_field(pts, side, rows, dz, dirs, by_row, centre_of, both_sides, leg_filters):
    """줄마다 볼록 껍질까지의 반지름(중심 centre_of(z) 에서 dirs 방향) → (껍질 반지름, 여유 · 고르기 뒤 반지름).
    leg_filters: 기울기 제한 최대 필터 · 일자(다리 틀에서만 — 골반 틀의 큰 반지름이 다리로 번지면 바지가 부풀었다)"""
    count = len(rows)
    raw = []
    for j, z in enumerate(rows):
        c = centre_of(z)
        pts2 = [
            (pts[i].x, pts[i].y)
            for i in by_row[j]
            if math.hypot(pts[i].x - c.x, pts[i].y - c.y) < 0.25 and (both_sides or pts[i].x * side >= -0.001)
        ]
        hull = convex_hull(pts2) if len(pts2) >= 6 else []
        raw.append([hull_radius(hull, c.x, c.y, ux, uy) for ux, uy in dirs] if len(hull) >= 3 else None)
    r = [row[:] if row else [-1.0] * RING for row in raw]
    if not leg_filters:
        # 골반 틀 — 빈 줄은 가장 가까운 줄 그대로
        for j in range(count):
            if raw[j] is None:
                near = min((abs(j - n), n) for n in range(count) if raw[n] is not None)[1]
                r[j] = raw[near][:]
    else:
        # 기울기 제한 최대 필터 — 위 → 아래(엉덩이 · 반바지 밑단 · 무릎의 불룩함이 아래로 완만하게, 빈 줄도 채운다),
        # 아래 → 위는 허리 띠 아래까지만(띠는 셔츠에 딱 붙는다)
        for j in range(1, count):
            for k in range(RING):
                r[j][k] = max(r[j][k], r[j - 1][k] - STYLE["slope_down"] * dz)
        for j in range(count - 2, -1, -1):
            if rows[j] >= band_bottom:
                continue
            for k in range(RING):
                r[j][k] = max(r[j][k], r[j + 1][k] - 0.5 * dz)
    hull_r = [row[:] for row in r]
    for j, z in enumerate(rows):
        e = ease_at(z)
        r[j] = [x + e for x in r[j]]
    if leg_filters and STYLE["straight"] is not None:
        # 통 큰 바지 — 무릎 아래로 거의 줄지 않게(일자)
        for j in range(1, count):
            if rows[j] > knee_z + 0.05:
                continue
            for k in range(RING):
                r[j][k] = max(r[j][k], r[j - 1][k] - STYLE["straight"] * dz)
    # 고르기 — 둘레 · 길이 방향 가우시안. 고른 뒤에도 껍질 + 여유 하한보다 안으로는 안 들어간다(가우시안은 봉우리를 낮춘다)
    r = [gaussian(row, 1.0, True) for row in r]
    cols = [gaussian([r[j][k] for j in range(count)], 1.5, False) for k in range(RING)]
    for j in range(count):
        for k in range(RING):
            floor = hull_r[j][k] + (STYLE["band_margin"] if rows[j] >= band_bottom else MIN_EASE)
            r[j][k] = max(cols[k][j], floor)
    return hull_r, r


# ── 줄 ── 두 다리가 같은 줄 높이를 쓴다(앞뒤 가운데 이음 정점을 줄마다 짝짓는다). 밑단은 낮은 쪽에 맞춘다(1mm 안팎)
top_z = waist_z
bottom_z = min(hem_z.values())
ROWS = int(math.ceil((top_z - bottom_z) / ROW)) + 1
rows = [top_z - (top_z - bottom_z) * i / (ROWS - 1) for i in range(ROWS)]
dz = (top_z - bottom_z) / (ROWS - 1)
upper = [j for j, z in enumerate(rows) if z >= apex_z - BLEND]
pel_index = {j: n for n, j in enumerate(upper)}
# 다리 안쪽에 둘레 이음 — 왼쪽 다리(x>0)의 안쪽은 −x(각 π), 오른쪽은 +x(각 0). 둘 다 반시계(위에서 볼 때)로 돈다.
# RING 이 4의 배수라 앞(−y) · 뒤(+y) 방향이 정확히 정점이다
THETA0 = {1: math.pi, -1: 0.0}
DIRS = {side: [(math.cos(THETA0[side] + 2 * math.pi * k / RING), math.sin(THETA0[side] + 2 * math.pi * k / RING)) for k in range(RING)] for side in (1, -1)}
def rows_of(pts):
    """줄마다 그 높이(위아래 SLAB)의 덮는 정점 — 체형 모프로 정점 높이가 바뀌면 그 높이로 다시 모은다"""
    by_row = [[] for _ in rows]
    for i, p in enumerate(pts):
        if not covered[i]:
            continue
        j0 = max(0, int(math.floor((top_z - (p.z + SLAB)) / dz)))
        j1 = min(ROWS - 1, int(math.ceil((top_z - (p.z - SLAB)) / dz)))
        for j in range(j0, j1 + 1):
            if abs(rows[j] - p.z) <= SLAB:
                by_row[j].append(i)
    return by_row


BY_ROW = rows_of(points)


# 줄마다 몸 안쪽 허벅지의 가운데 평면까지 거리(자기 쪽 덮는 정점 중 가장 작은 |x|) — 통 큰 바지 틈의 상한
INNER_X = {
    side: [min((points[i].x * side for i in BY_ROW[j] if points[i].x * side > 0), default=1.0) for j in range(ROWS)]
    for side in (1, -1)
}


def build_rings(pts):
    """몸 정점 자리 pts 로 두 다리의 링을 만든다 → {side: (ring 겉 · near 몸 가까운 기준 · clamped 벽 · leg_hull)}.
    다리 틀(중심 = 다리 축, 자기 쪽 정점)과 골반 틀(중심 = 가운데 평면, 양쪽 정점 — 몸 전체 껍질)을 따로 재고, 가랑이
    꼭짓점 위는 골반 틀, 그 아래 BLEND 동안 다리 틀로 옮긴다. 골반 틀은 두 통이 같은 껍질 · 같은 중심을 써서 앞뒤
    가운데(±90°) 정점이 두 통에서 똑같다 — 다리 축에서 쏘면 이음이 V 로 벌어져 반바지 · 셔츠가 비쳤다.
    near 는 여유를 넣기 전 껍질(+ 여유 하한) 자리 — 웨이트를 넓힌 통이 아니라 몸 가까이에서 옮겨 받는다"""
    out = {}
    pelvis_centre = lambda z: Vector((0.0, centre0.y, z))  # noqa: E731
    by_row = BY_ROW if pts is points else rows_of(pts)
    for side in (1, -1):
        dirs = DIRS[side]
        leg_hull, leg_r = radius_field(pts, side, rows, dz, dirs, by_row, lambda z: leg_axis(side, z), False, True)
        pel_hull, pel_r = radius_field(pts, side, [rows[j] for j in upper], dz, dirs, [by_row[j] for j in upper], pelvis_centre, True, False)

        def leg_hull_at(j, dx, dy):
            phi = (math.atan2(dy, dx) - THETA0[side]) % (2 * math.pi)
            kf = phi / (2 * math.pi) * RING
            k0 = int(math.floor(kf)) % RING
            t = kf - math.floor(kf)
            return leg_hull[j][k0] * (1 - t) + leg_hull[j][(k0 + 1) % RING] * t

        def place(j, k, r_leg, r_pel):
            z = rows[j]
            ux, uy = dirs[k]
            cl = leg_axis(side, z)
            x = cl.x + ux * r_leg
            y = cl.y + uy * r_leg
            if j in pel_index:
                px = ux * r_pel
                py = centre0.y + uy * r_pel
                s = 0.0 if z >= apex_z else smoothstep((apex_z - z) / BLEND)
                x = px + (x - px) * s
                y = py + (y - py) * s
                if 0.0 < s < 1.0:
                    # 섞은 점은 두 겉싸개 사이 안쪽으로 들어갈 수 있다 — 다리 틀 껍질 + 여유 하한 밖으로 민다
                    ddx, ddy = x - cl.x, y - cl.y
                    d = math.hypot(ddx, ddy)
                    need = leg_hull_at(j, ddx, ddy) + MIN_EASE
                    if 1e-6 < d < need:
                        x = cl.x + ddx / d * need
                        y = cl.y + ddy / d * need
            g = gap_at(z, side, j)
            # 평면에 거의 붙은 점도 평면 위로 본다 — 앞뒤 가운데(±90°)는 cos 반올림으로 x 가 ±1e-17 이라, 한쪽 통만 눌린 점이
            # 되어 이음 짝을 못 찾고 웨이트가 갈려 다리를 벌리면 이음이 11mm 벌어졌다(Codex 리뷰 2f8641a)
            hit = x * side < g + 1e-6
            if hit:
                x = side * g
            return Vector((x, y, z)), hit

        ring, near, clamped = [], [], []
        for j in range(ROWS):
            row_pts, row_near, row_clamped = [], [], []
            for k in range(RING):
                n = pel_index.get(j)
                p, hit = place(j, k, leg_r[j][k], pel_r[n][k] if n is not None else 0.0)
                q, _ = place(j, k, leg_hull[j][k] + MIN_EASE, pel_hull[n][k] + MIN_EASE if n is not None else 0.0)
                row_pts.append(p)
                row_near.append(q)
                row_clamped.append(hit)
            ring.append(row_pts)
            near.append(row_near)
            clamped.append(row_clamped)
        out[side] = (ring, near, clamped, leg_hull)
    return out


base = build_rings(points)

# ── 웨이트 ── 같은 쪽 몸 표면(덮는 정점으로 된 삼각형)에서 몸 가까운 기준점(near)의 가장 가까운 점을 찾아 삼각형 무게중심
# 좌표로 보간한다. 삼각형 목록과 몸 정점 번호를 함께 보관한다(BVH 면 번호 → 같은 목록)
mesh_b = body.data
mesh_b.calc_loop_triangles()
key_blocks = mesh_b.shape_keys.key_blocks
basis_b = key_blocks[0]
key_names = [k.name for k in key_blocks[1:]]
weights_b = [{groups[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in mesh_b.vertices]
trees = {}
for side in (1, -1):
    tri_list = []
    for tri in mesh_b.loop_triangles:
        vs = tuple(tri.vertices)
        if not all(covered[i] for i in vs):
            continue
        if sum(points[i].x for i in vs) / 3 * side < -0.003:
            continue
        tri_list.append(vs)
    trees[side] = (BVHTree.FromPolygons(points, tri_list), tri_list)


def sample_weights(side, p):
    tree, tris = trees[side]
    loc, _n, index, _d = tree.find_nearest(p)
    vs = tris[index]
    bary = poly_3d_calc([points[i] for i in vs], loc)
    weights = {}
    for i, b in zip(vs, bary):
        for name, w in weights_b[i].items():
            weights[name] = weights.get(name, 0.0) + w * b
    return weights


def normalise(weights):
    top = sorted(weights.items(), key=lambda item: item[1], reverse=True)[:4]
    total = sum(w for _, w in top) or 1.0
    return {k: w / total for k, w in top if w / total > 1e-4}


def mix(a, b, t):
    out = {name: w * (1 - t) for name, w in a.items()}
    for name, w in b.items():
        out[name] = out.get(name, 0.0) + w * t
    return out


def ring_distance(row_clamped):
    """눌린 점마다 둘레 순서로 가장 가까운 겉 정점까지 칸 수(겉 정점은 0)"""
    free = [k for k in range(RING) if not row_clamped[k]]
    if not free:
        return [RING] * RING
    return [0 if not c else min(min((k - f) % RING, (f - k) % RING) for f in free) for k, c in enumerate(row_clamped)]


W = {}
for side in (1, -1):
    ring, near, clamped, _ = base[side]
    Ws = [[None] * RING for _ in rows]
    for j in range(ROWS):
        free = [k for k in range(RING) if not clamped[j][k]]
        for k in free:
            Ws[j][k] = sample_weights(side, near[j][k])
        # 벽(눌린 점)은 같은 줄 양옆의 겉 정점 사이를 둘레 순서로 보간 — 몸 안쪽 가장 가까운 점은 반대 다리일 수 있다
        for k in range(RING):
            if not clamped[j][k]:
                continue
            if not free:
                Ws[j][k] = {"pelvis": 1.0}
                continue
            before = max((f for f in free if f < k), default=free[-1] - RING)
            after = min((f for f in free if f > k), default=free[0] + RING)
            Ws[j][k] = mix(Ws[j][before % RING], Ws[j][after % RING], (k - before) / max(1, after - before))
    W[side] = Ws

# 앞뒤 가운데 이음 — 두 통은 따로 된 메시라, 이음 정점이 각자 자기 허벅지를 따르면 걸을 때 가랑이 앞이 벌어져 반바지가
# 비쳤다. 눌린 점(가운데 평면의 벽 · 이음 모서리)은 같은 줄 반대 통의 가장 가까운 눌린 점과 반씩 섞어 두 통이 똑같이
# 움직이게 한다(웨이트 · 모프 모두). 골반 높이(가랑이 꼭짓점 위)는 벽 전체, 그 아래(맞닿은 허벅지 안쪽)는 이음 모서리에서
# 3칸 안쪽까지만 섞는다 — 벽 가운데는 제 다리를 따라야 걸을 때 허벅지가 벽을 뚫지 않는다
PAIRS = {1: {}, -1: {}}  # side → {(j, k): (partner_k, beta)}
for j, z in enumerate(rows):
    for side in (1, -1):
        other = -side
        clamped = base[side][2]
        mine = [k for k in range(RING) if clamped[j][k]]
        theirs = [k for k in range(RING) if base[other][2][j][k]]
        if not mine or not theirs:
            continue
        dist = ring_distance(clamped[j])
        for k in mine:
            beta = 1.0 if z >= apex_z else max(0.0, 1.0 - (dist[k] - 1) / 3.0)
            if beta <= 0:
                continue
            y = base[side][0][j][k].y
            partner = min(theirs, key=lambda q: abs(base[other][0][j][q].y - y))
            PAIRS[side][(j, k)] = (partner, beta)
raw_W = {side: [row[:] for row in W[side]] for side in W}
for side in (1, -1):
    for (j, k), (partner, beta) in PAIRS[side].items():
        W[side][j][k] = mix(raw_W[side][j][k], raw_W[-side][j][partner], beta * 0.5)
# 웨이트 고르기 — 줄 · 둘레 이웃 평균(천이 몸 근육을 따라 출렁이지 않게). 반대 통과 맞춘 이음 정점은 그대로 둔다
for side in (1, -1):
    pinned = {key for key, (_p, beta) in PAIRS[side].items() if beta >= 0.999}
    Ws = W[side]
    for _ in range(max(2, STYLE["weight_smooth"])):
        nxt = [[None] * RING for _ in rows]
        for j in range(ROWS):
            for k in range(RING):
                if (j, k) in pinned:
                    nxt[j][k] = Ws[j][k]
                    continue
                around = [(j, (k - 1) % RING), (j, (k + 1) % RING)]
                if j > 0:
                    around.append((j - 1, k))
                if j < ROWS - 1:
                    around.append((j + 1, k))
                mixed = {name: w * 0.5 for name, w in Ws[j][k].items()}
                share = 0.5 / len(around)
                for a, b in around:
                    for name, w in Ws[a][b].items():
                        mixed[name] = mixed.get(name, 0.0) + w * share
                nxt[j][k] = mixed
        Ws = nxt
    W[side] = [[normalise(w) for w in row] for row in Ws]

# ── 모프 ── 셰이프 키마다 그 체형의 몸으로 링을 다시 만들어 차이를 모프로 쓴다(같은 줄 · 같은 방향 · 같은 정점).
# 몸 이동량을 그대로 옮기면 지운 반바지 굴곡 · 통 큰 바지 일자가 체형을 바꿀 때 되살아난다(Codex 23회차)
# 음수로도 쓰는 키(골반 · 다리 두께 −1~1, 신발 신은 발 −1.5)는 −1 끝의 링을 따로 구워 「이름__neg」 모프로 둔다 — 겉싸개는
# 최대 필터라 +1 차이를 뒤집어 쓰면 −1 에서 몸보다 더 오그라들어 몸이 바지 밖으로 나왔다. 화면이 음수 값을 __neg 로 옮긴다
NEGATIVE_KEYS = {"hipWidth", "legThickness", "footScale"}
# 겉싸개는 최대 필터라 체형 모프끼리 더해지지 않는다 — 줄이는 모프 둘 셋을 겹치면(마른 체격 + 다리 · 골반 −1) 같은 여유를
# 두 번 빼 몸이 바지 밖으로 8mm 까지 나왔다. 안으로 줄어드는 성분은 이 비율만큼만 쓴다(마른 체형에서 바지가 조금 넉넉해진다)
SHRINK = 0.7
to_world = world.to_3x3()
to_local = to_world.inverted()
DELTA = {}  # 모프 이름 → {side: [[Vector local]]}
for key in key_blocks[1:]:
    for sign in (1.0, -1.0) if key.name in NEGATIVE_KEYS else (1.0,):
        moved = [points[i] + to_world @ (key.data[i].co - basis_b.data[i].co) * sign for i in range(len(points))]
        rings = build_rings(moved)
        per = {}
        for side in (1, -1):
            rows_delta = []
            for j in range(ROWS):
                c = Vector((0.0, centre0.y, rows[j])) if rows[j] >= apex_z else leg_axis(side, rows[j])
                row_delta = []
                for k in range(RING):
                    d = rings[side][0][j][k] - base[side][0][j][k]
                    out_dir = base[side][0][j][k] - c
                    out_dir.z = 0.0
                    if out_dir.length > 1e-6:
                        out_dir.normalize()
                        inward = d.dot(out_dir)
                        if inward < 0:
                            d = d - out_dir * inward * (1.0 - SHRINK)
                    row_delta.append(to_local @ d)
                rows_delta.append(row_delta)
            per[side] = rows_delta
        # 이음 정점은 웨이트처럼 반대 통과 반씩
        raw = {side: [row[:] for row in per[side]] for side in per}
        for side in (1, -1):
            for (j, k), (partner, beta) in PAIRS[side].items():
                per[side][j][k] = raw[side][j][k].lerp(raw[-side][j][partner], beta * 0.5)
        DELTA[key.name if sign > 0 else f"{key.name}__neg"] = per

# ── 메시 ── 골반 높이의 벽(가랑이 꼭짓점 위, 네 점이 다 눌린 면)은 몸 · 바지 안에 숨는다 — 정점을 따로 두고(앞뒤 가운데
# 모서리에서 법선이 섞이지 않게) 재질도 따로 둔다(화면이 외곽선 · 그림자에서 뺀다). 그 아래 맞닿은 허벅지 안쪽은 다리를
# 벌리면 보이는 안쪽 면이라 겉면과 같이 둔다
verts, vert_key, faces, face_uv, face_mat = [], [], [], [], []
for side in (1, -1):
    ring, _near, clamped, _ = base[side]
    outer_id, wall_id = {}, {}

    def vid(table, j, k):
        if (j, k) not in table:
            table[(j, k)] = len(verts)
            verts.append(ring[j][k])
            vert_key.append((side, j, k))
        return table[(j, k)]

    for j in range(ROWS - 1):
        for k in range(RING):
            k1 = (k + 1) % RING
            corners = [(j, k), (j + 1, k), (j + 1, k1), (j, k1)]
            wall = rows[j + 1] >= apex_z and all(clamped[a][b] for a, b in corners)
            table = wall_id if wall else outer_id
            faces.append([vid(table, a, b) for a, b in corners])
            # UV — 둘레 4번 · 높이 1m 에 8번 반복. 이음(k = RING → 0)은 4 로 이어 붙인다
            face_uv.append([((k if b == k else k + 1) / RING * 4, rows[a] * 8) for a, b in corners])
            face_mat.append(1 if wall else 0)

mesh = bpy.data.meshes.new(f"TeamPants_{args.style}")
local = [world.inverted() @ p for p in verts]
mesh.from_pydata([tuple(p) for p in local], [], faces)
mesh.update()
for poly, m in zip(mesh.polygons, face_mat):
    poly.use_smooth = True
    poly.material_index = m
uv = mesh.uv_layers.new(name="UVMap")
for poly, uvs in zip(mesh.polygons, face_uv):
    for li, value in zip(poly.loop_indices, uvs):
        uv.data[li].uv = value
pants = bpy.data.objects.new(mesh.name, mesh)
bpy.context.scene.collection.objects.link(pants)
pants.parent = body.parent
pants.parent_type = body.parent_type
pants.matrix_parent_inverse = body.matrix_parent_inverse.copy()
pants.matrix_world = body.matrix_world.copy()
modifier = pants.modifiers.new("Armature", "ARMATURE")
modifier.object = arm
used = sorted({name for side, j, k in vert_key for name in W[side][j][k]})
for name in used:
    pants.vertex_groups.new(name=name)
for i, (side, j, k) in enumerate(vert_key):
    for name, value in W[side][j][k].items():
        pants.vertex_groups[name].add([i], value, "REPLACE")
# 셰이프 키 — 바지에서 차이가 있는 것만(어깨 · 팔 · 손 · 발은 바지 링을 안 바꾼다, 화면은 이름으로 옮긴다)
pants.shape_key_add(name="Basis", from_mix=False)
kept_keys = []
for name in [n for base_name in key_names for n in (base_name, f"{base_name}__neg") if n in DELTA]:
    biggest = max(DELTA[name][side][j][k].length for side, j, k in vert_key)
    if biggest < 1e-5:
        continue
    key = pants.shape_key_add(name=name, from_mix=False)
    for i, (side, j, k) in enumerate(vert_key):
        key.data[i].co = local[i] + DELTA[name][side][j][k]
    kept_keys.append(name)

# ── 덮기 검사 ── 덮는 몸 정점마다 링 중심에서 바깥으로 쏴 바지에 닿는지(안 닿으면 몸이 바지 밖). 기본 체형과 체형 슬라이더
# 조합(팀 저장값 · 끝값)마다 몸 · 바지 모두에 모프를 얹어 잰다 — 허리 띠까지(허리 고리 3mm 아래)
BODY_DELTA = {k.name: [to_world @ (k.data[i].co - basis_b.data[i].co) for i in range(len(points))] for k in key_blocks[1:]}
COMBOS = {
    "base": {},
    "sejin": {"heavy": 0.4, "buff": 0.2, "legThickness": -1.0},
    "haerang": {"skinny": 1.0, "buff": 0.55},
    "max": {"heavy": 1.0, "buff": 1.0, "hipWidth": 1.0, "legThickness": 1.0},
    "min": {"skinny": 1.0, "hipWidth": -1.0, "legThickness": -1.0},
    "heavy": {"heavy": 1.0},
    "hipWide": {"hipWidth": 1.0},
    "skinnyOnly": {"skinny": 1.0},
    "hipNarrow": {"hipWidth": -1.0},
    "legThin": {"legThickness": -1.0},
    "skinnyLegThin": {"skinny": 1.0, "legThickness": -1.0},
}


def coverage(combo):
    body_pts = [p + sum((BODY_DELTA[n][i] * w for n, w in combo.items()), Vector()) for i, p in enumerate(points)]
    # 화면과 같게 — 음수 값은 __neg 모프에(있으면)
    terms = [(n, w) if w >= 0 or f"{n}__neg" not in DELTA else (f"{n}__neg", -w) for n, w in combo.items()]
    pants_pts = [
        verts[v] + sum((to_world @ DELTA[n][side][j][k] * w for n, w in terms), Vector())
        for v, (side, j, k) in enumerate(vert_key)
    ]
    tree = BVHTree.FromPolygons(pants_pts, faces)
    outside, thin, checked, closest, depth = 0, 0, 0, None, 0.0
    for i, p in enumerate(body_pts):
        if not covered[i] or not (bottom_z + 0.01 < p.z < waist_z - 0.003) or abs(p.x) < 0.008:
            continue
        side = 1 if p.x > 0 else -1
        c = Vector((0.0, centre0.y, p.z)) if p.z >= apex_z else leg_axis(side, p.z)
        d = Vector((p.x - c.x, p.y - c.y, 0.0))
        if d.length < 1e-6:
            continue
        d.normalize()
        checked += 1
        hit = tree.ray_cast(p, d, 0.3)
        if hit[0] is None:
            outside += 1
            # 얼마나 밖인지 — 가장 가까운 바지면까지
            nearest = tree.find_nearest(p)
            if nearest[0] is not None:
                depth = max(depth, nearest[3])
            continue
        if hit[3] < 0.002:
            thin += 1
        closest = hit[3] if closest is None else min(closest, hit[3])
    return {"checked": checked, "outside": outside, "maxDepth": round(depth, 4), "under2mm": thin, "closest": round(closest, 4) if closest is not None else None}


COVERAGE = {name: coverage(combo) for name, combo in COMBOS.items()}
checked, outside, thin = COVERAGE["base"]["checked"], COVERAGE["base"]["outside"], COVERAGE["base"]["under2mm"]
closest = COVERAGE["base"]["closest"]

# 결 무늬 텍스처 — 회색(밝을수록 하의 색이 그대로). jeans = 사선 능직 · baggy = 촘촘한 평직
SIZE = 256
image = bpy.data.images.new(f"{pants.name}_weave", SIZE, SIZE, alpha=False)
rng = random.Random(22)
pixels = [0.0] * (SIZE * SIZE * 4)
for y in range(SIZE):
    for x in range(SIZE):
        if args.style == "jeans":
            twill = 0.07 if ((x + y) // 3) % 2 else 0.0
            value = 0.9 - twill - 0.05 * rng.random()
        else:
            weave = 0.04 if (x // 2 + y // 2) % 2 else 0.0
            value = 0.92 - weave - 0.03 * rng.random()
        k = (y * SIZE + x) * 4
        pixels[k : k + 4] = [value, value, value, 1.0]
image.pixels = pixels
image.pack()
material = bpy.data.materials.new(f"{pants.name}_mat")
material.use_nodes = True
bsdf = material.node_tree.nodes.get("Principled BSDF")
tex = material.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9
material.use_backface_culling = False
mesh.materials.append(material)
# 골반 높이 벽 — 같은 결 무늬, 이름으로 화면이 알아본다(외곽선 · 그림자에서 뺀다)
wall_material = material.copy()
wall_material.name = "TeamPantsWall"
mesh.materials.append(wall_material)

pants["slot"] = "teamPants"
pants["style"] = args.style

bpy.ops.object.select_all(action="DESELECT")
pants.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = pants
bpy.ops.export_scene.gltf(
    filepath=args.out,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_animations=False,
    export_extras=True,
    export_yup=True,
)

report = {
    "glb": args.glb,
    "style": args.style,
    "vertices": len(mesh.vertices),
    "faces": len(mesh.polygons),
    "wallFaces": sum(face_mat),
    "waistZ": round(waist_z, 4),
    "bandBottomZ": round(band_bottom, 4),
    "crotchZ": round(crotch_z, 4),
    "apexZ": round(apex_z, 4),
    "sharedSeamVerts": sum(1 for side in PAIRS for _k, (_p, b) in PAIRS[side].items() if b >= 0.999),
    "coverage": COVERAGE,
    "shirtHemZ": round(shirt_hem_z, 4) if shirt_hem_z is not None else None,
    "shortsTopZ": round(shorts_top_z, 4) if shorts_top_z is not None else None,
    "shirtBody": shirt_body,
    "hemZ": {k: round(v, 4) for k, v in hem_z.items()},
    "shapeKeys": kept_keys,
    "keyMaxDelta": {name: round(max(DELTA[name][side][j][k].length for side, j, k in vert_key), 4) for name in DELTA},
    "emptyRows": {side: sum(1 for row in base[side][3] if min(row) < 0) for side in base},
}
print("TEAM_PANTS", json.dumps(report, ensure_ascii=False))
if args.report:
    with open(args.report, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
