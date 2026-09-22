# Tripo 에서 받은 FBX 동작들을 우리 리타게팅용 모션 GLB 하나로 굽는다.
#
#   Blender --background --factory-startup --python naju01/도구/tripo_build_motions.py -- \
#     --clip Walk_Loop=path/walk.fbx:0:56 --clip Idle_Loop=path/wait.fbx:0:144 --clip Jog_Fwd_Loop=path/run.fbx:0:30 \
#     --out public/models/tripo-motions.glb
#
# Tripo FBX 는 Mixamo 뼈 이름(mixamorig:LeftUpLeg …)이고 클립 뒤가 마지막 자세로 채워져 있다.
# 뼈 이름을 우리 리그 이름(thigh_l …)으로 바꾸고, 지정한 구간만 잘라, 클립 이름을 우리 이름으로
# 붙여 NLA 트랙으로 내보낸다. 메시는 Tripo 삭감본이 깨져 있어 버리고, 리타게팅 코드가 요구하는
# SkinnedMesh 자리에는 골반에 묶인 작은 삼각형 하나만 넣는다.
import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--clip", action="append", required=True, help="이름=fbx:시작:끝")
parser.add_argument("--out", required=True)
args = parser.parse_args(argv)

이름표 = {
    "Hips": "pelvis", "Spine": "spine_01", "Spine1": "spine_02", "Spine2": "spine_03",
    "Neck": "neck_01", "Head": "Head",  # 리타게팅옵션이 target 'head' 를 source 'Head' 로 찾는다
}
for side, s in (("Left", "l"), ("Right", "r")):
    이름표.update({
        f"{side}Shoulder": f"clavicle_{s}", f"{side}Arm": f"upperarm_{s}", f"{side}ForeArm": f"lowerarm_{s}",
        f"{side}Hand": f"hand_{s}", f"{side}UpLeg": f"thigh_{s}", f"{side}Leg": f"calf_{s}",
        f"{side}Foot": f"foot_{s}", f"{side}ToeBase": f"ball_{s}",
    })
    for finger, ours in (("Index", "index"), ("Middle", "middle"), ("Pinky", "pinky"), ("Ring", "ring"), ("Thumb", "thumb")):
        for k in (1, 2, 3):
            이름표[f"{side}Hand{finger}{k}"] = f"{ours}_0{k}_{s}"


def 우리이름(name):
    base = name.split(":", 1)[1] if ":" in name else name
    return 이름표.get(base, base)


bpy.ops.wm.read_factory_settings(use_empty=True)
rig = None
strips = []
for spec in args.clip:
    name, rest = spec.split("=", 1)
    path, start, end = rest.rsplit(":", 2)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    action = arm.animation_data.action
    action.name = name
    # 곡선의 뼈 이름을 우리 이름으로.
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    if fc.data_path.startswith('pose.bones["'):
                        bone = fc.data_path.split('"')[1]
                        fc.data_path = fc.data_path.replace(f'"{bone}"', f'"{우리이름(bone)}"')
    # 구간 밖 키는 지운다.
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    for k in reversed(fc.keyframe_points):
                        if k.co.x < int(start) - 0.5 or k.co.x > int(end) + 0.5:
                            fc.keyframe_points.remove(k)
    action.use_fake_user = True
    strips.append((name, action, int(start), int(end)))
    if rig is None:
        rig = arm
        for b in rig.data.bones:
            b.name = 우리이름(b.name)
    for o in new:
        if o is not rig:
            bpy.data.objects.remove(o, do_unlink=True)

# 리그 스케일(FBX cm)을 미터로, 정면을 우리 몸체와 같게(Blender -Y = glTF +Z). Tripo 리그는 +X 를
# 본다 — 그대로 두면 리타게팅이 90° 돌아간 세계 회전을 얹어 팔이 앞으로 뻗고 다리가 안 굽는다(실제로 그랬다).
bpy.context.view_layer.objects.active = rig
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
import math
from mathutils import Vector
def 정면():
    foot = rig.data.bones["foot_l"]; ball = rig.data.bones["ball_l"]
    d = (rig.matrix_world @ ball.head_local) - (rig.matrix_world @ foot.head_local); d.z = 0
    return d.normalized()
f = 정면()
yaw = math.atan2(-1, 0) - math.atan2(f.y, f.x)  # 목표: (0, -1)
rig.rotation_euler = (0, 0, yaw)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print("FACING before", [round(v, 2) for v in f], "after", [round(v, 2) for v in 정면()])

# 쉴 때 자세를 우리 리그와 같은 T포즈로. Tripo 리그는 A포즈(팔 45° 아래)라, 리타게팅이 팔의 세계 회전을
# 그대로 얹으면 팔 축 둘레 비틀림이 T포즈 팔에는 앞뒤 돌림으로 나타나 팔이 앞으로 뻗었다(실제로 그랬다).
# 위팔을 수평(±X)으로 세운 자세를 새 쉴 때 자세로 굳히고, 그만큼 모든 키를 되돌린다.
from mathutils import Matrix, Quaternion
# 임포트 직후엔 클립의 첫 프레임 포즈가 뼈에 남아 있다. 그대로 굳히면 쉴 때 자세가 엉킨다 — 먼저 비운다.
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
def 부모기준(b):
    m = b.matrix_local if b.parent is None else (b.parent.matrix_local.inverted() @ b.matrix_local)
    return m.to_3x3()
옛것 = {b.name: 부모기준(b) for b in rig.data.bones}
bpy.ops.object.mode_set(mode="POSE")
for name, child, target in (("upperarm_l", "lowerarm_l", Vector((1, 0, 0))), ("upperarm_r", "lowerarm_r", Vector((-1, 0, 0)))):
    pb = rig.pose.bones[name]; b = rig.data.bones[name]
    # FBX 임포트 뼈의 tail 은 자식 위치와 다를 수 있다 — 방향은 자식 뼈 머리로 잰다.
    cur = (rig.data.bones[child].head_local - b.head_local).normalized()
    R3 = cur.rotation_difference(target).to_matrix()
    L3 = b.matrix_local.to_3x3()
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (L3.inverted() @ R3 @ L3).to_quaternion()
bpy.context.view_layer.update()
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
새것 = {b.name: 부모기준(b) for b in rig.data.bones}
보정 = {}
for name in 옛것:
    C = 새것[name].inverted() @ 옛것[name]
    if abs(C.to_quaternion().angle) > 1e-5:
        보정[name] = C.to_quaternion()
print("REST_FIX bones", sorted(보정.keys()))
for _, action, _, _ in strips:
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                by_bone = {}
                for fc in cb.fcurves:
                    if fc.data_path.startswith('pose.bones["') and fc.data_path.endswith("rotation_quaternion"):
                        by_bone.setdefault(fc.data_path.split('"')[1], {})[fc.array_index] = fc
                for name, curves in by_bone.items():
                    C = 보정.get(name)
                    if C is None or len(curves) < 4:
                        continue
                    n = len(curves[0].keyframe_points)
                    for k in range(n):
                        q = Quaternion((curves[0].keyframe_points[k].co.y, curves[1].keyframe_points[k].co.y,
                                        curves[2].keyframe_points[k].co.y, curves[3].keyframe_points[k].co.y))
                        q2 = C @ q
                        for i in range(4):
                            curves[i].keyframe_points[k].co.y = q2[i]
                    for i in range(4):
                        curves[i].update()
print("T_POSE upperarm_l", [round(v, 2) for v in (rig.data.bones["lowerarm_l"].head_local - rig.data.bones["upperarm_l"].head_local).normalized()])

# 골반에 묶인 작은 삼각형 — 리타게팅 코드가 source 에서 SkinnedMesh 를 찾는다.
mesh = bpy.data.meshes.new("TripoStub")
mesh.from_pydata([(0, 0, 0), (0.01, 0, 0), (0, 0.01, 0)], [], [(0, 1, 2)])
stub = bpy.data.objects.new("TripoStub", mesh)
bpy.context.scene.collection.objects.link(stub)
stub.parent = rig
stub.vertex_groups.new(name="pelvis").add([0, 1, 2], 1.0, "REPLACE")
stub.modifiers.new("Armature", "ARMATURE").object = rig

# 액션들을 NLA 트랙으로 — glTF 가 트랙마다 클립 하나로 내보낸다.
rig.animation_data.action = None
for name, action, start, end in strips:
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, start, action)
    strip.action_frame_start = start
    strip.action_frame_end = end
    strip.frame_start = 0
    strip.frame_end = end - start
    track.mute = False

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
stub.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", use_selection=True,
    export_animations=True, export_animation_mode="NLA_TRACKS", export_nla_strips_merged_animation_name="",
    export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=False,
    export_skins=True, export_materials="NONE", export_image_format="NONE",
)
print("TRIPO_MOTIONS_OK", args.out, [(n, s, e) for n, _, s, e in strips], "bones", len(rig.data.bones))
