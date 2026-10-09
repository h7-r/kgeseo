# bake-textured-model.py — 텍스처를 그대로 살려 쓸 수 있게 면·텍스처만 줄인다.
#   쓰는 법:
#     Blender --background --factory-startup -t 6 \
#       --python naju01/tools/bake-textured-model.py -- \
#       --input ~/Downloads/some.glb --output naju01/assets/models/some-textured.glb \
#       --triangles 300000 --texture 2048
#   --convention lying(기본)|height|center · --size 0.8 (center 일 때 가장 긴 쪽)
#
# 수백 번 심는 것은 texture-to-vertex-colors.py 를 쓴다. 구렁이처럼 하나뿐인 것은
# 텍스처·노멀맵을 그대로 물려도 드로우콜 하나라 이 도구로 줄이기만 한다.

import bpy, sys, os
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return args[args.index(name) + 1] if name in args else default

input_path = os.path.expanduser(arg("--input"))
output_path = os.path.abspath(os.path.expanduser(arg("--output")))
target = int(arg("--triangles", "300000"))
convention = arg("--convention", "lying")
size_opt = float(arg("--size", "0.8"))
texture_size = int(arg("--texture", "2048"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("메시가 없다")
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
me = ob.data
print(f"  불러옴: {len(me.polygons):,} 면 · {len(me.vertices):,} 꼭짓점 · "
      f"재질 {len(ob.material_slots)}")


# 규약 맞추기 — Meshy 원본은 원점이 몸통 한가운데라 그대로면 절반이 땅에 박힌다.
# glTF Y = 블렌더 Z · glTF Z = −블렌더 Y 라 「glTF Z 폭 1」은 블렌더 Y 폭 1 이다.
def fit_convention(ob, convention, size=0.8):
    me = ob.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mn, mx = co.min(axis=0), co.max(axis=0)
    extent = mx - mn                      # 블렌더 X, Y, Z
    if convention == "height":                # glTF Y 폭 1 = 블렌더 Z 폭 1
        factor = 1.0 / max(extent[2], 1e-9)
    elif convention == "center":              # 가장 긴 쪽 = size
        factor = size / max(extent.max(), 1e-9)
    else:                             # lying — glTF Z 폭 1 = 블렌더 Y 폭 1
        factor = 1.0 / max(extent[1], 1e-9)
    co *= factor
    mn, mx = co.min(axis=0), co.max(axis=0)
    middle = (mn + mx) / 2
    if convention == "center":
        co -= middle                  # 한복판이 원점
    else:
        # 밑동(블렌더 Z 최소)을 0 으로, 나머지 두 축은 한복판
        co[:, 0] -= middle[0]
        co[:, 1] -= middle[1]
        co[:, 2] -= mn[2]
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    final = co.max(axis=0) - co.min(axis=0)
    print(f"  규약 «{convention}» 맞춤 — 블렌더 폭 "
          f"{final[0]:.4f} × {final[1]:.4f} × {final[2]:.4f} (배율 {factor:.5f})")
    print(f"    → glTF 폭 x {final[0]:.4f} · y {final[2]:.4f} · z {final[1]:.4f}")

# 텍스처 줄이기 — UV 는 그대로 두고 이미지만.
for image in list(bpy.data.images):
    if image.size[0] <= texture_size and image.size[1] <= texture_size:
        continue
    before = tuple(image.size)
    image.scale(texture_size, texture_size)
    print(f"  텍스처 줄임: {image.name or '(무명)'} {before[0]}×{before[1]} → {texture_size}×{texture_size}")

# 면 줄이기
current = len(me.polygons)
if target > 0 and current > target:
    ratio = target / current
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"  줄임: {current:,} → {len(me.polygons):,} 면 (비 {ratio:.4f})")

fit_convention(ob, convention, size_opt)

os.makedirs(os.path.dirname(output_path), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=True,       # UV 를 살린다 — 이 도구의 핵심
    export_materials="EXPORT",   # 재질·텍스처도 같이 내보낸다
    export_image_format="JPEG",  # 사진 같은 결이라 JPEG 가 훨씬 작다
    export_cameras=False,
    export_lights=False,
)
print(f"  → {output_path}  {os.path.getsize(output_path)/1024/1024:.1f} MB · "
      f"{len(bpy.context.view_layer.objects.active.data.polygons):,} 면")
