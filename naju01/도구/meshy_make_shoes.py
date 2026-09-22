# 흰색 운동화 파츠 — 구워 둔 캐릭터 GLB 의 발을 본떠 만든다.
#
#   Blender --background --factory-startup --python naju01/도구/meshy_make_shoes.py -- \
#     --glb public/models/meshy-base-male.glb --out public/models/shoes-base-male.glb
#
# 발을 감싸는 구를 발 표면에서 몇 mm 띄워 shrinkwrap 으로 씌우고(닫힌 도형에서 출발해
# 찢어지지 않는다 — 몸 메시를 복셀 리메시했더니 열린 메시라 조각조각 부서졌다),
# 매끈하게 다듬어 발가락 틈을 메운 뒤, 발목에서 잘라 입구를 내고 바닥을 평평한 밑창으로 깎는다.
# 웨이트는 몸에서 가장 가까운 정점의 것을 옮긴다. 결과 GLB 에는 골격도 같이 들어가는데,
# 런타임(치비게임아바타)에서 뼈 이름으로 캐릭터 골격에 다시 묶는다.
import argparse
import sys

import bmesh
import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--puff", type=float, default=0.009, help="발 표면에서 바깥으로 띄우는 두께(m)")
parser.add_argument("--sole", type=float, default=0.012, help="밑창 두께(m) — 바닥이 이만큼 내려간다")
parser.add_argument("--collar", type=float, default=0.078, help="신발 입구 높이(m, 바닥 기준)")
parser.add_argument("--voxel", type=float, default=0.003)
parser.add_argument("--tris", type=int, default=2600, help="신발 한 짝의 목표 삼각형 수")
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)

body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")
armature = body.parent
label = str(body.get("chibi_body", "")).capitalize()
ctx = bpy.context
ctx.view_layer.objects.active = body

# 몸의 가장 낮은 점(맨발 바닥) — 밑창은 여기서 --sole 만큼 더 내려간다.
floor = min((body.matrix_world @ v.co).z for v in body.data.vertices)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    ctx.view_layer.objects.active = obj


def apply_first(obj, modifier):
    bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def foot_only(side):
    """몸에서 이 발(foot/ball 웨이트) 부위만 남긴 임시 메시 — shrinkwrap 대상."""
    select_only(body)
    bpy.ops.object.duplicate()
    part = ctx.active_object
    part.shape_key_clear()
    M = part.matrix_world
    groups = {g.name: g.index for g in part.vertex_groups}
    foot_groups = {groups[n] for n in (f"foot_{side}", f"ball_{side}") if n in groups}
    bm = bmesh.new()
    bm.from_mesh(part.data)
    deform = bm.verts.layers.deform.active
    drop = [v for v in bm.verts
            if sum(v[deform].get(i, 0.0) for i in foot_groups) < 0.2 or (M @ v.co).z > floor + args.collar + 0.03]
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    bm.to_mesh(part.data)
    bm.free()
    return part


def make_shoe(side):
    foot = foot_only(side)
    M = foot.matrix_world
    pts = [M @ v.co for v in foot.data.vertices]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    center = [(lo[i] + hi[i]) / 2 for i in range(3)]
    size = [hi[i] - lo[i] for i in range(3)]

    # 1) 발을 넉넉히 감싸는 구 — 닫힌 도형이라 결과도 늘 닫힌 껍데기다.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=56, ring_count=36, location=(center[0], center[1], center[2]))
    shoe = ctx.active_object
    shoe.scale = (size[0] * 0.65, size[1] * 0.65, size[2] * 0.75)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    shoe.name = f"Shoes0_{side.upper()}_{label}"
    shoe.data.name = shoe.name

    # 2) 발 표면에서 --puff 만큼 띄워 감싼다 → 매끈하게 → 안으로 파고든 정점은 다시 밖으로.
    def wrap(offset):
        sw = shoe.modifiers.new("감싸기", "SHRINKWRAP")
        sw.target = foot
        sw.wrap_method = "NEAREST_SURFACEPOINT"
        sw.wrap_mode = "ON_SURFACE"
        sw.offset = offset
        apply_first(shoe, sw)

    select_only(shoe)
    wrap(args.puff)
    smooth = shoe.modifiers.new("매끈", "SMOOTH")
    smooth.factor = 0.5
    smooth.iterations = 10
    apply_first(shoe, smooth)
    wrap(args.puff)

    # 3) 밑창: 바닥 근처 정점을 아래로 눌러 평평하게, 발목 위는 잘라 입구를 낸다.
    Mw = shoe.matrix_world
    Minv = Mw.inverted()
    bm = bmesh.new()
    bm.from_mesh(shoe.data)
    bottom = floor - args.sole
    band = 0.014
    for v in bm.verts:
        p = Mw @ v.co
        if p.z < floor + band:
            t = max(0.0, (p.z - floor)) / band  # 0 = 바닥, 1 = 띠 위쪽
            p.z = bottom + (t * t) * (band + args.sole)
            v.co = Minv @ p
    # 입구·밑창 경계는 평면으로 자른다 — 정점을 높이로 골라 지우면 가장자리가 톱니가 된다.
    def cut(z, clear_outer):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Minv @ mathutils.Vector((0, 0, z)),
                               plane_no=(Minv.to_3x3() @ mathutils.Vector((0, 0, 1))).normalized(),
                               clear_outer=clear_outer, clear_inner=False)
    cut(floor + 0.004, False)  # 밑창 윗선
    cut(floor + args.collar, True)  # 입구
    bm.to_mesh(shoe.data)
    bm.free()

    # 4) 삼각형 수를 줄인다.
    shoe.data.calc_loop_triangles()
    tris = len(shoe.data.loop_triangles)
    if tris > args.tris:
        dec = shoe.modifiers.new("줄이기", "DECIMATE")
        dec.ratio = args.tris / tris
        apply_first(shoe, dec)
    shoe.data.validate(verbose=False)
    # 삭감·정리 과정에서 작은 구멍이 생길 수 있다(발등에 살이 비쳤다). 입구(collar 높이의
    # 경계)만 남기고 나머지 경계는 전부 메운다.
    bm = bmesh.new()
    bm.from_mesh(shoe.data)
    collar_z = floor + args.collar
    holes = [e for e in bm.edges if e.is_boundary
             and any(abs((Mw @ v.co).z - collar_z) > 0.002 for v in e.verts)]
    if holes:
        bmesh.ops.holes_fill(bm, edges=holes, sides=0)
        print(f"SHOES_HOLES {side} filled_edges={len(holes)}")
    bm.to_mesh(shoe.data)
    bm.free()
    for poly in shoe.data.polygons:
        poly.use_smooth = True

    # 5) 웨이트 — 몸에서 가장 가까운 정점의 것을 옮기고, 골격에 붙인다.
    for g in body.vertex_groups:
        shoe.vertex_groups.new(name=g.name)
    xfer = shoe.modifiers.new("웨이트", "DATA_TRANSFER")
    xfer.object = body
    xfer.use_vert_data = True
    xfer.data_types_verts = {"VGROUP_WEIGHTS"}
    xfer.vert_mapping = "NEAREST"
    xfer.layers_vgroup_select_src = "ALL"
    xfer.layers_vgroup_select_dst = "NAME"
    apply_first(shoe, xfer)
    # 신발은 발뼈(foot) 하나에 통째로 붙는다 — 게임 운동화는 발가락에서 굽지 않는다.
    # 발볼(ball) 웨이트까지 주면 걸을 때 발가락 관절이 껍데기를 뚫고 나왔다. 대신 런타임에서
    # 신발을 신었을 때 발볼 뼈를 줄여 발가락을 신발 안으로 접어 넣는다(치비게임아바타).
    for g in list(shoe.vertex_groups):
        if g.name != f"foot_{side}":
            shoe.vertex_groups.remove(g)
    shoe.vertex_groups[f"foot_{side}"].add(list(range(len(shoe.data.vertices))), 1.0, "REPLACE")
    shoe.parent = armature
    shoe.matrix_parent_inverse = armature.matrix_world.inverted()
    arm_mod = shoe.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = armature

    # 6) 재질 — 흰 갑피, 옅은 회색 밑창(면의 평균 높이로 가른다).
    shoe.data.materials.clear()
    upper = bpy.data.materials.new(f"Shoe_Upper_{label}")
    upper.use_nodes = True
    upper.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.93, 0.93, 0.93, 1)
    upper.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    sole = bpy.data.materials.new(f"Shoe_Sole_{label}")
    sole.use_nodes = True
    sole.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.72, 0.72, 0.74, 1)
    sole.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    shoe.data.materials.append(upper)
    shoe.data.materials.append(sole)
    sole_top = floor + 0.004
    for poly in shoe.data.polygons:
        z = (Mw @ poly.center).z
        poly.material_index = 1 if z < sole_top else 0

    # 7) 파츠 표식 — 아바타가 slot/variant 로 파츠를 켜고 끈다.
    shoe["slot"] = "shoes"
    shoe["variant"] = 0
    shoe["chibi_part"] = "shoes0"
    shoe["chibi_body"] = body.get("chibi_body", "")
    shoe["side"] = side

    bpy.data.objects.remove(foot, do_unlink=True)
    return shoe


shoes = [make_shoe("l"), make_shoe("r")]

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
