# build-terrain.py — 블렌더에서 NAJU-01 의 땅을 한 벌의 메시로 짓는다.
#   쓰는 법:
#     /Applications/Blender.app/Contents/MacOS/Blender --background \
#       --factory-startup -t 6 --python naju01/tools/build-terrain.py -- --out assets/terrain.glb
#   같은 폴더에 판정용 높이표 terrain-height.bin 도 쓴다.
#
# 걷기 판정·그림용 높이·실제 삼각형이 갈라지지 않게 땅을 한 배열에서 한 번에 짓는다.
# 도면 숫자(구역 고도·절벽 각도·통로 폭/경사)는 고정이라 순서가 중요하다:
#   흐름 짓기 → 흔들기 → 규격 다시 못박기. 흔들기가 마지막이면 대지가 기운다.
# --factory-startup 으로 돌고 환경설정·.blend 를 건드리지 않는다. 내보내는 것은 GLB 하나뿐.

import bpy, sys, os, math, time
import numpy as np

# 도면 값 (src/plan/sitePlan.ts 와 같은 숫자)
CORE = {"X": (0.0, 80.0), "Z": (0.0, 50.0)}
ZONES = [
    # 코드, X범위, Z범위, 고도
    ("Z1", (8.0, 28.0), (30.0, 44.0), 0.0),
    ("Z2", (34.0, 56.0), (30.0, 44.0), 0.0),
    ("Z3", (34.0, 58.0), (8.0, 26.0), 14.0),
    ("Z4", (62.0, 76.0), (8.0, 32.0), 8.0),
]
CLIFF = {"X": (34.0, 56.0), "zTop": 26.0, "zBottom": 30.0, "height": 14.0}
RIVER = {"zStart": 44.5, "zEnd": 50.0}
SHOULDER = {"width": 0.9, "spread": 0.6}          # 갓길 실폭 = 0.9 × 0.6 = 0.54 m
PATHS = [
    # 코드, 폭, 시작고도, 끝고도, 꼭짓점
    ("T1", 3.0, 0.0, 0.0,
     [(28, 36.5), (31, 36.5), (31, 40), (34, 40)]),
    ("T2", 3.0, 0.0, 8.0,
     [(56, 40), (61, 40), (64, 38), (66, 34.5), (66, 32)]),
    ("T3", 2.5, 8.0, 14.0,
     [(63.5, 13), (63.5, 5), (52, 5), (52, 8)]),
    ("T4", 2.5, 14.0, 0.0,
     [(36, 24.5), (31, 23), (25, 25.5), (21.5, 29), (18.5, 31.5), (21, 33), (25.5, 33)]),
]

CELL = 0.25          # m — 0.25 면 128,000 삼각형(규격 15~40만 안쪽)

# 대지 어깨는 방향마다 다르다. 14 m 를 5 m 안에 떨구면 70° 옹벽이라 상자로 읽힌다.
# 값은 도면상 그쪽으로 남은 빈 땅에서 나왔다. 남쪽 절벽은 raise_cliff 가 맡는다.
ZONE_SHOULDERS = {            # (서, 동, 북, 남) m
    "Z1": (7.0, 6.0, 8.0, 5.0),
    "Z2": (7.0, 10.0, 2.5, 5.0),
    "Z3": (20.0, 3.2, 6.5, 4.0),   # 서쪽 비탈을 T4 가 탄다. 남 4.0 = 절벽 띠 폭(2.0 이면 82° 벽)
    "Z4": (3.2, 4.0, 7.0, 13.0),   # 서쪽은 Z3 까지 4 m 뿐이다
}
SHOULDER_WARP = 2.6   # m — 어깨 경계선을 구불거리게 미는 폭

# 길 비탈은 전이 거리가 아니라 안식각으로 벌린다(거리로 물리면 깊은 자리에서 계단이 된다).
CUT_SLOPE = math.tan(math.radians(38.0))   # 0.78 — 길 위쪽 둑
FILL_SLOPE = math.tan(math.radians(30.0))   # 0.58 — 길 아래쪽 비탈
BERM_HEIGHT = 6.0   # m — 쌓기로 올릴 수 있는 최대 높이
BERM_SPREAD = 3.0   # m — 그 둑이 옆으로 퍼지는 거리
# 둑·깎기 뻗음은 Z1 에 손으로 놓은 배치에 맞춘 값이라 넓히면 배치가 어긋난다.

# 옹벽: T4 헤어핀은 두 다리 노면 사이가 1.25 m 뿐이라 노면 바로 옆에서만 급한 면을 허락한다.
WALL_SLOPE = 3.0    # tan 72°
WALL_HEIGHT = 5.0  # m — 축대로 받칠 수 있는 최대 높이

# 깎기도 깊이를 막는다 — 평지 길 하나가 옆 산자락을 통째로 밀지 않게.
CUT_DEPTH = 6.0   # m — 깎아 내릴 수 있는 최대 깊이
CUT_SPREAD = 5.0   # m — 그 깎기가 옆으로 미치는 거리


# 값 노이즈를 격자 전체에 한 번에 — mathutils.noise 는 점 하나씩이라 느리다.
def value_noise(X, Z, period, seed):
    rng = np.random.default_rng(seed)
    gx = int(CORE["X"][1] / period) + 3
    gz = int(CORE["Z"][1] / period) + 3
    lattice = rng.random((gz, gx)).astype(np.float32)
    u = X / period
    v = Z / period
    i = np.floor(u).astype(np.int32)
    j = np.floor(v).astype(np.int32)
    fu = u - i
    fv = v - j
    # 선형이면 격자 자국이 보여서 부드럽게
    su = fu * fu * (3 - 2 * fu)
    sv = fv * fv * (3 - 2 * fv)
    i = np.clip(i, 0, gx - 2)
    j = np.clip(j, 0, gz - 2)
    a = lattice[j, i]
    b = lattice[j, i + 1]
    c = lattice[j + 1, i]
    d = lattice[j + 1, i + 1]
    return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv


def grain(X, Z, layers, seed0):
    """여러 크기를 겹친 노이즈. 0~1."""
    acc = np.zeros_like(X)
    weight_sum = 0.0
    for k, (period, w) in enumerate(layers):
        acc += value_noise(X, Z, period, seed0 + k * 977) * w
        weight_sum += w
    return acc / weight_sum


def smoothstep(t):
    """smoothstep 0~1"""
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rect_distance(X, Z, xr, zr):
    """사각형 밖으로 떨어진 거리. 안이면 0."""
    dx = np.maximum(np.maximum(xr[0] - X, 0.0), X - xr[1])
    dz = np.maximum(np.maximum(zr[0] - Z, 0.0), Z - zr[1])
    return np.hypot(dx, dz)


def rect_distance_ratio(X, Z, xr, zr, spread):
    """사각형 밖으로 온 정도를 방향마다 다른 자로 잰 0~1 몫(1 = 그 방향 어깨 끝).

    서/동, 북/남은 서로 배타적이라 그냥 더해도 된다.
    """
    west, east, north, south = spread
    dx = np.maximum(xr[0] - X, 0.0) / west + np.maximum(X - xr[1], 0.0) / east
    dz = np.maximum(zr[0] - Z, 0.0) / north + np.maximum(Z - zr[1], 0.0) / south
    return np.hypot(dx, dz)


def warp(X, Z, width, seed):
    """좌표 자체를 민다(도메인 워프). 불리언 마스크로 무게를 흔들면 끊겨 톱니 절벽이 된다."""
    ux = (grain(X, Z, [(13.0, 1.0), (5.5, 0.45)], seed) - 0.5) * 2.0 * width
    uz = (grain(X, Z, [(13.0, 1.0), (5.5, 0.45)], seed + 613) - 0.5) * 2.0 * width
    return X + ux, Z + uz


def shift_clamped(h, dj, di):
    """가장자리를 물고 늘어지는 시프트. np.roll 은 반대편으로 감겨 테두리에 단차를 만든다."""
    g = np.roll(np.roll(h, dj, axis=0), di, axis=1)
    if dj > 0:
        g[:dj, :] = h[:dj, :]
    elif dj < 0:
        g[dj:, :] = h[dj:, :]
    if di > 0:
        g[:, :di] = h[:, :di]
    elif di < 0:
        g[:, di:] = h[:, di:]
    return g


def smooth(h, relax, iterations=4, strength=0.5):
    """못박힌 칸은 빼고 그 사이 한 칸짜리 각만 푼다. relax: 1 = 풀어도 됨, 0 = 못박힘."""
    h = h.copy()
    for _ in range(iterations):
        avg = (shift_clamped(h, 1, 0) + shift_clamped(h, -1, 0) + shift_clamped(h, 0, 1) + shift_clamped(h, 0, -1)) * 0.25
        h += (avg - h) * strength * relax
    return h


def smooth_centerline(points, spacing=0.25, iterations=14):
    """도면 꼭짓점을 둥글린 중심선으로 바꾼다.

    직각 코너 안쪽은 넓은 쐐기가 코너 한 점의 호 길이를 받아 경사진 길이 끊긴다.
    촘촘히 다시 뽑고 이웃과 평균한다(양 끝 고정).
    """
    cum = [0.0]
    for i in range(len(points) - 1):
        cum.append(cum[-1] + math.hypot(points[i + 1][0] -points[i][0], points[i + 1][1] -points[i][1]))
    total = cum[-1]
    n = max(2, int(round(total / spacing)))
    resampled = []
    for k in range(n + 1):
        d = total * k / n
        i = min(len(points) - 2, max(0, np.searchsorted(cum, d, side="right") - 1))
        t = (d - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
        resampled.append([points[i][0] + (points[i + 1][0] - points[i][0]) * t,
                   points[i][1] + (points[i + 1][1] - points[i][1]) * t])
    resampled = np.array(resampled, dtype=np.float64)
    for _ in range(iterations):
        resampled[1:-1] = (resampled[:-2] + resampled[1:-1] * 2 + resampled[2:]) / 4
    return [(float(a), float(b)) for a, b in resampled]


# 도면 통로를 다듬은 중심선으로 갈아 둔다(둥글린 만큼 수십 cm 짧아진다).
PATHS = [(code, width, start, end, smooth_centerline(points)) for code, width, start, end, points in PATHS]


def path_field(X, Z, points, with_foot=False):
    """폴리라인까지의 거리와 가장 가까운 자리의 호 길이 몫(0~1). with_foot 면 그 점 좌표도."""
    dist = np.full(X.shape, 1e9, dtype=np.float32)
    frac = np.zeros(X.shape, dtype=np.float32)
    foot_x = np.zeros(X.shape, dtype=np.float32)
    foot_z = np.zeros(X.shape, dtype=np.float32)
    cumulative = [0.0]
    for i in range(len(points) - 1):
        (x1, z1), (x2, z2) = points[i], points[i + 1]
        cumulative.append(cumulative[-1] + math.hypot(x2 - x1, z2 - z1))
    total = cumulative[-1]
    for i in range(len(points) - 1):
        x1, z1 = points[i]
        x2, z2 = points[i + 1]
        dx, dz = x2 - x1, z2 - z1
        L2 = dx * dx + dz * dz
        t = np.clip(((X - x1) * dx + (Z - z1) * dz) / L2, 0.0, 1.0)
        cx = x1 + t * dx
        cz = z1 + t * dz
        d = np.hypot(X - cx, Z - cz)
        closer = d < dist
        dist = np.where(closer, d, dist)
        frac = np.where(closer, (cumulative[i] + t * math.sqrt(L2)) / total, frac)
        if with_foot:
            foot_x = np.where(closer, cx, foot_x)
            foot_z = np.where(closer, cz, foot_z)
    if with_foot:
        return dist, frac, total, foot_x, foot_z
    return dist, frac, total


def road_fraction(d, edge_width, blend_width=0.5):
    """노면 몫 — 안쪽 1, edge_width 직전부터 blend_width 만에 0(걷는 폭은 통째로 1)."""
    return 1.0 - smoothstep((d - (edge_width - 0.2)) / blend_width)


def path_segments(X, Z, start, end, points):
    """토막마다 (거리, 그 토막 위 램프 높이).

    스위치백은 가장 가까운 토막 하나만 보면 두 다리 중간선에서 램프가 8 m 뛴다.
    흙일은 포락선이어야 한다 — 깎기는 상한의 최솟값, 쌓기는 하한의 최댓값.
    """
    cumulative = [0.0]
    for i in range(len(points) - 1):
        (x1, z1), (x2, z2) = points[i], points[i + 1]
        cumulative.append(cumulative[-1] + math.hypot(x2 - x1, z2 - z1))
    total = cumulative[-1]
    for i in range(len(points) - 1):
        x1, z1 = points[i]
        x2, z2 = points[i + 1]
        dx, dz = x2 - x1, z2 - z1
        L2 = dx * dx + dz * dz
        t = np.clip(((X - x1) * dx + (Z - z1) * dz) / L2, 0.0, 1.0)
        d = np.hypot(X - (x1 + t * dx), Z - (z1 + t * dz))
        frac = (cumulative[i] + t * math.sqrt(L2)) / total
        yield d, start + (end - start) * frac


def build_heights():
    x0, x1 = CORE["X"]
    z0, z1 = CORE["Z"]
    nx = int(round((x1 - x0) / CELL)) + 1
    nz = int(round((z1 - z0) / CELL)) + 1
    xs = np.linspace(x0, x1, nx, dtype=np.float32)
    zs = np.linspace(z0, z1, nz, dtype=np.float32)
    X, Z = np.meshgrid(xs, zs)

    # 1) 땅의 흐름 — 영산강 북쪽 기슭. 남은 강으로 내려가는 둔치, 북은 산자락.
    north = smoothstep((44.0 - Z) / 36.0)                     # 남 0 → 북 1
    h = 2.2 * north
    # 동쪽이 더 높다 — Z4 능선이 앉는다
    h += 4.2 * smoothstep((X - 30.0) / 40.0) * north
    # Z3 밑을 받치는 바위 노두
    outcrop = np.exp(-(((X - 46.0) / 26.0) ** 2 + ((Z - 17.0) / 16.0) ** 2))
    h += 9.5 * outcrop
    h += (grain(X, Z, [(34.0, 1.0), (13.0, 0.45)], 1301) - 0.5) * 3.4 * north

    # 강바닥
    water = smoothstep((Z - RIVER["zStart"]) / (RIVER["zEnd"] - RIVER["zStart"]))
    h = h * (1 - water) - 2.6 * water

    # 2) 흔들기 — 규격을 못박기 전에 한다
    h += (grain(X, Z, [(7.5, 1.0), (3.1, 0.5), (1.35, 0.25)], 5501) - 0.5) * 2.1
    h = thermal_erosion(h, iterations=48, repose=0.62)

    # 3) 규격 못박기
    h, inside_plateau, _ = seat_plateaus(X, Z, h)
    h, cliff_band = raise_cliff(X, Z, h)
    cliff_mask = cliff_shadow(X, Z)
    h, path_lock = carve_paths(X, Z, h, cliff_mask)

    # 3b) 대지 어깨가 덮어 버린 결을 기운 자리에만 되돌린다(대지·노면은 그대로).
    slope = np.hypot(np.gradient(h, CELL, axis=1), np.gradient(h, CELL, axis=0))
    grain_amount = smoothstep(slope / 0.30) * (1.0 - path_lock)
    h = h + (grain(X, Z, [(9.0, 1.0), (3.7, 0.55), (1.6, 0.3)], 8821) - 0.5) * 1.3 * grain_amount

    # 4) 이음매 풀기 — 대지 안·노면·절벽 면은 손대지 않는다(절벽을 문지르면 실각이 무너진다).
    relax = (1.0 - np.maximum(np.maximum(inside_plateau.astype(np.float32), path_lock), cliff_band))
    h = smooth(h, relax, iterations=5, strength=0.5)

    # 5) 4) 가 경계 바로 바깥을 건드렸으니 규격을 다시 못박는다
    h = repin(X, Z, h)

    # 대지에 ±6 cm 미세결 — 0 편차는 CAD 철판처럼 보인다. 걷기·배치엔 영향 없다.
    h = h + (grain(X, Z, [(3.4, 1.0), (1.1, 0.6)], 4243) - 0.5) * 0.12 * (1.0 - path_lock)

    return X, Z, h, nx, nz, path_lock


def thermal_erosion(h, iterations=40, repose=0.6):
    """열 침식 — 이웃과 높이차가 repose 를 넘으면 흘려보낸다(0.62 는 칸 기준 약 68°)."""
    h = h.copy()
    for _ in range(iterations):
        delta = np.zeros_like(h)
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            diff = h - shift_clamped(h, dj, di)
            excess = np.maximum(diff - repose, 0.0) * 0.22
            delta -= excess                                   # 나에게서 빠지고
            delta += shift_clamped(excess, -dj, -di)                   # 이웃에 쌓인다
        h += delta
    return h


def seat_plateaus(X, Z, h):
    """구역 넷을 제 고도의 평평한 대지로 앉힌다.

    Z3 와 Z4 는 4 m 떨어져 있어 차례로 덮으면 어깨가 이웃 대지를 들어올린다.
    그래서 네 무게를 한꺼번에 섞고, 사각형 안은 마지막에 제 고도로 못박는다.
    """
    weights = []
    elevations = []
    inside = np.zeros(X.shape, dtype=bool)
    inside_el = np.zeros(X.shape, dtype=np.float32)
    # 경계선은 무게가 아니라 좌표를 밀어 구불거리게
    wX, wZ = warp(X, Z, SHOULDER_WARP, 7001)
    for code, xr, zr, elevation in ZONES:
        # 어깨는 뒤틀린 좌표로, 대지 안 판정은 참 좌표로
        t = rect_distance_ratio(wX, wZ, xr, zr, ZONE_SHOULDERS[code])
        # 거의 직선 프로필 — smoothstep 은 어깨 한복판에 단차를 만든다
        w = np.clip(1.0 - t, 0.0, 1.0) ** 1.35
        weights.append(w)
        elevations.append(elevation)
        in_this = rect_distance(X, Z, xr, zr) <= 1e-3
        inside |= in_this
        inside_el = np.where(in_this, elevation, inside_el)

    w_sum = np.zeros(X.shape, dtype=np.float32)
    w_el_sum = np.zeros(X.shape, dtype=np.float32)
    for w, elevation in zip(weights, elevations):
        w_sum += w
        w_el_sum += w * elevation
    mix = np.clip(w_sum, 0.0, 1.0)
    plateau = np.where(w_sum > 1e-6, w_el_sum / np.maximum(w_sum, 1e-6), 0.0)
    h = h * (1 - mix) + plateau * mix
    # 사각형 안은 무조건 제 고도(걷는 바닥). mix 는 대지가 다스리는 땅 표시다.
    return np.where(inside, inside_el, h), inside, mix


def cliff_lines(X, Z):
    """Z3 남쪽 마루에서 Z2 바닥으로 떨어지는 74° 벼랑의 마루·발치·끝맺음."""
    xa, xb = CLIFF["X"]
    t = np.clip((X - xa) / (xb - xa), 0.0, 1.0)
    wave = lambda a, b, c: np.sin(t * math.pi * a + b) * c
    s1 = wave(1.7, 0.6, 0.55) + wave(3.9, 2.1, 0.30) + wave(7.3, 4.4, 0.15)
    s2 = wave(2.3, 1.9, 0.50) + wave(5.1, 0.4, 0.32) + wave(9.7, 3.2, 0.18)
    # 띠 폭을 4 m 로 붙들고 마루선만 흔든다 — 따로 흔들면 띠가 좁아져 85° 가 된다.
    band = CLIFF["height"] / math.tan(math.radians(74.0))     # = 4.01 m
    # 흔들림은 0.25 까지 — 크게 흔들면 발치가 Z2 대지 안을 들어올린다.
    crest = CLIFF["zTop"] + (0.5 + s1 * 0.5) * 0.25         # 26.0 ~ 26.25
    toe = crest + band                                     # 30.0 ~ 30.26

    # X 양 끝에서 절벽 영향이 잦아든다(56~58 은 벼랑이 아니다)
    fade = smoothstep((X - (xa - 1.2)) / 2.4) * (1.0 - smoothstep((X - (xb - 1.2)) / 2.4))
    return crest, toe, fade


def raise_cliff(X, Z, h):
    """cliff_lines 의 마루·발치로 벼랑 면을 세운다."""
    crest, toe, fade = cliff_lines(X, Z)

    t = np.clip((Z - crest) / np.maximum(toe - crest, 1e-3), 0.0, 1.0)
    # 면은 곧게 — smoothstep 이면 가운데가 82° 가 된다. 위·아래 끝만 둥글린다.
    frac = np.clip((t - 0.06) / 0.88, 0.0, 1.0)
    frac = frac * 0.94 + smoothstep(t) * 0.06
    face = CLIFF["height"] * (1.0 - frac)                        # 마루 14 → 발치 0
    # 민판이면 콘크리트로 보여서 결을 준다
    face += (grain(X, Z, [(4.5, 1.0), (1.7, 0.5)], 9109) - 0.5) * 1.5 * frac * (1 - frac) * 4
    # 밴드를 불리언으로 자르면 테두리에 수 m 단차가 난다. 창을 부드럽게 연다.
    near = smoothstep((Z - (crest - 6.0)) / 4.0) * (1.0 - smoothstep((Z - (toe + 2.0)) / 4.0))
    w = fade * near
    # 두 번째 값은 smooth 가 문지르지 말라는 표
    return h * (1 - w) + face * w, w


def carve_paths(X, Z, h, cliff_mask):
    """통로를 땅에 파 넣는다.

    걷는 폭은 좌우 수평, 진행 방향으로만 경사진다(걷기 판정이 이 높이를 쓴다).
    그 바깥은 거리로 섞지 않고 안식각으로 가둔다 — 위로 깎기각, 아래로 쌓기각.
    """
    lock = np.zeros(X.shape, dtype=np.float32)
    shoulder = SHOULDER["width"] * SHOULDER["spread"]
    # 클램프는 스스로 멈추지 않아 거리로 끊는다(안 끊으면 쌓기가 멀리까지 땅을 들어올린다).
    reach = 9.0   # m — 이 밖에서는 길이 지형을 다스리지 않는다
    # 절벽 면 위에서는 클램프를 끈다 — 벼랑에 흙을 쌓을 수 없다.
    off = cliff_mask.astype(np.float32) * 60.0
    # 흙일의 기준은 길을 파기 전의 땅(길 순서에 결과가 기대지 않게)
    base = h.copy()
    for code, width, start, end, points in PATHS:
        half = width / 2.0
        # 포락선: 토막마다 상·하한을 구해 min / max 로 모은다
        upper = np.full(X.shape, 1e9, dtype=np.float32)
        lower = np.full(X.shape, -1e9, dtype=np.float32)
        for d, ramp in path_segments(X, Z, start, end, points):
            outside = np.maximum(d - half - shoulder, 0.0)
            loose = np.maximum(outside - reach, 0.0) * 8.0 + off
            wall = np.maximum(CUT_SLOPE * outside,
                            np.minimum(WALL_SLOPE * outside, WALL_HEIGHT))
            dig = CUT_DEPTH * np.maximum(1.0 - outside / CUT_SPREAD, 0.0)
            upper = np.minimum(upper,
                              np.maximum(ramp + wall + loose, base - dig))
            berm = BERM_HEIGHT * np.maximum(1.0 - outside / BERM_SPREAD, 0.0)
            lower = np.maximum(lower, np.minimum(ramp - FILL_SLOPE * outside - loose, base + berm))
        # 쌓기 먼저, 깎기 나중 — 헤어핀 안쪽에서 깎기가 이겨야 아래 노면이 안 묻힌다.
        h = np.minimum(np.maximum(h, lower), upper)
        # 노면 + 갓길은 못박는다(걷기 판정 자리)
        d, frac, total = path_field(X, Z, points)
        ramp = start + (end - start) * frac
        # 테두리를 불리언으로 자르면 격자에 세로 빗살이 생겨 0.5 m 에 걸쳐 물린다.
        road = road_fraction(d, half + shoulder)
        h = h * (1 - road) + ramp * road
        lock = np.maximum(lock, road)
    return h, lock


def path_shadow(X, Z, elevation, reach=9.0):
    """길의 흙일이 닿는 칸 — 대지 고도를 못박으면 안 되는 자리.

    길이 대지보다 높으면 둑을 BERM_SPREAD 까지, 낮으면 높이차/깎기각 만큼 파고든다.
    램프와 대지가 같은 높이면 그늘이 없다(토막마다 본다 — 스위치백 때문).
    """
    shoulder = SHOULDER["width"] * SHOULDER["spread"]
    shadow = np.zeros(X.shape, dtype=bool)
    for code, width, start, end, points in PATHS:
        for d, ramp in path_segments(X, Z, start, end, points):
            outside = np.maximum(d - width / 2 - shoulder, 0.0)
            diff_el = np.abs(ramp - elevation)
            spread = np.where(ramp > elevation, BERM_SPREAD, np.minimum(diff_el / CUT_SLOPE, reach))
            shadow |= (outside <= spread) & (diff_el > 0.25)
    return shadow


def cliff_shadow(X, Z):
    """절벽 면이 지나는 칸 — 대지 잠금이 절벽을 먹지 않게(발치가 Z2 안으로 넘어온다)."""
    crest, toe, fade = cliff_lines(X, Z)
    return (fade > 0.02) & (Z > crest - 0.1) & (Z < toe + 0.1)


def repin(X, Z, h):
    """smooth 뒤에 규격 자리만 다시 못박는다(대지 테두리 한 줄이 2~3 cm 처진다).

    순서는 대지 → 통로. T3 는 Z4 안을 오르므로 길이 이겨야 한다.
    """
    cliff_mask = cliff_shadow(X, Z)
    for code, xr, zr, elevation in ZONES:
        h = np.where((rect_distance(X, Z, xr, zr) <= 1e-3)
                     & ~path_shadow(X, Z, elevation)
                     & ~cliff_mask, elevation, h)
    for code, width, start, end, points in PATHS:
        d, frac, _ = path_field(X, Z, points)
        road = road_fraction(d, width / 2.0 + SHOULDER["width"] * SHOULDER["spread"])
        ramp = start + (end - start) * frac
        h = h * (1 - road) + ramp * road
    return h


def make_mesh(X, Z, h, nx, nz):
    """격자를 메시로. glTF 내보내기가 (x, y, z) → (x, z, −y) 라 블렌더엔 (x, −z, 높이) 로 담는다."""
    co = np.empty((nz * nx, 3), dtype=np.float32)
    co[:, 0] = X.ravel()
    co[:, 1] = -Z.ravel()
    co[:, 2] = h.ravel()

    faces = []
    for j in range(nz - 1):
        r0 = j * nx
        r1 = (j + 1) * nx
        for i in range(nx - 1):
            # 감는 순서를 뒤집으면 법선이 아래를 봐 단면 재질에서 땅이 사라진다
            faces.append((r0 + i, r1 + i, r1 + i + 1, r0 + i + 1))

    me = bpy.data.meshes.new("terrain")
    me.from_pydata(co.tolist(), [], faces)
    me.update()
    ob = bpy.data.objects.new("terrain", me)
    bpy.context.collection.objects.link(ob)
    return ob


def export_height_table(h, lock, nx, nz, path):
    """판정용 높이 격자를 Uint16 로 내보낸다 — GLB 와 같은 배열 h 에서 나와 어긋날 수 없다.

    형식: 머리말 36 바이트 "NJTH" · 판(u16) · 예비(u16) · nx(u16) · nz(u16)
          · x0 · z0 · 칸x · 칸z (f32 ×4) · 낮 · 높 (f32 ×2)
    뒤에 little-endian Uint16 nz × nx, 이어서 노면 잠금 u8 nz × nx.
    값 v → 높이 = 낮 + v / 65535 × (높 − 낮).
    """
    import struct
    lo, hi = float(h.min()), float(h.max())
    q = np.clip(np.round((h - lo) / (hi - lo) * 65535), 0, 65535).astype("<u2")
    header = struct.pack("<4sHHHHffff", b"NJTH", 1, 0, nx, nz,
                       0.0, 0.0, CELL, CELL) + struct.pack("<ff", lo, hi)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    road_mask = np.clip(np.round(lock * 255), 0, 255).astype(np.uint8)
    with open(path, "wb") as f:
        f.write(header)
        f.write(q.tobytes())
        f.write(road_mask.tobytes())
    return lo, hi, len(header) + q.nbytes + road_mask.nbytes


# 바닥 팔레트 (src/terrain/ground.ts 와 같은 색 — 다르면 갈아끼울 때 화풍이 갈린다)
PALETTE = {                      # 코드: (색, 색2, 그늘)
    "Z1": ("#93836B", "#6E5F49", "#4E4436"),   # 나루터 — 다져진 흙
    "Z2": ("#9A968E", "#6F7068", "#4A4C50"),   # 자갈밭
    "Z3": ("#9C917A", "#77786A", "#4C4738"),   # 바위 위
    "Z4": ("#87956F", "#5E6B4C", "#3A452F"),   # 능선 — 흙에 풀
    "unplanned": ("#82885F", "#6E7550", "#4A5038"),
}
PATH_COLOR = "#8A7B62"       # 밟아 다져진 흙길
SHORE_COLOR = "#A29579"     # 강가 모래


def hex_to_linear(text):
    """#RRGGBB → 선형 RGB. three 가 정점 색을 선형으로 읽어 sRGB 그대로면 허옇게 뜬다."""
    v = np.array([int(text[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def paint_colors(ob, X, Z, h, lock, nx, nz):
    """정점 색을 굽는다 — 바닥 재질이 vertexColors 를 켜서 없으면 땅이 새까맣다.

    구역(뒤틀린 사각형) → 색/색2 결 섞기 → 가파른 면은 그늘색 → 노면·물가.
    """
    wX, wZ = warp(X, Z, 1.6, 3307)
    base = np.zeros(X.shape + (3,), dtype=np.float32)
    shade_color = np.zeros(X.shape + (3,), dtype=np.float32)
    mix = grain(X, Z, [(2.6, 1.0), (0.9, 0.5)], 6151)[..., None]

    used = np.zeros(X.shape, dtype=bool)
    for code, xr, zr, _ in ZONES:
        inside = ((wX >= xr[0]) & (wX <= xr[1]) & (wZ >= zr[0]) & (wZ <= zr[1]) & ~used)
        c1, c2, cg = (hex_to_linear(v) for v in PALETTE[code])
        base = np.where(inside[..., None], c1 * (1 - mix) + c2 * mix, base)
        shade_color = np.where(inside[..., None], cg, shade_color)
        used |= inside
    c1, c2, cg = (hex_to_linear(v) for v in PALETTE["unplanned"])
    base = np.where(used[..., None], base, c1 * (1 - mix) + c2 * mix)
    shade_color = np.where(used[..., None], shade_color, cg)

    # 가파를수록 그늘색 — 절벽이 대지와 같은 색이면 높이가 안 읽힌다
    slope = np.hypot(np.gradient(h, CELL, axis=1), np.gradient(h, CELL, axis=0))
    steep = smoothstep((slope - 0.45) / 1.4)[..., None]
    color = base * (1 - steep) + shade_color * steep

    # 노면 · 물가
    color = color * (1 - lock[..., None]) + hex_to_linear(PATH_COLOR) * lock[..., None]
    water = smoothstep((Z - (RIVER["zStart"] - 2.5)) / 3.0)[..., None]
    color = color * (1 - water) + hex_to_linear(SHORE_COLOR) * water

    me = ob.data
    values = np.ones((nz * nx, 4), dtype=np.float32)
    values[:, :3] = color.reshape(-1, 3)
    layer = me.color_attributes.new(name="groundColor", type="FLOAT_COLOR", domain="POINT")
    layer.data.foreach_set("color", values.ravel())
    me.update()


def unwrap_uv(ob):
    """상자 투영 UV — 위에서 투영하고 선 면(절벽)만 옆에서. 1 m = UV 0.05.

    Smart UV Project 는 12 만 면에 몇 분이 걸리고 조각이 흩어진다.
    """
    me = ob.data
    me.uv_layers.new(name="UVMap")
    uv = me.uv_layers[0].data
    scale = 0.05
    coords = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)
    normals = np.empty(len(me.polygons) * 3, dtype=np.float32)
    me.polygons.foreach_get("normal", normals)
    normals = normals.reshape(-1, 3)
    values = np.empty((len(me.loops), 2), dtype=np.float32)
    loop_verts = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loop_verts)
    start = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_start", start)

    upright = np.abs(normals[:, 2]) < 0.55        # 블렌더 Z = 높이. 눕지 않은 면.
    for pi in range(len(me.polygons)):
        s = start[pi]
        for k in range(4):
            v = coords[loop_verts[s + k]]
            if upright[pi]:
                # 옆면 — 가로는 X 나 Y 중 긴 쪽, 세로는 높이
                across = v[0] if abs(normals[pi][1]) > abs(normals[pi][0]) else v[1]
                values[s + k] = (across * scale, v[2] * scale)
            else:
                values[s + k] = (v[0] * scale, v[1] * scale)
    uv.foreach_set("uv", values.ravel())
    me.update()


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,        # 모디파이어 적용
        export_yup=True,          # glTF 표준 — Y 가 위
        export_normals=True,
        export_texcoords=True,
        export_materials="NONE",  # 재질은 코드가 입힌다
        export_vertex_color="MATERIAL",  # 바닥색을 싣는다(없으면 검게 나온다)
        export_cameras=False,
        export_lights=False,
    )


def measure(X, Z, h):
    """지은 땅이 도면과 맞나 — 내보내기 전에 스스로 검사한다.

    대지 평탄도는 통로·절벽을 뺀 자리에서 재되, 뺀 칸도 반드시 찍는다
    (뺀 자리에서 둑이 대지를 밀고 들어와도 놓치지 않게).
    """
    lines = []
    shoulder = SHOULDER["width"] * SHOULDER["spread"]
    # 절벽 띠 마스크 (넉넉히)
    off_cliff = ~((X > CLIFF["X"][0] - 2) & (X < CLIFF["X"][1] + 2)
             & (Z > CLIFF["zTop"] - 1.5) & (Z < CLIFF["zBottom"] + 1.5))

    # 통로 밭은 한 번만 구해 구역마다 다시 쓴다
    path_fields = [(width, start, end) + path_field(X, Z, points)[:2] for code, width, start, end, points in PATHS]

    for code, xr, zr, elevation in ZONES:
        inside = ((X >= xr[0] + 0.5) & (X <= xr[1] - 0.5)
              & (Z >= zr[0] + 0.5) & (Z <= zr[1] - 0.5))
        # 클램프가 실제로 물린 칸(노면)만 뺀다 — 좁게 잡은 측정이 「이상 없음」을 만든다.
        off_path = ~path_shadow(X, Z, elevation)
        for width, start, end, d, frac in path_fields:
            off_path &= d > width / 2 + shoulder + 0.3
        kept = inside & off_path & off_cliff
        v = h[kept]
        if v.size == 0:
            lines.append(f"  {code} 대지 — 잴 자리가 없다")
            continue
        bad = np.abs(v - elevation)
        k = int(np.argmax(bad))
        xs = X[kept][k]; zs = Z[kept][k]
        all_cells = int(inside.sum())
        lines.append(f"  {code} 대지 EL {elevation:+.0f} → 편차 최대 {bad.max():.3f} m "
                  f"@({xs:.1f}, {zs:.1f}) · 평균 {bad.mean():.3f} · "
                  f"{v.size:,}/{all_cells:,}점 검사")
        excluded = inside & ~kept
        if excluded.any():
            w2 = np.abs(h[excluded] - elevation)
            k2 = int(np.argmax(w2))
            lines.append(f"       └ 뺀 칸 {int(excluded.sum()):,}개(길 흙일·절벽) "
                      f"편차 최대 {w2.max():.2f} m @({X[excluded][k2]:.1f}, {Z[excluded][k2]:.1f})")
    for code, width, start, end, points in PATHS:
        d, frac, total = path_field(X, Z, points)
        inside = d <= width / 2 - 0.2
        ramp = start + (end - start) * frac
        error = np.abs(h - ramp)[inside]
        grade = math.degrees(math.atan2(abs(end - start), total))
        lines.append(f"  {code} 노면 길이 {total:.1f} m · 경사 {grade:.1f}° · "
                  f"램프 오차 최대 {error.max():.3f} m")
    # 절벽 각도 — X 를 따라 마루~발치 단면을 재 본다
    angles = []
    for xv in np.arange(36.0, 55.0, 1.0):
        col = np.abs(X[0] - xv).argmin()
        column = h[:, col]
        zcol = Z[:, col]
        up = zcol[(zcol > 20) & (zcol < 32)]
        hi = column[(zcol > 20) & (zcol < 32)]
        try:
            # 74° 는 마루에서 발치까지 14 m 다 — 12 m/2 m 로 재면 늘 더 가파르게 나온다
            z_top = up[np.where(hi > CLIFF["height"] - 0.7)[0].max()]
            z_bottom = up[np.where(hi < 0.7)[0].min()]
            if z_bottom > z_top:
                angles.append(math.degrees(math.atan2(CLIFF["height"], z_bottom - z_top)))
        except ValueError:
            pass
    if angles:
        lines.append(f"  절벽 실각 {min(angles):.0f}° ~ {max(angles):.0f}° (중앙 {sorted(angles)[len(angles)//2]:.0f}°) · 도면 74°")
    lines.append(f"  높이 범위 {h.min():.2f} ~ {h.max():.2f} m")
    return "\n".join(lines)


def shade_smooth(ob, angle=38.0):
    """각도 기준으로 셰이딩을 부드럽게 — 흙비탈은 잇고 옹벽·벼랑(38° 넘는 꺾임)은 날을 살린다."""
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    ob.select_set(False)


def measure_normals(ob):
    """면 법선이 위를 보는지 — 워크벤치 렌더는 양면이라 뒤집혀도 안 드러난다."""
    me = ob.data
    normals = np.empty(len(me.polygons) * 3, dtype=np.float32)
    me.polygons.foreach_get("normal", normals)
    z = normals.reshape(-1, 3)[:, 2]          # 블렌더 Z = 높이
    up = float(np.mean(z > 0) * 100)
    return f"  법선 위를 보는 면 {up:.1f}% (100 에 가까워야 한다 · 평균 z {z.mean():+.3f})"


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = "assets/terrain.glb"
    if "--out" in args:
        out = args[args.index("--out") + 1]
    out = os.path.abspath(out)

    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    X, Z, h, nx, nz, lock = build_heights()
    print(f"  높이 지음 {nx}×{nz} · {time.time()-t0:.1f}s")
    print(measure(X, Z, h))

    ob = make_mesh(X, Z, h, nx, nz)
    print(f"  메시 {len(ob.data.vertices):,} 꼭짓점 · {len(ob.data.polygons):,} 면 "
          f"({len(ob.data.polygons)*2:,} 삼각형)")
    unwrap_uv(ob)
    paint_colors(ob, X, Z, h, lock, nx, nz)
    shade_smooth(ob)
    print(measure_normals(ob))
    export_glb(out)
    table = os.path.join(os.path.dirname(out), "terrain-height.bin")
    lo, hi, size = export_height_table(h, lock, nx, nz, table)
    print(f"  → {table}  {size/1024:.0f} KB  ({lo:.2f} ~ {hi:.2f} m)")
    print(f"  → {out}  {os.path.getsize(out)/1024/1024:.2f} MB  ({time.time()-t0:.1f}s)")


main()
