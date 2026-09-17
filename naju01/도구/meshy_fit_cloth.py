"""Cut the reviewed clothing out of a dressed Meshy variant and fit it to the base body.

The garment mesh, its UVs and its texture stay exactly as Meshy made them.  Only its
placement changes: each bone of a temporary rig gets an affine map (variant bind ->
base bind, bone frame to bone frame with per-axis size ratios), and every garment
vertex moves with the weight blend of those maps.  That absorbs the pose and
proportion differences between two Meshy generations.

Adds Top_<Label>/Bottom_<Label> objects to the base rig blend (weights taken from
the nearest base-body vertices), so build_chibi_body.py straightens the arms and
rebinds body and clothes together.

Usage:
  Blender --background --factory-startup --python meshy_fit_cloth.py -- \
    --base-blend /tmp/meshy_base_rig.blend --label Male \
    --variant ~/Downloads/Meshy_AI_Bald_Cartoon_Boy_in_W_0917064538_texture.glb \
    --selection naju01/캐릭터작업/meshy-parts/outfit_m/select/selection.json \
    --split-z 0.02 --out-blend /tmp/meshy_base_rig.blend --review-dir /tmp/fit_m
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
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshy_base_rig as R  # noqa: E402
import meshy_extract_hair as H  # noqa: E402


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--base-blend", type=Path, required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--variant", type=Path, required=True)
    p.add_argument("--selection", type=Path, required=True)
    p.add_argument("--split-z", type=float, required=True, help="waist height in variant coordinates")
    p.add_argument("--out-blend", type=Path, required=True)
    p.add_argument("--review-dir", type=Path, required=True)
    return p.parse_args(raw)


def spread(points, frame_inv):
    local = [frame_inv @ p for p in points]
    if len(local) < 25:
        return None
    n = len(local)
    mean = sum(local, Vector()) / n
    return Vector([math.sqrt(sum((p[i] - mean[i]) ** 2 for p in local) / n) for i in range(3)])


def bone_frame(joints, name, tail_name) -> Matrix:
    head = joints[name]
    tail = joints.get(tail_name, head + Vector((0, 0, 0.05)))
    y = (tail - head)
    if y.length < 1e-6:
        y = Vector((0, 0, 1))
    y.normalize()
    ref = Vector((0, -1, 0)) if abs(y.dot(Vector((0, -1, 0)))) < 0.95 else Vector((1, 0, 0))
    x = ref.cross(y).normalized()
    z = y.cross(x)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2] = x[i], y[i], z[i]
        m[i][3] = head[i]
    return m


CHAIN = {  # bone -> tail joint
    "Hips": "Spine", "Spine": "Chest", "Chest": "Neck", "Neck": "Head", "Head": "HeadTop",
    **{f"{n}.{s}": f"{t}.{s}" for s in ("L", "R")
       for n, t in (("Clavicle", "UpperArm"), ("UpperArm", "Forearm"), ("Forearm", "Hand"), ("Hand", "HandTip"),
                    ("Thigh", "Shin"), ("Shin", "Foot"), ("Foot", "Toe"))},
}


def affines(base_joints, base_pts, var_joints, var_pts):
    """Per-bone affine variant -> base, with spread ratios from each body's own points."""
    result = {}
    for bone, tail in CHAIN.items():
        f_base = bone_frame(base_joints, bone, tail)
        f_var = bone_frame(var_joints, bone, tail)
        inv_base, inv_var = f_base.inverted(), f_var.inverted()
        near_base = [p for p in base_pts if (p - base_joints[bone]).length < 0.18]
        near_var = [p for p in var_pts if (p - var_joints[bone]).length < 0.18]
        s_base, s_var = spread(near_base, inv_base), spread(near_var, inv_var)
        if s_base and s_var:
            ratio = Vector([max(0.6, min(1.6, s_base[i] / max(1e-5, s_var[i]))) for i in range(3)])
        else:
            ratio = Vector((1, 1, 1))
        length_base = (base_joints[tail] - base_joints[bone]).length
        length_var = (var_joints[tail] - var_joints[bone]).length
        if length_var > 1e-4:
            ratio.y = max(0.6, min(1.6, length_base / length_var))
        result[bone] = f_base @ Matrix.Diagonal((ratio.x, ratio.y, ratio.z, 1.0)) @ inv_var
    return result


def blended(maps, weights):
    m = Matrix(((0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 0, 0)))
    total = 0.0
    for bone, w in weights.items():
        a = maps.get(bone)
        if a is None:
            continue
        for i in range(4):
            for j in range(4):
                m[i][j] += a[i][j] * w
        total += w
    if total <= 0:
        return maps["Hips"].copy()
    for i in range(4):
        for j in range(4):
            m[i][j] /= total
    return m


def main():
    args = arguments()
    review = args.review_dir.expanduser().resolve()
    review.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(args.base_blend.expanduser().resolve()))
    base = bpy.data.objects[f"Body_{args.label}"]
    rig = bpy.data.objects[f"Rig_{args.label}"]
    base_pts = [v.co.copy() for v in base.data.vertices]
    base_joints = R.find_landmarks(base_pts)

    var = H.import_glb(args.variant, "Variant")
    pts = [v.co for v in var.data.vertices]
    low = min(p.z for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    var.data.transform(Matrix.Translation((-cx, -cy, -low)))
    var.data.update()
    var_pts = [v.co.copy() for v in var.data.vertices]
    var_joints = R.find_landmarks(var_pts)
    maps = affines(base_joints, base_pts, var_joints, var_pts)

    # Base-body weights for the nearest-vertex transfer.
    names = {g.index: g.name for g in base.vertex_groups}
    base_weights = [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-5} for v in base.data.vertices]
    tree = KDTree(len(base_pts))
    for i, p in enumerate(base_pts):
        tree.insert(p, i)
    tree.balance()

    selection = set(json.loads(args.selection.read_text()))
    report = {"selected_faces": len(selection), "parts": {}}
    for part, keep in (("Top", lambda c: c.z >= args.split_z), ("Bottom", lambda c: c.z < args.split_z)):
        obj = var.copy()
        obj.data = var.data.copy()
        obj.name = f"{part}_{args.label}"
        bpy.context.scene.collection.objects.link(obj)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        doomed = [f for f in bm.faces if f.index not in selection or not keep(f.calc_center_median())]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        if not obj.data.vertices:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        # Weights from the nearest base-body vertices, then the affine move.
        groups = {}
        moved = []
        for v in obj.data.vertices:
            found = tree.find_n(v.co, 4)
            weights: dict[str, float] = {}
            norm = 0.0
            for _co, index, dist in found:
                share = 1.0 / max(dist, 1e-4)
                norm += share
                for bone, w in base_weights[index].items():
                    weights[bone] = weights.get(bone, 0.0) + w * share
            weights = {b: w / norm for b, w in weights.items()}
            ranked = sorted(((w, b) for b, w in weights.items() if w > 1e-3), reverse=True)[:4]
            total = sum(w for w, _ in ranked) or 1.0
            final = {b: w / total for w, b in ranked}
            moved.append((v.index, final))
            v.co = blended(maps, final) @ v.co
        for index, weights in moved:
            for bone, w in weights.items():
                if bone not in groups:
                    groups[bone] = obj.vertex_groups.new(name=bone)
                groups[bone].add([index], w, "REPLACE")
        obj.modifiers.new("Armature", "ARMATURE").object = rig
        obj.parent = rig
        obj["slot"] = part.lower()
        obj["variant"] = 0
        report["parts"][obj.name] = {"vertices": len(obj.data.vertices), "faces": len(obj.data.polygons)}
    bpy.data.objects.remove(var, do_unlink=True)

    # Review renders: base body with the fitted clothes.
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = 620, 720
    for o in bpy.data.objects:
        o.hide_render = o.type == "MESH" and args.label not in o.name
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    height = max(p.z for p in base_pts)
    cam.data.ortho_scale = height * 1.05
    for name, angle in (("front", 0), ("side", math.pi / 2), ("back", math.pi)):
        d = Vector((math.sin(angle), -math.cos(angle), 0))
        cam.location = Vector((0, 0, height * 0.5)) + d * 5
        cam.rotation_euler = (math.pi / 2, 0, angle)
        scene.render.filepath = str(review / f"{args.label}_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for o in bpy.data.objects:
        o.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out_blend.expanduser().resolve()))
    (review / f"{args.label}_fit_report.json").write_text(json.dumps(report, indent=2))
    print("CLOTH_FIT_OK", json.dumps(report["parts"]))


if __name__ == "__main__":
    main()
