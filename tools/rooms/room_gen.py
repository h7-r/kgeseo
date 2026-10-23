#!/usr/bin/env python3
# room_gen.py — 빈 한옥 방(앞벽·지붕 없는 단면) 생성기 시험판 v0 (2026-10-20)
#   python3 room_gen.py spec.json out.glb   → out.glb + out.json(배치용 정보)
# 단위 m, y 위. 방 안쪽: x 0..W(왼→오), z 0(뒤벽)..D(앞, 열림). 재질: 행궁 온돌(KCISA)·신라 가옥(KHS) 텍스처 재사용(CC BY).
import json, sys, math, numpy as np, trimesh
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance
HERE = Path(__file__).resolve().parent; TEX = HERE / "tex"

def tinted(name, tint=None, size=512, seams=None, bright=1.0):
    im = Image.open(TEX / f"{name}.png").convert("RGB").resize((size, size))
    if bright != 1.0: im = ImageEnhance.Brightness(im).enhance(bright)
    if tint:
        a = np.asarray(im).astype(float) / 255; t = np.array(tint) / 255
        g = a.mean(axis=2, keepdims=True); im = Image.fromarray((np.clip(g * t * 1.25, 0, 1) * 255).astype(np.uint8))
    if seams:  # 장판 이음매
        d = ImageDraw.Draw(im); n = seams
        for i in range(n + 1):
            p = int(i * size / n); d.line([(p, 0), (p, size)], fill=(120, 80, 30), width=3); d.line([(0, p), (size, p)], fill=(120, 80, 30), width=3)
    return im

MATS = {}
def clay_texture(size=512, seed=5):
    from PIL import ImageFilter
    rng = np.random.default_rng(seed); n = np.zeros((size, size))
    for k, amp in ((4, 1.0), (8, 0.5), (32, 0.18)):
        g = np.kron(rng.normal(size=(k, k)), np.ones((size // k, size // k)))
        g = np.asarray(Image.fromarray(((g - g.min()) / (np.ptp(g) + 1e-9) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(size / k / 2)), float) / 255 - 0.5
        n += amp * g
    base = np.array([168, 120, 82], float); img = base[None, None, :] * (1 + 0.22 * n)[..., None]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    for _ in range(70):   # 손으로 문지른 결(짧고 휜 밝은·어두운 줄)
        x, y = rng.integers(0, size, 2); L = rng.integers(30, 90); a = rng.uniform(-0.5, 0.5); c = int(rng.choice([-14, 12]))
        pts = [(x + t * math.cos(a), y + t * math.sin(a) + 6 * math.sin(t / 18)) for t in range(0, int(L), 6)]
        d.line(pts, fill=tuple(int(v + c) for v in base), width=int(rng.integers(3, 7)))
    for _ in range(9):    # 마른 흙 잔금
        x, y = rng.integers(0, size, 2); pts = [(x, y)]
        for _ in range(rng.integers(3, 7)): x += rng.integers(-18, 18); y += rng.integers(6, 22); pts.append((x, y))
        d.line(pts, fill=(96, 66, 44), width=1)
    return im.filter(ImageFilter.GaussianBlur(0.6))

def char_texture(size=256, seed=9):
    rng = np.random.default_rng(seed); img = np.full((size, size, 3), 24, float)
    img += rng.normal(0, 6, (size, size))[..., None]
    for y in range(0, size, int(rng.integers(10, 16))):   # 숯 갈라짐(가로 줄)
        img[y:y + 2] = 8
    for x in range(0, size, 23): img[:, x:x + 1] *= 0.6
    img[..., 0] += 4
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

def soot_decal(size=256, seed=4):
    rng = np.random.default_rng(seed); y, x = np.mgrid[0:size, 0:size] / size
    # 아궁이 입 위쪽으로 번진 그을음: 아래 가운데가 진하고 위로 갈수록 옅게, 가장자리는 들쭉날쭉
    d = np.sqrt(((x - 0.5) / 0.42) ** 2 + ((y - 0.78) / 0.75) ** 2)
    from PIL import ImageFilter
    g = np.kron(rng.normal(size=(16, 16)), np.ones((size // 16, size // 16)))
    g = np.asarray(Image.fromarray(((g - g.min()) / (np.ptp(g) + 1e-9) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), float) / 255
    a = np.clip(1.0 - d + (g - 0.5) * 0.5, 0, 1) ** 1.4 * 0.85
    rgba = np.zeros((size, size, 4), np.uint8); rgba[..., :3] = np.array([30, 22, 16]); rgba[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")

def earth_texture(size=512, seed=3):
    rng = np.random.default_rng(seed); img = np.zeros((size, size, 3))
    base = np.array([138, 104, 72], float)
    n = np.zeros((size, size))
    for k, amp in ((4, 1.0), (8, 0.6), (16, 0.35), (64, 0.2)):   # 여러 겹 얼룩(이어 붙여도 이음매 없게 주기 맞춤)
        g = rng.normal(size=(k, k)); g = np.kron(g, np.ones((size // k, size // k)))
        from PIL import ImageFilter
        g = np.asarray(Image.fromarray(((g - g.min()) / (np.ptp(g) + 1e-9) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(size / k / 2)), float) / 255 - 0.5
        n += amp * g
    img[:] = base; img *= (1 + 0.28 * n)[..., None]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    for _ in range(260):   # 잔돌·흙덩이
        x, y = rng.integers(0, size, 2); r = rng.integers(1, 4); c = int(rng.integers(150, 200)); c2 = int(rng.integers(60, 95))
        col = (c, c - 20, c - 45) if rng.random() < 0.6 else (c2, c2 - 12, c2 - 22)
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    return im
WALLKEY = ["plaster"]
def mat(key):
    if key in MATS: return MATS[key]
    if key == "soot_decal":
        MATS[key] = trimesh.visual.material.PBRMaterial(name=key, baseColorTexture=soot_decal(), alphaMode="BLEND", metallicFactor=0.0, roughnessFactor=1.0, doubleSided=True); return MATS[key]
    if key == "ember":   # 불씨: 텍스처 없이 스스로 빛나는 주황
        MATS[key] = trimesh.visual.material.PBRMaterial(name=key, baseColorFactor=[255, 120, 40, 255], emissiveFactor=[1.0, 0.42, 0.1], metallicFactor=0.0, roughnessFactor=0.8); return MATS[key]
    spec = {
        "wood":   ("sl_M_24ET0028_Pillar", None, 1.0, None),
        "wood_dk":("sl_M_24ET0028_Pillar", None, 0.7, None),
        "plaster":("sl_M_24ET0028_Concrete01", (232, 214, 182), 1.0, None),
        "paper":  ("hg_MI_KoreanPaper_1", (250, 240, 215), 1.0, None),
        "floor":  ("sl_M_24ET0028_Floor", (214, 160, 70), 1.0, 1),
        "stone":  ("hg_MI_KoreanStone_1", None, 0.85, None),
        "maru":   ("sl_M_24ET0028_Wood_02", None, 1.05, None),
        "hanji":  ("hg_MI_KoreanPaper_1", (246, 236, 212), 1.0, None),
        "ceil_paper": ("hg_MI_KoreanPaper_1", (246, 238, 216), 1.0, None),
        "cloth_a":("hg_MI_KoreanPaper_1", (70, 86, 128), 1.0, None),
        "cloth_b":("hg_MI_KoreanPaper_1", (236, 228, 210), 1.0, None),
        "cloth_c":("hg_MI_KoreanPaper_1", (150, 92, 70), 1.0, None),
        "earth":  ("hg_MI_KoreanStone_1", (150, 112, 74), 0.9, None),
        "clay":   ("hg_MI_KoreanStone_1", (176, 140, 100), 1.0, None),
        "soot":   ("hg_MI_KoreanStone_1", (34, 28, 24), 1.0, None),
        "char":   ("hg_MI_KoreanStone_1", None, 1.0, None),
        "ash":    ("hg_MI_KoreanStone_1", (118, 108, 98), 0.95, None),
    }[key]
    im = ceil_paper_texture() if key == "ceil_paper" else maru_texture() if key == "maru" else earth_texture() if key == "earth" else clay_texture() if key == "clay" else char_texture() if key == "char" else tinted(spec[0], spec[1], bright=spec[2], seams=spec[3])
    MATS[key] = trimesh.visual.material.PBRMaterial(name=key, baseColorTexture=im, metallicFactor=0.0, roughnessFactor=0.9)
    return MATS[key]
TILE = {"soot_decal": 1.0, "ember": 1.0, "char": 0.3, "ash": 0.6, "clay": 1.0, "soot": 0.5, "hanji": 0.9, "cloth_a": 0.5, "cloth_b": 0.5, "cloth_c": 0.5, "maru": 0.9, "ceil_paper": 0.9, "earth": 1.5, "wood": 1.0, "wood_dk": 1.0, "plaster": 1.5, "paper": 0.6, "floor": 0.9, "stone": 1.2}

def box(lo, hi, key):
    """축 정렬 상자. UV = 면 크기(m)/타일 크기 → 늘어남 없음."""
    lo = np.array(lo, float); hi = np.array(hi, float); s = TILE[key]
    V = []; F = []; UV = []
    faces = [  # (축, 부호)
        (0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)]
    for ax, sg in faces:
        u_ax, v_ax = [a for a in range(3) if a != ax]
        c = hi[ax] if sg > 0 else lo[ax]
        quad = []
        for (uu, vv) in [(0, 0), (1, 0), (1, 1), (0, 1)]:
            p = np.zeros(3); p[ax] = c
            p[u_ax] = lo[u_ax] if uu == 0 else hi[u_ax]; p[v_ax] = lo[v_ax] if vv == 0 else hi[v_ax]
            quad.append(p)
        b = len(V); V += quad
        for p in quad: UV.append([p[u_ax] / s, p[v_ax] / s])
        tri = [[b, b + 1, b + 2], [b, b + 2, b + 3]]
        # 바깥을 보도록 감기 방향 맞춤
        n = np.cross(quad[1] - quad[0], quad[2] - quad[0])
        if np.sign(n[ax]) != sg: tri = [[t[0], t[2], t[1]] for t in tri]
        F += tri
    return np.array(V), np.array(F), np.array(UV)

class Part:
    def __init__(self): self.by = {}
    def add(self, lo, hi, key, T=None):
        v, f, uv = box(lo, hi, key)
        if T is not None: v = (np.c_[v, np.ones(len(v))] @ np.asarray(T).T)[:, :3]
        self.by.setdefault(key, []).append((v, f, uv))
    def add_raw(self, v, f, uv, key): self.by.setdefault(key, []).append((np.asarray(v, float), np.asarray(f), np.asarray(uv, float)))
    def meshes(self):
        out = []
        for key, bs in self.by.items():
            V = []; F = []; UV = []; o = 0
            for v, f, uv in bs: V.append(v); F.append(f + o); UV.append(uv); o += len(v)
            m = trimesh.Trimesh(np.vstack(V), np.vstack(F), process=False)
            m.visual = trimesh.visual.TextureVisuals(uv=np.vstack(UV), material=mat(key)); _ = m.vertex_normals   # 법선을 꼭 넣는다(없으면 툰 셰이딩이 검게 나옴)
            out.append((key, m))
        return out

def wall(part, a, b, y0, h, t, openings, key="plaster"):
    key = WALLKEY[0]
    """a→b 선 위의 벽(x 또는 z 축 방향). openings: [{u(벽 시작에서 중심까지), w, sill, h}] → 구멍 뺀 칸 상자."""
    a = np.array(a, float); b = np.array(b, float); L = np.linalg.norm(b - a); d = (b - a) / L
    ax = 0 if abs(d[0]) > 0.5 else 2; nx = 2 if ax == 0 else 0
    us = sorted({0, L, *[o["u"] - o["w"] / 2 for o in openings], *[o["u"] + o["w"] / 2 for o in openings]})
    vs = sorted({0, h, *[o["sill"] for o in openings], *[o["sill"] + o["h"] for o in openings]})
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            uc = (us[i] + us[i + 1]) / 2; vc = (vs[j] + vs[j + 1]) / 2
            if any(abs(uc - o["u"]) < o["w"] / 2 and o["sill"] < vc < o["sill"] + o["h"] for o in openings): continue
            p0 = a + d * us[i]; p1 = a + d * us[i + 1]
            lo = [0, 0, 0]; hi = [0, 0, 0]
            lo[ax] = min(p0[ax], p1[ax]); hi[ax] = max(p0[ax], p1[ax])
            lo[nx] = a[nx] - t / 2; hi[nx] = a[nx] + t / 2; lo[1] = y0 + vs[j]; hi[1] = y0 + vs[j + 1]
            part.add(lo, hi, key)
    return ax, nx

def framed_panel(kind, w, h, depth=0.05):
    """문(띠살)·창(정자살)·벽장문 — 원점 = 아래 왼쪽 경첩, x 방향 폭, y 높이, z 두께."""
    P = Part(); f = 0.06
    for lo, hi in [([0, 0, 0], [f, h, depth]), ([w - f, 0, 0], [w, h, depth]), ([0, 0, 0], [w, f, depth]), ([0, h - f, 0], [w, h, depth])]:
        P.add(lo, hi, "wood_dk")
    P.add([f, f, depth * 0.45], [w - f, h - f, depth * 0.55], "wood" if kind == "closet" else "paper")
    bar = 0.018
    if kind == "door":   # 띠살: 세로살 촘촘 + 가로 띠 3곳
        n = max(4, int((w - 2 * f) / 0.07))
        for i in range(1, n): x = f + i * (w - 2 * f) / n; P.add([x - bar / 2, f, depth * 0.6], [x + bar / 2, h - f, depth * 0.8], "wood_dk")
        for yy in (0.18, 0.5, 0.82):
            y = f + yy * (h - 2 * f); P.add([f, y - 0.03, depth * 0.6], [w - f, y + 0.03, depth * 0.85], "wood_dk")
    elif kind == "window":  # 정자살
        nx = max(3, int((w - 2 * f) / 0.12)); ny = max(3, int((h - 2 * f) / 0.12))
        for i in range(1, nx): x = f + i * (w - 2 * f) / nx; P.add([x - bar / 2, f, depth * 0.6], [x + bar / 2, h - f, depth * 0.8], "wood_dk")
        for j in range(1, ny): y = f + j * (h - 2 * f) / ny; P.add([f, y - bar / 2, depth * 0.6], [w - f, y + bar / 2, depth * 0.8], "wood_dk")
    elif kind == "closet":  # 벽장 두 짝
        P.add([w / 2 - 0.02, f, depth * 0.6], [w / 2 + 0.02, h - f, depth * 0.85], "wood_dk")
    return P

def rot_y(deg):
    T = trimesh.transformations.rotation_matrix(math.radians(deg), [0, 1, 0]); return T

def maru_texture(N=512):
    """우물마루 한 장(0.9 m) — 동귀틀 띠 + 청판 4장. 이어 붙여도 이음매가 안 보이게 가장자리를 맞춘다(10/22)."""
    rng = np.random.default_rng(11)
    img = np.zeros((N, N, 3), float)
    xs = np.arange(N)[None, :] / N; ys = np.arange(N)[:, None] / N
    beam = 0.12
    # 청판(가로) — 결은 x 방향으로 길게
    for k in range(4):
        y0, y1 = int(N * k / 4), int(N * (k + 1) / 4)
        tone = np.array([176, 128, 82]) * (0.92 + 0.14 * rng.random())
        yy = ys[y0:y1]
        grain = 0.05 * np.sin(2 * np.pi * (yy * 38 + 0.6 * np.sin(2 * np.pi * (xs * 2 + k * 0.37)))) + 0.025 * np.sin(2 * np.pi * (yy * 97 + xs * 3 + k))
        img[y0:y1] = tone[None, None, :] * (1 + grain)[..., None]
        img[y0:y0 + 3] *= 0.55; img[y1 - 2:y1] *= 0.7            # 판 사이 틈
    # 동귀틀(세로 띠) — 결은 y 방향
    bw = int(N * beam)
    g2 = 0.05 * np.sin(2 * np.pi * (xs[:, :bw] * 30 + 0.5 * np.sin(2 * np.pi * ys * 1.0))) + 0.02 * np.sin(2 * np.pi * (xs[:, :bw] * 80 + ys * 2))
    img[:, :bw] = np.array([140, 98, 62])[None, None, :] * (1 + g2)[..., None]
    img[:, :2] *= 0.6; img[:, bw - 3:bw] *= 0.55                  # 귀틀 가장자리 그늘
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

def ceil_paper_texture(N=512):
    """종이반자 한 장 묶음(0.9 m) — 한지 위에 종이 이음 겹침 자국을 옅게(10/22)."""
    im = tinted("hg_MI_KoreanPaper_1", (246, 238, 216), size=N).convert("RGB")
    a = np.asarray(im).astype(float)
    def hline(y, x0, x1): a[max(0, y - 1):y + 2, x0:x1] *= 0.93
    def vline(x, y0, y1): a[y0:y1, max(0, x - 1):x + 2] *= 0.93
    rows = [0, N // 2]
    for r, y in enumerate(rows):
        hline(y, 0, N)
        off = 0 if r == 0 else N // 3
        for x in (off, off + int(N * 0.66)):
            x %= N; vline(x, y, y + N // 2)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def build(spec):
    K = spec.get("kan_m", 2.4); nx_ = spec.get("kan_x", 2); D = spec.get("depth_m", 3.0)
    WALLKEY[0] = {"plaster": "plaster", "hanji": "hanji"}[spec.get("wall", "plaster")]
    W = K * nx_; H = spec.get("wall_h", 2.3); Y = spec.get("floor_lift", 0.45); t = 0.14; ps = 0.2
    scene = trimesh.Scene(); info = {"spec": spec, "units": "m", "floor_y": Y, "nodes": {}, "walk": None, "wall_zones": [], "openings": []}
    def put(name, part, T=np.eye(4), role="static", extra=None):
        base_ = name; k = 2
        while name in info["nodes"]: name = f"{base_}_{k}"; k += 1
        for key, m in part.meshes():
            scene.add_geometry(m, node_name=f"{name}__{key}", geom_name=f"{name}__{key}", transform=T)
        info["nodes"][name] = {"role": role, **(extra or {})}
    # 기단·주춧돌
    OM = set(spec.get("omit_walls", []))   # 이웃 방이 대신 짓는 벽(같은 벽을 두 번 짓지 않음) — 정보(구멍·기댈 자리)는 남김
    def skipx(x): return (abs(x) < 1e-6 and "left" in OM) or (abs(x - W) < 1e-6 and "right" in OM)
    if spec.get("base", True):
        base = Part(); base.add([-0.45, 0, -0.45], [W + 0.45, Y - 0.04, D + 0.45], "stone"); put("기단", base)
    # 바닥(장판)
    fk = {"jangpan": "floor", "maru": "maru", "earth": "earth"}[spec.get("floor", "jangpan")]
    fl = Part()
    if fk == "earth":
        rng = np.random.default_rng(spec.get("seed", 11)); st = 0.08
        xs_ = np.arange(0, W + 1e-6, st); zs_ = np.arange(0, D + 1e-6, st); nx, nz = len(xs_), len(zs_)
        X, Zg = np.meshgrid(xs_, zs_, indexing="ij"); Hh = np.zeros_like(X)
        for _ in range(6):   # 완만한 기복
            kx, kz, ph = rng.uniform(0.8, 3.0), rng.uniform(0.8, 3.0), rng.uniform(0, 6.3)
            Hh += np.sin(X * kx + ph) * np.cos(Zg * kz + ph * 0.7)
        Hh = Hh / np.abs(Hh).max() * 0.018
        for _ in range(18):  # 패이거나 볼록한 곳(발에 밟혀 다져진 자리)
            cx, cz, rr, a = rng.uniform(0, W), rng.uniform(0, D), rng.uniform(0.15, 0.45), rng.uniform(-0.012, 0.008)
            Hh += a * np.exp(-((X - cx) ** 2 + (Zg - cz) ** 2) / rr ** 2)
        Hh += rng.normal(0, 0.002, Hh.shape)
        edge = np.clip(np.minimum.reduce([X, W - X, Zg, D - Zg]) / 0.3, 0, 1); Hh *= edge
        V = np.c_[X.ravel(), (Y + Hh).ravel(), Zg.ravel()]; UV = np.c_[X.ravel() / 1.5, Zg.ravel() / 1.5]
        F = []
        for i in range(nx - 1):
            for j in range(nz - 1):
                a0 = i * nz + j; b0 = (i + 1) * nz + j
                F += [[a0, a0 + 1, b0 + 1], [a0, b0 + 1, b0]]
        fl.add_raw(V, F, UV, "earth"); fl.add([0, Y - 0.06, 0], [W, Y - 0.02, D], "earth")
        info["floor_relief_m"] = round(float(np.abs(Hh).max()), 3)
    else:
        fl.add([0, Y - 0.04, 0], [W, Y, D], fk)
    put("바닥", fl, role="walkable", extra={"floor": spec.get("floor", "jangpan")})
    info["walk"] = {"x": [t / 2 + 0.02, W - t / 2 - 0.02], "z": [t / 2 + 0.02, D], "y": Y}
    # 기둥
    po = Part(); xs = [i * K for i in range(nx_ + 1)]
    ff = spec.get("front_frame", False)
    for x in xs:
        if skipx(x): continue
        for z in ((0, D) if (ff or x in (xs[0], xs[-1])) else (0,)): po.add([x - ps / 2, Y - 0.04, z - ps / 2], [x + ps / 2, Y + H + 0.3, z + ps / 2], "wood")
    put("기둥", po)
    # 벽 + 구멍
    ops = {"back": [], "left": [], "right": [], "front": []}
    has_front = spec.get("front_wall", True)
    for o in spec.get("openings", []): ops[o["wall"]].append(o)
    def u_of(o, L):  # kan 번호 + 칸 안 위치(0..1)
        return o["kan"] * K + K * o.get("at", 0.5) if o["wall"] in ("back", "front") else min(L, max(0, o.get("at", 0.5) * L))
    walls = {"back": ([0, Y, 0], [W, Y, 0], [0, 0, 1]), "left": ([0, Y, 0], [0, Y, D], [1, 0, 0]), "right": ([W, Y, 0], [W, Y, D], [-1, 0, 0])}
    if has_front: walls["front"] = ([0, Y, D], [W, Y, D], [0, 0, -1])
    wl_main = Part(); frame_main = Part(); wl_f = Part(); frame_f = Part()
    for wn, (a, b, nrm) in walls.items():
        wl, frame = (wl_f, frame_f) if wn == "front" else (wl_main, frame_main)
        L = np.linalg.norm(np.array(b) - np.array(a))
        holes = [{"u": u_of(o, L), "w": o["w"], "sill": o.get("sill", 0.0), "h": o["h"], "o": o} for o in ops[wn] if o["type"] != "closet"]
        if wn in OM: wl, frame = Part(), Part()   # 짓지 않음(버리는 그릇)
        ax, nax = wall(wl, a, b, Y, H, t, holes)
        a_ = np.array(a, float); d = (np.array(b, float) - a_) / L
        # 인방(아래·위 가로 나무)
        for y0, y1 in ((Y, Y + 0.12), (Y + H - 0.16, Y + H)):
            lo = [0, y0, 0]; hi = [0, y1, 0]; lo[ax] = min(a_[ax], b[ax]); hi[ax] = max(a_[ax], b[ax]); lo[nax] = a_[nax] - t / 2 - 0.02; hi[nax] = a_[nax] + t / 2 + 0.02
            frame.add(lo, hi, "wood")
        # 벽에 기댈 자리: 문·벽장은 피하고, 창 밑은 창턱보다 낮은 것만(구간을 창 가장자리에서 나눠 높이 제한)
        blocked = [(h["u"] - h["w"] / 2 - 0.1, h["u"] + h["w"] / 2 + 0.1) for h in holes if h["o"]["type"] == "door"] + \
                  [(u_of(o, L) - o["w"] / 2, u_of(o, L) + o["w"] / 2) for o in ops[wn] if o["type"] == "closet" and o.get("sill", 0) < 0.9]
        wins = [(h["u"] - h["w"] / 2 - 0.06, h["u"] + h["w"] / 2 + 0.06, h["sill"]) for h in holes if h["o"]["type"] == "window"]
        free = [(ps / 2 + 0.05, L - ps / 2 - 0.05)]
        for bl in blocked:
            nf = []
            for s, e in free:
                if bl[1] <= s or bl[0] >= e: nf.append((s, e)); continue
                if bl[0] > s: nf.append((s, bl[0]))
                if bl[1] < e: nf.append((bl[1], e))
            free = nf
        pieces = []
        for s, e in free:
            cuts = sorted({s, e, *[c for w0, w1, _ in wins for c in (w0, w1) if s < c < e]})
            for c0, c1 in zip(cuts, cuts[1:]):
                mid = (c0 + c1) / 2; mh = min([H] + [sl for w0, w1, sl in wins if w0 <= mid <= w1])
                if pieces and abs(pieces[-1][1] - c0) < 1e-6 and abs(pieces[-1][2] - mh) < 1e-6: pieces[-1] = (pieces[-1][0], c1, mh)
                else: pieces.append((c0, c1, mh))
        merged = [(s0, e0, min([pc[2] for pc in pieces if s0 - 1e-6 <= pc[0] and pc[1] <= e0 + 1e-6] or [H])) for s0, e0 in free]
        merged = [m for m in merged if not any(abs(m[0] - pc[0]) < 1e-6 and abs(m[1] - pc[1]) < 1e-6 for pc in pieces)]
        for s, e, mh in ((pieces + merged) if wn != "front" else []):   # 앞벽은 위에서 볼 때 숨기므로 기댈 자리로 안 씀 / 창을 걸치는 긴 구간도(낮은 것만)
            if e - s > 0.3:
                p0 = a_ + d * s + np.array(nrm) * t / 2; p1 = a_ + d * e + np.array(nrm) * t / 2
                info["wall_zones"].append({"wall": wn, "from": np.round(p0, 3).tolist(), "to": np.round(p1, 3).tolist(), "normal": nrm, "max_h": round(mh, 2)})
        # 문·창·벽장
        for o in ops[wn]:
            u = u_of(o, L); sill = o.get("sill", 0.0); w = o["w"]; h = o["h"]
            P = framed_panel(o["type"], w, h)
            start = a_ + d * (u - w / 2)
            T = np.eye(4)
            if wn == "back": T[:3, 3] = [start[0], Y + sill, -0.025 if o["type"] != "closet" else t / 2]
            elif wn == "front": T[:3, 3] = [start[0], Y + sill, D - 0.025]
            elif wn == "left": T = rot_y(-90); T[:3, 3] = [-0.025 if o["type"] != "closet" else t / 2 + 0.05, Y + sill, start[2]]
            else: T = rot_y(90); T[:3, 3] = [W + (0.025 if o["type"] != "closet" else -t / 2 - 0.05), Y + sill, start[2] + w]
            name = {"door": "문", "window": "창", "closet": "벽장"}[o["type"]] + f"_{wn}"
            if wn in OM: P = Part()
            put(name, P, T, role="interactive", extra={"built_by_neighbor": wn in OM, "link": o.get("link"), "cutaway": wn == "front", "type": o["type"], "wall": wn, "hinge": np.round(T[:3, 3], 3).tolist(), "w": w, "h": h, "sill": sill})
            info["openings"].append({"name": list(info["nodes"])[-1], **{k: v for k, v in o.items()}})
            # 문얼굴(구멍 테두리)
            if o["type"] != "closet":
                for (u0, u1, v0, v1) in ((u - w / 2 - 0.06, u - w / 2 + 0.004, sill, sill + h), (u + w / 2 - 0.004, u + w / 2 + 0.06, sill, sill + h), (u - w / 2 - 0.06, u + w / 2 + 0.06, sill + h - 0.004, sill + h + 0.06)) + (((u - w / 2 - 0.06, u + w / 2 + 0.06, sill - 0.06, sill + 0.004),) if sill > 0 else ()):  # 10/22: 구멍 안으로 4 mm — 벽 옆면과 같은 평면 겹침(깜빡임) 방지
                    p0 = a_ + d * u0; p1 = a_ + d * u1; lo = [0, Y + v0, 0]; hi = [0, Y + v1, 0]
                    lo[ax] = min(p0[ax], p1[ax]); hi[ax] = max(p0[ax], p1[ax]); lo[nax] = a_[nax] - t / 2 - 0.03; hi[nax] = a_[nax] + t / 2 + 0.03
                    frame.add(lo, hi, "wood")
    put("벽", wl_main); put("인방_문얼굴", frame_main)
    if has_front: put("앞벽", wl_f, role="cutaway"); put("앞벽_인방", frame_f, role="cutaway")
    info["surfaces"] = []
    WL = {"back": (np.array([0, 0, 0.0]), np.array([1, 0, 0.0]), np.array([0, 0, 1.0])),
          "left": (np.array([0, 0, 0.0]), np.array([0, 0, 1.0]), np.array([1, 0, 0.0])),
          "right": (np.array([W, 0, 0.0]), np.array([0, 0, 1.0]), np.array([-1, 0, 0.0]))}
    def P(wn, u, off, y): a, d, n = WL[wn]; q = a + d * u + n * (t / 2 + off); return np.array([q[0], y, q[2]])
    def bar(part, wn, u0, u1, off0, off1, y0, y1, key):
        p0 = P(wn, u0, off0, y0); p1 = P(wn, u1, off1, y1); part.add(np.minimum(p0, p1), np.maximum(p0, p1), key)
    # 머름(창 밑 나무 판) — 창턱이 높은 창 아래
    mr = Part()
    for o in ops["back"] + ops["left"] + ops["right"]:
        if o["type"] == "window" and 0.4 <= o.get("sill", 0) <= 1.0:
            L = W if o["wall"] == "back" else D; u = u_of(o, L)
            bar(mr, o["wall"], u - o["w"] / 2 - 0.06, u + o["w"] / 2 + 0.06, 0.0, 0.03, Y, Y + o["sill"] - 0.06, "wood_dk")
            for k in range(1, 4):
                uu = u - o["w"] / 2 + k * o["w"] / 4; bar(mr, o["wall"], uu - 0.02, uu + 0.02, 0.03, 0.045, Y + 0.05, Y + o["sill"] - 0.1, "wood")
    if mr.by: put("머름", mr)
    # 시렁(벽에 건너지른 선반 두 줄) — 올려놓을 자리로 기록
    for i, sh in enumerate(spec.get("shelves", [])):
        sp = Part(); wn = sh["wall"]; u0, u1 = sh["from"], sh["to"]; y = Y + sh["y"]; dp = sh.get("depth", 0.32)
        for off in (0.04, dp - 0.04): bar(sp, wn, u0, u1, off - 0.025, off + 0.025, y - 0.05, y, "wood")
        for u in (u0 + 0.08, u1 - 0.08):  # 받침 나무(까치발)
            bar(sp, wn, u - 0.025, u + 0.025, 0.0, dp, y - 0.09, y - 0.05, "wood_dk"); bar(sp, wn, u - 0.025, u + 0.025, 0.0, 0.04, y - 0.3, y - 0.05, "wood_dk")
        nm = f"시렁_{wn}" + (f"_{i+1}" if i else ""); put(nm, sp, role="surface")
        q0 = P(wn, u0, 0.0, y); q1 = P(wn, u1, dp, y)
        info["surfaces"].append({"name": nm, "rect": [round(min(q0[0], q1[0]), 3), round(min(q0[2], q1[2]), 3), round(max(q0[0], q1[0]), 3), round(max(q0[2], q1[2]), 3)], "y": round(y, 3), "kind": "shelf"})
    # 부뚜막: 흙으로 쌓은 단 + 아궁이(앞면 불 때는 구멍) + 솥 자리(위에 솥을 올림) — 아궁이는 상호작용 후보
    info.setdefault("keep", []); info.setdefault("blocked_wall", [])
    for i, bt in enumerate(spec.get("buttumak", [])):
        wn = bt["wall"]; u0, u1 = bt["from"], bt["to"]; hh = bt.get("h", 0.55); dp = bt.get("depth", 0.8); n = bt.get("n", 2)
        bp = RG_Part = Part(); bar(bp, wn, u0, u1, 0.0, dp, Y, Y + hh, "clay"); bar(bp, wn, u0 - 0.02, u1 + 0.02, 0.0, dp + 0.03, Y + hh - 0.04, Y + hh, "clay")
        seg = (u1 - u0) / n
        for k in range(n):
            uc = u0 + seg * (k + 0.5); ap = Part()
            bar(ap, wn, uc - 0.19, uc + 0.19, dp - 0.01, dp + 0.006, Y, Y + 0.3, "soot")           # 아궁이 구멍(검게 그을린 입)
            bar(ap, wn, uc - 0.25, uc + 0.25, dp - 0.005, dp + 0.04, Y + 0.3, Y + 0.37, "clay")     # 이맛돌(흙으로 바른 턱)
            bar(bp, wn, uc - 0.3, uc + 0.3, 0.12, dp - 0.12, Y + hh, Y + hh + 0.005, "soot")        # 솥 자리(그을린 테) — 부뚜막 몸체에(솥을 눌렀을 때 아궁이로 잡히지 않게)
            rr = np.random.default_rng(spec.get("seed", 11) * 7 + k)
            a, d, nrm_ = WL[wn]
            # 아궁이 둘레 그을음: 반투명 데칼 한 장(입 위로 번지게) — 벽면 바로 앞
            c0 = P(wn, uc, dp + 0.008, Y + 0.33); w_, h_ = 0.36, 0.3
            V = [c0 + d * sx * w_ + np.array([0, sy * h_, 0]) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            ap.add_raw(V, [[0, 1, 2], [0, 2, 3]], [[0, 1], [1, 1], [1, 0], [0, 0]], "soot_decal")
            # 숯이 된 나무: 2~4개, 아궁이 안에서 바깥으로 비스듬히 튀어나옴(육각 기둥, 방향·길이·굵기 무작위)
            for j in range(int(rr.integers(2, 5))):
                L_ = rr.uniform(0.3, 0.52); r_ = rr.uniform(0.02, 0.036); inside_ = rr.uniform(0.06, 0.14)
                yaw_ = rr.uniform(-0.45, 0.45); tilt_ = rr.uniform(0.02, 0.14); off_ = rr.uniform(-0.12, 0.12)
                ux = d * math.sin(yaw_) + nrm_ * math.cos(yaw_); ux = ux / np.linalg.norm(ux); uy = np.array([0, 1.0, 0]); uz = np.cross(ux, uy)
                R_ = trimesh.transformations.rotation_matrix(tilt_, uz)[:3, :3]; ux2 = R_ @ ux; uy2 = R_ @ uy; uz2 = np.cross(ux2, uy2)
                T = np.eye(4); T[:3, 0] = uz2; T[:3, 1] = uy2; T[:3, 2] = ux2; T[:3, 3] = P(wn, uc + off_, dp - inside_, Y + 0.04 + r_)
                cyl = trimesh.creation.cylinder(radius=r_, height=L_, sections=6); cyl.apply_translation([0, 0, L_ / 2])
                cv = cyl.vertices; ang = np.arctan2(cv[:, 1], cv[:, 0]); uvc = np.c_[ang / (2 * math.pi) * 0.4, cv[:, 2] / 0.3]
                vv = (np.c_[cv, np.ones(len(cv))] @ T.T)[:, :3]; ap.add_raw(vv, cyl.faces, uvc, "char")
                if rr.random() < 0.7: ap.add([-r_ * 0.7, -r_ * 0.7, L_ - 0.03], [r_ * 0.7, r_ * 0.7, L_ + 0.004], "ember", T)   # 끝 불씨
            # 잿더미: 아궁이 앞 바닥의 낮은 둔덕(가장자리 들쭉날쭉, 최대 3 cm)
            cx_, cz_ = P(wn, uc, dp + 0.14, Y)[[0, 2]]; gx = np.linspace(-0.3, 0.3, 16); X_, Z_ = np.meshgrid(gx, gx, indexing="ij")
            rad = np.sqrt((X_ / 0.26) ** 2 + (Z_ / 0.2) ** 2) + rr.normal(0, 0.08, X_.shape)
            Hh_ = np.clip(1 - rad, 0, 1) ** 1.2 * rr.uniform(0.04, 0.055) + 0.006; Hh_[rad >= 1] = -0.06   # 둔덕 밖은 바닥 밑으로(네모난 가장자리가 안 보이게)
            Vv = np.c_[(cx_ + X_).ravel(), (Y + Hh_).ravel(), (cz_ + Z_).ravel()]; UVv = np.c_[X_.ravel() / 0.6, Z_.ravel() / 0.6]
            Ff = [[i * 16 + j, i * 16 + j + 1, (i + 1) * 16 + j + 1] for i in range(15) for j in range(15)] + [[i * 16 + j, (i + 1) * 16 + j + 1, (i + 1) * 16 + j] for i in range(15) for j in range(15)]
            ap.add_raw(Vv, Ff, UVv, "ash")
            for _ in range(7):   # 숯 부스러기
                du = rr.uniform(-0.3, 0.3); dn = rr.uniform(0.05, 0.42); c_ = rr.uniform(0.01, 0.024)
                bar(ap, wn, uc + du - c_, uc + du + c_, dp + dn - c_ * 0.7, dp + dn + c_ * 0.7, Y, Y + c_, "char")
            nm = f"아궁이_{k+1}"; put(nm, ap, role="interactive", extra={"type": "agungi", "wall": wn})
            c0 = P(wn, uc - 0.28, 0.14, Y + hh); c1 = P(wn, uc + 0.28, dp - 0.14, Y + hh)
            info["surfaces"].append({"name": f"솥자리_{k+1}", "rect": [round(min(c0[0], c1[0]), 3), round(min(c0[2], c1[2]), 3), round(max(c0[0], c1[0]), 3), round(max(c0[2], c1[2]), 3)], "y": round(Y + hh, 3), "kind": "pot_seat"})
        put(f"부뚜막_{wn}" + (f"_{i+1}" if i else ""), bp, role="fixture")
        q0 = P(wn, u0, 0.0, Y); q1 = P(wn, u1, dp + 0.6, Y)   # 부뚜막 + 불 때는 자리(앞 0.6 m)는 비움
        info["keep"].append({"why": "부뚜막·불 때는 자리", "rect": [round(min(q0[0], q1[0]), 3), round(min(q0[2], q1[2]), 3), round(max(q0[0], q1[0]), 3), round(max(q0[2], q1[2]), 3)]})
        info["blocked_wall"].append({"wall": wn, "from": u0, "to": u1})
        b0 = P(wn, u0, 0.0, Y); b1 = P(wn, u1, dp, Y)
        info.setdefault("solids", []).append({"name": f"부뚜막_{wn}", "rect": [round(min(b0[0], b1[0]), 3), round(min(b0[2], b1[2]), 3), round(max(b0[0], b1[0]), 3), round(max(b0[2], b1[2]), 3)], "h": hh})
        for k in range(n):
            uc = u0 + seg * (k + 0.5); q = P(wn, uc, dp + 0.12, Y + 0.15)
            info.setdefault("lights", []).append({"kind": "fire", "name": f"아궁이_{k+1} 불빛", "pos": [round(q[0], 3), round(q[1], 3), round(q[2], 3)], "color": "#ff7a30", "intensity": 0.9, "distance": 1.8})
    # 횃대(옷 거는 장대, 끈으로 매닮) + 걸린 옷
    for i, rl in enumerate(spec.get("rails", [])):
        rp = Part(); wn = rl["wall"]; u0, u1 = rl["from"], rl["to"]; y = Y + rl["y"]
        bar(rp, wn, u0, u1, 0.13, 0.17, y - 0.02, y + 0.02, "wood")
        for u in (u0 + 0.05, u1 - 0.05): bar(rp, wn, u - 0.006, u + 0.006, 0.144, 0.156, y, Y + H - 0.16, "wood_dk")
        for j, c in enumerate(rl.get("cloth", [])):
            cu = u0 + 0.15 + j * (u1 - u0 - 0.3) / max(1, len(rl["cloth"]) - 1) if len(rl["cloth"]) > 1 else (u0 + u1) / 2
            cw = c.get("w", 0.45); ch = c.get("h", 0.7)
            bar(rp, wn, cu - cw / 2, cu + cw / 2, 0.165, 0.18, y - ch, y + 0.025, c["mat"])     # 앞자락
            bar(rp, wn, cu - cw / 2, cu + cw / 2, 0.12, 0.135, y - ch * 0.8, y + 0.025, c["mat"])  # 뒷자락
            bar(rp, wn, cu - cw / 2, cu + cw / 2, 0.12, 0.18, y + 0.02, y + 0.035, c["mat"])  # 걸친 윗부분
        put(f"횃대_{wn}", rp, role="decor")
    # 도리·보(지붕은 뺌)
    bm = Part(); top = Y + H + 0.3
    for z in ((0, D) if ff else (0,)): bm.add([-0.25, top - 0.05, z - 0.09], [W + 0.25, top + 0.13, z + 0.09], "wood")
    for x in (xs if ff else (xs[0], xs[-1])):
        if not skipx(x): bm.add([x - 0.1, top + 0.13, -0.2], [x + 0.1, top + 0.33, D + 0.2], "wood")
    put("도리_보", bm)
    if has_front and not ff:   # 앞쪽 가운데 기둥·앞 도리·가운데 보 — 위에서 볼 땐 숨김
        fr = Part()
        for x in xs[1:-1]: fr.add([x - ps / 2, Y - 0.04, D - ps / 2], [x + ps / 2, Y + H + 0.3, D + ps / 2], "wood")
        fr.add([-0.25, top - 0.05, D - 0.09], [W + 0.25, top + 0.13, D + 0.09], "wood")
        for x in xs[1:-1]: fr.add([x - 0.1, top + 0.13, -0.2], [x + 0.1, top + 0.33, D + 0.2], "wood")
        put("앞틀", fr, role="cutaway")
    ck = spec.get("ceiling")
    if ck == "banja":   # 종이 반자(평천장) + 반자틀
        cp = Part(); yc = Y + H
        cp.add([0, yc, 0], [W, yc + 0.02, D], "ceil_paper")   # 10/22: 민가 방 = 종이반자(평평한 한지). 격자 반자틀은 종이 위라 안 보임
        e = 0.045   # 반자돌림 — 벽과 천장이 만나는 테두리
        for lo, hi in (([0, yc - e, 0], [W, yc, e]), ([0, yc - e, D - e], [W, yc, D]), ([0, yc - e, 0], [e, yc, D]), ([W - e, yc - e, 0], [W, yc, D])): cp.add(lo, hi, "wood")
        put("천장_반자", cp, role="ceiling", extra={"y": round(yc, 3)})
    elif ck == "rafters":  # 연등천장 — 서까래·개판·종도리가 드러남
        cp = Part(); rk = spec.get("rafter_wood", "wood"); base = top + 0.33; rh = base + spec.get("roof_rise", 1.0)
        cp.add([-0.25, rh - 0.12, D / 2 - 0.11], [W + 0.25, rh + 0.1, D / 2 + 0.11], rk)   # 종도리
        for side in (0, 1):
            z0 = -0.35 if side == 0 else D + 0.35; z1 = D / 2
            L = math.hypot(z1 - z0, rh - base); ang = math.atan2(rh - base, abs(z1 - z0))
            def slope_T(dy=0.0):
                T = trimesh.transformations.rotation_matrix(-ang, [1, 0, 0]); T[:3, 3] = [0, base + dy, z0]; return T
            for x in np.arange(0.12, W - 0.05, 0.32):   # 서까래
                lo = [x - 0.04, 0, 0] if side == 0 else [x - 0.04, 0, -L]; hi = [x + 0.04, 0.08, L] if side == 0 else [x + 0.04, 0.08, 0]
                T = slope_T(); 
                if side == 1: T = trimesh.transformations.rotation_matrix(ang, [1, 0, 0]); T[:3, 3] = [0, base, z0]
                cp.add(lo, hi, rk, T)
            # 개판(서까래 위 판)
            lo = [-0.3, 0.08, 0] if side == 0 else [-0.3, 0.08, -L]; hi = [W + 0.3, 0.11, L] if side == 0 else [W + 0.3, 0.11, 0]
            T = slope_T() if side == 0 else trimesh.transformations.rotation_matrix(ang, [1, 0, 0]); 
            if side == 1: T[:3, 3] = [0, base, z0]
            cp.add(lo, hi, "wood_dk", T)
        # 옆면 박공 안쪽 벽(세모)
        for x0 in [x for x in (0.0, W) if not skipx(x)]:
            V = []; F = []; UV = []
            tri = [(0.0, base), (D, base), (D / 2, rh)]
            for dx in (-t / 2, t / 2):
                for (zz, yy) in tri: V.append([x0 + dx, yy, zz]); UV.append([zz / 1.5, yy / 1.5])
            F = [[0, 1, 2], [3, 5, 4], [0, 3, 4], [0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [2, 3, 0]]
            cp.add_raw(V, F, UV, WALLKEY[0])
        put("천장_서까래", cp, role="ceiling", extra={"ridge_y": round(rh, 3)})
        up = Part(); upf = Part(); y0 = Y + H; y1 = base + 0.12
        up.add([0, y0, -t / 2], [W, y1, t / 2], WALLKEY[0])
        for x0 in [x for x in (0.0, W) if not skipx(x)]: up.add([x0 - t / 2, y0, 0], [x0 + t / 2, base, D], WALLKEY[0])
        if has_front: upf.add([0, y0, D - t / 2], [W, y1, D + t / 2], WALLKEY[0]); put("앞벽_상벽", upf, role="cutaway")
        put("상벽", up, role="ceiling")
    info["bounds_m"] = [round(W + 0.9, 2), round(top + 0.33, 2), round(D + 0.9, 2)]
    return scene, info

if __name__ == "__main__":
    spec = json.load(open(sys.argv[1])); out = Path(sys.argv[2])
    scene, info = build(spec)
    scene.export(out, include_normals=True); out.with_suffix(".json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    tri = sum(len(g.faces) for g in scene.geometry.values())
    print(out.name, f"{out.stat().st_size/1e6:.2f}MB", "tris", tri, "nodes", len(scene.graph.nodes_geometry), "wall_zones", len(info["wall_zones"]))
