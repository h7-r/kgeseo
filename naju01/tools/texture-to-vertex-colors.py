# texture-to-vertex-colors.py — 텍스처 붙은 GLB 를 정점 색으로 옮겨 굽는다.
#   쓰는 법:
#     Blender --background --factory-startup -t 6 \
#       --python naju01/tools/texture-to-vertex-colors.py -- \
#       --input ~/Downloads/some.glb --output naju01/assets/models/some.glb --triangles 300000
#   --convention lying(기본)|height|center · --size 0.8 (center 일 때 가장 긴 쪽)
#
# 나무·바위처럼 인스턴스 무리로 심는 것은 개체마다 텍스처를 물리면 묶음이 쪼개진다.
# 재질이 이미 vertexColors 를 쓰므로 색을 정점에 구워 두면 그대로 꽂힌다.
# 원본 해상도에서 색을 뜬 다음에 줄인다(거꾸로면 무늬가 뭉개진다).

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

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("메시가 없다")
# 여러 조각이면 합친다 — 무리는 지오메트리 하나만 받는다
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
me = ob.data
print(f"  불러옴: {len(me.polygons):,} 면 · {len(me.vertices):,} 꼭짓점")


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


def base_color_image(ob):
    """재질에서 베이스컬러에 물린 이미지 — 러프니스·노멀 맵을 집으면 회색 덩어리가 된다."""
    for slot in ob.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            base = bsdf.inputs.get("Base Color")
            if base and base.is_linked:
                n = base.links[0].from_node
                if n.type == "TEX_IMAGE" and n.image:
                    return n.image
        # 물려 있지 않으면 이미지 노드 중 첫 번째
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                return n.image
    return None


image = base_color_image(ob)
if image is None:
    raise SystemExit("베이스컬러 이미지를 못 찾았다 — 텍스처 포함으로 받았는지 확인해라")
width, height = image.size
print(f"  텍스처: {image.name or '(무명)'} {width}×{height}")

# 픽셀을 numpy 로 (RGBA float, 아래에서 위로 쌓여 있다)
pixels = np.empty(width * height * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
pixels = pixels.reshape(height, width, 4)

# UV 는 면마다 달려 있어(이음매) 루프 도메인에 색을 쓴다
uv_layer = me.uv_layers.active
if uv_layer is None:
    raise SystemExit("UV 가 없다")
loop_count = len(me.loops)
uv = np.empty(loop_count * 2, dtype=np.float32)
uv_layer.data.foreach_get("uv", uv)
uv = uv.reshape(-1, 2)

# 이중선형으로 뜬다 — 최근접이면 저해상도 텍스처에서 계단이 보인다
u = np.clip(uv[:, 0], 0.0, 1.0) * (width - 1)
v = np.clip(uv[:, 1], 0.0, 1.0) * (height - 1)
x0 = np.floor(u).astype(np.int32); x1 = np.minimum(x0 + 1, width - 1)
y0 = np.floor(v).astype(np.int32); y1 = np.minimum(y0 + 1, height - 1)
fx = (u - x0)[:, None]; fy = (v - y0)[:, None]
top = pixels[y0, x0, :3] * (1 - fx) + pixels[y0, x1, :3] * fx
bottom = pixels[y1, x0, :3] * (1 - fx) + pixels[y1, x1, :3] * fx
color = top * (1 - fy) + bottom * fy

# sRGB → 선형. 블렌더가 돌려주는 픽셀 값은 sRGB 라 안 바꾸면 허옇게 뜬다.
clamped = np.clip(color, 0.0, 1.0)
linear = np.where(clamped <= 0.04045, clamped / 12.92, ((clamped + 0.055) / 1.055) ** 2.4)
color4 = np.ones((loop_count, 4), dtype=np.float32)
color4[:, :3] = linear
layer = me.color_attributes.new(name="baseColor", type="FLOAT_COLOR", domain="CORNER")
layer.data.foreach_set("color", color4.ravel())
me.update()
print(f"  색 뜸: 루프 {loop_count:,} 개 · sRGB 평균 "
      f"{np.mean(clamped[:, 0]):.3f}/{np.mean(clamped[:, 1]):.3f}/{np.mean(clamped[:, 2]):.3f}"
      f" → 선형 {np.mean(color4[:, 0]):.3f}/{np.mean(color4[:, 1]):.3f}/{np.mean(color4[:, 2]):.3f}")

# 줄이기 — 색을 뜬 다음에. 데시메이트가 정점 색을 보간해 준다.
current = len(me.polygons)
if target > 0 and current > target:
    ratio = target / current
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"  줄임: {current:,} → {len(me.polygons):,} 면 (비 {ratio:.4f})")

# 재질은 버린다 — 색은 이미 정점에 있고, 재질이 남으면 three 가 텍스처를 찾는다
ob.data.materials.clear()

fit_convention(ob, convention, size_opt)

os.makedirs(os.path.dirname(output_path), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=False,      # UV 는 더 안 쓴다 — 색이 정점에 있다
    export_vertex_color="MATERIAL",
    export_materials="NONE",
    export_cameras=False,
    export_lights=False,
)
print(f"  → {output_path}  {os.path.getsize(output_path)/1024/1024:.1f} MB · "
      f"{len(bpy.context.view_layer.objects.active.data.polygons):,} 면")
