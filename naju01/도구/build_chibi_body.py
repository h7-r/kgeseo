"""V4 chibi body -> Sidekick-compatible skeleton prototype (step 1: body + motions).

Reads (never writes) the V4 review body (`base_rig.blend`: Body/Face/Underwear on a
22-bone rig in the source pose: arms bent, palms up) and the Sidekick shared rig.
Writes a new blend + one GLB per body type whose skeleton has the Sidekick bone
names, hierarchy and bone axes, so the existing Quaternius retarget (43 motions)
works unchanged.

Steps per body type
1. Swing the arms into the Sidekick T-pose direction with the V4 skin (LBS).
2. Distributed arm twist about the straightened arm axis: 0 deg at the shoulder,
   90 deg at the elbow, 180 deg at the wrist.  Source palms-up/thumb-back becomes
   Sidekick palms-down/thumb-forward with the elbow hinge facing forward.
3. Chibi proportions: larger head, shorter legs, rounder limbs (weight blended).
4. Uniform scale to the requested standing height, feet on the ground.
5. Copy the Sidekick armature, move its joints onto the body, remap V4 weights
   (normalized, 4 influences) and bind.

Usage:
  Blender --background --factory-startup --python build_chibi_body.py -- \
    --v4-blend naju01/캐릭터작업/sunny_stroll_20260915/v4_new_source/base_rig.blend \
    --sidekick-blend ~/Downloads/SIDEKICK_customizer_base.blend \
    --blend-output ~/Downloads/CHIBI_body_prototype.blend \
    --glb-dir public/models \
    --report naju01/캐릭터작업/chibi-body-prototype/build-report.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

V4_TO_SIDEKICK = {
    "Hips": "pelvis",
    "Chest": "spine_03",
    "Neck": "neck_01",
    "Head": "head",
    **{f"{v4}.{s}": f"{sk}_{s.lower()}" for s in ("L", "R") for v4, sk in (
        ("Clavicle", "clavicle"), ("UpperArm", "upperarm"), ("Forearm", "lowerarm"),
        ("Hand", "hand"), ("Thigh", "thigh"), ("Shin", "calf"), ("Foot", "foot"), ("Toe", "ball"),
    )},
}
MAX_INFLUENCES = 4


def arguments() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--v4-blend", type=Path, required=True)
    p.add_argument("--sidekick-blend", type=Path, required=True)
    p.add_argument("--blend-output", type=Path, required=True)
    p.add_argument("--glb-dir", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--height", type=float, default=1.45)
    p.add_argument("--head-scale", type=float, default=1.18)
    p.add_argument("--leg-length", type=float, default=0.86)
    p.add_argument("--arm-thickness", type=float, default=1.12)
    p.add_argument("--leg-thickness", type=float, default=1.08)
    p.add_argument("--torso-width", type=float, default=1.0)
    p.add_argument("--neck-thickness", type=float, default=1.0)
    # V4 source hands are palms-up (180); Meshy A-pose hands face the thighs (0).
    p.add_argument("--arm-twist-deg", type=float, default=180.0)
    p.add_argument("--glb-prefix", default="chibi")
    # A-pose sources stand with the legs apart; the motions expect the Sidekick
    # rest stance, so the legs are straightened the same way the arms are.
    p.add_argument("--straighten-legs", action="store_true")
    p.add_argument("--labels", nargs="+", default=["Male", "Female"])
    # 면 줄이기는 모프를 만들기 전에 해야 한다(모프가 있으면 적용 불가).
    p.add_argument("--face-budget", type=int, default=0, help="0 = 줄이지 않음")
    p.add_argument("--hair-budget", type=int, default=30000)
    # 옷마다 다른 Meshy 모델이라 체형·자세가 조금씩 다르다. 기준 골격 하나를 뽑아
    # (--canonical-out) 나머지 착장을 그 골격에 맞춰 변형한다(--canonical).
    p.add_argument("--canonical-out", type=Path, default=None)
    p.add_argument("--canonical", type=Path, default=None)
    return p.parse_args(raw)


def smoothstep(a: float, b: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - a) / (b - a))) if a != b else float(x >= a)
    return t * t * (3 - 2 * t)


# ─────────────────────────────── Sidekick reference ─────────────────────────

def append_sidekick_rig(path: Path) -> bpy.types.Object:
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        dst.objects = ["SidekickCustomizerRig"]
    rig = dst.objects[0]
    bpy.context.scene.collection.objects.link(rig)
    return rig


def sidekick_joint(rig: bpy.types.Object, name: str) -> Vector:
    return rig.matrix_world @ rig.data.bones[name].head_local


# ─────────────────────────────── V4 body posing ─────────────────────────────

def world_head(rig, name) -> Vector:
    return rig.matrix_world @ rig.pose.bones[name].head


def swing_bone(rig, name: str, child: str | None, target: Vector) -> None:
    """Rotate a pose bone about its head so head->child(head) points along target."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[name]
    head = pb.head.copy()
    end = rig.pose.bones[child].head.copy() if child else pb.tail.copy()
    current = (end - head).normalized()
    rotation = current.rotation_difference(target.normalized()).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(head) @ rotation @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def apply_rig_pose(rig, meshes) -> None:
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            if mod.type == "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=mod.name)
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)


def vertex_weights(obj) -> list[dict[str, float]]:
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-6} for v in obj.data.vertices]


def rotate_about_axis(point: Vector, origin: Vector, axis: Vector, angle: float) -> Vector:
    return origin + Quaternion(axis, angle) @ (point - origin)


def twist_arms(meshes, weights, joints, twist_deg: float = 180.0) -> None:
    for side, sign in (("L", 1.0), ("R", -1.0)):
        shoulder, elbow, wrist = joints[f"UpperArm.{side}"], joints[f"Forearm.{side}"], joints[f"Hand.{side}"]
        axis = (wrist - shoulder).normalized()
        if axis.x < 0:
            axis = -axis
        upper_len = (elbow - shoulder).length
        fore_len = (wrist - elbow).length
        for obj in meshes:
            for v, w in zip(obj.data.vertices, weights[obj.name]):
                arm = sum(w.get(f"{b}.{side}", 0.0) for b in ("UpperArm", "Forearm", "Hand"))
                if arm <= 0 or v.co.x * sign <= 0:
                    continue
                along = (v.co - shoulder).dot(axis) * sign
                if along <= upper_len:
                    t = 0.5 * max(0.0, along) / upper_len
                else:
                    t = 0.5 + 0.5 * min(1.0, (along - upper_len) / fore_len)
                angle = math.radians(twist_deg) * t * arm
                v.co = rotate_about_axis(v.co, shoulder, axis, angle)


def apply_proportions(meshes, weights, joints, args) -> None:
    head_origin = joints["Head"]
    hip_z = (joints["Thigh.L"].z + joints["Thigh.R"].z) / 2
    ankle_z = (joints["Foot.L"].z + joints["Foot.R"].z) / 2
    k = args.leg_length

    def leg_z(z: float) -> float:
        if z >= hip_z:
            return z
        if z >= ankle_z:
            return hip_z - (hip_z - z) * k
        # 발목 아래(발)는 모양을 그대로 두고 발목이 올라간 만큼만 함께 올린다.
        return z + (hip_z - ankle_z) * (1 - k)

    def radial(point: Vector, a: Vector, b: Vector, scale: float, amount: float) -> Vector:
        d = (b - a).normalized()
        base = a + d * (point - a).dot(d)
        return base + (point - base) * (1 + (scale - 1) * amount)

    for obj in meshes:
        rigid_head = obj.name.startswith("Face_")
        for v, w in zip(obj.data.vertices, weights[obj.name]):
            p = v.co.copy()
            head_w = 1.0 if rigid_head else w.get("Head", 0.0) + 0.5 * w.get("Neck", 0.0)
            if head_w > 0:
                p = head_origin + (p - head_origin) * (1 + (args.head_scale - 1) * min(1.0, head_w))
            for side, sign in (("L", 1.0), ("R", -1.0)):
                arm = w.get(f"UpperArm.{side}", 0.0) + w.get(f"Forearm.{side}", 0.0)
                if arm > 0 and p.x * sign > 0:
                    p = radial(p, joints[f"UpperArm.{side}"], joints[f"Hand.{side}"], args.arm_thickness, min(1.0, arm))
                leg = w.get(f"Thigh.{side}", 0.0) + w.get(f"Shin.{side}", 0.0)
                if leg > 0 and p.x * sign > 0:
                    p = radial(p, joints[f"Thigh.{side}"], joints[f"Foot.{side}"], args.leg_thickness, min(1.0, leg))
            # 몸통·목은 척추 축에서 좌우·앞뒤로 둥글게 부풀린다(머리는 제외).
            torso = sum(w.get(b, 0.0) for b in ("Hips", "Spine", "Chest"))
            neck = w.get("Neck", 0.0) * (0.0 if rigid_head else 1.0)
            core = torso * (args.torso_width - 1) + neck * (args.neck_thickness - 1)
            if core != 0 and not rigid_head:
                axis_y = joints["Spine"].y
                p = Vector((p.x * (1 + core), axis_y + (p.y - axis_y) * (1 + core * 0.7), p.z))
            leg_all = sum(w.get(f"{b}.{s}", 0.0) for b in ("Thigh", "Shin", "Foot", "Toe") for s in ("L", "R"))
            if leg_all > 0:
                p.z = p.z + (leg_z(p.z) - p.z) * min(1.0, leg_all)
            v.co = p
    for name, joint in joints.items():
        if name == "Head":
            continue
        joints[name] = Vector((joint.x, joint.y, leg_z(joint.z)))


def fit_height(meshes, joints, height: float) -> float:
    body = next(o for o in meshes if o.name.startswith("Body_"))
    zs = [v.co.z for v in body.data.vertices]
    low, high = min(zs), max(zs)
    scale = height / (high - low)
    for obj in meshes:
        for v in obj.data.vertices:
            v.co = Vector((v.co.x * scale, v.co.y * scale, (v.co.z - low) * scale))
    for name, j in joints.items():
        joints[name] = Vector((j.x * scale, j.y * scale, (j.z - low) * scale))
    return scale


# ─────────────────────────────── Sidekick rig fitting ───────────────────────

def bone_children(rig) -> dict[str, list[str]]:
    return {b.name: [c.name for c in b.children] for b in rig.pose.bones}


def normalise_to_canonical(meshes, weights, joints, canonical, children) -> dict:
    """Deform the body so its joints land on the canonical skeleton.

    Each look is its own Meshy generation, so arm/leg lengths, hip height and the
    forward lean differ by a few percent — enough that swapping one garment visibly
    changes the body.  Per bone we build the similarity (rotation + uniform scale +
    translation) that carries the measured bone onto the canonical one and blend
    them by skin weight, so the shape stays continuous across joints.
    """
    shared = [n for n in joints if n in canonical]
    maps: dict[str, tuple[Matrix, Vector, Vector]] = {}
    for name in shared:
        kids = [c for c in children.get(name, []) if c in canonical]
        measured_dir = canonical_dir = None
        if kids:
            measured_dir = sum((joints[c] - joints[name] for c in kids), Vector()) / len(kids)
            canonical_dir = sum((canonical[c] - canonical[name] for c in kids), Vector()) / len(kids)
        if measured_dir is None or measured_dir.length < 1e-5 or canonical_dir.length < 1e-5:
            maps[name] = (Matrix.Identity(3), joints[name], canonical[name])
            continue
        rotation = measured_dir.normalized().rotation_difference(canonical_dir.normalized()).to_matrix()
        maps[name] = (rotation * (canonical_dir.length / measured_dir.length), joints[name], canonical[name])
    # 끝 뼈(머리·손·발끝)는 자기 방향이 없어 부모의 배율을 그대로 쓴다.
    for name, kids in children.items():
        for child in kids:
            if child in maps and not [c for c in children.get(child, []) if c in canonical] and name in maps:
                maps[child] = (maps[name][0], joints[child], canonical[child])

    moved = 0.0
    for obj in meshes:
        for vertex, w in zip(obj.data.vertices, weights[obj.name]):
            blend = {b: v for b, v in w.items() if b in maps and v > 0}
            total = sum(blend.values())
            if total <= 0:
                continue
            p = vertex.co
            out = Vector()
            for bone, weight in blend.items():
                matrix, source, target = maps[bone]
                out += (target + matrix @ (p - source)) * (weight / total)
            moved += (out - p).length
            vertex.co = out
    for name in shared:
        joints[name] = canonical[name].copy()
    return {"bones": len(maps), "mean_shift": round(moved / max(1, sum(len(o.data.vertices) for o in meshes)), 5)}


def fit_sidekick_rig(template: bpy.types.Object, joints: dict[str, Vector], label: str) -> bpy.types.Object:
    rig = template.copy()
    rig.data = template.data.copy()
    rig.name = f"ChibiRig_{label}"
    rig.data.name = f"ChibiRig_{label}"
    bpy.context.scene.collection.objects.link(rig)

    targets: dict[str, Vector] = {sk: joints[v4] for v4, sk in V4_TO_SIDEKICK.items()}
    # Distribute the spine joints along the V4 pelvis->neck polyline at the
    # same relative heights the Sidekick spine uses.
    sk = {n: sidekick_joint(template, n) for n in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01")}
    v4_chain = [joints["Hips"], joints["Spine"], joints["Chest"], joints["Neck"]]
    lengths = [(b - a).length for a, b in zip(v4_chain, v4_chain[1:])]
    total = sum(lengths)
    sk_total = sk["neck_01"].z - sk["pelvis"].z
    for name in ("spine_01", "spine_02", "spine_03"):
        distance = (sk[name].z - sk["pelvis"].z) / sk_total * total
        for (a, b), seg in zip(zip(v4_chain, v4_chain[1:]), lengths):
            if distance <= seg:
                targets[name] = a.lerp(b, distance / seg)
                break
            distance -= seg

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    bones = rig.data.edit_bones
    original = {b.name: (b.head.copy(), b.tail.copy(), b.matrix.copy()) for b in bones}
    body_scale = (joints["Head"].z - joints["Hips"].z) / (sk["neck_01"].z - sk["pelvis"].z + 0.1)

    def place(bone) -> None:
        head, tail, _matrix = original[bone.name]
        vector = tail - head
        if bone.name in targets:
            new_head = targets[bone.name]
        elif bone.parent is not None:
            parent_head = original[bone.parent.name][0]
            new_head = bone.parent.head + (head - parent_head) * body_scale
        else:
            new_head = head * body_scale
        roll = bone.roll
        bone.head = new_head
        bone.tail = new_head + vector * body_scale
        bone.roll = roll
        for child in bone.children:
            place(child)

    for bone in [b for b in bones if b.parent is None]:
        place(bone)
    # Twist bones sit between their segment joints like the Sidekick rig.
    for side in ("l", "r"):
        for twist, a, b in (("upperarm_twist_01", "upperarm", "lowerarm"), ("lowerarm_twist_01", "lowerarm", "hand"),
                            ("thigh_twist_01", "thigh", "calf"), ("calf_twist_01", "calf", "foot")):
            tb = bones[f"{twist}_{side}"]
            head_a, head_b = bones[f"{a}_{side}"].head, bones[f"{b}_{side}"].head
            src = original[tb.name][0]
            sa, sb = original[f"{a}_{side}"][0], original[f"{b}_{side}"][0]
            frac = (src - sa).dot(sb - sa) / max(1e-9, (sb - sa).length_squared)
            vector = original[tb.name][1] - src
            roll = tb.roll
            tb.head = head_a.lerp(head_b, frac)
            tb.tail = tb.head + vector * body_scale
            tb.roll = roll
        for ik, ref in ((f"ik_hand_{side}", f"hand_{side}"), (f"ik_foot_{side}", f"foot_{side}")):
            ib = bones[ik]
            vector = original[ik][1] - original[ik][0]
            ib.head = bones[ref].head.copy()
            ib.tail = ib.head + vector
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def remap_weights(obj, weights, rig, joints_sk) -> dict:
    spine_low = joints_sk["spine_01"].z
    spine_high = joints_sk["spine_03"].z
    new: list[dict[str, float]] = []
    for v, w in zip(obj.data.vertices, weights):
        out: dict[str, float] = {}
        for bone, weight in w.items():
            if bone == "Spine":
                f = smoothstep(spine_low, spine_high, v.co.z)
                out["spine_01"] = out.get("spine_01", 0.0) + weight * (1 - f)
                out["spine_02"] = out.get("spine_02", 0.0) + weight * f
            elif bone in V4_TO_SIDEKICK:
                target = V4_TO_SIDEKICK[bone]
                out[target] = out.get(target, 0.0) + weight
        ranked = sorted(((x, b) for b, x in out.items() if x > 1e-4), reverse=True)[:MAX_INFLUENCES]
        total = sum(x for x, _ in ranked) or 1.0
        new.append({b: x / total for x, b in ranked} if ranked else {"head" if obj.name.startswith("Face_") else "pelvis": 1.0})
    obj.vertex_groups.clear()
    groups = {}
    for i, w in enumerate(new):
        for bone, weight in w.items():
            if bone not in rig.data.bones:
                raise RuntimeError(f"{obj.name}: unknown bone {bone}")
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], weight, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    obj.parent = rig
    return {"vertices": len(new), "max_influences": max(len(w) for w in new), "bones": sorted(groups)}


# ─────────────────────────────── body sliders ───────────────────────────────

BODY_MORPHS = ("heavy", "skinny", "buff", "shoulderWidth", "hipWidth", "lumbar", "armThickness", "legThickness",
               "handScale", "footScale", "fistHands")


def morph_delta(p: Vector, w: dict[str, float], joints: dict[str, Vector], key: str) -> Vector:
    """World-space delta of one slider at a rest point with its Sidekick weights.

    Every mesh (body, clothes, hair) uses the same field, so parts stay together.
    """
    def chain(*names) -> float:
        return min(1.0, sum(w.get(n, 0.0) for n in names))

    torso = chain("pelvis", "spine_01", "spine_02", "spine_03")
    belly = chain("spine_01", "spine_02") + 0.5 * w.get("pelvis", 0.0)
    chest = chain("spine_03") + 0.5 * chain("clavicle_l", "clavicle_r")
    axis_y = joints["spine_02"].y
    delta = Vector()

    def radial(a: Vector, b: Vector, amount: float, weight: float) -> Vector:
        d = (b - a).normalized()
        base = a + d * (p - a).dot(d)
        return (p - base) * amount * weight

    def limbs(amount_arm: float, amount_leg: float) -> Vector:
        out = Vector()
        for s in "lr":
            arm = chain(f"upperarm_{s}", f"lowerarm_{s}", f"upperarm_twist_01_{s}", f"lowerarm_twist_01_{s}")
            if arm > 0:
                out += radial(joints[f"upperarm_{s}"], joints[f"hand_{s}"], amount_arm, arm)
            leg = chain(f"thigh_{s}", f"calf_{s}", f"thigh_twist_01_{s}", f"calf_twist_01_{s}")
            if leg > 0:
                out += radial(joints[f"thigh_{s}"], joints[f"foot_{s}"], amount_leg, leg)
        return out

    if key == "heavy":
        delta += Vector((p.x * 0.38 * torso, (p.y - axis_y) * (0.28 * torso + 0.42 * belly * float(p.y < axis_y)), 0))
        delta += limbs(0.34, 0.36)
    elif key == "skinny":
        delta += Vector((p.x * -0.22 * torso, (p.y - axis_y) * -0.2 * torso, 0))
        delta += limbs(-0.26, -0.24)
    elif key == "buff":
        delta += Vector((p.x * 0.24 * chest, (p.y - axis_y) * 0.2 * chest, 0))
        delta += limbs(0.4, 0.2)
    elif key == "shoulderWidth":
        for s, sign in (("l", 1.0), ("r", -1.0)):
            arm = chain(f"upperarm_{s}", f"lowerarm_{s}", f"hand_{s}", f"upperarm_twist_01_{s}", f"lowerarm_twist_01_{s}")
            clav = w.get(f"clavicle_{s}", 0.0)
            shift = 0.055 * (arm + 0.6 * clav)
            if shift > 0:
                delta += Vector((sign * shift, 0, 0))
    elif key == "hipWidth":
        # 허리에서 무릎까지만 좁히거나 넓힌다 — 위아래로 부드럽게 0 이 되어 다리가 꺾이지 않는다.
        hips_z = joints["pelvis"].z
        waist_z = joints["spine_02"].z
        knee_z = (joints["calf_l"].z + joints["calf_r"].z) / 2
        f = smoothstep(knee_z, hips_z, p.z) if p.z <= hips_z else smoothstep(waist_z, hips_z, p.z)
        if f > 0:
            delta += Vector((p.x * 0.3 * f, (p.y - axis_y) * 0.2 * f, 0))
    elif key == "lumbar":
        # 엉덩이~허리의 S 굴곡. 뼈를 돌려서는 안 된다 — 마디가 통째로 돌 뿐
        # 표면이 오목해지지 않는다. 등 쪽 면만 앞뒤로 밀어 굴곡을 만든다.
        hips_z = joints["pelvis"].z
        waist_z = joints["spine_02"].z
        span = max(1e-4, waist_z - hips_z)
        깊이 = p.y - axis_y  # 앞이 -y, 등이 +y
        if 깊이 > 0:
            def 종 (중심, 폭):
                return max(0.0, 1.0 - abs(p.z - 중심) / (span * 폭))

            허리 = 종(hips_z + span * 0.5, 1.0)  # 안으로 들어가는 곳
            엉덩이 = 종(hips_z - span * 0.4, 1.0)  # 뒤로 나오는 곳
            옆 = smoothstep(span * 1.2, span * 0.5, abs(p.x))  # 옆구리로 갈수록 0
            # 슬라이더 0~1 로 쓰므로 1 에서 확실히 보이게 잡는다(기본값은 런타임에서 정한다).
            delta += Vector((0, 깊이 * (엉덩이 * 0.9 - 허리 * 0.85) * 옆, 0))
    elif key == "armThickness":
        delta += limbs(0.3, 0.0)
    elif key == "legThickness":
        delta += limbs(0.0, 0.3)
    elif key in ("handScale", "footScale"):
        chain_names = ("hand", "wrist") if key == "handScale" else ("foot", "ball")
        for s in "lr":
            joint = joints["hand_" + s] if key == "handScale" else joints["foot_" + s]
            weight = chain(*[f"{n}_{s}" for n in chain_names if f"{n}_{s}" in joints or True])
            weight = min(1.0, sum(w.get(b, 0.0) for b in w if b.startswith(chain_names[0]) and b.endswith(f"_{s}")))
            if weight > 0:
                delta += (p - joint) * 0.35 * weight
    elif key == "fistHands":
        # 손가락만 손등 쪽 관절선에서 감아 가볍게 주먹을 쥔다(T포즈: 팔은 +-x, 손바닥은 아래).
        for s, sign in (("l", 1.0), ("r", -1.0)):
            hand = min(1.0, sum(x for b, x in w.items() if b.startswith(("hand", "index", "middle", "ring", "pinky", "thumb")) and b.endswith(f"_{s}")))
            if hand <= 0:
                continue
            wrist = joints[f"hand_{s}"]
            tip = joints.get(f"handtip_{s}", wrist + Vector((sign * 0.1, 0, 0)))
            reach = max(0.02, abs(tip.x - wrist.x))
            along = (p.x - wrist.x) * sign
            # 손가락 밑마디에서 손끝까지만 감는다.
            knuckle = reach * 0.32
            length = reach * 0.68
            if along <= knuckle:
                continue
            t = min(1.0, (along - knuckle) / length)
            angle = math.radians(105.0) * t * hand
            pivot = Vector((wrist.x + sign * knuckle, p.y, wrist.z))
            offset = p - pivot
            c, sn = math.cos(angle), math.sin(angle)
            rotated = Vector((offset.x * c + offset.z * sn * sign, offset.y, -offset.x * sn * sign + offset.z * c))
            delta += pivot + rotated - p
    return delta


def add_body_morphs(obj, joints: dict[str, Vector]) -> list[str]:
    names = {g.index: g.name for g in obj.vertex_groups}
    joints = dict(joints)
    # 손끝: 손 가중치를 가진 정점 중 가장 바깥. 손 크기가 모델마다 달라 직접 잰다.
    for s, sign in (("l", 1.0), ("r", -1.0)):
        tips = [v.co for v in obj.data.vertices
                if any(names[g.group].startswith(("hand", "index", "middle", "ring", "pinky"))
                       and names[g.group].endswith(f"_{s}") and g.weight > 0.5 for g in v.groups)]
        if tips:
            joints[f"handtip_{s}"] = max(tips, key=lambda p: p.x * sign)
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    added = []
    for key in BODY_MORPHS:
        block = obj.shape_key_add(name=key, from_mix=False)
        # 새 키는 값 1로 만들어져 GLB 기본 상태에 그대로 반영된다. 0으로 되돌린다.
        block.value = 0.0
        if key == "shoulderWidth":
            block.slider_min = -1.0
        for v in obj.data.vertices:
            weights = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-5}
            block.data[v.index].co = v.co + morph_delta(v.co, weights, joints, key)
        added.append(key)
    return added


def main() -> None:
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=str(args.v4_blend.expanduser().resolve()))
    template = append_sidekick_rig(args.sidekick_blend.expanduser().resolve())
    sk_dirs = {
        side: {
            "UpperArm": sidekick_joint(template, f"lowerarm_{s}") - sidekick_joint(template, f"upperarm_{s}"),
            "Forearm": sidekick_joint(template, f"hand_{s}") - sidekick_joint(template, f"lowerarm_{s}"),
            "Hand": sidekick_joint(template, f"middle_01_{s}") - sidekick_joint(template, f"hand_{s}"),
            "Thigh": sidekick_joint(template, f"calf_{s}") - sidekick_joint(template, f"thigh_{s}"),
            "Shin": sidekick_joint(template, f"foot_{s}") - sidekick_joint(template, f"calf_{s}"),
        }
        for side, s in (("L", "l"), ("R", "r"))
    }
    report: dict = {"params": {k: v for k, v in vars(args).items() if isinstance(v, (int, float))}, "variants": {}}
    export_sets = {}
    for label in args.labels:
        rig = bpy.data.objects[f"Rig_{label}"]
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="POSE")
        for side in ("L", "R"):
            swing_bone(rig, f"UpperArm.{side}", f"Forearm.{side}", sk_dirs[side]["UpperArm"])
            swing_bone(rig, f"Forearm.{side}", f"Hand.{side}", sk_dirs[side]["Forearm"])
            swing_bone(rig, f"Hand.{side}", None, sk_dirs[side]["Hand"])
            if args.straighten_legs:
                swing_bone(rig, f"Thigh.{side}", f"Shin.{side}", sk_dirs[side]["Thigh"])
                swing_bone(rig, f"Shin.{side}", f"Foot.{side}", sk_dirs[side]["Shin"])
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.update()
        joints = {b.name: world_head(rig, b.name) for b in rig.pose.bones}
        weights = {o.name: vertex_weights(o) for o in meshes}
        apply_rig_pose(rig, meshes)
        if args.face_budget:
            for obj in meshes:
                budget = args.hair_budget if str(obj.get("slot", "")) == "hair" else args.face_budget
                faces = len(obj.data.polygons)
                if faces <= budget:
                    continue
                bpy.ops.object.select_all(action="DESELECT")
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                mod = obj.modifiers.new("Decimate", "DECIMATE")
                mod.ratio = budget / faces
                mod.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=mod.name)
            weights = {o.name: vertex_weights(o) for o in meshes}
        twist_arms(meshes, weights, joints, args.arm_twist_deg)
        apply_proportions(meshes, weights, joints, args)
        scale = fit_height(meshes, joints, args.height)
        if args.canonical_out:
            path = args.canonical_out.expanduser().resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({k: list(v) for k, v in joints.items()}, indent=2))
        if args.canonical:
            saved = json.loads(args.canonical.expanduser().resolve().read_text())
            report.setdefault("canonical", {})[label] = normalise_to_canonical(
                meshes, weights, joints, {k: Vector(v) for k, v in saved.items()}, bone_children(rig))
        new_rig = fit_sidekick_rig(template, joints, label)
        joints_sk = {b.name: new_rig.matrix_world @ b.head_local for b in new_rig.data.bones}
        stats = {o.name: remap_weights(o, weights[o.name], new_rig, joints_sk) for o in meshes}
        for o in meshes:
            add_body_morphs(o, joints_sk)
        bpy.data.objects.remove(rig, do_unlink=True)
        for obj in meshes:
            obj["chibi_part"] = obj.name.split("_")[0].lower()
            obj["chibi_body"] = label.lower()
        report["variants"][label] = {"scale": round(scale, 5), "parts": stats, "height": args.height}
        export_sets[label] = (new_rig, meshes)

    bpy.data.objects.remove(template, do_unlink=True)
    for path in (args.blend_output, args.report):
        path.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
    args.glb_dir.expanduser().resolve().mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.expanduser().resolve()))
    for label, (rig, meshes) in export_sets.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in (rig, *meshes):
            # 원본 검토 파일에서 한쪽 체형이 숨김 상태라 선택 내보내기에서 빠졌다.
            obj.hide_viewport = False
            obj.hide_set(False)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        out = args.glb_dir.expanduser().resolve() / f"{args.glb_prefix}-{label.lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(out), export_format="GLB", use_selection=True, export_animations=False,
            export_skins=True, export_influence_nb=MAX_INFLUENCES, export_morph=True,
            export_morph_normal=False, export_apply=False, export_extras=True,
        )
        report["variants"][label]["glb"] = str(out)
    args.report.expanduser().resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("CHIBI_BODY_OK", json.dumps({k: v["scale"] for k, v in report["variants"].items()}))


if __name__ == "__main__":
    main()
