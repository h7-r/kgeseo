"""NAJU-01 전용 모듈형 아바타 초안 생성기.

현재 열려 있는 Blender 파일의 GAME_CLEAN_CHARACTER / GAME_SIMPLE_RIG를
읽기만 하며, 원본은 보존한 채 별도 .blend와 GLB를 만든다.
각 파츠는 같은 armature와 skinning을 공유하므로 R3F에서 이름 접두사로
Hair/Top/Bottom/Shoes를 하나씩 표시할 수 있다.
"""
import bpy
from pathlib import Path

OUT_BLEND = Path('/Users/derrick/Downloads/NAJU_modular_avatar_work.blend')
OUT_GLB = Path('/Users/derrick/Documents/GitHub/kgeseo/public/models/naju-modular-avatar.glb')

rig = bpy.data.objects.get('GAME_SIMPLE_RIG')
if not rig:
    raise RuntimeError('GAME_SIMPLE_RIG가 없습니다. 이 스크립트는 게임용 간단 리그 파일에서 실행해야 합니다.')

required = [
    'Game_Hair', 'Game_Torso', 'Game_UpperArm.L', 'Game_UpperArm.R',
    'Game_Forearm.L', 'Game_Forearm.R', 'Game_Hips', 'Game_Thigh.L',
    'Game_Thigh.R', 'Game_Shin.L', 'Game_Shin.R', 'Game_Foot.L', 'Game_Foot.R',
    'Game_Face', 'Game_Ear_L', 'Game_Ear_R', 'Game_Eye_L', 'Game_Eye_R',
    'Game_Hand.L', 'Game_Hand.R',
]
missing = [name for name in required if bpy.data.objects.get(name) is None]
if missing:
    raise RuntimeError('필요한 게임 파츠가 없습니다: ' + ', '.join(missing))

# 새 파일부터 만든다. 현재의 리토폴로지·고해상도 원본은 절대 덮어쓰지 않는다.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

old = bpy.data.collections.get('NAJU_AVATAR_OPTIONS')
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(old)
opts = bpy.data.collections.new('NAJU_AVATAR_OPTIONS')
bpy.context.scene.collection.children.link(opts)

def material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.72
    return mat

def copy_bound(source_name, name, mat):
    src = bpy.data.objects[source_name]
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = name
    obj.data.name = name + '_Mesh'
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    opts.objects.link(obj)
    obj.hide_set(False)
    obj.hide_render = False
    obj['naju_slot'] = name.split('_')[0]
    obj['naju_variant'] = int(name.split('_')[1])
    return obj

def bind_new(obj, bone_name, mat):
    obj.data.materials.append(mat)
    group = obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
    arm = obj.modifiers.new('Armature', 'ARMATURE')
    arm.object = rig
    opts.objects.link(obj)
    return obj

def sphere(name, location, scale, mat, bone='head'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    bind_new(obj, bone, mat)
    obj['naju_slot'] = 'Hair'
    obj['naju_variant'] = int(name.split('_')[1])
    return obj

def torus(name, location, major, minor, mat):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=20, minor_segments=8, location=location)
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.shade_smooth()
    bind_new(obj, 'spine', mat)
    return obj

hair_colors = [(0.10, 0.055, 0.025), (0.18, 0.08, 0.035), (0.035, 0.055, 0.09), (0.38, 0.19, 0.08)]
top_colors = [(0.12, 0.36, 0.78), (0.12, 0.54, 0.35), (0.70, 0.20, 0.17), (0.12, 0.13, 0.18)]
bottom_colors = [(0.06, 0.12, 0.24), (0.18, 0.22, 0.30), (0.30, 0.18, 0.10), (0.12, 0.27, 0.20)]
shoe_colors = [(0.94, 0.94, 0.92), (0.07, 0.08, 0.10), (0.50, 0.12, 0.10), (0.10, 0.30, 0.46)]

# 기존 게임용 파츠는 이 파일에서만 숨기고, 같은 리그를 쓰는 선택 파츠로 바꾼다.
replace = required[:13]
for name in replace:
    bpy.data.objects[name].hide_set(True)
    bpy.data.objects[name].hide_render = True

# Hair_01은 기존 헤어 실루엣, 02~04는 번·포니테일·짧은 머리의 간결한 실루엣이다.
copy_bound('Game_Hair', 'Hair_01_Main', material('Hair_01', hair_colors[0]))
copy_bound('Game_Hair', 'Hair_02_Main', material('Hair_02', hair_colors[1]))
copy_bound('Game_Hair', 'Hair_03_Main', material('Hair_03', hair_colors[2]))
copy_bound('Game_Hair', 'Hair_04_Main', material('Hair_04', hair_colors[3]))
sphere('Hair_02_Cap', (0, 0.045, 0.48), (0.36, 0.31, 0.36), material('Hair_02', hair_colors[1]))
sphere('Hair_02_Bun_L', (0.31, 0.06, 0.48), (0.12, 0.10, 0.12), material('Hair_02', hair_colors[1]))
sphere('Hair_02_Bun_R', (-0.31, 0.06, 0.48), (0.12, 0.10, 0.12), material('Hair_02', hair_colors[1]))
sphere('Hair_03_Cap', (0, 0.045, 0.48), (0.35, 0.30, 0.33), material('Hair_03', hair_colors[2]))
sphere('Hair_03_Ponytail', (0, 0.24, 0.36), (0.13, 0.12, 0.24), material('Hair_03', hair_colors[2]))
sphere('Hair_04_Short', (0, 0.02, 0.50), (0.34, 0.29, 0.30), material('Hair_04', hair_colors[3]))

top_sources = ['Game_Torso', 'Game_UpperArm.L', 'Game_UpperArm.R', 'Game_Forearm.L', 'Game_Forearm.R']
bottom_sources = ['Game_Hips', 'Game_Thigh.L', 'Game_Thigh.R', 'Game_Shin.L', 'Game_Shin.R']
shoe_sources = ['Game_Foot.L', 'Game_Foot.R']
for i, color in enumerate(top_colors, 1):
    mat = material(f'Top_{i:02d}', color)
    for source in top_sources:
        copy_bound(source, f'Top_{i:02d}_{source[5:]}', mat)
    # 옷깃 하나만으로도 셔츠/후드의 실루엣 구분이 보이게 한다.
    collar = torus(f'Top_{i:02d}_Collar', (0, -0.01, 0.05), 0.115 + (i % 2) * 0.016, 0.018 + (i == 2) * 0.01, mat)
    collar['naju_slot'] = 'Top'; collar['naju_variant'] = i
for i, color in enumerate(bottom_colors, 1):
    mat = material(f'Bottom_{i:02d}', color)
    for source in bottom_sources:
        copy_bound(source, f'Bottom_{i:02d}_{source[5:]}', mat)
for i, color in enumerate(shoe_colors, 1):
    mat = material(f'Shoes_{i:02d}', color)
    for source in shoe_sources:
        copy_bound(source, f'Shoes_{i:02d}_{source[5:]}', mat)

# 내보낼 때 쓰는 선택 정보. R3F는 이 접두사들을 보고 한 벌씩만 표시한다.
rig['naju_avatar_slots'] = 'Hair_01..04, Top_01..04, Bottom_01..04, Shoes_01..04'
rig['naju_avatar_version'] = 1

for obj in bpy.context.scene.objects:
    if obj.name.startswith('LAST_') or obj.name == 'Mesh_0':
        obj.hide_set(True)
        obj.hide_render = True

bpy.ops.object.select_all(action='DESELECT')
for name in ['Game_Face', 'Game_Ear_L', 'Game_Ear_R', 'Game_Eye_L', 'Game_Eye_R', 'Game_Hand.L', 'Game_Hand.R']:
    obj = bpy.data.objects[name]
    obj.hide_set(False)
    obj.hide_render = False
    obj.select_set(True)
for obj in opts.objects:
    obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig

OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT_GLB),
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_all_influences=True,
    export_apply=False,
)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
print('NAJU_MODULAR_AVATAR_READY', OUT_BLEND, OUT_GLB, OUT_GLB.stat().st_size)
