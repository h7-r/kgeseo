"""Meshy 기본 캐릭터에 임시 22본 리그를 씌운다(메시·텍스처는 건드리지 않는다).

관절 자리는 메시의 수평 단면(가랑이 틈·목 잘록함·팔 축·다리 중심선)에서 찾고, 골격을 겹쳐
그려 검수한다. 웨이트는 용접·축소한 대리 메시에서 자동 웨이트를 구해 원래 메시로 옮긴다.
이름(Rig_<Label>, Body_<Label>)은 build_chibi_body.py 가 이어받는 규약이다.

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
    parser = argparse.ArgumentParser()
    parser.add_argument("--male", type=Path)
    parser.add_argument("--female", type=Path)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--review-dir", type=Path, required=True)
    # 옷 입은 모델은 소매·밑단 때문에 관절이 잘못 잡힌다. 기본 착장에서 잡은 관절을 키로 나눠
    # 저장해 두고(--joints-out) 같은 캐릭터의 다른 착장에 그대로 쓴다(--joints).
    parser.add_argument("--joints-out", type=Path, default=None)
    parser.add_argument("--joints", type=Path, default=None)
    return parser.parse_args(raw)


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


def find_knee(leg_centre, ankle_z, crotch, h):
    """종아리 알(가장 굵은 단면) 위쪽에서 가장 가는 단면의 높이. 못 찾으면 None."""
    def width(z):
        # leg_centre 가 쓰는 것과 같은 다리 덩어리의 폭(x·y 범위의 합)
        sl = leg_centre.slice(z)
        if not sl:
            return None
        return (max(p.x for p in sl) - min(p.x for p in sl)) + (max(p.y for p in sl) - min(p.y for p in sl))
    span = crotch - ankle_z
    samples = []
    for i in range(0, 80):
        f = 0.25 + i * 0.006  # 다리 길이의 25~72%
        w = width(ankle_z + span * f)
        if w is not None:
            samples.append((f, w))
    if len(samples) < 10:
        return None
    lower = [s for s in samples if s[0] <= 0.5]
    if not lower:
        return None
    calf_f = max(lower, key=lambda s: s[1])[0]
    upper = [s for s in samples if calf_f + 0.03 <= s[0] <= 0.68]
    if not upper:
        return None
    knee_f = min(upper, key=lambda s: s[1])[0]
    # 잘록한 곳이 종아리 알에 너무 붙어 있거나 허벅지까지 올라가면 검출 실패로 본다.
    if not 0.44 <= knee_f <= 0.64:
        return None
    print("KNEE_FRACTION", round(knee_f, 3), "calf", round(calf_f, 3))
    return ankle_z + span * knee_f


def find_landmarks(points) -> dict[str, Vector]:
    zs = [p.z for p in points]
    ground, top = min(zs), max(zs)
    h = top - ground
    band = h * 0.004

    def z_at(f):
        return ground + h * f

    # 가랑이: 무릎에서 위로 훑어 x = 0 둘레가 처음 한 덩어리로 이어지는 높이.
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

    # 목: 어깨와 귀 사이에서 가장 가는 가운데 단면(Meshy 치비 비율에서 키의 70~86%).
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
        # 다리: 가랑이 아래 단면의 좌우별 무게중심.
        def leg_slice(z):
            sl = [p for p in slice_points(points, z, band * 1.5) if p.x * sign > h * 0.005]
            if not sl:
                return []
            # A자세에서는 손이 엉덩이 높이에 있다. 몸 중심에 가장 가까운 덩어리만 다리로 본다.
            groups = clusters_x(sl, gap=h * 0.02)
            inner = min(groups, key=lambda g: min(abs(g[0]), abs(g[1])))
            return [p for p in sl if inner[0] - 1e-6 <= p.x <= inner[1] + 1e-6]

        def leg_centre(z):
            sl = leg_slice(z)
            return centroid(sl) if sl else None

        leg_centre.slice = leg_slice

        thigh = leg_centre(crotch - h * 0.03)
        ankle_z = ground + h * 0.055
        ankle = leg_centre(ankle_z)
        # 무릎은 비율로 찍으면 종아리 알에 관절이 놓여 엉뚱한 데서 접힌다. 살의 잘록한 곳을 찾고,
        # 못 찾을 때만 비율(0.47)을 쓴다.
        knee_z = find_knee(leg_centre, ankle_z, crotch, h) or ankle_z + (crotch - ankle_z) * 0.47
        knee = leg_centre(knee_z)
        # 허벅지 관절을 안쪽으로 당기면 걷기·달리기에서 무릎이 모인다. 실제 다리 중심을 쓴다.
        joints[f"Thigh.{side}"] = Vector((thigh.x, thigh.y, hips_z - h * 0.02))
        joints[f"Shin.{side}"] = Vector((knee.x, knee.y + h * 0.005, knee_z))
        joints[f"Foot.{side}"] = Vector((ankle.x, ankle.y + h * 0.01, ankle_z))
        toe_pts = [p for p in points if p.x * sign > 0 and p.z < ground + h * 0.03]
        tip = min(toe_pts, key=lambda p: p.y)
        joints[f"Toe.{side}"] = Vector((ankle.x, (tip.y + ankle.y) * 0.5 - h * 0.01, ground + h * 0.015))

        # 팔: 몸통 바깥·엉덩이 위의 점. 겨드랑이는 팔이 따로 떨어지는 가장 높은 단면(목 아래).
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
        bone = data.edit_bones.new(name)
        if name == "Root":
            bone.head, bone.tail = Vector((0, 0, 0)), Vector((0, 0, 0.1))
            bone.use_deform = False
        else:
            bone.head = joints[name]
            if tail:
                bone.tail = joints[tail]
            else:
                bone.tail = joints[name] + Vector((0, -0.05, 0))
            if (bone.tail - bone.head).length < 1e-3:
                bone.tail = bone.head + Vector((0, 0, 0.03))
        if parent:
            bone.parent = data.edit_bones[parent]
        bone.align_roll(Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def auto_weights(body, rig) -> dict:
    """용접·축소한 대리 메시에서 자동 웨이트를 구해 원래 메시로 옮긴다."""
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
        marker = bpy.context.object
        marker.data.materials.append(mat)
        marker.show_in_front = True
        markers.append(marker)
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
    # 몸을 반투명하게 해 관절 표시가 비쳐 보이게 한다.
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
    for marker in markers:
        bpy.data.objects.remove(marker, do_unlink=True)


def main():
    args = arguments()
    out = args.review_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    report = {}
    for label, path in [(l, p) for l, p in (("Male", args.male), ("Female", args.female)) if p]:
        body = H.import_glb(path, f"Body_{label}")
        # 발을 바닥(z = 0)에, x·y 는 가운데로.
        pts = [v.co for v in body.data.vertices]
        low = min(p.z for p in pts)
        cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
        cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
        body.data.transform(Matrix.Translation((-cx, -cy, -low)))
        # 머리카락·옷도 같은 기준으로 옮겨야 하므로 이동량을 남긴다.
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
    for label, entry in report.items():
        body_height = entry["height"]
        print("FRACTIONS", label, {k: round(v[2] / body_height, 3) for k, v in entry["joints"].items() if k.endswith(("L",)) or "." not in k})
    print("MESHY_BASE_RIG_OK", json.dumps({k: v["weights"] for k, v in report.items()}))


if __name__ == "__main__":
    main()
