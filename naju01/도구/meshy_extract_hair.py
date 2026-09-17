"""Extract a Meshy hair variant onto a Meshy base character (no geometry authoring).

1. Similarity-align (rotation + translation + uniform scale) the variant head to the
   base head with ICP on face/ear/jaw points that hair does not cover.
2. Keep variant faces whose vertices lie outside the base head surface by more than
   `--gap` metres above the neck: that is the hair shell, with its UVs and texture.
3. Drop tiny islands, save a blend with base + hair, export the hair GLB and
   texture-colour renders (front/side/back) of base+hair next to the variant.

Usage:
  Blender --background --factory-startup --python meshy_extract_hair.py -- \
    --base ~/Downloads/Meshy_AI_Bald_Cartoon_Boy_0917063109_texture.glb \
    --variant ~/Downloads/Meshy_AI_Young_Boy_Character_0917063138_texture.glb \
    --out-dir naju01/캐릭터작업/meshy-parts/male_hair_01
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


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--base", type=Path, required=True)
    p.add_argument("--variant", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--gap", type=float, default=0.006)
    p.add_argument("--selection", type=Path, default=None,
                   help="selection.json from meshy_hair_select.py (reviewed face indices)")
    return p.parse_args(raw)


def import_glb(path: Path, name: str) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path.expanduser().resolve()))
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    obj = meshes[0]
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)
    for other in [o for o in bpy.data.objects if o not in before and o is not obj]:
        bpy.data.objects.remove(other, do_unlink=True)
    obj.name = name
    return obj


def umeyama(src: list[Vector], dst: list[Vector]) -> Matrix:
    """Least-squares similarity transform src -> dst (4x4)."""
    import numpy as np

    a = np.array([tuple(p) for p in src])
    b = np.array([tuple(p) for p in dst])
    ma, mb = a.mean(0), b.mean(0)
    ac, bc = a - ma, b - mb
    cov = bc.T @ ac / len(a)
    u, s, vt = np.linalg.svd(cov)
    d = np.eye(3)
    if np.linalg.det(u @ vt) < 0:
        d[2, 2] = -1
    r = u @ d @ vt
    var = (ac ** 2).sum() / len(a)
    scale = float(np.trace(np.diag(s) @ d) / var)
    t = mb - scale * r @ ma
    m = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            m[i][j] = scale * r[i, j]
        m[i][3] = t[i]
    return m


def head_frame(points: list[Vector]):
    zs = sorted(p.z for p in points)
    top = zs[-1]
    height = top - zs[0]
    return top, height



def face_islands(bm):
    bm.faces.ensure_lookup_table()
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, island = [f], []
        seen.add(f.index)
        while stack:
            cur = stack.pop()
            island.append(cur)
            for e in cur.edges:
                for nb in e.link_faces:
                    if nb.index not in seen:
                        seen.add(nb.index)
                        stack.append(nb)
        islands.append(island)
    return islands


def base_color_pixels(obj):
    """Base-colour texture as a small numpy RGB array (for colour classification only)."""
    import numpy as np

    material = obj.data.materials[0]
    image = None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            link = node.inputs["Base Color"].links
            if link and link[0].from_node.type == "TEX_IMAGE":
                image = link[0].from_node.image
    if image is None:
        raise RuntimeError("base colour texture not found")
    small = image.copy()
    small.scale(1024, 1024)
    buf = np.empty(1024 * 1024 * 4, dtype=np.float32)
    small.pixels.foreach_get(buf)
    return buf.reshape(1024, 1024, 4)[:, :, :3]


def ear_region(base_pts, top, height):
    """Base ear box: beyond the skull side (front-of-head width) at ear height."""
    band = (top - height * 0.19, top - height * 0.105)
    front = [abs(p.x) for p in base_pts if band[0] < p.z < band[1] and -0.2 < p.y < -0.06]
    skull = max(front)
    return {"z": band, "x_min": skull + 0.004, "y": (-0.06, 0.16)}


def select_ear_faces(obj, box) -> set[int]:
    """The variant's own ear: faces in the ear box beyond the skull side.

    The hair was generated around this ear, so shipping it with the hair (and hiding
    the base ear while this hair is worn) removes strands cutting through the ear.
    """
    faces = set()
    for poly in obj.data.polygons:
        c = sum((obj.data.vertices[i].co for i in poly.vertices), Vector()) / len(poly.vertices)
        if box["z"][0] - 0.01 < c.z < box["z"][1] + 0.01 and abs(c.x) > box["x_min"] and box["y"][0] - 0.02 < c.y < box["y"][1]:
            faces.add(poly.index)
    return faces


def uv_islands(obj) -> list[list[int]]:
    """Faces connected across edges whose UVs match on both sides (Meshy texture charts)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active

    def key(loop):
        return round(loop[uv].uv.x, 5), round(loop[uv].uv.y, 5)

    seen, islands = set(), []
    for start in bm.faces:
        if start.index in seen:
            continue
        stack, island = [start], []
        seen.add(start.index)
        while stack:
            face = stack.pop()
            island.append(face.index)
            for loop in face.loops:
                edge_uv = {key(loop), key(loop.link_loop_next)}
                for other in loop.edge.link_loops:
                    nb = other.face
                    if nb.index in seen:
                        continue
                    if {key(other), key(other.link_loop_next)} == edge_uv:
                        seen.add(nb.index)
                        stack.append(nb)
        islands.append(island)
    bm.free()
    return islands


def select_hair_faces(obj, top, height, neck_z, tree=None, eye_line=None) -> set[int]:
    """Whole texture charts that are mostly hair-coloured.

    Meshy lays hair and face on separate UV charts, so dark lashes and brows painted
    on the face chart are excluded even though their colour matches the hair.
    """
    import numpy as np

    pixels = base_color_pixels(obj)
    uv = obj.data.uv_layers.active.data
    polys = obj.data.polygons
    verts = obj.data.vertices
    hair = set()
    for island in uv_islands(obj):
        lum, zs = [], []
        for index in island[:: max(1, len(island) // 400)]:
            poly = polys[index]
            u = sum(uv[li].uv.x for li in poly.loop_indices) / poly.loop_total
            v = sum(uv[li].uv.y for li in poly.loop_indices) / poly.loop_total
            px = pixels[min(1023, max(0, int(v % 1 * 1024))), min(1023, max(0, int(u % 1 * 1024)))]
            lum.append(float(np.dot(px, (0.2126, 0.7152, 0.0722))))
            zs.append(sum(verts[i].co.z for i in poly.vertices) / len(poly.vertices))
        dark = sum(1 for x in lum if x < 0.45) / len(lum)
        high = sum(1 for z in zs if z > neck_z - 0.10) / len(zs)
        if dark >= 0.6 and high >= 0.5:
            hair.update(island)
    return fill_enclosed(obj, hair, neck_z)


def fill_enclosed(obj, hair: set[int], neck_z: float) -> set[int]:
    """Add small non-hair patches completely surrounded by hair (strand highlights, gaps)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    limit = max(400, len(hair) // 40)
    seen = set(hair)
    added = set()
    for start in bm.faces:
        if start.index in seen or start.calc_center_median().z < neck_z - 0.10:
            continue
        stack, patch, touches_outside = [start], [], False
        seen.add(start.index)
        while stack:
            face = stack.pop()
            patch.append(face.index)
            for edge in face.edges:
                for nb in edge.link_faces:
                    if nb.index in hair or nb.index in seen:
                        continue
                    if nb.calc_center_median().z < neck_z - 0.10:
                        touches_outside = True
                        continue
                    seen.add(nb.index)
                    stack.append(nb)
        if not touches_outside and len(patch) <= limit:
            added.update(patch)
    bm.free()
    return hair | added


def seat_on_skull(bm, tree, top, height, skip=frozenset()) -> dict:
    """Move hair radially (about the head centre) so its inner layer rests on the base skull.

    The shift is a smooth, low-frequency field over directions (binned, blurred and
    bilinearly sampled), so strands keep their original relief and nothing steps.
    """
    centre = Vector((0.0, 0.0, top - height * 0.13))
    rows, cols = 24, 48

    def coords(d: Vector):
        theta = math.acos(max(-1.0, min(1.0, d.z)))
        phi = math.atan2(d.y, d.x) + math.pi
        return theta / math.pi * (rows - 1), phi / (2 * math.pi) * cols

    inner = [[None] * cols for _ in range(rows)]
    for v in bm.verts:
        off = v.co - centre
        y, x = coords(off.normalized())
        r, c = int(round(y)), int(round(x)) % cols
        inner[r][c] = off.length if inner[r][c] is None else min(inner[r][c], off.length)
    delta = [[None] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            if inner[r][c] is None:
                continue
            theta = r / (rows - 1) * math.pi
            phi = c / cols * 2 * math.pi - math.pi
            d = Vector((math.sin(theta) * math.cos(phi), math.sin(theta) * math.sin(phi), math.cos(theta)))
            hit = tree.ray_cast(centre, d, 1.0)[0]
            if hit is not None:
                delta[r][c] = (hit - centre).length + 0.004 - inner[r][c]
    known = [x for row in delta for x in row if x is not None]
    fill = sum(known) / len(known)
    field = [[x if x is not None else fill for x in row] for row in delta]
    for _ in range(12):
        field = [[(field[r][c] * 2 + field[max(0, r - 1)][c] + field[min(rows - 1, r + 1)][c]
                   + field[r][(c - 1) % cols] + field[r][(c + 1) % cols]) / 6
                  for c in range(cols)] for r in range(rows)]

    def sample(d: Vector) -> float:
        y, x = coords(d)
        r0, c0 = int(math.floor(y)), int(math.floor(x))
        fy, fx = y - r0, x - c0
        r1 = min(rows - 1, r0 + 1)
        a, b = field[r0][c0 % cols], field[r0][(c0 + 1) % cols]
        c_, d_ = field[r1][c0 % cols], field[r1][(c0 + 1) % cols]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c_ * (1 - fx) + d_ * fx) * fy

    shifts = []
    for v in bm.verts:
        if v in skip:
            continue
        off = v.co - centre
        d = off.normalized()
        shift = sample(d)
        v.co = centre + d * (off.length + shift)
        shifts.append(shift)
    shifts.sort()
    return {"median_shift_mm": round(1000 * shifts[len(shifts) // 2], 1),
            "p90_abs_mm": round(1000 * sorted(abs(x) for x in shifts)[int(len(shifts) * .9)], 1)}


def clear_skull(bm, tree, gap: float, skip=frozenset()) -> int:
    """Where thin hair dips under the base scalp, lift just those vertices outside it.

    Smoothed over one-ring neighbours so strands don't get dents.
    """
    lift = {}
    for v in bm.verts:
        if v in skip:
            continue
        loc, normal, _i, _d = tree.find_nearest(v.co)
        if loc is None:
            continue
        signed = (v.co - loc).dot(normal)
        if signed < gap:
            lift[v] = normal * (gap - signed)
    smoothed = {}
    for v, vec in lift.items():
        ring = [lift.get(e.other_vert(v), Vector()) for e in v.link_edges]
        smoothed[v] = (vec * 2 + sum(ring, Vector())) / (2 + len(ring))
    for v, vec in smoothed.items():
        v.co += vec.normalized() * max(vec.length, lift[v].length)
    return len(lift)

def main():
    args = arguments()
    out = args.out_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    base = import_glb(args.base, "Base")
    var = import_glb(args.variant, "Variant")

    base_pts = [v.co.copy() for v in base.data.vertices]
    top, height = head_frame(base_pts)
    tree = BVHTree.FromPolygons(base_pts, [list(p.vertices) for p in base.data.polygons])

    # Head region of the base: above the chin line (upper ~25% of the body).
    neck_z = top - height * 0.26
    face_band = (top - height * 0.24, top - height * 0.12)

    # Front of the face below the eyes (cheeks, nose, mouth, chin): hair never covers it.
    eye_line = top - height * 0.155
    chin_line = top - height * 0.235
    front_y = min(p.y for p in base_pts if chin_line < p.z < eye_line and abs(p.x) < 0.05)

    def anchor(p: Vector) -> bool:
        return chin_line < p.z < eye_line and abs(p.x) < 0.11 and p.y < front_y + 0.07

    var_pts = [v.co.copy() for v in var.data.vertices]
    sample = [p for p in var_pts if anchor(p)][::7]
    transform = Matrix.Identity(4)
    history = []
    for _ in range(30):
        moved = [transform @ p for p in sample]
        pairs = []
        for p in moved:
            loc, _n, _i, dist = tree.find_nearest(p)
            if loc is not None and dist < 0.05:
                pairs.append((p, loc, dist))
        pairs.sort(key=lambda x: x[2])
        pairs = pairs[: int(len(pairs) * 0.8)]
        step = umeyama([p for p, _, _ in pairs], [q for _, q, _ in pairs])
        transform = step @ transform
        history.append(round(1000 * sum(d for _, _, d in pairs) / len(pairs), 2))
        if len(history) > 3 and abs(history[-1] - history[-2]) < 0.01:
            break
    var.data.transform(transform)
    var.data.update()

    eye_line = top - height * 0.155
    ear_box = ear_region(base_pts, top, height)
    if args.selection:
        hair_faces = set(json.loads(args.selection.read_text()))
        ear_faces = set()
    else:
        hair_faces = select_hair_faces(var, top, height, neck_z, tree, eye_line)
        ear_faces = select_ear_faces(var, ear_box)
        hair_faces |= ear_faces
    bm = bmesh.new()
    bm.from_mesh(var.data)
    bm.faces.ensure_lookup_table()
    ear_layer = bm.faces.layers.int.new("ear")
    for f in bm.faces:
        f[ear_layer] = 1 if f.index in ear_faces else 0
    doomed = [f for f in bm.faces if f.index not in hair_faces]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # glTF splits vertices along UV seams; weld positions (UVs live on loops, so they
    # are kept) so a hair shell is one island instead of hundreds of UV patches.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    islands = face_islands(bm)
    total = sum(len(i) for i in islands)
    small = [f for island in islands if len(island) < max(300, total * 0.02)
             and not any(f[ear_layer] for f in island) for f in island]
    bmesh.ops.delete(bm, geom=small, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    ear_verts = {v for f in bm.faces if f[ear_layer] for v in f.verts}
    fit = seat_on_skull(bm, tree, top, height, skip=ear_verts)
    fit["pushed_out"] = clear_skull(bm, tree, 0.003, skip=ear_verts)
    bm.to_mesh(var.data)
    bm.free()
    var.name = "Hair"

    report = {
        "icp_mean_mm": history,
        "scale": round(transform.to_scale().x, 4),
        "translation_mm": [round(1000 * x, 1) for x in transform.to_translation()],
        "hair_vertices": len(var.data.vertices),
        "hair_faces": len(var.data.polygons),
        "islands_kept": sum(1 for i in islands if len(i) >= max(300, total * 0.02)),
        "seat": fit,
        "ear_faces": len(ear_faces),
        "ear_region": {"z": [round(x, 4) for x in ear_box["z"]], "x_min": round(ear_box["x_min"], 4)},
    }

    bpy.ops.wm.save_as_mainfile(filepath=str(out / "hair_on_base.blend"))
    bpy.ops.object.select_all(action="DESELECT")
    var.select_set(True)
    bpy.context.view_layer.objects.active = var
    bpy.ops.export_scene.gltf(filepath=str(out / "hair.glb"), export_format="GLB", use_selection=True)

    # Texture-colour renders: base+hair, and hair alone.
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = 520, 560
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = height * 0.34
    centre = Vector((0, 0, top - height * 0.15))
    if ear_faces:
        bmb = bmesh.new()
        bmb.from_mesh(base.data)
        ears = [v for v in bmb.verts if ear_box["z"][0] < v.co.z < ear_box["z"][1]
                and abs(v.co.x) > ear_box["x_min"] and ear_box["y"][0] < v.co.y < ear_box["y"][1]]
        bmesh.ops.delete(bmb, geom=ears, context="VERTS")
        preview = base.data.copy()
        preview.name = "BasePreview"
        bmb.to_mesh(preview)
        bmb.free()
        base.data = preview
    for label, hide_base in (("with_base", False), ("hair_only", True)):
        base.hide_render = hide_base
        for view, angle in (("front", 0), ("side", math.pi / 2), ("back", math.pi)):
            d = Vector((math.sin(angle), -math.cos(angle), 0))
            cam.location = centre + d * 4
            cam.rotation_euler = (math.pi / 2, 0, angle)
            scene.render.filepath = str(out / f"{label}_{view}.png")
            bpy.ops.render.render(write_still=True)
    base.hide_render = False
    # 확인용 blend: 기본 모델은 이 헤어를 쓸 때처럼 귀를 숨긴 상태로 저장한다.
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "hair_on_base.blend"))
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print("MESHY_HAIR_OK", json.dumps(report))


if __name__ == "__main__":
    main()
