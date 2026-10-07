# view-terrain.py — 구운 지형 GLB 를 블렌더에서 몇 각도로 찍는다.
#   쓰는 법:
#     Blender --background --factory-startup -t 6 --python naju01/tools/view-terrain.py \
#       -- --glb assets/terrain.glb --out /tmp/view-terrain
#
# 숫자 검수만으로는 「규격은 맞는데 흉한 땅」을 못 잡아 게임에 올리기 전에 형태를 본다.
# 재질이 아직 없으니 워크벤치(스튜디오 조명 + 그림자 + 캐비티)가 형태를 가장 잘 보여 준다.

import bpy, sys, os, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return args[args.index(name) + 1] if name in args else default

GLB = os.path.abspath(arg("--glb", "assets/terrain.glb"))
OUT = os.path.abspath(arg("--out", "/tmp/view-terrain"))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

ground = next(o for o in bpy.context.scene.objects if o.type == "MESH")
print(f"  불러옴: {ground.name} · {len(ground.data.polygons):,} 면")

# 불러온 GLB 는 Y-up → 블렌더 Z-up 으로 돌아온다. 경계로 확인한다.
bb = [ground.matrix_world @ Vector(c) for c in ground.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
print(f"  경계  X {mn.x:.1f}~{mx.x:.1f} · Y {mn.y:.1f}~{mx.y:.1f} · Z {mn.z:.1f}~{mx.z:.1f}")

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = 1000, 620
scene.render.film_transparent = False
sh = scene.display.shading
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
scene.collection.objects.link(cam)
scene.camera = cam

def aim(eye, target):
    """게임 좌표(x, 높이, z)를 블렌더 좌표로 — 블렌더 Y = −게임 z 라 부호를 빠뜨리면 반대편을 본다."""
    e = Vector((eye[0], -eye[2], eye[1]))
    l = Vector((target[0], -target[2], target[1]))
    cam.location = e
    d = (l - e).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

# 절벽 컷은 옆에서·멀리서 — 가까우면 절벽 면이 화각을 채워 통짜 회색이 된다.
shots = [
    ("01_overview",      (40, 52, 105), (40, 4, 26)),
    ("02_cliff",      (30, 16, 52),  (46, 7, 28)),
    ("03_T4-slope",    (6, 16, 14),   (26, 6, 29)),
    ("04_T3-switchback", (78, 22, -6),  (58, 10, 9)),
    ("05_ferry",    (10, 4, 48),   (24, 1, 36)),
    ("06_Z3-west-shoulder", (14, 10, 40),  (36, 9, 20)),
]
for name, eye, target in shots:
    aim(eye, target)
    scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"  찍음 {name}")
print("  →", OUT)
