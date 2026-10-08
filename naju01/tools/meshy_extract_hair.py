"""다른 Meshy 모델의 머리카락을 기본 캐릭터 머리에 옮겨 얹는다(형상을 새로 만들지 않는다).

1. 머리카락이 덮지 않는 얼굴 아랫부분 점으로 ICP 유사 변환(회전·이동·균일 배율)을 맞춘다.
2. 머리카락 면(UV·텍스처 그대로)만 남기고 작은 섬을 버린 뒤 기본 두피에 얹는다.
3. 기본+머리카락 blend, 머리카락 GLB, 앞·옆·뒤 검수 그림을 쓴다.

Usage:
  Blender --background --factory-startup --python meshy_extract_hair.py -- \
    --base ~/Downloads/Meshy_AI_Bald_Cartoon_Boy_0917063109_texture.glb \
    --variant ~/Downloads/Meshy_AI_Young_Boy_Character_0917063138_texture.glb \
    --out-dir naju01/character-work/meshy-parts/male_hair_01
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--variant", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--gap", type=float, default=0.006)
    parser.add_argument("--selection", type=Path, default=None,
                   help="selection.json from meshy_hair_select.py (reviewed face indices)")
    return parser.parse_args(raw)


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
    """src → dst 최소제곱 유사 변환(4x4)."""
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
    """기본색 텍스처를 1024² RGB 배열로(색 분류용)."""
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
    """기본 모델의 귀 상자: 귀 높이에서 두개골 옆면보다 바깥."""
    band = (top - height * 0.19, top - height * 0.105)
    front = [abs(p.x) for p in base_pts if band[0] < p.z < band[1] and -0.2 < p.y < -0.06]
    skull = max(front)
    return {"z": band, "x_min": skull + 0.004, "y": (-0.06, 0.16)}


def select_ear_faces(obj, box) -> set[int]:
    """머리카락을 가져오는 모델 자신의 귀 면.

    머리카락이 이 귀를 둘러 생성됐으므로 귀를 함께 가져와야(기본 귀는 숨김) 가닥이 귀를 뚫지 않는다.
    """
    faces = set()
    for poly in obj.data.polygons:
        c = sum((obj.data.vertices[i].co for i in poly.vertices), Vector()) / len(poly.vertices)
        if box["z"][0] - 0.01 < c.z < box["z"][1] + 0.01 and abs(c.x) > box["x_min"] and box["y"][0] - 0.02 < c.y < box["y"][1]:
            faces.add(poly.index)
    return faces


def uv_islands(obj) -> list[list[int]]:
    """양쪽 UV 가 같은 모서리로 이어진 면 묶음(= Meshy 텍스처 차트)."""
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


def select_hair_faces(obj, neck_z) -> set[int]:
    """대부분 머리카락 색인 텍스처 차트를 통째로 고른다.

    Meshy 는 머리카락과 얼굴을 다른 차트에 두므로, 얼굴 차트의 어두운 눈썹·속눈썹은 빠진다.
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
    """머리카락에 완전히 둘러싸인 작은 조각(가닥 하이라이트·틈)을 더한다."""
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
    """머리 중심에서 방사 방향으로 옮겨 안쪽 층이 기본 두개골에 얹히게 한다.

    이동량은 방향별로 칸을 나눠 흐린 매끄러운 장이라 가닥의 결이 살고 계단이 안 생긴다.
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
    """얇은 머리카락이 두피 아래로 파고든 정점만 바깥으로 들어 올린다(1링 평균으로 패임 방지)."""
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

    # 머리 영역: 턱선 위(몸 위쪽 약 25%).
    neck_z = top - height * 0.26

    # 눈 아래 얼굴 앞면(뺨·코·입·턱)은 머리카락이 덮지 않아 정렬 기준점으로 쓴다.
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

    ear_box = ear_region(base_pts, top, height)
    if args.selection:
        hair_faces = set(json.loads(args.selection.read_text()))
        ear_faces = set()
    else:
        hair_faces = select_hair_faces(var, neck_z)
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
    # glTF 는 UV 이음매마다 정점을 쪼개므로 자리로 용접해 머리카락을 한 섬으로 만든다(UV 는 루프에 남는다).
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

    # 텍스처 색 검수 그림: 기본+머리카락, 머리카락만.
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
    # 확인용 blend 는 이 머리카락을 쓸 때처럼 기본 귀를 숨긴 상태로 저장한다.
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "hair_on_base.blend"))
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print("MESHY_HAIR_OK", json.dumps(report))


if __name__ == "__main__":
    main()
