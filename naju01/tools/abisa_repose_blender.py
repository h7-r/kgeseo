"""
아비사 자세 다시 굽기(11/8) — A자세 Meshy 원본(abisa.glb)에 뼈를 심어 손을 아랫배 앞에 모은 자세(공수)로 굽고 정지 GLB 로 낸다.

  /Applications/Blender.app/Contents/MacOS/Blender -b --python naju01/tools/abisa_repose_blender.py -- \
      naju01/assets/models/abisa.glb naju01/assets/models/abisa-pose.glb /tmp/abisa-pose

  - 마지막 인자는 확인용 그림(앞 · 옆 · 비스듬히) 이름 앞머리.
  - 원본은 UV 이음매마다 점이 갈라져 있어 그대로는 자동 뼈 무게(열 확산)가 통째로 실패한다 → 같은 자리 점을 먼저 잇는다(UV 는 면 모서리에 있어 안 깨진다).
  - 손이 쉬던 자리 근처의 치마 아랫단에 팔 무게가 묻어 손을 모으면 치마가 오므라든다 → 손보다 아래(높이 0.34~0.47)만 부드럽게 걷고
    무게를 이웃끼리 고른다. 점마다 0/1 로 가르면(소매 · 치마 구분) 이웃끼리 찢어진다 — 해 보고 버린 길.
  - 좌표: glTF(x, y=위, z=앞) → 블렌더(x, −z, y). 키 1 규약.
"""
import bpy, sys, math
from mathutils import Vector, Matrix, Quaternion
argv = sys.argv[sys.argv.index("--")+1:]
src, out_glb, out_prefix = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
mesh = [o for o in scene.objects if o.type == 'MESH'][0]
for o in list(scene.objects):
    if o != mesh and o.type != 'MESH': pass
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# 떨어진 조각 · 겹친 점을 잇는다 — 뼈 무게(열 확산)가 닫힌 면을 요구한다
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0006)
bpy.ops.object.mode_set(mode='OBJECT')
print("AFTER_MERGE verts", len(mesh.data.vertices))
def B(x, y, z): return Vector((x, -z, y))   # glTF -> Blender
arm_data = bpy.data.armatures.new("rig"); arm = bpy.data.objects.new("rig", arm_data); scene.collection.objects.link(arm)
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
def bone(name, h, t, parent=None):
    b = arm_data.edit_bones.new(name); b.head = B(*h); b.tail = B(*t); b.roll = 0
    if parent: b.parent = arm_data.edit_bones[parent]
    return b
bone("hips", (0, 0.05, 0), (0, 0.55, 0))
bone("spine", (0, 0.55, 0), (0, 0.72, 0), "hips")
bone("chest", (0, 0.72, 0), (0, 0.80, 0), "spine")
bone("neck", (0, 0.80, 0), (0, 0.87, 0), "chest")
bone("head", (0, 0.87, 0), (0, 1.0, 0), "neck")
for s, side in ((1, "L"), (-1, "R")):
    bone(f"shoulder.{side}", (s*0.03, 0.775, 0), (s*0.105, 0.77, 0), "chest")
    bone(f"upper_arm.{side}", (s*0.105, 0.77, 0), (s*0.155, 0.615, 0.0), f"shoulder.{side}")
    bone(f"forearm.{side}", (s*0.155, 0.615, 0.0), (s*0.212, 0.47, 0.015), f"upper_arm.{side}")
    bone(f"hand.{side}", (s*0.212, 0.47, 0.015), (s*0.225, 0.425, 0.02), f"forearm.{side}")
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# 치마 · 몸통에 묻은 팔 무게를 걷어 hips 로 — 손을 앞으로 모을 때 치마가 따라 오므라들지 않게
def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
arm_groups = {vg.index for vg in mesh.vertex_groups if any(k in vg.name for k in ("shoulder", "upper_arm", "forearm", "hand"))}
hips = mesh.vertex_groups["hips"]; spine = mesh.vertex_groups["spine"]
moved = 0
for v in mesh.data.vertices:
    x, h = abs(v.co.x), v.co.z
    # 몸을 향한 면(소매 안쪽) — 법선이 몸 가운데 쪽이면 팔에 붙여 둔다. 바깥을 향하면 치마 · 몸통 옆면
    # 치마 아랫단(손보다 아래)만 높이로 부드럽게 걷는다 — 칸마다 0/1 로 가르면 이웃 점끼리 찢어진다
    f = smoothstep(0.34, 0.47, h)
    if f >= 0.999: continue
    removed = 0.0
    for g in v.groups:
        if g.group in arm_groups:
            nw = g.weight * f; removed += g.weight - nw; g.weight = nw
    if removed > 1e-4:
        (hips if h < 0.6 else spine).add([v.index], removed, 'ADD'); moved += 1
print("MOVED", moved)
# 무게를 이웃끼리 고르게 — 경계에서 찢어지지 않게
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
# 무게 확인
counts = {}
for vg in mesh.vertex_groups: counts[vg.name] = 0
for v in mesh.data.vertices:
    for g in v.groups:
        if g.weight > 0.05: counts[mesh.vertex_groups[g.group].name] += 1
print("WEIGHTS", counts, "verts", len(mesh.data.vertices))
# 자세 — 팔을 내려 손을 아랫배 앞에 모은다(공수)
targets = {}
for s, side in ((1, "L"), (-1, "R")):
    elbow = B(s*0.095, 0.615, 0.075)
    hand = B(s*0.02, 0.53, 0.135)
    tip = B(s*-0.005, 0.515, 0.145)
    targets[side] = (elbow, hand, tip)
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
def aim(pb, target):
    bpy.context.view_layer.update()
    head = pb.matrix.to_translation()
    cur_dir = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
    want = (target - head).normalized()
    rot = cur_dir.rotation_difference(want).to_matrix().to_4x4()
    m = pb.matrix.copy()
    loc = m.to_translation()
    m = Matrix.Translation(loc) @ rot @ Matrix.Translation(-loc) @ m
    pb.matrix = m
    bpy.context.view_layer.update()
for side in ("L", "R"):
    elbow, hand, tip = targets[side]
    aim(arm.pose.bones[f"upper_arm.{side}"], elbow)
    aim(arm.pose.bones[f"forearm.{side}"], hand)
    aim(arm.pose.bones[f"hand.{side}"], tip)
bpy.ops.object.mode_set(mode='OBJECT')
# 자세를 메시에 굽는다
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
for mod in mesh.modifiers:
    if mod.type == 'ARMATURE': bpy.ops.object.modifier_apply(modifier=mod.name)
mesh.parent = None
bpy.data.objects.remove(arm)
for vg in list(mesh.vertex_groups): mesh.vertex_groups.remove(vg)
# 렌더
import mathutils
bb = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb))); mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
center = (mn+mx)/2; size = max(mx-mn)
scene.render.engine = 'BLENDER_WORKBENCH'; scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'TEXTURE'
scene.view_settings.view_transform = 'Standard'; scene.render.resolution_x = 600; scene.render.resolution_y = 600
scene.world = bpy.data.worlds.new("w")
cd = bpy.data.cameras.new("c"); cd.type = 'ORTHO'; cd.ortho_scale = size*1.15
cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
for name, d in {"front": (0,-1,0), "side": (1,0,0), "q": (0.7,-0.7,0.25)}.items():
    d = Vector(d).normalized(); cam.location = center + d*size*3; cam.rotation_euler = (-d).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = f"{out_prefix}_{name}.png"; bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_glb, use_selection=True, export_format='GLB')
print("BOUNDS", tuple(mn), tuple(mx))
