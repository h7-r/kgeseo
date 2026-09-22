# 게임에서 보이는 캐릭터를 GLB 하나로 내보낸다(외부 3D 도구에 넣어 볼 때).
#
#   Blender --background --factory-startup --python naju01/도구/meshy_export_character.py -- \
#     --body public/models/meshy-both-male.glb --shoes public/models/shoes-both-male.glb \
#     --hair 0 --arm-length 0.88 --out ~/Downloads/kgeseo-male.glb
#
# 런타임(치비게임아바타)에서만 적용되는 것들을 쉴 때 자세에 굽는다:
#   팔 길이(아래팔·손 뼈 위치 배율), 신을 때 발뼈 줄이기(신발 GLB 의 foot_shrink), 발볼 접기.
# 머리는 고른 variant 하나만 남기고, 신발은 캐릭터 골격에 다시 묶는다.
import argparse
import math
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--body", required=True)
parser.add_argument("--shoes")
parser.add_argument("--hair", type=int, default=0)
parser.add_argument("--arm-length", type=float, default=0.88)
parser.add_argument("--shoulder-width", type=float, default=1.2, help="위팔 뼈 위치 배율(쇄골 기준) — 게임 기본 어깨 폭")
parser.add_argument("--out", required=True)
# 리깅용 내보내기: 골격·신발·머리를 빼고 몸 메시만, 팔을 이 각도(도)만큼 내린 A포즈로.
parser.add_argument("--apose", type=float, default=0.0, help="팔을 수평에서 아래로 내리는 각(도). 0 = T포즈 그대로")
parser.add_argument("--mesh-only", action="store_true", help="골격 없이 몸 메시만 내보낸다")
args = parser.parse_args(argv)

ctx = bpy.context
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.body)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")
rig = body.parent

# 머리: 고른 variant 만.
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.get("slot") == "hair" and int(o.get("variant", -1)) != args.hair:
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is None and not o.get("slot") and not o.get("chibi_part"):
        bpy.data.objects.remove(o, do_unlink=True)  # 잡동사니(Icosphere 등)

# 신발: 골격을 캐릭터 것으로 바꿔 붙인다(뼈 이름이 같다).
foot_shrink = 1.0
if args.shoes:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=args.shoes)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type != "MESH":
            continue
        owner = o
        while owner and owner.get("slot") is None:
            owner = owner.parent
        if owner is not None and owner.get("foot_shrink"):
            foot_shrink = float(owner.get("foot_shrink"))
        world = o.matrix_world.copy()
        o.parent = rig
        o.matrix_world = world
        for m in o.modifiers:
            if m.type == "ARMATURE":
                m.object = rig
        if not any(m.type == "ARMATURE" for m in o.modifiers):
            o.modifiers.new("Armature", "ARMATURE").object = rig
        o["slot"] = "shoes"
    for o in new:
        if o.type == "ARMATURE" or (o.type == "EMPTY"):
            bpy.data.objects.remove(o, do_unlink=True)

for o in list(bpy.data.objects):
    if o.type == "MESH" and (o.name.startswith("Icosphere") or len(o.data.vertices) < 100):
        bpy.data.objects.remove(o, do_unlink=True)  # 리그에 딸린 잡동사니(Icosphere 등)
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]

# 셰이프키가 있으면 armature 적용이 안 된다 — 기본 형태로 굳힌다(슬라이더 값은 0).
for o in meshes:
    if o.data.shape_keys:
        ctx.view_layer.objects.active = o
        o.shape_key_clear()

# 런타임 조정을 포즈로 만든다.
ctx.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
pb = rig.pose.bones
for side in ("l", "r"):
    if foot_shrink != 1.0 and f"foot_{side}" in pb:
        pb[f"foot_{side}"].scale = (foot_shrink,) * 3
    if args.shoes and f"ball_{side}" in pb:
        pb[f"ball_{side}"].scale = (0.02,) * 3
    if args.shoulder_width != 1.0 and f"upperarm_{side}" in pb:
        b = rig.data.bones[f"upperarm_{side}"]
        p = rig.data.bones[f"clavicle_{side}"]
        off_arm = (b.head_local - p.head_local) * (args.shoulder_width - 1)
        pb[f"upperarm_{side}"].location = b.matrix_local.to_3x3().inverted() @ off_arm
    if args.arm_length != 1.0:
        for name, parent in ((f"lowerarm_{side}", f"upperarm_{side}"), (f"hand_{side}", f"lowerarm_{side}")):
            if name not in pb:
                continue
            b = rig.data.bones[name]
            p = rig.data.bones[parent]
            off_arm = (b.head_local - p.head_local) * (args.arm_length - 1)  # 아마추어 공간
            off_local = b.matrix_local.to_3x3().inverted() @ off_arm
            pb[name].location = off_local
if args.apose:
    # 위팔을 앞뒤 축(아마추어 Y) 둘레로 돌려 팔을 내린다. 왼팔은 +X 방향이라 +각이 아래.
    for side, sign in (("l", 1), ("r", -1)):
        name = f"upperarm_{side}"
        if name not in pb:
            continue
        # 아마추어 공간 회전을 뼈 로컬 회전으로 옮겨 넣는다(pose matrix 대입은 배경 모드에서 먹지 않았다).
        R3 = mathutils.Matrix.Rotation(math.radians(sign * args.apose), 3, "Y")
        L3 = rig.data.bones[name].matrix_local.to_3x3()
        pb[name].rotation_mode = "QUATERNION"
        pb[name].rotation_quaternion = (L3.inverted() @ R3 @ L3).to_quaternion()
    ctx.view_layer.update()
    for side in ("l", "r"):
        if f"hand_{side}" in pb:
            print(f"APOSE_HAND {side} z={(rig.matrix_world @ pb[f'hand_{side}'].head).z:.3f} x={(rig.matrix_world @ pb[f'hand_{side}'].head).x:.3f}")
bpy.ops.object.mode_set(mode="OBJECT")
# 메시에 포즈를 굽는다 — 평가된(변형된) 메시를 복사해 넣는다(modifier_apply 는 배경 모드에서
# 조용히 아무것도 안 했다). 그 뒤 포즈를 새 쉴 때 자세로 굳히고 다시 묶는다.
dg = ctx.evaluated_depsgraph_get()
for o in meshes:
    baked = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    baked.name = o.data.name + "_baked"
    o.modifiers.clear()
    o.data = baked
ctx.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
for o in meshes:
    o.modifiers.new("Armature", "ARMATURE").object = rig

if args.mesh_only:
    keep = [o for o in meshes if o.get("chibi_part") == "body"]
    for o in meshes:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = keep
    for o in meshes:
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        for g in list(o.vertex_groups):
            o.vertex_groups.remove(g)
        world = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = world
    bpy.data.objects.remove(rig, do_unlink=True)
    hand = None
    for o in meshes:
        xs = [(o.matrix_world @ v.co) for v in o.data.vertices]
        print("APOSE_CHECK hand-ish min z", round(min(p.z for p in xs if abs(p.x) > 0.3), 3) if any(abs(p.x) > 0.3 for p in xs) else "n/a",
              "max |x|", round(max(abs(p.x) for p in xs), 3))
bpy.ops.object.select_all(action="DESELECT")
if not args.mesh_only:
    rig.select_set(True)
    ctx.view_layer.objects.active = rig
for o in meshes:
    o.select_set(True)
if args.mesh_only:
    ctx.view_layer.objects.active = meshes[0]
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", use_selection=True, export_animations=False,
    export_skins=not args.mesh_only, export_influence_nb=4, export_morph=False, export_apply=True,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=85,
)
print("EXPORT_OK", args.out, "meshes:", [o.name for o in meshes], "foot_shrink", foot_shrink)
