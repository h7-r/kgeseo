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
    p.add_argument("--eye-scale", type=float, default=1.0)
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


def transfer_garment_weights(meshes) -> dict:
    """Garments take the skin weights of the nearest body surface (inverse-distance, 4 nearest).

    V4 garments were authored in the bent-arm source pose with partly torso-bound
    sleeves; straightening the arms left sleeves behind.  Matching the skin makes
    every garment follow the body exactly through the pose change and all motions.
    """
    from mathutils.kdtree import KDTree

    body = next(o for o in meshes if o.name.startswith("Body_"))
    positions = [body.matrix_world @ v.co for v in body.data.vertices]
    names = {g.index: g.name for g in body.vertex_groups}
    body_weights = [{names[g.group]: g.weight for g in v.groups} for v in body.data.vertices]
    tree = KDTree(len(positions))
    for i, p in enumerate(positions):
        tree.insert(p, i)
    tree.balance()
    stats = {}
    for obj in meshes:
        if slot_of(obj) not in ("top", "bottom", "shoes", "underwear", "underweartop"):
            continue
        new = []
        for v in obj.data.vertices:
            found = tree.find_n(obj.matrix_world @ v.co, 4)
            total: dict[str, float] = {}
            norm = 0.0
            for _co, index, dist in found:
                share = 1.0 / max(dist, 1e-4)
                norm += share
                for bone, w in body_weights[index].items():
                    total[bone] = total.get(bone, 0.0) + w * share
            ranked = sorted(((w / norm, b) for b, w in total.items()), reverse=True)[:MAX_INFLUENCES]
            scale = sum(w for w, _ in ranked) or 1.0
            new.append({b: w / scale for w, b in ranked})
        obj.vertex_groups.clear()
        groups = {}
        for i, weights in enumerate(new):
            for bone, w in weights.items():
                if bone not in groups:
                    groups[bone] = obj.vertex_groups.new(name=bone)
                groups[bone].add([i], w, "REPLACE")
        stats[obj.name] = len(new)
    return stats


def reset_rig_pose(rig) -> None:
    """V4 review files carry an active action; start from the bind pose."""
    if rig.animation_data:
        rig.animation_data_clear()
    rig.data.pose_position = "POSE"
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def apply_rig_pose(rig, meshes) -> None:
    """Bake armature pose + current shape-key mix into plain mesh data (keeps weights)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        baked = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        world = obj.matrix_world.copy()
        old = obj.data
        obj.modifiers.clear()
        obj.parent = None
        obj.data = baked
        baked.name = old.name
        if old.users == 0:
            bpy.data.meshes.remove(old)
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
        if obj.data.shape_keys:
            obj.shape_key_clear()


def vertex_weights(obj) -> list[dict[str, float]]:
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-6} for v in obj.data.vertices]


def rotate_about_axis(point: Vector, origin: Vector, axis: Vector, angle: float) -> Vector:
    return origin + Quaternion(axis, angle) @ (point - origin)


def arm_param(p: Vector, side: str, joints) -> tuple[float, float, Vector]:
    """(distance along the straightened arm, arm membership 0..1, axis) from position only.

    Every part (body, sleeves, gloves) gets the same field, so garments deform
    exactly like the skin underneath them.
    """
    shoulder, wrist = joints[f"UpperArm.{side}"], joints[f"Hand.{side}"]
    axis = (wrist - shoulder).normalized()
    along = (p - shoulder).dot(axis)
    sign = 1.0 if side == "L" else -1.0
    radius = (p - (shoulder + axis * along)).length
    inside = smoothstep(-0.05, 0.035, along) * float(p.x * sign > 0) * smoothstep(0.17, 0.11, radius)
    return along, inside, axis


def twist_arms(meshes, weights, joints) -> None:
    for side in ("L", "R"):
        shoulder, elbow, wrist = joints[f"UpperArm.{side}"], joints[f"Forearm.{side}"], joints[f"Hand.{side}"]
        upper_len = (elbow - shoulder).length
        fore_len = (wrist - elbow).length
        for obj in meshes:
            for v in obj.data.vertices:
                along, inside, axis = arm_param(v.co, side, joints)
                if inside <= 0:
                    continue
                if along <= upper_len:
                    t = 0.5 * max(0.0, along) / upper_len
                else:
                    t = 0.5 + 0.5 * min(1.0, (along - upper_len) / fore_len)
                # Positive x axis for both sides keeps the twist direction mirrored.
                spin = axis if axis.x >= 0 else -axis
                v.co = rotate_about_axis(v.co, shoulder, spin, math.radians(180.0) * t * inside)


def apply_proportions(meshes, weights, joints, args) -> None:
    head_origin = joints["Head"]
    neck_z = joints["Neck"].z
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

    axis_y = joints["Spine"].y
    for obj in meshes:
        for v in obj.data.vertices:
            p = v.co.copy()
            # Head: everything above the neck joint, faded over 6 cm.
            head_w = smoothstep(neck_z - 0.02, neck_z + 0.06, p.z) * smoothstep(0.30, 0.22, abs(p.x))
            if head_w > 0:
                p = head_origin + (p - head_origin) * (1 + (args.head_scale - 1) * head_w)
            arm_total = 0.0
            for side in ("L", "R"):
                _along, inside, _axis = arm_param(v.co, side, joints)
                arm_total += inside
                if inside > 0:
                    p = radial(p, joints[f"UpperArm.{side}"], joints[f"Hand.{side}"], args.arm_thickness, inside)
            # Legs: below the hip line, per side.
            leg_w = smoothstep(hip_z + 0.02, hip_z - 0.10, v.co.z)
            if leg_w > 0:
                side = "L" if v.co.x >= 0 else "R"
                p = radial(p, joints[f"Thigh.{side}"], joints[f"Foot.{side}"], args.leg_thickness, leg_w * smoothstep(ankle_z - 0.02, ankle_z + 0.08, v.co.z))
            # Torso + neck: round out around the spine, excluding arms and head.
            torso_w = (1 - arm_total) * (1 - head_w) * smoothstep(hip_z - 0.12, hip_z + 0.05, v.co.z)
            neck_w = smoothstep(neck_z - 0.08, neck_z - 0.01, v.co.z) * (1 - head_w)
            core = torso_w * (args.torso_width - 1) + neck_w * (args.neck_thickness - args.torso_width)
            if core != 0:
                p = Vector((p.x * (1 + core), axis_y + (p.y - axis_y) * (1 + core * 0.3), p.z))
            p.z = leg_z(p.z) if p.z < hip_z else p.z
            v.co = p
    for name, joint in joints.items():
        if name == "Head":
            continue
        joints[name] = Vector((joint.x, joint.y, leg_z(joint.z)))
    enlarge_eyes(meshes, args.eye_scale)


EYE_PARTS = ("Eye", "Iris", "Pupil", "Highlight", "UpperLid")


def eye_centres(meshes) -> dict[int, Vector]:
    centres = {}
    for obj in meshes:
        if obj.name.startswith("Face_") and "_Eye_" in obj.name:
            side = 1 if obj.name.endswith("_1") and not obj.name.endswith("-1") else -1
            points = [v.co for v in obj.data.vertices]
            centres[side] = sum(points, Vector()) / len(points)
    return centres


def enlarge_eyes(meshes, scale: float) -> None:
    """Bigger, rounder chibi eyes: scale each eye stack about its eyeball centre."""
    if abs(scale - 1) < 1e-6:
        return
    centres = eye_centres(meshes)
    for obj in meshes:
        if not obj.name.startswith("Face_") or not any(f"_{part}_" in obj.name for part in EYE_PARTS):
            continue
        side = 1 if obj.name.endswith("_1") and not obj.name.endswith("-1") else -1
        centre = centres[side]
        for v in obj.data.vertices:
            v.co = centre + (v.co - centre) * scale
    # Brows follow the larger eyes upward a little.
    for obj in meshes:
        if obj.name.startswith("Face_") and "_Brow_" in obj.name:
            for v in obj.data.vertices:
                v.co.z += 0.012 * (scale - 1) / 0.3


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


# ─────────────────────────────── customization data ─────────────────────────

BODY_KEY_PARTS = ("body", "underwear", "underweartop", "top", "bottom", "shoes")


def slot_of(obj) -> str:
    if obj.get("slot"):
        return str(obj["slot"])
    return obj.name.split("_")[0].lower()


def body_shape_delta(p: Vector, w: dict[str, float], joints: dict[str, Vector], key: str) -> Vector:
    """World-space delta for a body-type morph at a rest point with Sidekick weights."""
    torso = sum(w.get(b, 0.0) for b in ("pelvis", "spine_01", "spine_02", "spine_03"))
    belly = sum(w.get(b, 0.0) for b in ("spine_01", "spine_02")) + 0.5 * w.get("pelvis", 0.0)
    chest = w.get("spine_03", 0.0) + 0.5 * sum(w.get(f"clavicle_{s}", 0.0) for s in "lr")
    delta = Vector()

    def limb(chain_a: str, chain_b: str, amount: float) -> None:
        nonlocal delta
        for s in "lr":
            wa = w.get(f"{chain_a}_{s}", 0.0) + w.get(f"{chain_b}_{s}", 0.0)
            if wa <= 0:
                continue
            a, b = joints[f"{chain_a}_{s}"], joints[f"{chain_b}_{s}"]
            d = (b - a).normalized()
            base = a + d * (p - a).dot(d)
            delta += (p - base) * amount * min(1.0, wa)

    axis_y = joints["spine_02"].y
    if key == "heavy":
        delta += Vector((p.x * 0.20 * torso, (p.y - axis_y) * (0.16 * torso + 0.22 * belly * float(p.y < axis_y)), 0))
        limb("upperarm", "lowerarm", 0.22)
        limb("thigh", "calf", 0.22)
    elif key == "skinny":
        delta += Vector((p.x * -0.12 * torso, (p.y - axis_y) * -0.12 * torso, 0))
        limb("upperarm", "lowerarm", -0.18)
        limb("thigh", "calf", -0.15)
    elif key == "buff":
        delta += Vector((p.x * 0.12 * chest, (p.y - axis_y) * 0.14 * chest, 0))
        limb("upperarm", "lowerarm", 0.24)
        limb("thigh", "calf", 0.12)
    return delta


def add_body_keys(obj, joints) -> None:
    names = {g.index: g.name for g in obj.vertex_groups}
    obj.shape_key_add(name="Basis", from_mix=False)
    for key in ("heavy", "skinny", "buff"):
        block = obj.shape_key_add(name=key, from_mix=False)
        for v in obj.data.vertices:
            w = {names[g.group]: g.weight for g in v.groups}
            block.data[v.index].co = v.co + body_shape_delta(v.co, w, joints, key)


def add_pupil_keys(obj, centres) -> None:
    side = 1 if obj.name.endswith("_1") and not obj.name.endswith("-1") else -1
    centre = centres[side]
    obj.shape_key_add(name="Basis", from_mix=False)
    for key, scale in (("pupilLarge", 1.22), ("pupilSmall", 0.68)):
        block = obj.shape_key_add(name=key, from_mix=False)
        # Scale on the eye's front plane only so the iris stays on the eyeball surface.
        for v in obj.data.vertices:
            offset = v.co - centre
            block.data[v.index].co = centre + Vector((offset.x * scale, offset.y, offset.z * scale))


def coverage_bits(body, garments) -> tuple[list[int], dict]:
    """Bit per garment: body vertex hidden when the garment is directly outside it.

    Three rays (normal, tilted up, tilted down) must all hit the garment within 6 cm,
    so skin near hems and cuffs stays drawn and only fully covered skin is hidden.
    """
    from mathutils.bvhtree import BVHTree

    bits = [0] * len(body.data.vertices)
    summary = {}
    for bit, garment in garments:
        tree = BVHTree.FromObject(garment, bpy.context.evaluated_depsgraph_get())
        count = 0
        for v in body.data.vertices:
            n = v.normal
            if n.length < 1e-6:
                continue
            up = Vector((0, 0, 1))
            side = n.cross(up)
            tilt = (up - n * n.dot(up)).normalized() if side.length > 1e-3 else n.cross(Vector((1, 0, 0))).normalized()
            rays = [n, (n + tilt * 0.45).normalized(), (n - tilt * 0.45).normalized()]
            origin = v.co + n * 0.001
            if all(tree.ray_cast(origin, d, 0.06)[0] is not None for d in rays):
                bits[v.index] |= 1 << bit
                count += 1
        summary[garment.name] = count
    return bits, summary


def main() -> None:
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=str(args.v4_blend.expanduser().resolve()))
    template = append_sidekick_rig(args.sidekick_blend.expanduser().resolve())
    sk_dirs = {
        side: {
            "UpperArm": sidekick_joint(template, f"lowerarm_{s}") - sidekick_joint(template, f"upperarm_{s}"),
            "Forearm": sidekick_joint(template, f"hand_{s}") - sidekick_joint(template, f"lowerarm_{s}"),
            "Hand": sidekick_joint(template, f"middle_01_{s}") - sidekick_joint(template, f"hand_{s}"),
        }
        for side, s in (("L", "l"), ("R", "r"))
    }
    report: dict = {"params": {k: v for k, v in vars(args).items() if isinstance(v, (int, float))}, "variants": {}}
    export_sets = {}
    for label in ("Male", "Female"):
        rig = bpy.data.objects[f"Rig_{label}"]
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]
        for obj in (rig, *meshes):
            obj.hide_viewport = False
            obj.hide_set(False)
        reset_rig_pose(rig)
        # 검토 파일은 손 보정 key(RelaxedHands=1)가 켜진 채라 굽힌 손가락이 구워졌다.
        for obj in meshes:
            if obj.data.shape_keys:
                for block in obj.data.shape_keys.key_blocks[1:]:
                    block.value = 0.0
        transfer_garment_weights(meshes)
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="POSE")
        for side in ("L", "R"):
            swing_bone(rig, f"UpperArm.{side}", f"Forearm.{side}", sk_dirs[side]["UpperArm"])
            swing_bone(rig, f"Forearm.{side}", f"Hand.{side}", sk_dirs[side]["Forearm"])
            swing_bone(rig, f"Hand.{side}", None, sk_dirs[side]["Hand"])
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.update()
        joints = {b.name: world_head(rig, b.name) for b in rig.pose.bones}
        weights = {o.name: vertex_weights(o) for o in meshes}
        apply_rig_pose(rig, meshes)
        twist_arms(meshes, weights, joints)
        apply_proportions(meshes, weights, joints, args)
        scale = fit_height(meshes, joints, args.height)
        new_rig = fit_sidekick_rig(template, joints, label)
        joints_sk = {b.name: new_rig.matrix_world @ b.head_local for b in new_rig.data.bones}
        stats = {o.name: remap_weights(o, weights[o.name], new_rig, joints_sk) for o in meshes}
        bpy.data.objects.remove(rig, do_unlink=True)
        centres = eye_centres(meshes)
        body = next(o for o in meshes if o.name.startswith("Body_"))
        garments = []
        for obj in meshes:
            part = slot_of(obj)
            obj["chibi_part"] = part
            obj["chibi_body"] = label.lower()
            if part in BODY_KEY_PARTS:
                add_body_keys(obj, joints_sk)
            if obj.name.startswith("Face_") and any(f"_{x}_" in obj.name for x in ("Iris", "Pupil", "Highlight")):
                add_pupil_keys(obj, centres)
            if part in ("top", "bottom", "shoes"):
                bit = {"top": 0, "bottom": 4, "shoes": 8}[part] + int(obj.get("variant", 0))
                obj["chibi_cover_bit"] = bit
                garments.append((bit, obj))
        bits, cover = coverage_bits(body, garments)
        attribute = body.data.attributes.new("_cover", "FLOAT", "POINT")
        attribute.data.foreach_set("value", [float(b) for b in bits])
        report_cover = {name: n for name, n in cover.items()}
        report["variants"][label] = {"scale": round(scale, 5), "parts": stats, "height": args.height, "covered_vertices": report_cover}
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
        out = args.glb_dir.expanduser().resolve() / f"chibi-{label.lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(out), export_format="GLB", use_selection=True, export_animations=False,
            export_skins=True, export_influence_nb=MAX_INFLUENCES, export_morph=True, export_morph_normal=True,
            export_apply=False, export_extras=True, export_attributes=True,
        )
        report["variants"][label]["glb"] = str(out)
    args.report.expanduser().resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("CHIBI_BODY_OK", json.dumps({k: v["scale"] for k, v in report["variants"].items()}))


if __name__ == "__main__":
    main()
