"""Add skinned modern casual garments and a shoulderWidth morph to the Sidekick library.

Input is the shared-rig blend produced by build_sidekick_modular_library.py.  The
script never touches bone names, bind pose or the original licensed parts.  It

1. adds a `shoulderWidth` shape key to every upper-body part (body, SF, knight),
2. builds 16 garments from the base body surface:
   duplicate body surface -> linear subdivision -> cut to the garment outline ->
   per-layer offset along that layer's normals -> clearance projection against the
   body in the same layer (shrinkwrap) -> hem lip.  Skin weights come from the
   duplicated surface (skirts: nearest-surface weight transfer blended with a
   pelvis/thigh split), are normalized and limited to 4 influences.
3. writes coverage data as node extras so the runtime can hide skin under cloth,
4. saves the blend and exports the GLB.

Coordinates in this file are Blender world space (Z up, -Y front, metres).

Usage:
  Blender --background --factory-startup --python build_sidekick_wardrobe.py -- \
    --base-blend /tmp/sidekick-customizer.blend \
    --blend-output ~/Downloads/SIDEKICK_customizer_wardrobe.blend \
    --glb-output public/models/sidekick-customizer.glb \
    --report /tmp/sidekick-wardrobe-report.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BODY_KEYS = ["masculineFeminine", "defaultHeavy", "defaultBuff", "defaultSkinny"]
LAYERS = ["Basis", *BODY_KEYS]
SHOULDER_KEY = "shoulderWidth"
# Shoulder joint travel per side at shoulderWidth influence +/-1 (UI 1.25 / 0.75).
SHOULDER_SHIFT = 0.035
MAX_INFLUENCES = 4
# Skirt skinning parameters (tuned with the QA cycle metrics; env override for tuning).
SKIRT_THIGH_SHARE = float(os.environ.get("SKIRT_THIGH_SHARE", "1.0"))
SKIRT_SIDE_WIDTH = float(os.environ.get("SKIRT_SIDE_WIDTH", "0.40"))
SKIRT_FLARE = float(os.environ.get("SKIRT_FLARE", "0.26"))
SKIRT_SHARE_TOP = float(os.environ.get("SKIRT_SHARE_TOP", "0.92"))
SKIRT_BLEND_TOP = float(os.environ.get("SKIRT_BLEND_TOP", "0.80"))
# Extra room in front of the crotch: fabric hangs from the belly instead of the
# inner thighs, so a lifted knee has space before it reaches the front panel.
SKIRT_FRONT_DRAPE = float(os.environ.get("SKIRT_FRONT_DRAPE", "0.06"))


def arguments() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-blend", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--glb-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args(raw)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


# ─────────────────────────────── scene lookup ───────────────────────────────

def base_part(code: str) -> bpy.types.Object:
    matches = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and obj.name.startswith("SKLIB__") and obj.name.endswith(f"SK_HUMN_BASE_01_{code}_HU01")
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one base part {code}, found {len(matches)}")
    return matches[0]


def chain_bones(rig: bpy.types.Object, side: str) -> set[str]:
    upper = rig.data.bones[f"upperarm_{side}"]
    return {upper.name, f"shoulderAttach_{side}", *(bone.name for bone in upper.children_recursive)}


# ─────────────────────────────── shoulder morph ─────────────────────────────

def shoulder_delta(position: Vector, weights: dict[str, float], chains: dict[str, set[str]]) -> Vector:
    """World-space morph delta for shoulderWidth = +1.

    The runtime moves upperarm_* (and shoulderAttach_*) by +/-SHOULDER_SHIFT, which
    already carries chain-weighted vertices.  The morph adds the remaining part of
    the target field  SHIFT * (chain + (1 - chain) * ramp)  so the torso silhouette
    near the shoulder follows the joint without tearing at part seams.
    """
    x = position.x
    side = "l" if x >= 0 else "r"
    chain = min(1.0, sum(w for bone, w in weights.items() if bone in chains[side]))
    ramp = smoothstep(0.085, 0.205, abs(x))
    vertical = smoothstep(1.04, 1.30, position.z)
    amount = SHOULDER_SHIFT * (1.0 - chain) * ramp * vertical
    return Vector((math.copysign(amount, x), 0.0, 0.0))


def add_shoulder_key_to_part(obj: bpy.types.Object, chains: dict[str, set[str]]) -> float:
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    keys = obj.data.shape_keys.key_blocks
    if SHOULDER_KEY in keys:
        obj.shape_key_remove(keys[SHOULDER_KEY])
    key = obj.shape_key_add(name=SHOULDER_KEY, from_mix=False)
    key.slider_min = -1.0
    key.slider_max = 1.0
    world = obj.matrix_world
    to_local = world.to_3x3().inverted()
    names = {group.index: group.name for group in obj.vertex_groups}
    largest = 0.0
    for vertex in obj.data.vertices:
        weights = {names[g.group]: g.weight for g in vertex.groups if g.weight > 1e-5}
        basis = keys["Basis"].data[vertex.index].co
        delta = shoulder_delta(world @ basis, weights, chains)
        key.data[vertex.index].co = basis + to_local @ delta
        largest = max(largest, delta.length)
    return largest


# ─────────────────────────────── garment data ───────────────────────────────

class Surface:
    """Multi-layer polygon soup: identical topology in every shape-key layer."""

    def __init__(self) -> None:
        self.layers: dict[str, list[Vector]] = {name: [] for name in LAYERS}
        self.weights: list[dict[str, float]] = []
        self.faces: list[list[int]] = []

    @property
    def count(self) -> int:
        return len(self.weights)

    def add_vertex(self, layer_positions: dict[str, Vector], weights: dict[str, float]) -> int:
        for name in LAYERS:
            self.layers[name].append(layer_positions[name].copy())
        self.weights.append(dict(weights))
        return self.count - 1

    def blend_vertex(self, indices: list[int]) -> int:
        share = 1.0 / len(indices)
        positions = {
            name: sum((self.layers[name][i] for i in indices), Vector()) * share for name in LAYERS
        }
        weights: dict[str, float] = {}
        for i in indices:
            for bone, w in self.weights[i].items():
                weights[bone] = weights.get(bone, 0.0) + w * share
        return self.add_vertex(positions, weights)

    def basis(self, index: int) -> Vector:
        return self.layers["Basis"][index]

    def move_all_layers(self, index: int, delta: Vector) -> None:
        for name in LAYERS:
            self.layers[name][index] += delta


def gather(parts: list[bpy.types.Object]) -> Surface:
    surface = Surface()
    lookup: dict[tuple[int, int, int], int] = {}
    for obj in parts:
        world = obj.matrix_world
        keys = obj.data.shape_keys.key_blocks
        names = {group.index: group.name for group in obj.vertex_groups}
        mapping: list[int] = []
        for vertex in obj.data.vertices:
            basis = world @ keys["Basis"].data[vertex.index].co
            token = tuple(round(c * 1e4) for c in basis)
            if token in lookup:
                mapping.append(lookup[token])
                continue
            positions = {name: world @ keys[name].data[vertex.index].co for name in LAYERS}
            weights = {names[g.group]: g.weight for g in vertex.groups if g.weight > 1e-5}
            lookup[token] = surface.add_vertex(positions, weights)
            mapping.append(lookup[token])
        for polygon in obj.data.polygons:
            face = [mapping[i] for i in polygon.vertices]
            if len(set(face)) == len(face):
                surface.faces.append(face)
    return surface


def subdivide(surface: Surface) -> None:
    edge_mid: dict[tuple[int, int], int] = {}

    def mid(a: int, b: int) -> int:
        key = (min(a, b), max(a, b))
        if key not in edge_mid:
            edge_mid[key] = surface.blend_vertex([a, b])
        return edge_mid[key]

    faces: list[list[int]] = []
    for face in surface.faces:
        center = surface.blend_vertex(face)
        n = len(face)
        for i in range(n):
            a, b, prev = face[i], face[(i + 1) % n], face[(i - 1) % n]
            faces.append([a, mid(a, b), center, mid(prev, a)])
    surface.faces = faces


def keep_faces(surface: Surface, keep) -> None:
    kept = []
    for face in surface.faces:
        centroid = sum((surface.basis(i) for i in face), Vector()) / len(face)
        if keep(centroid):
            kept.append(face)
    used = sorted({i for face in kept for i in face})
    remap = {old: new for new, old in enumerate(used)}
    for name in LAYERS:
        surface.layers[name] = [surface.layers[name][i] for i in used]
    surface.weights = [surface.weights[i] for i in used]
    surface.faces = [[remap[i] for i in face] for face in kept]
    drop_islands(surface)


def drop_islands(surface: Surface) -> None:
    """Keep only the largest connected face island (removes stray cut crumbs)."""
    adjacency: dict[int, list[int]] = {}
    for fi, face in enumerate(surface.faces):
        for v in face:
            adjacency.setdefault(v, []).append(fi)
    seen = [False] * len(surface.faces)
    islands = []
    for start in range(len(surface.faces)):
        if seen[start]:
            continue
        stack, island = [start], []
        seen[start] = True
        while stack:
            fi = stack.pop()
            island.append(fi)
            for v in surface.faces[fi]:
                for other in adjacency[v]:
                    if not seen[other]:
                        seen[other] = True
                        stack.append(other)
        islands.append(island)
    if len(islands) <= 1:
        return
    largest = set(max(islands, key=len))
    faces = [face for fi, face in enumerate(surface.faces) if fi in largest]
    used = sorted({i for face in faces for i in face})
    remap = {old: new for new, old in enumerate(used)}
    for name in LAYERS:
        surface.layers[name] = [surface.layers[name][i] for i in used]
    surface.weights = [surface.weights[i] for i in used]
    surface.faces = [[remap[i] for i in face] for face in faces]


def boundary_edges(surface: Surface) -> list[tuple[int, int]]:
    count: dict[tuple[int, int], int] = {}
    directed: dict[tuple[int, int], tuple[int, int]] = {}
    for face in surface.faces:
        for i in range(len(face)):
            a, b = face[i], face[(i + 1) % len(face)]
            key = (min(a, b), max(a, b))
            count[key] = count.get(key, 0) + 1
            directed[key] = (a, b)
    return [directed[key] for key, n in count.items() if n == 1]


def neighbours(surface: Surface) -> list[set[int]]:
    result = [set() for _ in range(surface.count)]
    for face in surface.faces:
        for i in range(len(face)):
            a, b = face[i], face[(i + 1) % len(face)]
            result[a].add(b)
            result[b].add(a)
    return result


def vertex_normals(positions: list[Vector], faces: list[list[int]]) -> list[Vector]:
    normals = [Vector() for _ in positions]
    for face in faces:
        n = Vector()
        for i in range(len(face)):
            a, b = positions[face[i]], positions[face[(i + 1) % len(face)]]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        for i in face:
            normals[i] += n
    return [n.normalized() if n.length > 1e-12 else Vector((0, 0, 1)) for n in normals]


def smooth(surface: Surface, iterations: int, factor: float, pinned: set[int], mask=None) -> None:
    near = neighbours(surface)
    for name in LAYERS:
        positions = surface.layers[name]
        for _ in range(iterations):
            updated = list(positions)
            for i, adjacent in enumerate(near):
                if i in pinned or not adjacent:
                    continue
                strength = factor * (mask(surface.basis(i)) if mask else 1.0)
                if strength <= 0:
                    continue
                average = sum((positions[j] for j in adjacent), Vector()) / len(adjacent)
                updated[i] = positions[i].lerp(average, strength)
            positions[:] = updated


class Body:
    """Per-layer BVH of a body region for clearance and weight transfer."""

    def __init__(self, surface: Surface) -> None:
        self.surface = surface
        self.triangles: list[tuple[int, int, int]] = []
        for face in surface.faces:
            for i in range(1, len(face) - 1):
                self.triangles.append((face[0], face[i], face[i + 1]))
        self.trees = {
            name: BVHTree.FromPolygons(surface.layers[name], self.triangles, all_triangles=True)
            for name in LAYERS
        }

    def nearest(self, layer: str, point: Vector):
        return self.trees[layer].find_nearest(point)

    def weights_at(self, point: Vector) -> dict[str, float]:
        location, _normal, index, _dist = self.trees["Basis"].find_nearest(point)
        a, b, c = self.triangles[index]
        pa, pb, pc = (self.surface.basis(i) for i in (a, b, c))
        v0, v1, v2 = pb - pa, pc - pa, location - pa
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        denom = d00 * d11 - d01 * d01
        if abs(denom) < 1e-14:
            bary = (1.0, 0.0, 0.0)
        else:
            v = (d11 * d20 - d01 * d21) / denom
            w = (d00 * d21 - d01 * d20) / denom
            bary = (1.0 - v - w, v, w)
        result: dict[str, float] = {}
        for vertex, share in zip((a, b, c), bary):
            for bone, weight in self.surface.weights[vertex].items():
                result[bone] = result.get(bone, 0.0) + weight * max(0.0, share)
        return result


def offset_layers(surface: Surface, thickness) -> None:
    for name in LAYERS:
        normals = vertex_normals(surface.layers[name], surface.faces)
        positions = surface.layers[name]
        for i in range(surface.count):
            positions[i] = positions[i] + normals[i] * thickness(surface.basis(i))


def clearance(surface: Surface, body: Body, minimum) -> int:
    pushed = 0
    for name in LAYERS:
        positions = surface.layers[name]
        for i in range(surface.count):
            location, normal, _index, _dist = body.nearest(name, positions[i])
            if location is None:
                continue
            want = minimum(surface.basis(i))
            signed = (positions[i] - location).dot(normal)
            if signed < want:
                positions[i] = positions[i] + normal * (want - signed)
                pushed += 1
    return pushed


def snap_boundary(surface: Surface, planes: list[tuple[str, float, float]]) -> None:
    """Flatten jagged cut borders onto their cut plane.

    planes: ("x", value, 0) for |x| = value, ("z", value, slope) for z = value +
    slope * y, ("neck", value, (slope, curve)) for z = value + slope * y + curve * x^2.
    Each boundary vertex snaps to the closest plane.
    """
    vertices = {v for edge in boundary_edges(surface) for v in edge}
    for i in vertices:
        p = surface.basis(i)
        best = None
        for axis, value, slope in planes:
            if axis == "x":
                distance = abs(abs(p.x) - value)
                delta = Vector((math.copysign(value, p.x) - p.x, 0, 0))
            elif axis == "neck":
                target = value + slope[0] * p.y + slope[1] * p.x * p.x
                distance = abs(p.z - target)
                delta = Vector((0, 0, target - p.z))
            else:
                target = value + slope * p.y
                distance = abs(p.z - target)
                delta = Vector((0, 0, target - p.z))
            if best is None or distance < best[0]:
                best = (distance, delta)
        if best and best[0] < 0.045:
            surface.move_all_layers(i, best[1])


def add_hem_lip(surface: Surface, depth: float) -> None:
    """Turn every open border inward so hems read as cloth, not paper."""
    edges = boundary_edges(surface)
    normals = {name: vertex_normals(surface.layers[name], surface.faces) for name in LAYERS}
    inner: dict[int, int] = {}
    for a, b in edges:
        for v in (a, b):
            if v in inner:
                continue
            positions = {name: surface.layers[name][v] - normals[name][v] * depth for name in LAYERS}
            inner[v] = surface.add_vertex(positions, surface.weights[v])
    for a, b in edges:
        surface.faces.append([b, a, inner[a], inner[b]])


def limit_weights(weights: dict[str, float]) -> dict[str, float]:
    ranked = sorted(((w, bone) for bone, w in weights.items() if w > 1e-4), reverse=True)[:MAX_INFLUENCES]
    total = sum(w for w, _ in ranked)
    if total <= 0:
        return {"pelvis": 1.0}
    return {bone: w / total for w, bone in ranked}


# ─────────────────────────────── garment recipes ────────────────────────────

TOP_PARTS_SHORT = ["10TORS", "11AUPL", "12AUPR", "17HIPS"]
TOP_PARTS_LONG = [*TOP_PARTS_SHORT, "13ALWL", "14ALWR"]
BOTTOM_PARTS = ["17HIPS", "18LEGL", "19LEGR"]
BODY_UPPER = ["10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR", "15HNDL", "16HNDR", "17HIPS", "01HEAD"]
BODY_LOWER = ["10TORS", "17HIPS", "18LEGL", "19LEGR"]

# Bottom garments reach up to WAIST; tops that overlap them must stay outside.
WAIST = 0.975
WAIST_THICKNESS = 0.008
TOP_OVER_BOTTOM = 0.017
# Neckline rises toward the shoulders: z = z0 + slope * y + NECK_CURVE * x^2.
NECK_CURVE = 3.2

TOPS = [
    # option, gender, id, label, hem, sleeve |x|, neck z0, neck slope, thickness, smooth, fabric, collar
    (4, "masculine", "M_TEE_CREW", "크루넥 반팔 티", 0.855, 0.365, 1.452, 0.30, 0.010, 2, "jersey", 0.0),
    (5, "masculine", "M_TEE_RELAXED", "루즈핏 반팔 티", 0.830, 0.425, 1.446, 0.30, 0.019, 5, "jersey", 0.0),
    (6, "masculine", "M_LONGSLEEVE", "기본 긴팔 티", 0.855, 0.690, 1.452, 0.30, 0.010, 2, "jersey", 0.0),
    (7, "masculine", "M_SWEATSHIRT", "맨투맨", 0.840, 0.690, 1.458, 0.30, 0.021, 5, "fleece", 0.0),
    (8, "feminine", "F_TEE_FITTED", "기본 반팔 티", 0.885, 0.310, 1.444, 0.34, 0.006, 3, "jersey", 0.0),
    (9, "feminine", "F_TEE_RIB", "골지 라운드 반팔", 0.890, 0.290, 1.440, 0.36, 0.005, 3, "rib", 0.0),
    (10, "feminine", "F_LONGSLEEVE", "기본 긴팔 티", 0.885, 0.690, 1.448, 0.34, 0.006, 3, "jersey", 0.0),
    (11, "feminine", "F_MOCKNECK", "모크넥 긴팔", 0.885, 0.690, 1.470, 0.20, 0.007, 3, "rib", 0.034),
]

BOTTOMS = [
    # option, gender, id, label, kind, leg cut z, leg thickness, flare, straight radius, smooth, fabric
    (4, "masculine", "M_CHINO_SHORTS", "치노 반바지", "pants", 0.520, 0.011, 0.010, 0.0, 2, "twill"),
    (5, "masculine", "M_ATHLETIC_SHORTS", "운동 반바지", "pants", 0.600, 0.015, 0.028, 0.0, 4, "nylon"),
    (6, "masculine", "M_STRAIGHT_PANTS", "일자 긴바지", "pants", 0.115, 0.011, 0.0, 0.066, 2, "twill"),
    (7, "masculine", "M_JEANS", "청바지", "pants", 0.115, 0.008, 0.0, 0.056, 2, "denim"),
    (8, "feminine", "F_SHORTS", "캐주얼 반바지", "pants", 0.650, 0.009, 0.012, 0.0, 2, "denim"),
    (9, "feminine", "F_LONG_PANTS", "기본 긴바지", "pants", 0.115, 0.009, 0.0, 0.060, 2, "twill"),
    (10, "feminine", "F_SKIRT_ALINE", "A라인 치마", "skirt_aline", 0.520, 0.0, 0.0, 0.0, 0, "twill"),
    (11, "feminine", "F_SKIRT_PLEATED", "플리츠 치마", "skirt_pleated", 0.575, 0.0, 0.0, 0.0, 0, "twill"),
]


def top_surface(recipe, body: Body, parts_by_code, chains) -> tuple[Surface, dict]:
    option, gender, ident, label, hem, sleeve, neck_z, neck_slope, thickness, smooth_steps, fabric, collar = recipe
    long_sleeve = sleeve > 0.6
    surface = gather([parts_by_code[c] for c in (TOP_PARTS_LONG if long_sleeve else TOP_PARTS_SHORT)])
    subdivide(surface)

    def neck_plane(p: Vector) -> float:
        return neck_z + neck_slope * p.y + NECK_CURVE * p.x * p.x

    def keep(p: Vector) -> bool:
        if p.z < hem or abs(p.x) > sleeve:
            return False
        return p.z < neck_plane(p)

    keep_faces(surface, keep)
    snap_boundary(surface, [("x", sleeve, 0.0), ("z", hem, 0.0), ("neck", neck_z, (neck_slope, NECK_CURVE))])
    border = {v for edge in boundary_edges(surface) for v in edge}
    smooth(surface, smooth_steps, 0.45, border)

    def local_thickness(p: Vector) -> float:
        over_bottom = TOP_OVER_BOTTOM * smoothstep(WAIST + 0.06, WAIST - 0.02, p.z)
        cuff = 0.002 if abs(p.x) > sleeve - 0.03 else 0.0
        # Trapezius/neck base moves a lot under head turns; keep a little more room.
        neck = 0.003 * smoothstep(neck_plane(p) - 0.06, neck_plane(p) - 0.01, p.z)
        return max(thickness, over_bottom) + cuff + neck

    offset_layers(surface, local_thickness)
    clearance(surface, body, lambda p: max(0.0045, 0.75 * local_thickness(p)))
    if smooth_steps >= 4:
        smooth(surface, 2, 0.35, border)
        clearance(surface, body, lambda p: max(0.0045, 0.75 * local_thickness(p)))

    if collar > 0:
        add_collar(surface, body, collar)

    add_hem_lip(surface, 0.004 if thickness < 0.012 else 0.007)
    cover = {
        "cover_kind": "top",
        "cover_hem_y": hem,
        "cover_sleeve_x": sleeve,
        "cover_neck_y0": neck_z + (collar * 0.8 if collar else 0.0),
        "cover_neck_slope_z": -neck_slope,
        "cover_neck_curve": NECK_CURVE,
    }
    return surface, cover


def add_collar(surface: Surface, body: Body, height: float) -> None:
    """Mock-neck: extrude the neckline upward, shrinkwrapped around the neck."""
    edges = boundary_edges(surface)
    neck_edges = [
        (a, b) for a, b in edges
        if abs(surface.basis(a).x) < 0.16 and surface.basis(a).z > 1.40 and surface.basis(b).z > 1.40
    ]
    rings = 3
    current = {v for edge in neck_edges for v in edge}
    ring_map: dict[int, int] = {v: v for v in current}
    for step in range(1, rings + 1):
        rise = height * step / rings
        new_map: dict[int, int] = {}
        for v in current:
            positions = {}
            for name in LAYERS:
                start = surface.layers[name][v]
                target = start + Vector((0, 0, rise))
                location, normal, _i, _d = body.nearest(name, target)
                if location is not None:
                    # Hug the neck with 7 mm clearance and a gentle inward taper.
                    target = location + normal * (0.009 - 0.002 * step / rings)
                    target.z = start.z + rise
                positions[name] = target
            weights = body.weights_at(positions["Basis"])
            new_map[v] = surface.add_vertex(positions, weights)
        for a, b in neck_edges:
            surface.faces.append([ring_map[a], ring_map[b], new_map[b], new_map[a]])
        neck_edges = [(new_map[a], new_map[b]) for a, b in neck_edges]
        ring_map = {nv: nv for nv in new_map.values()}
        current = set(new_map.values())


def pants_surface(recipe, body: Body, parts_by_code, rig) -> tuple[Surface, dict]:
    option, gender, ident, label, kind, leg_cut, thickness, flare, straight_radius, smooth_steps, fabric = recipe
    surface = gather([parts_by_code[c] for c in BOTTOM_PARTS])
    subdivide(surface)
    keep_faces(surface, lambda p: leg_cut <= p.z <= WAIST)
    snap_boundary(surface, [("z", WAIST, 0.0), ("z", leg_cut, 0.0)])
    border = {v for edge in boundary_edges(surface) for v in edge}
    smooth(surface, smooth_steps, 0.4, border)

    def local_thickness(p: Vector) -> float:
        return WAIST_THICKNESS + (thickness - WAIST_THICKNESS) * smoothstep(0.90, 0.80, p.z)

    offset_layers(surface, local_thickness)
    clearance(surface, body, lambda p: max(0.004, 0.75 * local_thickness(p)))

    # Leg shaping relative to each leg's own axis (basis), applied to all layers.
    if flare > 0 or straight_radius > 0:
        axes = leg_axes(rig)
        for i in range(surface.count):
            p = surface.basis(i)
            if p.z > 0.80:
                continue
            side = "l" if p.x >= 0 else "r"
            axis = axes[side](p.z)
            radial = Vector((p.x - axis.x, p.y - axis.y, 0))
            radius = radial.length
            if radius < 1e-5:
                continue
            extra = 0.0
            if flare > 0:
                extra += flare * smoothstep(0.80, leg_cut, p.z)
            if straight_radius > 0 and p.z < 0.62:
                blend = smoothstep(0.62, 0.42, p.z)
                extra += max(0.0, straight_radius - radius) * blend
            if extra > 0:
                surface.move_all_layers(i, radial.normalized() * extra)
        clearance(surface, body, lambda p: max(0.004, 0.75 * local_thickness(p)))

    add_hem_lip(surface, 0.006)
    cover = {"cover_kind": "bottom", "cover_waist_y": WAIST, "cover_leg_y": leg_cut}
    return surface, cover


def leg_axes(rig):
    """Leg centre line from the rest skeleton: thigh -> calf -> foot joints."""

    def make(side):
        bones = rig.data.bones
        joints = [rig.matrix_world @ bones[f"{name}_{side}"].head_local for name in ("thigh", "calf", "foot")]

        def axis(z: float) -> Vector:
            upper, knee, ankle = joints
            if z >= knee.z:
                t = (z - knee.z) / max(1e-6, upper.z - knee.z)
                return knee.lerp(upper, max(0.0, min(1.0, t)))
            t = (z - ankle.z) / max(1e-6, knee.z - ankle.z)
            return ankle.lerp(knee, max(0.0, min(1.0, t)))

        return axis

    return {"l": make("l"), "r": make("r")}


def convex_hull_2d(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(points))
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


def hull_radius(hull, centre, angle) -> float:
    """Distance from centre to the hull boundary along angle (x = sin, y = -cos -> front)."""
    direction = (math.sin(angle), -math.cos(angle))
    best = 0.0
    n = len(hull)
    for i in range(n):
        ax, ay = hull[i][0] - centre[0], hull[i][1] - centre[1]
        bx, by = hull[(i + 1) % n][0] - centre[0], hull[(i + 1) % n][1] - centre[1]
        ex, ey = bx - ax, by - ay
        denom = direction[0] * ey - direction[1] * ex
        if abs(denom) < 1e-12:
            continue
        t = (ax * ey - ay * ex) / denom
        s = (ax * direction[1] - ay * direction[0]) / denom
        if t > 0 and -1e-6 <= s <= 1 + 1e-6:
            best = max(best, t)
    return best


def skirt_surface(recipe, body: Body, parts_by_code) -> tuple[Surface, dict]:
    option, gender, ident, label, kind, hem, *_rest = recipe
    pleated = kind == "skirt_pleated"
    segments = 96 if pleated else 64
    rings = 18
    pleats = 24
    heights = [WAIST + (hem - WAIST) * (k / rings) ** 1.05 for k in range(rings + 1)]
    lower = gather([parts_by_code[c] for c in BODY_LOWER])

    # Slab hulls per layer: skirt follows the outer envelope, never between legs.
    radii: dict[str, list[list[float]]] = {}
    centres: dict[str, list[tuple[float, float]]] = {}
    for name in LAYERS:
        positions = lower.layers[name]
        layer_radii, layer_centres = [], []
        previous = None
        for k, z in enumerate(heights):
            band = 0.02
            slab = [(p.x, p.y) for p in positions if abs(p.z - z) < band]
            while len(slab) < 12:
                band += 0.01
                slab = [(p.x, p.y) for p in positions if abs(p.z - z) < band]
            hull = convex_hull_2d(slab)
            if k == 0 or previous is None:
                centre = (0.0, sum(y for _, y in hull) / len(hull))
            else:
                centre = layer_centres[0]
            # Waistband tucks under the top hem; flare room opens below the hip crease.
            clear = 0.005 + 0.026 * smoothstep(0.89, 0.72, z) + 0.008 * (k / rings)
            ring = []
            for j in range(segments):
                angle = 2 * math.pi * j / segments
                front = max(0.0, math.cos(angle)) ** 2
                back = max(0.0, -math.cos(angle)) ** 2
                drape = SKIRT_FRONT_DRAPE * smoothstep(0.92, 0.72, z) * (front + 0.4 * back)
                r = hull_radius(hull, centre, angle) + clear + drape
                if previous is not None:
                    dz = heights[k - 1] - z
                    slope = SKIRT_FLARE * (1.0 if not pleated else 0.65) * smoothstep(0.93, 0.80, z)
                    r = max(r, previous[j] + slope * dz)
                ring.append(r)
            # Angular smoothing keeps the drape even where hull corners are sharp.
            for _ in range(2):
                ring = [max(ring[j], (ring[j - 1] + ring[(j + 1) % segments]) * 0.5) for j in range(segments)]
            layer_radii.append(ring)
            layer_centres.append(centre)
            previous = ring
        radii[name] = layer_radii
        centres[name] = layer_centres

    surface = Surface()
    grid: list[list[int]] = []
    for k, z in enumerate(heights):
        row = []
        t = k / rings
        for j in range(segments):
            angle = 2 * math.pi * j / segments
            pleat = 0.0
            if pleated:
                phase = (j % (segments // pleats)) / (segments // pleats)
                pleat = (abs(phase - 0.5) * 2 - 0.5) * 0.030 * smoothstep(0.90, hem, z)
            positions = {}
            for name in LAYERS:
                cx, cy = centres[name][k]
                r = radii[name][k][j] + pleat + (0.012 if pleated else 0.0) * smoothstep(0.90, hem, z)
                positions[name] = Vector((cx + math.sin(angle) * r, cy - math.cos(angle) * r, z))
            base = positions["Basis"]
            transferred = body.weights_at(base)
            # Upper skirt copies the body weights under it (hip skin and cloth move
            # together); lower rings hand over to a left/right thigh split so each
            # side follows its own leg in walk/run and only the centre line averages.
            side = base.x / max(1e-5, radii["Basis"][k][j])
            left = smoothstep(-SKIRT_SIDE_WIDTH, SKIRT_SIDE_WIDTH, side)
            share = SKIRT_THIGH_SHARE * (1.0 if not pleated else 0.95) * smoothstep(SKIRT_SHARE_TOP, 0.62, z)
            split = {"pelvis": 1.0 - share, "thigh_l": share * left, "thigh_r": share * (1.0 - left)}
            blend = smoothstep(SKIRT_BLEND_TOP, 0.66, z)
            weights: dict[str, float] = {}
            for bone, w in transferred.items():
                weights[bone] = weights.get(bone, 0.0) + w * (1.0 - blend)
            for bone, w in split.items():
                weights[bone] = weights.get(bone, 0.0) + w * blend
            row.append(surface.add_vertex(positions, weights))
        grid.append(row)
    for k in range(rings):
        for j in range(segments):
            a, b = grid[k][j], grid[k][(j + 1) % segments]
            c, d = grid[k + 1][(j + 1) % segments], grid[k + 1][j]
            surface.faces.append([a, d, c, b])
    add_hem_lip(surface, 0.007)
    cover = {"cover_kind": "skirt", "cover_waist_y": WAIST, "cover_leg_y": hem}
    return surface, cover


# ─────────────────────────────── object output ──────────────────────────────

def build_object(surface: Surface, name: str, rig, material, props: dict, chains) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata([tuple(p) for p in surface.layers["Basis"]], [], [tuple(f) for f in surface.faces])
    mesh.validate(clean_customdata=False)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = rig
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    mesh.materials.append(material)

    groups: dict[str, bpy.types.VertexGroup] = {}
    limited = [limit_weights(w) for w in surface.weights]
    for index, weights in enumerate(limited):
        for bone, weight in weights.items():
            if bone not in rig.data.bones:
                raise RuntimeError(f"{name}: unknown bone {bone}")
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([index], weight, "REPLACE")

    obj.shape_key_add(name="Basis", from_mix=False)
    for key_name in BODY_KEYS:
        key = obj.shape_key_add(name=key_name, from_mix=False)
        for i, p in enumerate(surface.layers[key_name]):
            key.data[i].co = p
    shoulder = obj.shape_key_add(name=SHOULDER_KEY, from_mix=False)
    shoulder.slider_min = -1.0
    for i, p in enumerate(surface.layers["Basis"]):
        shoulder.data[i].co = p + shoulder_delta(p, limited[i], chains)
    for key, value in props.items():
        obj[key] = value
    return obj


def cloth_material() -> bpy.types.Material:
    material = bpy.data.materials.get("SKLIB_cloth") or bpy.data.materials.new("SKLIB_cloth")
    material.use_nodes = True
    material.use_backface_culling = False
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
    shader.inputs["Roughness"].default_value = 0.88
    shader.inputs["Metallic"].default_value = 0.0
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def gltf_cover(cover: dict) -> dict:
    """Blender Z-up/-Y-front -> glTF Y-up/+Z-front (same numbers, renamed axes)."""
    return {key: (round(value, 5) if isinstance(value, float) else value) for key, value in cover.items()}


def mesh_stats(obj: bpy.types.Object) -> dict:
    influences = [len([g for g in v.groups if g.weight > 1e-5]) for v in obj.data.vertices]
    sums = [sum(g.weight for g in v.groups) for v in obj.data.vertices]
    return {
        "vertices": len(obj.data.vertices),
        "faces": len(obj.data.polygons),
        "max_influences": max(influences),
        "weight_sum_error": round(max(abs(s - 1) for s in sums), 6),
        "shape_keys": [k.name for k in obj.data.shape_keys.key_blocks[1:]],
        "bones": sorted(g.name for g in obj.vertex_groups),
    }


def main() -> None:
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=str(args.base_blend.expanduser().resolve()))
    rig = bpy.data.objects["SidekickCustomizerRig"]
    chains = {"l": chain_bones(rig, "l"), "r": chain_bones(rig, "r")}
    bone_names_before = [bone.name for bone in rig.data.bones]

    # Remove garments from a previous run so the script is idempotent.
    for obj in list(bpy.data.objects):
        if obj.get("wardrobe_garment"):
            bpy.data.objects.remove(obj, do_unlink=True)

    report: dict = {"shoulder_shift_per_side_m": SHOULDER_SHIFT, "upper_parts": {}, "garments": {}}

    # Seam check before/after adding shoulderWidth: body parts must stay stitched.
    parts_by_code = {
        code: base_part(code)
        for code in ["01HEAD", "10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR", "15HNDL", "16HNDR", "17HIPS", "18LEGL", "19LEGR"]
    }
    body_upper = Body(gather([parts_by_code[c] for c in BODY_UPPER]))
    body_lower = Body(gather([parts_by_code[c] for c in BODY_LOWER]))

    upper_parts = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and obj.name.startswith("SKLIB__top__")
    ]
    for obj in upper_parts:
        report["upper_parts"][obj.name] = round(add_shoulder_key_to_part(obj, chains), 5)
    report["seams_after_shoulder_key"] = seam_report(parts_by_code)

    material = cloth_material()
    for recipe in TOPS:
        option, gender, ident, label, *_ = recipe
        surface, cover = top_surface(recipe, body_upper, parts_by_code, chains)
        name = f"SKLIB__top__{option:02d}__WARDROBE_{ident}"
        props = {
            "wardrobe_garment": True,
            "garment_gender": gender,
            "garment_label": label,
            "garment_fabric": recipe[10],
            **gltf_cover(cover),
        }
        obj = build_object(surface, name, rig, material, props, chains)
        report["garments"][name] = {**mesh_stats(obj), **props}
    for recipe in BOTTOMS:
        option, gender, ident, label, kind, *_ = recipe
        if kind == "pants":
            surface, cover = pants_surface(recipe, body_lower, parts_by_code, rig)
        else:
            surface, cover = skirt_surface(recipe, body_lower, parts_by_code)
        name = f"SKLIB__bottom__{option:02d}__WARDROBE_{ident}"
        props = {
            "wardrobe_garment": True,
            "garment_gender": gender,
            "garment_label": label,
            "garment_fabric": recipe[10],
            **gltf_cover(cover),
        }
        obj = build_object(surface, name, rig, material, props, chains)
        report["garments"][name] = {**mesh_stats(obj), **props}

    if [bone.name for bone in rig.data.bones] != bone_names_before:
        raise RuntimeError("bone list changed")
    report["bone_count"] = len(bone_names_before)

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name.startswith("SKLIB__"):
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig

    for path in (args.blend_output, args.glb_output, args.report):
        path.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.expanduser().resolve()))
    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output.expanduser().resolve()),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_influence_nb=MAX_INFLUENCES,
        export_morph=True,
        export_morph_normal=True,
        export_apply=False,
        export_extras=True,
    )
    args.report.expanduser().resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"SIDEKICK_WARDROBE_OK garments={len(report['garments'])} glb={args.glb_output}")


def seam_report(parts_by_code) -> dict:
    """Largest gap between coincident seam vertices at shoulderWidth = +1."""
    pairs = [("10TORS", "11AUPL"), ("10TORS", "12AUPR"), ("11AUPL", "13ALWL"), ("10TORS", "01HEAD"), ("10TORS", "17HIPS")]
    result = {}
    for a, b in pairs:
        oa, ob = parts_by_code[a], parts_by_code[b]
        ka = oa.data.shape_keys.key_blocks
        kb = ob.data.shape_keys.key_blocks
        wa, wb = oa.matrix_world, ob.matrix_world
        points_b = [(wb @ kb["Basis"].data[i].co, i) for i in range(len(ob.data.vertices))]
        worst = 0.0
        matched = 0
        for i in range(len(oa.data.vertices)):
            pa = wa @ ka["Basis"].data[i].co
            for pb, j in points_b:
                if (pa - pb).length < 1e-4:
                    matched += 1
                    da = wa @ ka[SHOULDER_KEY].data[i].co - pa if SHOULDER_KEY in ka else Vector()
                    db = wb @ kb[SHOULDER_KEY].data[j].co - pb if SHOULDER_KEY in kb else Vector()
                    worst = max(worst, (da - db).length)
                    break
        result[f"{a}-{b}"] = {"matched": matched, "max_gap_m": round(worst, 6)}
    return result


if __name__ == "__main__":
    main()
