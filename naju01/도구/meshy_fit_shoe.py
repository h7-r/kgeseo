# 만들어 둔 신발 모델(Meshy 등)을 캐릭터 발에 맞춰 파츠 GLB 로 굽는다.
#
#   1) 소스 정리(한 번): 무거운 원본을 삭감해 소스 GLB 로 저장
#      Blender --background --factory-startup --python naju01/도구/meshy_fit_shoe.py -- \
#        --prep ~/Downloads/Meshy_AI_White_Nike_Air_Force__0921030657_generate.glb \
#        --source naju01/캐릭터작업/meshy-parts/shoes/sneaker-white.glb
#   2) 착장마다 맞추기:
#      Blender --background --factory-startup --python naju01/도구/meshy_fit_shoe.py -- \
#        --source naju01/캐릭터작업/meshy-parts/shoes/sneaker-white.glb \
#        --glb public/models/meshy-both-male.glb --out public/models/shoes-both-male.glb
#
# 소스 신발의 축: 앞코 -X, 뒤꿈치 +X, 위 +Z, 폭 Y (Meshy 신발이 그렇게 나온다. 다르면 --toe-axis).
# 캐릭터 발은 앞코 -Y. 발 길이·폭에 여유(--margin)를 더한 크기로 놓고, 뒤꿈치를 발 뒤꿈치에
# 맞춘다. 모든 정점을 발뼈(foot) 하나에 100% 로 묶는다 — 게임 운동화는 발가락에서 굽지 않고,
# 런타임에서 신발을 신으면 발볼 뼈를 줄여 발가락을 신발 안으로 접어 넣는다(치비게임아바타).
import argparse
import math
import sys

import bmesh
import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--prep", help="원본 신발 GLB — 삭감해서 --source 로 저장하고 끝낸다")
parser.add_argument("--source", required=True, help="정리된 신발 소스 GLB")
parser.add_argument("--glb", help="캐릭터 몸 GLB")
parser.add_argument("--out", help="결과 파츠 GLB")
parser.add_argument("--tris", type=int, default=7000, help="소스 정리 때 신발 한 짝의 삼각형 수")
# 신발은 원래 발보다 아주 조금만 크게 잡는다. 발 자체가 통통해 발+여유로 잡으면 발목에 비해
# 신발이 너무 커 보였다. 발은 신을 때 --foot-shrink 로 줄여 신발 안에 넣는다(안 줄이면 살이 뚫고 나온다).
parser.add_argument("--margin-length", type=float, default=0.006, help="원래 발 길이에 더하는 여유(m)")
parser.add_argument("--margin-width", type=float, default=0.004, help="줄어든 발 폭에 더하는 여유(m) — 이보다 좁을 때만 폭을 키운다")
parser.add_argument("--sink", type=float, default=0.006, help="신발 바닥을 맨발 바닥보다 이만큼 내린다(m)")
parser.add_argument("--heel-gap", type=float, default=0.016, help="발 뒤꿈치 뒤로 신발 뒤꿈치가 나가는 양(m)")
# 발은 줄지만 발목 위 종아리는 줄지 않아, 신발 입구가 발목보다 좁으면 뒤꿈치 위 살이 신발 뒤로
# 삐져나온다. 밑창은 그대로 두고 위로 갈수록 폭·길이를 이 비율까지 넓힌다.
parser.add_argument("--collar-flare", type=float, default=0.2)
parser.add_argument("--sole-ratio", type=float, default=0.14, help="신발 높이 중 밑창으로 칠할 비율")
# 신발을 신으면 런타임이 발뼈를 이 배율로 줄여 발을 신발 안에 넣는다(뒤꿈치·발볼이 비치지 않게).
# 신발은 발뼈에 붙어 같이 줄어드므로, 여기서 발목(발뼈 머리) 기준으로 1/배율 만큼 미리 키워 둔다.
parser.add_argument("--foot-shrink", type=float, default=0.72, help="신을 때 발뼈 배율(1 = 안 줄임)")
args = parser.parse_args(argv)

ctx = bpy.context


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    ctx.view_layer.objects.active = obj


def apply_first(obj, modifier):
    bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def bounds(obj, pts=None):
    pts = pts if pts is not None else [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


# ── 1) 소스 정리 ─────────────────────────────────────────────
if args.prep:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.prep)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    select_only(meshes[0])
    for o in meshes[1:]:
        o.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    shoe = ctx.active_object
    shoe.name = "SneakerSource"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Meshy 프리뷰 메시는 정점이 면마다 갈라져 있고 떠도는 정점도 많다. 합치고 지운 뒤 삭감한다.
    bm = bmesh.new()
    bm.from_mesh(shoe.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(shoe.data)
    bm.free()
    shoe.data.calc_loop_triangles()
    tris = len(shoe.data.loop_triangles)
    print(f"SHOE_PREP_MERGED tris={tris} verts={len(shoe.data.vertices)}")
    if tris > args.tris:
        dec = shoe.modifiers.new("줄이기", "DECIMATE")
        dec.ratio = args.tris / tris
        apply_first(shoe, dec)
    shoe.data.validate(verbose=False)
    for poly in shoe.data.polygons:
        poly.use_smooth = True
    shoe.data.materials.clear()
    select_only(shoe)
    bpy.ops.export_scene.gltf(filepath=args.source, export_format="GLB", use_selection=True,
                              export_apply=True, export_animations=False, export_materials="NONE")
    shoe.data.calc_loop_triangles()
    print(f"SHOE_PREP_OK tris={len(shoe.data.loop_triangles)} verts={len(shoe.data.vertices)}")
    sys.exit(0)

# ── 2) 발에 맞추기 ────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")
armature = body.parent
label = str(body.get("chibi_body", "")).capitalize()
floor = min((body.matrix_world @ v.co).z for v in body.data.vertices)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=args.source)
source = next(o for o in bpy.data.objects if o not in before and o.type == "MESH")
# 변환은 오브젝트가 아니라 메시 데이터에 직접 곱한다(글TF 로 들어온 계층에서는 apply 가 먹지 않았다).
source.data.transform(source.matrix_world)
source.matrix_world = mathutils.Matrix.Identity(4)
if source.parent:
    source.parent = None
    source.matrix_world = mathutils.Matrix.Identity(4)
# 소스 축 → 캐릭터 축: 앞코 -X 를 -Y 로(z 둘레 +90°).
source.data.transform(mathutils.Matrix.Rotation(math.radians(90), 4, "Z"))
source.data.update()
src_lo, src_hi = bounds(source)
src_len = src_hi.y - src_lo.y
src_wid = src_hi.x - src_lo.x
src_hgt = src_hi.z - src_lo.z


def foot_points(side):
    groups = {g.name: g.index for g in body.vertex_groups}
    idx = {groups[n] for n in (f"foot_{side}", f"ball_{side}") if n in groups}
    M = body.matrix_world
    return [M @ v.co for v in body.data.vertices
            if sum(g.weight for g in v.groups if g.group in idx) > 0.3]


upper = bpy.data.materials.new(f"Shoe_Upper_{label}")
upper.use_nodes = True
upper.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.94, 0.94, 0.94, 1)
upper.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.75
sole = bpy.data.materials.new(f"Shoe_Sole_{label}")
sole.use_nodes = True
sole.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.80, 0.80, 0.82, 1)
sole.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9


def fit(side):
    pts = foot_points(side)
    f_lo, f_hi = bounds(None, pts)
    foot_len = f_hi.y - f_lo.y
    foot_wid = f_hi.x - f_lo.x
    s = (foot_len + args.margin_length) / src_len
    # 폭은 신발 비례를 지킨다. 줄어든 발이 그래도 더 넓을 때만 폭을 키운다.
    sx = max(s, (foot_wid * args.foot_shrink + args.margin_width) / src_wid)

    select_only(source)
    bpy.ops.object.duplicate()
    shoe = ctx.active_object
    shoe.name = f"Shoes0_{side.upper()}_{label}"
    shoe.data.name = shoe.name
    for key in list(shoe.keys()):
        del shoe[key]
    # 발 폭이 더 넓으면 폭만 더 키운다(길이·높이는 균일 배율).
    shoe.data.transform(mathutils.Matrix.Diagonal((sx if side == "l" else -sx, s, s, 1)))
    if side != "l":
        # 거울상은 면이 뒤집힌다.
        bm = bmesh.new()
        bm.from_mesh(shoe.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(shoe.data)
        bm.free()
    # 놓는 자리는 **줄어든 발** 기준이다. 발은 발목(발뼈 머리)을 중심으로 줄어들어 살이 뼈보다
    # 바깥에 있는 남성 발은 줄면서 안쪽으로 들어온다 — 원래 발 중심에 놓았더니 신발이 바깥으로
    # 치우쳐 안쪽 살이 드러났다.
    head = armature.matrix_world @ armature.data.bones[f"foot_{side}"].head_local
    k = args.foot_shrink
    sx_c = head.x + ((f_lo.x + f_hi.x) / 2 - head.x) * k
    heel_y = head.y + (f_hi.y - head.y) * k
    # 발 살의 방향(뒤꿈치 중심 → 앞꿈치 중심)에 신발을 맞춰 돌린다. 남성 발 살은 뼈보다 바깥으로
    # 틀어져 있어, 상자 중심에만 맞추면 뒤꿈치 안쪽이 신발 밖으로 나왔다.
    heel_pts = [p for p in pts if p.y > f_hi.y - foot_len * 0.3]
    toe_pts = [p for p in pts if p.y < f_lo.y + foot_len * 0.3]
    hc = sum(heel_pts, mathutils.Vector()) / len(heel_pts)
    tc = sum(toe_pts, mathutils.Vector()) / len(toe_pts)
    yaw = math.atan2(tc.x - hc.x, -(tc.y - hc.y))
    lo, hi = bounds(shoe)
    pivot = mathutils.Vector(((lo.x + hi.x) / 2, hi.y, 0))  # 뒤꿈치 끝 기준으로 돌린다
    shoe.data.transform(mathutils.Matrix.Translation(pivot) @ mathutils.Matrix.Rotation(yaw, 4, "Z") @ mathutils.Matrix.Translation(-pivot))
    shoe.data.update()
    # 뒤꿈치 중심을 줄어든 발의 뒤꿈치 중심에 맞춘다.
    sx_c = head.x + (hc.x - head.x) * k + (tc.x - hc.x) * k * 0.5  # 신발 상자 중심 ≈ 발 중심
    lo, hi = bounds(shoe)
    shoe.data.transform(mathutils.Matrix.Translation((
        sx_c - (lo.x + hi.x) / 2,
        (heel_y + args.heel_gap) - hi.y,
        (floor - args.sink) - lo.z,
    )))
    shoe.data.update()
    if args.collar_flare > 0:
        lo, hi = bounds(shoe)
        cx = (lo.x + hi.x) / 2
        cy = (lo.y + hi.y) / 2
        for v in shoe.data.vertices:
            p = shoe.matrix_world @ v.co
            t = min(1.0, max(0.0, (p.z - lo.z) / (hi.z - lo.z)))
            f = 1 + args.collar_flare * t * t
            p.x = cx + (p.x - cx) * f
            p.y = cy + (p.y - cy) * f
            v.co = shoe.matrix_world.inverted() @ p
        shoe.data.update()
    shoe.data.validate(verbose=False)

    # 발이 신발 밖으로 나오는 정점 수 — 크기·여유 점검용(런타임에 줄어든 발 기준).
    bvh = mathutils.bvhtree.BVHTree.FromObject(shoe, ctx.evaluated_depsgraph_get())
    outside = 0
    for p in pts:
        q = head + (p - head) * k
        loc, nor, _, _ = bvh.find_nearest(q)
        if loc is not None and (q - loc).dot(nor) > 0:
            outside += 1
    # 발뼈 배율을 되돌릴 만큼 미리 키운다(발목 기준).
    if k != 1:
        shoe.data.transform(mathutils.Matrix.Translation(head) @ mathutils.Matrix.Scale(1 / k, 4) @ mathutils.Matrix.Translation(-head))
        shoe.data.update()

    # 웨이트: 발뼈 하나에 100%.
    for g in body.vertex_groups:
        shoe.vertex_groups.new(name=g.name)
    shoe.vertex_groups[f"foot_{side}"].add(list(range(len(shoe.data.vertices))), 1.0, "REPLACE")
    shoe.parent = armature
    shoe.matrix_parent_inverse = armature.matrix_world.inverted()
    mod = shoe.modifiers.new("Armature", "ARMATURE")
    mod.object = armature

    shoe.data.materials.clear()
    shoe.data.materials.append(upper)
    shoe.data.materials.append(sole)
    lo, hi = bounds(shoe)
    sole_top = lo.z + (hi.z - lo.z) * args.sole_ratio
    for poly in shoe.data.polygons:
        poly.material_index = 1 if (shoe.matrix_world @ poly.center).z < sole_top else 0

    shoe["slot"] = "shoes"
    shoe["variant"] = 0
    shoe["chibi_part"] = "shoes0"
    shoe["chibi_body"] = body.get("chibi_body", "")
    shoe["side"] = side
    shoe["foot_shrink"] = k
    print(f"SHOE_YAW {side} {math.degrees(yaw):.1f}deg")
    print(f"SHOE_FIT {side} foot_len={foot_len:.3f} foot_wid={foot_wid:.3f} scale=({sx:.4f},{s:.4f}) "
          f"shoe_len={hi.y - lo.y:.3f} shoe_wid={hi.x - lo.x:.3f} shoe_hgt={hi.z - lo.z:.3f} outside={outside}/{len(pts)}")
    return shoe


shoes = [fit("l"), fit("r")]
bpy.data.objects.remove(source, do_unlink=True)

select_only(armature)
for shoe in shoes:
    shoe.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=args.out,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_morph=False,
    export_skins=True,
    export_extras=True,
    export_image_format="NONE",
)
for shoe in shoes:
    shoe.data.calc_loop_triangles()
    print(f"SHOES_OK {shoe.name} tris={len(shoe.data.loop_triangles)} verts={len(shoe.data.vertices)}")
