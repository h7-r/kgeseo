"""모듈형 아바타의 안전한 Idle/Walk/Run 루프.

팔을 넓게 벌리는 Meshy Running 동작은 사용하지 않는다. 몸통은 spine만,
팔다리는 각자 뼈대만 움직이는 구조라 가슴/배가 함께 찢어지는 일이 없다.
"""
import bpy
from pathlib import Path

rig = bpy.data.objects.get('GAME_SIMPLE_RIG')
opts = bpy.data.collections.get('NAJU_AVATAR_OPTIONS')
if not rig or not opts:
    raise RuntimeError('NAJU 모듈형 아바타 파일에서 실행해야 합니다.')

# ── 저장소 뿌리를 스스로 찾는다 ──────────────────────────────
#   [왜]  예전에는 `/Users/derrick/...` 절대경로를 박아 뒀다. 그러면
#     ① 그 기기에서만 돌고,
#     ② 내보낸 GLB 가 저장소 **밖**에 떨어져도 `git status` 에 안 떠서
#        아무도 빠진 걸 모른다.
#     실제로 그렇게 됐다 — naju01 이 부르는 아바타 GLB 3 개가 미추적으로
#     남아, 다른 사람 기기에서 vite 가 404 대신 index.html 을 돌려주고
#     GLTF 로더가 그 HTML 을 파싱하다 터져서 **페이지가 통째로 멈췄다.**
#     (`Unexpected token '<', "<!doctype "...`)
#   이제 이 파일 위치에서 뿌리를 되짚으므로, 내보내는 순간 git status 에 뜬다.
뿌리 = Path(__file__).resolve().parents[2]   # naju01/도구/이파일.py → 저장소 뿌리
OUT = 뿌리 / "public/models/naju-modular-avatar.glb"

def reset():
    for p in rig.pose.bones:
        p.rotation_mode = 'XYZ'
        p.rotation_euler = (0, 0, 0)
        p.location = (0, 0, 0)

def make_action(name):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    action = bpy.data.actions.new(name)
    if not rig.animation_data:
        rig.animation_data_create()
    rig.animation_data.action = action
    return action

def pose(frame, rotations):
    for name, xyz in rotations.items():
        p = rig.pose.bones[name]
        p.rotation_euler = xyz
        p.keyframe_insert(data_path='rotation_euler', frame=frame)

def loop(name, run=False):
    action = make_action(name)
    reset()
    amp_leg = 0.60 if run else 0.38
    amp_arm = 0.52 if run else 0.30
    elbow = 0.52 if run else 0.18
    # 발이 닿는 순간 → 반대발이 닿는 순간 → 처음으로 돌아오는 24 fps 루프.
    # 몸통 기울임은 작게 제한해 배와 가슴의 경계가 꺾이지 않게 한다.
    frames = [(1, 1), (7, 0), (13, -1), (19, 0), (25, 1)]
    for f, phase in frames:
        left = amp_leg * phase
        right = -left
        arm_l = -amp_arm * phase
        arm_r = amp_arm * phase
        pose(f, {
            'root': (0, 0, 0),
            'spine': (0.025 if run else 0.012, 0, 0),
            'head': (0, 0, 0),  # 고개를 숙이지 않는다.
            'upper_arm.L': (arm_l, 0, -0.06),
            'upper_arm.R': (arm_r, 0, 0.06),
            'forearm.L': (-elbow, 0, 0),
            'forearm.R': (-elbow, 0, 0),
            'thigh.L': (left, 0, 0),
            'thigh.R': (right, 0, 0),
            'shin.L': (max(0, -left) * 0.75, 0, 0),
            'shin.R': (max(0, -right) * 0.75, 0, 0),
            'foot.L': (-left * 0.24, 0, 0),
            'foot.R': (-right * 0.24, 0, 0),
        })
    action.frame_range = (1, 25)
    # Blender 5의 layered Action API는 fcurves 컬렉션을 항상 노출하지 않는다.
    # 기본 보간도 충분히 부드럽고, 내보낸 GLB에서는 정상 샘플링된다.
    return action

# 서 있을 때도 시선·팔이 중립에서 안정적이다.
idle = make_action('Idle')
reset()
pose(1, {'spine': (0, 0, 0), 'head': (0, 0, 0), 'upper_arm.L': (0, 0, -0.04), 'upper_arm.R': (0, 0, 0.04)})
pose(31, {'spine': (0.012, 0, 0), 'head': (0, 0, 0), 'upper_arm.L': (0.012, 0, -0.04), 'upper_arm.R': (0.012, 0, 0.04)})
pose(61, {'spine': (0, 0, 0), 'head': (0, 0, 0), 'upper_arm.L': (0, 0, -0.04), 'upper_arm.R': (0, 0, 0.04)})
idle.frame_range = (1, 61)
walk = loop('Walk', run=False)
run = loop('Run', run=True)

rig.animation_data.action = idle
reset()
bpy.context.scene.frame_set(1)

# GLB에는 네 벌 전부를 담고, R3F가 이름 접두사로 한 벌만 보이게 한다.
bpy.ops.object.select_all(action='DESELECT')
exported = []
hidden_state = {obj: obj.hide_get() for obj in opts.objects}
# Blender glTF exporter는 선택돼 있어도 viewport에서 숨긴 객체를 제외한다.
# 네 벌 모두 내보낸 뒤, 작업 파일 화면에는 01번만 다시 보이게 복원한다.
for obj in opts.objects:
    obj.hide_set(False)
for name in ['Game_Face', 'Game_Ear_L', 'Game_Ear_R', 'Game_Eye_L', 'Game_Eye_R', 'Game_Hand.L', 'Game_Hand.R']:
    obj = bpy.data.objects[name]
    obj.select_set(True)
    exported.append(obj)
for obj in opts.objects:
    obj.select_set(True)
    exported.append(obj)
# glTF는 Armature modifier만 있는 느슨한 메쉬를 경고와 함께 내보낸다.
# 부모를 명시하면 skin과 모든 액션이 같은 뼈대를 확실히 참조한다.
for obj in exported:
    if obj.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers):
        obj.parent = rig
        obj.matrix_parent_inverse = rig.matrix_world.inverted()
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_all_influences=True,
    export_apply=False,
)
for obj, was_hidden in hidden_state.items():
    obj.hide_set(was_hidden)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print('NAJU_AVATAR_ANIMATIONS_READY', OUT, OUT.stat().st_size)
