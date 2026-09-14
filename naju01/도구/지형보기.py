# ═══════════════════════════════════════════════════════════════
#  지형보기.py — 구운 지형 GLB 를 블렌더에서 몇 각도로 찍는다
# ═══════════════════════════════════════════════════════════════
#  쓰는 법:
#    Blender --background --factory-startup -t 6 --python 도구/지형보기.py \
#      -- --glb 에셋/지형.glb --out /tmp/지형보기
#
# [왜 따로 있나]
#   숫자로만 검수하면 「규격은 맞는데 흉한 땅」이 나온다. 실제로 이번에
#   대지 평탄도·통로 오차가 전부 0 인데도 형태를 안 본 채로 넘어갈 뻔했다.
#   게임에 올리기 전에 여기서 먼저 본다 — 블렌더 안이라 왕복이 짧다.
#
# [워크벤치로 찍는다]
#   재질이 아직 없으므로 Cycles/EEVEE 는 의미가 없다. 워크벤치의
#   「스터디오 조명 + 그림자 + 캐비티」가 지형 형태를 가장 잘 보여 준다.

import bpy, sys, os, math
from mathutils import Vector

인자 = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def 값(이름, 기본):
    return 인자[인자.index(이름) + 1] if 이름 in 인자 else 기본

GLB = os.path.abspath(값("--glb", "에셋/지형.glb"))
OUT = os.path.abspath(값("--out", "/tmp/지형보기"))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

땅 = next(o for o in bpy.context.scene.objects if o.type == "MESH")
print(f"  불러옴: {땅.name} · {len(땅.data.polygons):,} 면")

# 불러온 GLB 는 Y-up → 블렌더 Z-up 으로 돌아온다. 경계로 확인한다.
bb = [땅.matrix_world @ Vector(c) for c in 땅.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
print(f"  경계  X {mn.x:.1f}~{mx.x:.1f} · Y {mn.y:.1f}~{mx.y:.1f} · Z {mn.z:.1f}~{mx.z:.1f}")

씬 = bpy.context.scene
씬.render.engine = "BLENDER_WORKBENCH"
씬.render.resolution_x, 씬.render.resolution_y = 1000, 620
씬.render.film_transparent = False
sh = 씬.display.shading
sh.light = "STUDIO"
sh.color_type = "SINGLE"
sh.single_color = (0.62, 0.58, 0.50)
sh.show_shadows = True
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.curvature_ridge_factor = 1.4
sh.curvature_valley_factor = 1.4
sh.shadow_intensity = 0.55

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam = bpy.data.objects.new("cam", cam_d)
씬.collection.objects.link(cam)
씬.camera = cam

def 겨냥(눈, 봄):
    """게임 좌표(x, 높이, z)로 받아 블렌더 좌표로 옮긴다.
    ★ 부호를 빠뜨리기 쉽다. glTF 를 블렌더로 불러오면
      블렌더 X = glTF X · 블렌더 Y = **−glTF Z** · 블렌더 Z = glTF Y 다.
      게임 z 가 0~50 인데 블렌더에서는 **−50~0** 으로 앉는다(경계로 확인했다).
      여기서 −를 빼먹으면 카메라가 땅 반대편을 본다."""
    e = Vector((눈[0], -눈[2], 눈[1]))
    l = Vector((봄[0], -봄[2], 봄[1]))
    cam.location = e
    d = (l - e).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

# ※ 02 는 눈을 (45,10,44) 에 뒀다가 화면이 **통짜 회색**으로 나왔다.
#   메시 안에 들어간 게 아니라, 17 m 앞의 22 m 짜리 절벽 면이 화각을
#   가득 채운 것이었다. 절벽은 「얼마나 서 있나」를 보려는 컷이므로
#   옆에서·멀리서 봐야 한다.
컷 = [
    ("01_전경",      (40, 52, 105), (40, 4, 26)),
    ("02_절벽",      (30, 16, 52),  (46, 7, 28)),
    ("03_T4비탈",    (6, 16, 14),   (26, 6, 29)),
    ("04_T3스위치백", (78, 22, -6),  (58, 10, 9)),
    ("05_나루터",    (10, 4, 48),   (24, 1, 36)),
    ("06_Z3서쪽어깨", (14, 10, 40),  (36, 9, 20)),
]
for 이름, 눈, 봄 in 컷:
    겨냥(눈, 봄)
    씬.render.filepath = os.path.join(OUT, 이름 + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"  찍음 {이름}")
print("  →", OUT)
