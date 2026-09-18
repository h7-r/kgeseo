"""Chibi body + the full Sidekick customization system -> chibi-customizer.glb.

Only the bare chibi body mesh comes from V4 (via build_chibi_body.py, bound to the
Sidekick-named rig).  Everything else follows the Sidekick library:
head/hair/brows/ears/facial hair/nose/teeth/eyes, the 16 modern garments,
masculineFeminine/defaultHeavy/defaultBuff/defaultSkinny/shoulderWidth morphs and
the SKLIB__slot__option__name convention, so the Sidekick runtime and panel work.

How the two bodies are matched
  Every bone b gets an affine map A_b (chibi bind -> Sidekick bind): bone frame to
  bone frame with per-axis scale (length ratio along the bone, spread ratio across).
  A vertex maps with the weight blend M = sum w_b A_b, and back with M^-1, which is
  exact for the same weights.  In Sidekick space we
    1. transfer body-type morph deltas from the Sidekick base body,
    2. cut the chibi head at the Sidekick torso/head seam and stitch to that ring,
    3. split the body into Sidekick part names (TORS, AUPL, ... FOTR),
    4. run the Sidekick wardrobe builder unchanged (garments + shoulderWidth),
  then map every mesh (Sidekick head parts too) back to chibi space.  Head-child
  bones use A_head so the Sidekick face scales onto the chibi head.

Usage:
  Blender --background --factory-startup --python build_chibi_sidekick.py -- \
    --chibi-blend /tmp/chibi_body_step1.blend \
    --sidekick-blend ~/Downloads/SIDEKICK_customizer_base.blend \
    --blend-output ~/Downloads/CHIBI_sidekick_customizer.blend \
    --glb-output public/models/chibi-customizer.glb \
    --report naju01/캐릭터작업/chibi-sidekick/build-report.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_sidekick_wardrobe as W  # noqa: E402

BODY_CODES = ["10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR", "15HNDL", "16HNDR",
              "17HIPS", "18LEGL", "19LEGR", "20FOTL", "21FOTR"]
SLOT_OF = {"10TORS": "top", "11AUPL": "top", "12AUPR": "top", "13ALWL": "top", "14ALWR": "top",
           "15HNDL": "top", "16HNDR": "top", "17HIPS": "bottom", "18LEGL": "bottom", "19LEGR": "bottom",
           "20FOTL": "shoes", "21FOTR": "shoes"}
KEYS = W.BODY_KEYS


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--chibi-blend", type=Path, required=True)
    p.add_argument("--sidekick-blend", type=Path, required=True)
    p.add_argument("--blend-output", type=Path, required=True)
    p.add_argument("--glb-output", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    return p.parse_args(raw)


# ─────────────────────────────── bone affine maps ───────────────────────────

def bone_frame(rig, bone) -> Matrix:
    m = rig.matrix_world @ bone.matrix_local
    loc, rot, _scale = m.decompose()
    return Matrix.Translation(loc) @ rot.to_matrix().to_4x4()


def weights_of(obj) -> list[dict[str, float]]:
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-5}
        total = sum(w.values()) or 1.0
        out.append({b: x / total for b, x in w.items()})
    return out


def spread(points: list[Vector]) -> Vector | None:
    if len(points) < 25:
        return None
    n = len(points)
    mean = sum(points, Vector()) / n
    return Vector([math.sqrt(sum((p[i] - mean[i]) ** 2 for p in points) / n) for i in range(3)])


def build_affines(ch_rig, sk_rig, ch_samples, sk_samples) -> dict[str, Matrix]:
    """ch_samples/sk_samples: list of (world point, weights)."""
    affines: dict[str, Matrix] = {}
    ratios: dict[str, Vector] = {}
    head = sk_rig.data.bones["head"]
    head_children = {b.name for b in head.children_recursive}
    order = sorted(ch_rig.data.bones, key=lambda b: len(b.parent_recursive))
    for bone in order:
        name = bone.name
        if name not in sk_rig.data.bones:
            continue
        f_ch = bone_frame(ch_rig, bone)
        f_sk = bone_frame(sk_rig, sk_rig.data.bones[name])
        inv_ch, inv_sk = f_ch.inverted(), f_sk.inverted()
        local_ch = [inv_ch @ p for p, w in ch_samples if w.get(name, 0) >= 0.5]
        local_sk = [inv_sk @ p for p, w in sk_samples if w.get(name, 0) >= 0.5]
        s_ch, s_sk = spread(local_ch), spread(local_sk)
        parent = bone.parent.name if bone.parent else None
        if s_ch and s_sk:
            r = Vector([max(0.35, min(2.8, s_sk[i] / max(1e-5, s_ch[i]))) for i in range(3)])
        else:
            r = ratios.get(parent, Vector((1, 1, 1))).copy()
        # Along-bone scale from joint spacing where a deforming child exists.
        child = next((c for c in bone.children if c.use_deform and c.name in sk_rig.data.bones
                      and "twist" not in c.name), None)
        if child and name != "head":
            len_ch = (child.head_local - bone.head_local).length
            len_sk = (sk_rig.data.bones[child.name].head_local - sk_rig.data.bones[name].head_local).length
            if len_ch > 1e-4:
                r.y = len_sk / len_ch
        ratios[name] = r
        affines[name] = f_sk @ Matrix.Diagonal((r.x, r.y, r.z, 1.0)) @ inv_ch
    for name in head_children:
        if name in affines or name in ch_rig.data.bones:
            affines[name] = affines["head"]
    return affines, ratios


def blended(affines, w: dict[str, float]) -> Matrix:
    m = Matrix(((0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0)))
    total = 0.0
    for bone, x in w.items():
        a = affines.get(bone)
        if a is None:
            continue
        for i in range(4):
            for j in range(4):
                m[i][j] += a[i][j] * x
        total += x
    if total <= 0:
        return affines["pelvis"].copy()
    for i in range(4):
        for j in range(4):
            m[i][j] /= total
    return m


# ─────────────────────────────── helpers ────────────────────────────────────

def triangle_barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-14:
        return 1.0, 0.0, 0.0
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return 1 - v - w, v, w


def seam_ring(sk_parts) -> list[tuple[Vector, dict]]:
    """Sidekick torso vertices shared with the head (the neck seam), sorted by angle."""
    tors, head = sk_parts["10TORS"], sk_parts["01HEAD"]
    head_pts = [head.matrix_world @ v.co for v in head.data.vertices]
    kd = KDTree(len(head_pts))
    for i, p in enumerate(head_pts):
        kd.insert(p, i)
    kd.balance()
    tw = weights_of(tors)
    ring = []
    for v in tors.data.vertices:
        p = tors.matrix_world @ v.co
        if kd.find(p)[2] < 1e-4:
            ring.append((p, tw[v.index]))
    centre = sum((p for p, _ in ring), Vector()) / len(ring)
    ring.sort(key=lambda item: math.atan2(item[0].x - centre.x, -(item[0].y - centre.y)))
    return ring, centre


def nearest_on_ring(p: Vector, ring):
    best = None
    n = len(ring)
    for i in range(n):
        a, wa = ring[i]
        b, wb = ring[(i + 1) % n]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-12, ab.length_squared)))
        q = a + ab * t
        d = (p - q).length
        if best is None or d < best[0]:
            w = {}
            for bone, x in wa.items():
                w[bone] = w.get(bone, 0.0) + x * (1 - t)
            for bone, x in wb.items():
                w[bone] = w.get(bone, 0.0) + x * t
            best = (d, q, w)
    return best[1], best[2]


def ring_height(p: Vector, ring, centre) -> float:
    angle = math.atan2(p.x - centre.x, -(p.y - centre.y))
    angles = [math.atan2(q.x - centre.x, -(q.y - centre.y)) for q, _ in ring]
    n = len(ring)
    for i in range(n):
        a0, a1 = angles[i], angles[(i + 1) % n]
        span = (a1 - a0) % (2 * math.pi)
        off = (angle - a0) % (2 * math.pi)
        if off <= span + 1e-9:
            t = off / span if span > 1e-9 else 0
            return ring[i][0].z * (1 - t) + ring[(i + 1) % n][0].z * t
    return max(q.z for q, _ in ring)


# ─────────────────────────────── main ───────────────────────────────────────

def main():
    args = arguments()
    report = {}
    bpy.ops.wm.open_mainfile(filepath=str(args.sidekick_blend.expanduser().resolve()))
    sk_rig = bpy.data.objects["SidekickCustomizerRig"]
    with bpy.data.libraries.load(str(args.chibi_blend.expanduser().resolve()), link=False) as (_src, dst):
        dst.objects = ["ChibiRig_Male", "Body_Male"]
    ch_rig, ch_body = dst.objects
    for obj in (ch_rig, ch_body):
        bpy.context.scene.collection.objects.link(obj)

    sk_parts = {code: W.base_part(code) for code in [*BODY_CODES, "01HEAD"]}

    # 1) affine maps ------------------------------------------------------------
    ch_w = weights_of(ch_body)
    ch_pts = [ch_body.matrix_world @ v.co for v in ch_body.data.vertices]
    ch_samples = list(zip(ch_pts, ch_w))
    sk_samples = []
    for code, part in sk_parts.items():
        pw = weights_of(part)
        sk_samples += [(part.matrix_world @ v.co, pw[v.index]) for v in part.data.vertices]
    affines, ratios = build_affines(ch_rig, sk_rig, ch_samples, sk_samples)
    report["bone_ratios"] = {k: [round(x, 3) for x in v] for k, v in ratios.items()
                             if k in ("pelvis", "spine_02", "neck_01", "head", "upperarm_l", "lowerarm_l", "thigh_l", "calf_l")}

    # 2) chibi body in Sidekick space ------------------------------------------
    sk_space = [blended(affines, w) @ p for p, w in zip(ch_pts, ch_w)]
    sk_surface = W.gather([sk_parts[c] for c in BODY_CODES])
    sk_body = W.Body(sk_surface)
    ring, ring_centre = seam_ring(sk_parts)
    ring_radius = max((p - ring_centre).length for p, _ in ring)

    bm = bmesh.new()
    bm.from_mesh(ch_body.data)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        v.co = sk_space[v.index]
    orig = bm.verts.layers.int.new("orig")
    for v in bm.verts:
        v[orig] = v.index

    def above_seam(c: Vector) -> bool:
        horizontal = math.hypot(c.x - ring_centre.x, c.y - ring_centre.y)
        return c.z > 1.40 and (c.z > 1.52 or (horizontal < ring_radius * 1.9 and c.z > ring_height(c, ring, ring_centre)))

    doomed = [f for f in bm.faces if above_seam(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # keep only the largest island (drops stray crumbs near the ears/jaw)
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for start in bm.verts:
        if start.index in seen:
            continue
        stack, island = [start], []
        seen.add(start.index)
        while stack:
            v = stack.pop()
            island.append(v)
            for e in v.link_edges:
                o = e.other_vert(v)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        islands.append(island)
    largest = max(islands, key=len)
    small = [v for island in islands if island is not largest for v in island]
    if small:
        bmesh.ops.delete(bm, geom=small, context="VERTS")
    bm.verts.ensure_lookup_table()

    boundary = [v for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    stitched_weights = {}
    for v in boundary:
        q, w = nearest_on_ring(v.co, ring)
        v.co = q
        stitched_weights[v[orig]] = w
    # relax two rings below the seam so the stitch has no pleat
    pinned = {v.index for v in boundary}
    near = set()
    frontier = set(boundary)
    for _ in range(3):
        nxt = set()
        for v in frontier:
            for e in v.link_edges:
                o = e.other_vert(v)
                if o.index not in pinned and o not in near:
                    nxt.add(o)
        near |= nxt
        frontier = nxt
    for _ in range(6):
        for v in near:
            ns = [e.other_vert(v).co for e in v.link_edges]
            v.co = v.co.lerp(sum(ns, Vector()) / len(ns), 0.5)
    report["neck_stitch_vertices"] = len(boundary)

    # 3) per-vertex data after the cut ------------------------------------------
    verts = list(bm.verts)
    idx = {v: i for i, v in enumerate(verts)}
    vweights = [stitched_weights.get(v[orig], ch_w[v[orig]]) for v in verts]
    positions = [v.co.copy() for v in verts]

    # morph transfer from the Sidekick body surface (nearest triangle, barycentric)
    layers = {name: [] for name in W.LAYERS}
    for p in positions:
        loc, _n, tri, _d = sk_body.trees["Basis"].find_nearest(p)
        a, b, c = sk_body.triangles[tri]
        bary = triangle_barycentric(loc, *(sk_surface.basis(i) for i in (a, b, c)))
        base = sum((sk_surface.layers["Basis"][i] * s for i, s in zip((a, b, c), bary)), Vector())
        layers["Basis"].append(p.copy())
        for key in KEYS:
            shaped = sum((sk_surface.layers[key][i] * s for i, s in zip((a, b, c), bary)), Vector())
            layers[key].append(p + (shaped - base))

    # 4) split into Sidekick part names by nearest Sidekick part -----------------
    part_trees = {}
    for code in BODY_CODES:
        part = sk_parts[code]
        pts = [part.matrix_world @ v.co for v in part.data.vertices]
        part_trees[code] = BVHTree.FromPolygons(pts, [list(pl.vertices) for pl in part.data.polygons])
    face_parts = {code: [] for code in BODY_CODES}
    for f in bm.faces:
        c = f.calc_center_median()
        best = min(BODY_CODES, key=lambda code: part_trees[code].find_nearest(c)[3])
        face_parts[best].append([idx[v] for v in f.verts])
    bm.free()

    # Sidekick base body parts, SF/knight sets and SF/knight accessories go away.
    keep_slots = {"head", "hair", "brows", "ears", "facialHair", "nose", "teeth", "fixed"}
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.name.startswith("SKLIB__"):
            slot = obj.name.split("__")[1]
            if slot not in keep_slots:
                bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.objects.remove(ch_body, do_unlink=True)

    skin = bpy.data.materials["SKLIB_skin"]
    new_parts = {}
    for code, faces in face_parts.items():
        used = sorted({i for f in faces for i in f})
        remap = {old: new for new, old in enumerate(used)}
        mesh = bpy.data.meshes.new(f"CHIBI_{code}_Mesh")
        mesh.from_pydata([tuple(positions[i]) for i in used], [], [[remap[i] for i in f] for f in faces])
        mesh.update()
        for pl in mesh.polygons:
            pl.use_smooth = True
        name = f"SKLIB__{SLOT_OF[code]}__01__SK_HUMN_BASE_01_{code}_HU01"
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = sk_rig
        obj.modifiers.new("Armature", "ARMATURE").object = sk_rig
        mesh.materials.append(skin)
        groups = {}
        for new, old in enumerate(used):
            for bone, w in W.limit_weights(vweights[old]).items():
                if bone not in groups:
                    groups[bone] = obj.vertex_groups.new(name=bone)
                groups[bone].add([new], w, "REPLACE")
        obj.shape_key_add(name="Basis", from_mix=False)
        for key in KEYS:
            block = obj.shape_key_add(name=key, from_mix=False)
            for new, old in enumerate(used):
                block.data[new].co = layers[key][old]
        obj["chibi_body"] = True
        new_parts[code] = obj
    report["part_faces"] = {code: len(f) for code, f in face_parts.items()}

    # 5) Sidekick wardrobe builder in Sidekick space ----------------------------
    # The chibi body is already dense (~45k vertices); the Sidekick builder's
    # one-level subdivision is for its low-poly parts and would make ~150 MB.
    W.subdivide = lambda surface: None
    chains = {"l": W.chain_bones(sk_rig, "l"), "r": W.chain_bones(sk_rig, "r")}
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("SKLIB__top__")]:
        W.add_shoulder_key_to_part(obj, chains)
    parts_by_code = {code: W.base_part(code) for code in ["01HEAD", "10TORS", "11AUPL", "12AUPR", "13ALWL",
                                                            "14ALWR", "15HNDL", "16HNDR", "17HIPS", "18LEGL", "19LEGR"]}
    body_upper = W.Body(W.gather([parts_by_code[c] for c in W.BODY_UPPER]))
    body_lower = W.Body(W.gather([parts_by_code[c] for c in W.BODY_LOWER]))
    material = W.cloth_material()
    garments = []
    for recipe in W.TOPS:
        surface, cover = W.top_surface(recipe, body_upper, parts_by_code, chains, body_upper)
        props = {"wardrobe_garment": True, "garment_gender": recipe[1], "garment_label": recipe[3],
                 "garment_fabric": recipe[10], **W.gltf_cover(cover)}
        garments.append(W.build_object(surface, f"SKLIB__top__{recipe[0]:02d}__WARDROBE_{recipe[2]}", sk_rig, material, props, chains))
    for recipe in W.BOTTOMS:
        if recipe[4] == "pants":
            surface, cover = W.pants_surface(recipe, body_lower, parts_by_code, sk_rig, body_lower)
        else:
            surface, cover = W.skirt_surface(recipe, body_lower, parts_by_code)
        props = {"wardrobe_garment": True, "garment_gender": recipe[1], "garment_label": recipe[3],
                 "garment_fabric": recipe[10], **W.gltf_cover(cover)}
        garments.append(W.build_object(surface, f"SKLIB__bottom__{recipe[0]:02d}__WARDROBE_{recipe[2]}", sk_rig, material, props, chains))

    # sk-space -> chibi-space lookup for scalar cover values
    torso_pairs = [(sk_space[i], ch_pts[i], ch_w[i]) for i in range(len(ch_pts))]

    def map_scalar(kind: str, value: float) -> float:
        for tolerance in (0.012, 0.025, 0.05):
            picks = []
            for sk, ch, w in torso_pairs:
                arm = sum(x for b, x in w.items() if b.startswith(("upperarm", "lowerarm", "hand")))
                leg = sum(x for b, x in w.items() if b.startswith(("thigh", "calf", "foot")))
                if kind == "torso_z" and arm < 0.2 and leg < 0.6 and abs(sk.x) < 0.14 and abs(sk.z - value) < tolerance:
                    picks.append(ch.z + (value - sk.z))
                elif kind == "leg_z" and leg > 0.6 and abs(sk.z - value) < tolerance:
                    picks.append(ch.z)
                elif kind == "arm_x" and arm > 0.6 and abs(abs(sk.x) - value) < tolerance:
                    picks.append(abs(ch.x))
            if picks:
                return sum(picks) / len(picks)
        raise RuntimeError(f"cannot map {kind}={value}")

    lin = blended(affines, {"spine_03": 1.0}).to_3x3().inverted()
    for g in garments:
        kind = g["cover_kind"]
        if kind == "top":
            g["cover_hem_y"] = round(map_scalar("torso_z", g["cover_hem_y"]), 5)
            g["cover_sleeve_x"] = round(map_scalar("arm_x", min(g["cover_sleeve_x"], 0.70)), 5)
            y0 = g["cover_neck_y0"]
            g["cover_neck_y0"] = round(map_scalar("torso_z", min(y0, 1.43)) + (y0 - min(y0, 1.43)) * lin[2][2], 5)
            g["cover_neck_slope_z"] = round(g["cover_neck_slope_z"] * lin[2][2] / lin[1][1], 5)
            g["cover_neck_curve"] = round(g["cover_neck_curve"] * lin[2][2] / (lin[0][0] ** 2), 5)
        else:
            g["cover_waist_y"] = round(map_scalar("torso_z", g["cover_waist_y"]), 5)
            g["cover_leg_y"] = round(map_scalar("leg_z", g["cover_leg_y"]), 5)
    band = {"top": [map_scalar("torso_z", 1.17), map_scalar("torso_z", 1.36)],
            "bottom": [map_scalar("torso_z", 0.93) - (map_scalar("torso_z", 1.0) - map_scalar("torso_z", 0.93)) * 3.2,
                       map_scalar("torso_z", 1.0)]}
    new_parts["10TORS"]["underwear_band"] = [round(x, 4) for x in band["top"]]
    new_parts["17HIPS"]["underwear_band"] = [round(x, 4) for x in band["bottom"]]
    shift = (lin @ Vector((W.SHOULDER_SHIFT, 0, 0)))
    arm_lin = blended(affines, {"upperarm_l": 1.0}).to_3x3().inverted()
    new_parts["10TORS"]["shoulder_shift"] = round((arm_lin @ Vector((W.SHOULDER_SHIFT, 0, 0))).length, 5)
    report["underwear_band"] = band
    report["shoulder_shift"] = new_parts["10TORS"]["shoulder_shift"]
    _ = shift

    # 6) map everything back to chibi space --------------------------------------
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("SKLIB__")]
    for obj in meshes:
        world = obj.matrix_world.copy()
        to_local = world.inverted()
        ws = weights_of(obj)
        inverses = [blended(affines, w).inverted() for w in ws]
        blocks = obj.data.shape_keys.key_blocks if obj.data.shape_keys else None
        if blocks:
            for block in blocks:
                for i, point in enumerate(block.data):
                    point.co = to_local @ (inverses[i] @ (world @ point.co))
            for i, v in enumerate(obj.data.vertices):
                v.co = blocks["Basis"].data[i].co
        else:
            for i, v in enumerate(obj.data.vertices):
                v.co = to_local @ (inverses[i] @ (world @ v.co))
        obj.data.update()

    # head-child bones follow the head map onto the chibi head
    bpy.ops.object.select_all(action="DESELECT")
    ch_rig.select_set(True)
    bpy.context.view_layer.objects.active = ch_rig
    bpy.ops.object.mode_set(mode="EDIT")
    inv_head = affines["head"].inverted()
    for b in sk_rig.data.bones["head"].children_recursive:
        if b.name in ch_rig.data.edit_bones:
            eb = ch_rig.data.edit_bones[b.name]
            roll = eb.roll
            eb.head = inv_head @ (sk_rig.matrix_world @ b.head_local)
            eb.tail = inv_head @ (sk_rig.matrix_world @ b.tail_local)
            eb.roll = roll
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = ch_rig
        obj.matrix_world = world
        for mod in obj.modifiers:
            if mod.type == "ARMATURE":
                mod.object = ch_rig
    bpy.data.objects.remove(sk_rig, do_unlink=True)
    ch_rig.name = "SidekickCustomizerRig"

    report["meshes"] = len(meshes)
    report["garments"] = [g.name for g in garments]
    for path in (args.blend_output, args.glb_output, args.report):
        path.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    ch_rig.select_set(True)
    for obj in meshes:
        obj.hide_viewport = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ch_rig
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.expanduser().resolve()))
    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output.expanduser().resolve()), export_format="GLB", use_selection=True,
        export_animations=False, export_skins=True, export_influence_nb=4, export_morph=True,
        export_morph_normal=True, export_apply=False, export_extras=True,
    )
    args.report.expanduser().resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    print("CHIBI_SIDEKICK_OK", len(meshes))


if __name__ == "__main__":
    main()
