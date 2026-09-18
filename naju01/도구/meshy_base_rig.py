"""Rig a bald Meshy base character with a temporary 22-bone rig (no shape authoring).

The Meshy mesh and texture stay untouched.  Joint positions come from horizontal
slices of the mesh (crotch gap, neck narrowing, arm axis, leg centre lines); the
result is rendered with the skeleton drawn over it for visual review.  Weights are
computed with Blender automatic weights on a welded, decimated proxy and transferred
to the full mesh.  Output uses the V4 names (Rig_<Label>, Body_<Label>) so
build_chibi_body.py can straighten the arms to the Sidekick T-pose and rebind to
the Sidekick 89-bone skeleton.

Usage:
  Blender --background --factory-startup --python meshy_base_rig.py -- \
    --male ~/Downloads/Meshy_AI_Bald_Cartoon_Boy_0917063109_texture.glb \
    --female ~/Downloads/Meshy_AI_Bald_Fitness_Avatar_0917063125_texture.glb \
    --blend-output /tmp/meshy_base_rig.blend --review-dir /tmp/meshy_base_review
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshy_extract_hair as H  # noqa: E402


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--male", type=Path)
    p.add_argument("--female", type=Path)
    p.add_argument("--blend-output", type=Path, required=True)
    p.add_argument("--review-dir", type=Path, required=True)
    # 옷을 입은 모델은 소매·밑단 때문에 관절이 잘못 잡힌다(티셔츠에서는 손목이
    # 13% 안쪽으로 잡혀 팔 각도가 18도 틀어졌다). 속옷 차림에서 한 번 잡은 관절을
    # 키로 나눠 저장해 두고(--joints-out) 같은 캐릭터의 다른 착장에 그대로 쓴다(--joints).
    p.add_argument("--joints-out", type=Path, default=None)
    p.add_argument("--joints", type=Path, default=None)
    return p.parse_args(raw)


def slice_points(points, z, band):
    return [p for p in points if abs(p.z - z) < band]


def clusters_x(points, gap=0.02):
    xs = sorted(p.x for p in points)
    if not xs:
        return []
    groups, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x - prev > gap:
            groups.append((start, prev))
            start = x
        prev = x
    groups.append((start, prev))
    return groups


def centroid(points):
    return sum(points, Vector()) / len(points)


def find_landmarks(points) -> dict[str, Vector]:
    zs = [p.z for p in points]
    ground, top = min(zs), max(zs)
    h = top - ground
    band = h * 0.004

    def z_at(f):
        return ground + h * f

    # Crotch: scanning up from the knees, the first height where the body is one
    # connected piece around x = 0.
    crotch, run = None, 0
    for i in range(300):
        z = z_at(0.30 + i * 0.001)
        near = [p for p in slice_points(points, z, band) if abs(p.x) < h * 0.08]
        if any(abs(p.x) < h * 0.004 for p in near):
            run += 1
            # 옷이 다리 사이를 한두 단면만 이어 붙이는 경우가 있어 연속으로 확인한다.
            if run >= 6:
                crotch = z - h * 0.005
                break
        else:
            run = 0
    crotch = crotch or z_at(0.45)
    # 반바지 밑단이 다리 사이를 이어 붙이면 가랑이가 낮게 잡힌다. 실제 범위로 묶는다.
    crotch = min(max(crotch, z_at(0.40)), z_at(0.45))

    # Neck: narrowest central slice between the shoulders and the ears.  Meshy chibi
    # proportions keep it inside 70-86 % of the height (ears ~87 %, shoulders ~74 %).
    best = None
    for i in range(140):
        z = z_at(0.73 + i * 0.001)
        pts = [p for p in slice_points(points, z, band) if abs(p.x) < h * 0.3]
        centre = [g for g in clusters_x(pts, gap=h * 0.01) if g[0] <= 0 <= g[1]]
        if not centre:
            continue
        width = centre[0][1] - centre[0][0]
        if best is None or width < best[0]:
            best = (width, z)
    neck_z = best[1]
    # 옷깃이 목을 두껍게 만들면 탐색이 아래로 새므로, 이 캐릭터 계열의 실제 범위로 묶는다.
    neck_z = min(max(neck_z, z_at(0.74)), z_at(0.80))
    neck_front_back = [p.y for p in slice_points(points, neck_z, band) if abs(p.x) < best[0] / 2]
    neck_y = (min(neck_front_back) + max(neck_front_back)) / 2

    joints: dict[str, Vector] = {}
    hips_z = crotch + h * 0.045
    hip_slice = [p for p in slice_points(points, hips_z, band * 2) if abs(p.x) < h * 0.12]
    hips_y = (min(p.y for p in hip_slice) + max(p.y for p in hip_slice)) / 2
    joints["Hips"] = Vector((0, hips_y, hips_z))
    joints["Neck"] = Vector((0, neck_y, neck_z - h * 0.012))
    chest_z = hips_z + (neck_z - hips_z) * 0.62
    spine_z = hips_z + (neck_z - hips_z) * 0.28
    for name, z in (("Spine", spine_z), ("Chest", chest_z)):
        sl = [p for p in slice_points(points, z, band * 2) if abs(p.x) < h * 0.05]
        joints[name] = Vector((0, (min(p.y for p in sl) + max(p.y for p in sl)) / 2 + h * 0.01, z))
    joints["Head"] = Vector((0, neck_y, neck_z + h * 0.03))

    for side, sign in (("L", 1.0), ("R", -1.0)):
        # Legs: per-side centroid of slices below the crotch.
        def leg_centre(z):
            sl = [p for p in slice_points(points, z, band * 1.5) if p.x * sign > h * 0.005]
            if not sl:
                return None
            # A자세에서는 손이 엉덩이 높이에 있다. 몸 중심에 가장 가까운 덩어리만 다리로 본다.
            groups = clusters_x(sl, gap=h * 0.02)
            inner = min(groups, key=lambda g: min(abs(g[0]), abs(g[1])))
            return centroid([p for p in sl if inner[0] - 1e-6 <= p.x <= inner[1] + 1e-6])

        thigh = leg_centre(crotch - h * 0.03)
        ankle_z = ground + h * 0.055
        ankle = leg_centre(ankle_z)
        knee_z = ankle_z + (crotch - ankle_z) * 0.47
        knee = leg_centre(knee_z)
        # 허벅지 관절을 안쪽으로 당기면 걷기·달리기에서 무릎이 모인다. 실제 다리 중심을 쓴다.
        joints[f"Thigh.{side}"] = Vector((thigh.x, thigh.y, hips_z - h * 0.02))
        joints[f"Shin.{side}"] = Vector((knee.x, knee.y + h * 0.005, knee_z))
        joints[f"Foot.{side}"] = Vector((ankle.x, ankle.y + h * 0.01, ankle_z))
        toe_pts = [p for p in points if p.x * sign > 0 and p.z < ground + h * 0.03]
        tip = min(toe_pts, key=lambda p: p.y)
        joints[f"Toe.{side}"] = Vector((ankle.x, (tip.y + ankle.y) * 0.5 - h * 0.01, ground + h * 0.015))

        # Arms: points outside the torso, above the hips; axis by principal direction.
        # Armpit: highest slice (below the neck) where the arm is a separate piece.
        armpit_z, torso_half, run = None, None, 0
        for i in range(300):
            # 목·귀 근처에서 오검출되지 않게 목보다 충분히 아래에서 시작한다.
            z = neck_z - h * (0.05 + i * 0.001)
            groups = clusters_x([p for p in slice_points(points, z, band) if p.x * sign >= 0], gap=h * 0.012)
            groups = sorted(groups, key=lambda g: min(abs(g[0]), abs(g[1])))
            torso = max(abs(groups[0][0]), abs(groups[0][1])) if groups else 0
            outer = [g for g in groups[1:] if min(abs(g[0]), abs(g[1])) > h * 0.10]
            if outer and torso > h * 0.055:
                run += 1
                if run >= 3:
                    armpit_z = z + h * 0.002
                    torso_half = torso
                    break
            else:
                run = 0
        armpit_z = armpit_z or neck_z - h * 0.08
        torso_half = torso_half or h * 0.1
        arm = [p for p in points if p.x * sign > torso_half + h * 0.01 and hips_z - h * 0.25 < p.z < neck_z]
        tip = max(arm, key=lambda p: p.x * sign)
        shoulder_z = armpit_z + (neck_z - armpit_z) * 0.6
        shoulder_ring = [p for p in slice_points(points, shoulder_z, band * 2)
                         if torso_half - h * 0.04 < p.x * sign < torso_half + h * 0.01]
        shoulder_y = centroid(shoulder_ring).y if shoulder_ring else neck_y
        shoulder = Vector((sign * (torso_half - h * 0.012), shoulder_y, shoulder_z))
        axis = (tip - shoulder).normalized()
        hand_len = h * 0.075
        wrist = tip - axis * hand_len
        ring = [p for p in arm if abs((p - wrist).dot(axis)) < h * 0.01 and (p - wrist).length < h * 0.06]
        if len(ring) > 20:
            wrist = centroid(ring)
        elbow = shoulder + (wrist - shoulder) * 0.5
        ring = [p for p in arm if abs((p - elbow).dot(axis)) < h * 0.006]
        if ring:
            elbow = centroid(ring) + Vector((0, h * 0.008, 0))
        joints[f"Clavicle.{side}"] = Vector((sign * h * 0.015, shoulder_y, shoulder_z + h * 0.004))
        joints[f"UpperArm.{side}"] = shoulder
        joints[f"Forearm.{side}"] = elbow
        joints[f"Hand.{side}"] = wrist
        joints[f"HandTip.{side}"] = tip
    joints["HeadTop"] = Vector((0, neck_y, top))
    return joints


BONES = [
    ("Root", None, None), ("Hips", "Root", "Spine"), ("Spine", "Hips", "Chest"), ("Chest", "Spine", "Neck"),
    ("Neck", "Chest", "Head"), ("Head", "Neck", "HeadTop"),
    *[(n.format(s=s), p.format(s=s) if p else None, t.format(s=s) if t else None)
      for s in ("L", "R")
      for n, p, t in (("Clavicle.{s}", "Chest", "UpperArm.{s}"), ("UpperArm.{s}", "Clavicle.{s}", "Forearm.{s}"),
                      ("Forearm.{s}", "UpperArm.{s}", "Hand.{s}"), ("Hand.{s}", "Forearm.{s}", "HandTip.{s}"),
                      ("Thigh.{s}", "Hips", "Shin.{s}"), ("Shin.{s}", "Thigh.{s}", "Foot.{s}"),
                      ("Foot.{s}", "Shin.{s}", "Toe.{s}"), ("Toe.{s}", "Foot.{s}", None))],
]


def build_rig(label, joints) -> bpy.types.Object:
    data = bpy.data.armatures.new(f"Skeleton_{label}")
    rig = bpy.data.objects.new(f"Rig_{label}", data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, tail in BONES:
        b = data.edit_bones.new(name)
        if name == "Root":
            b.head, b.tail = Vector((0, 0, 0)), Vector((0, 0, 0.1))
            b.use_deform = False
        else:
            b.head = joints[name]
            if tail:
                b.tail = joints[tail]
            else:
                b.tail = joints[name] + Vector((0, -0.05, 0))
            if (b.tail - b.head).length < 1e-3:
                b.tail = b.head + Vector((0, 0, 0.03))
        if parent:
            b.parent = data.edit_bones[parent]
        b.align_roll(Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def auto_weights(body, rig) -> dict:
    """Automatic weights on a welded, decimated proxy, then transfer to the full mesh."""
    proxy = body.copy()
    proxy.data = body.data.copy()
    proxy.name = f"{body.name}_proxy"
    bpy.context.scene.collection.objects.link(proxy)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(proxy.data)
    bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    mod = proxy.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = min(1.0, 40000 / max(1, len(proxy.data.polygons)))
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    empty = sum(1 for v in proxy.data.vertices if not v.groups)

    for bone in rig.data.bones:
        if bone.use_deform:
            body.vertex_groups.new(name=bone.name)
    transfer = body.modifiers.new("WeightTransfer", "DATA_TRANSFER")
    transfer.object = proxy
    transfer.use_vert_data = True
    transfer.data_types_verts = {"VGROUP_WEIGHTS"}
    transfer.vert_mapping = "POLYINTERP_NEAREST"
    transfer.layers_vgroup_select_src = "ALL"
    transfer.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=transfer.name)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.data.objects.remove(proxy, do_unlink=True)
    arm = body.modifiers.new("Armature", "ARMATURE")
    arm.object = rig
    body.parent = rig
    unweighted = sum(1 for v in body.data.vertices if not v.groups)
    return {"proxy_unweighted": empty, "unweighted": unweighted}


def render_review(label, body, rig, joints, out: Path, height: float):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = 600, 700
    markers = []
    mat = bpy.data.materials.get("JointMarker") or bpy.data.materials.new("JointMarker")
    mat.diffuse_color = (1, 0.1, 0.1, 1)
    for name, co in joints.items():
        bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.008, location=co, segments=12, ring_count=8)
        m = bpy.context.object
        m.data.materials.append(mat)
        m.show_in_front = True
        markers.append(m)
    body.hide_render = False
    cam = bpy.data.objects.get("ReviewCam") or bpy.data.objects.new("ReviewCam", bpy.data.cameras.new("ReviewCam"))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = height * 1.1
    centre = Vector((0, 0, height * 0.5))
    others = [o for o in bpy.data.objects if o.type == "MESH" and o not in markers and o is not body]
    for o in others:
        o.hide_render = True
    # Markers render through a slightly transparent body: draw wire-ish by alpha.
    scene.display.shading.show_xray = True
    scene.display.shading.xray_alpha = 0.55
    for view, angle in (("front", 0), ("side", math.pi / 2)):
        d = Vector((math.sin(angle), -math.cos(angle), 0))
        cam.location = centre + d * 5
        cam.rotation_euler = (math.pi / 2, 0, angle)
        scene.render.filepath = str(out / f"{label}_joints_{view}.png")
        bpy.ops.render.render(write_still=True)
    scene.display.shading.show_xray = False
    for o in others:
        o.hide_render = False
    for m in markers:
        bpy.data.objects.remove(m, do_unlink=True)


def main():
    args = arguments()
    out = args.review_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    report = {}
    for label, path in [(l, p) for l, p in (("Male", args.male), ("Female", args.female)) if p]:
        body = H.import_glb(path, f"Body_{label}")
        # Feet on the ground (z = 0), centred on x/y.
        pts = [v.co for v in body.data.vertices]
        low = min(p.z for p in pts)
        cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
        cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
        body.data.transform(Matrix.Translation((-cx, -cy, -low)))
        # 헤어·의상도 같은 기준으로 옮겨야 하므로 이동량을 남긴다.
        body["meshy_offset"] = (-cx, -cy, -low)
        body.data.update()
        points = [v.co.copy() for v in body.data.vertices]
        height = max(p.z for p in points)
        if args.joints:
            saved = json.loads(args.joints.expanduser().resolve().read_text())
            joints = {k: Vector(v) * height for k, v in saved.items()}
        else:
            joints = find_landmarks(points)
        if args.joints_out:
            path = args.joints_out.expanduser().resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({k: [c / height for c in v] for k, v in joints.items()}, indent=2))
        rig = build_rig(label, joints)
        body["slot"] = "body"
        weights = auto_weights(body, rig)
        report[label] = {"height": round(height, 4), "weights": weights,
                         "joints": {k: [round(c, 4) for c in v] for k, v in joints.items()}}
        render_review(label, body, rig, joints, out, height)
        body.hide_viewport = False
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.expanduser().resolve()))
    (out / "rig_report.json").write_text(json.dumps(report, indent=2))
    for label, r in report.items():
        hgt = r["height"]
        print("FRACTIONS", label, {k: round(v[2] / hgt, 3) for k, v in r["joints"].items() if k.endswith(("L",)) or "." not in k})
    print("MESHY_BASE_RIG_OK", json.dumps({k: v["weights"] for k, v in report.items()}))


if __name__ == "__main__":
    main()
