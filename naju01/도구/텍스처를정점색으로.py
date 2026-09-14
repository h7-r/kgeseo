# ═══════════════════════════════════════════════════════════════
#  텍스처를정점색으로.py — 텍스처 붙은 GLB 를 **정점 색**으로 옮겨 굽는다
# ═══════════════════════════════════════════════════════════════
#  쓰는 법:
#    Blender --background --factory-startup -t 6 \
#      --python naju01/도구/텍스처를정점색으로.py -- \
#      --입력 ~/Downloads/어떤.glb --출력 naju01/에셋/모형/어떤.glb --삼각형 300000
#
# [왜 필요한가]
#   이 프로젝트는 나무·바위·구렁이를 **인스턴스 무리**로 심는다. 무리는
#   지오메트리 하나를 수백 번 그리므로, 개체마다 텍스처를 물리면 묶음이
#   쪼개져 드로우콜이 폭발한다. 대신 재질이 이미 `vertexColors` 를 쓰므로
#   **색을 정점에 구워 두면** 그대로 꽂힌다.
#
# [왜 이게 큰 변화인가]
#   지금까지 Meshy 원본은 POSITION 하나뿐이라(실측: 초목·동물 40 개 전부)
#   색을 **코드가 추측해서** 칠했다. 「여기가 눈, 여기가 혀」를 기하로 찾는
#   일인데, 구렁이 눈 하나에 열 번 넘게 왕복하고도 좌우 대칭을 못 맞췄다.
#   색이 입혀져 오면 그 추측이 통째로 없어진다.
#
# [순서가 중요하다]
#   ① 원본 해상도에서 색을 뜬다 → ② 그 다음에 줄인다.
#   거꾸로 하면 줄인 꼭짓점에서만 색을 떠서 무늬가 뭉갠다.

import bpy, sys, os, math
import numpy as np

인자 = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def 값(이름, 기본=None):
    return 인자[인자.index(이름) + 1] if 이름 in 인자 else 기본

입력 = os.path.expanduser(값("--입력"))
출력 = os.path.abspath(os.path.expanduser(값("--출력")))
목표 = int(값("--삼각형", "300000"))
규약 = 값("--규약", "눕힘")
크기옵 = float(값("--크기", "0.8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=입력)

메시들 = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not 메시들:
    raise SystemExit("메시가 없다")
# 여러 조각이면 합친다 — 무리는 지오메트리 하나만 받는다
bpy.ops.object.select_all(action="DESELECT")
for o in 메시들:
    o.select_set(True)
bpy.context.view_layer.objects.active = 메시들[0]
if len(메시들) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
me = ob.data
print(f"  불러옴: {len(me.polygons):,} 면 · {len(me.vertices):,} 꼭짓점")



# ── 규약 맞추기 ─────────────────────────────────────────────
# ★ 이걸 빠뜨리면 **물건이 땅에 박힌다.** 기존 모형들은 정해진 규약으로
#   정규화해 굽는다(각 모듈 머리말에 적혀 있다). Meshy 원본은 원점이
#   몸통 한가운데라, 그대로 내보내면 절반이 땅속에 들어간다.
#   ※ 축이 바뀐다는 점을 조심해야 한다 — glTF 로 내보내면
#     glTF Y = 블렌더 Z · glTF Z = **−블렌더 Y** 다.
#     그래서 「glTF 기준 Z 폭 1」은 블렌더에서 **Y 폭 1** 이다.
def 규약맞추기(ob, 규약, 크기=0.8):
    import mathutils
    me = ob.data
    좌 = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", 좌)
    좌 = 좌.reshape(-1, 3)
    mn, mx = 좌.min(axis=0), 좌.max(axis=0)
    폭 = mx - mn                      # 블렌더 X, Y, Z
    if 규약 == "높이":                # glTF Y 폭 1 = 블렌더 Z 폭 1
        배 = 1.0 / max(폭[2], 1e-9)
    elif 규약 == "중심":              # 가장 긴 쪽 = 크기
        배 = 크기 / max(폭.max(), 1e-9)
    else:                             # 눕힘 — glTF Z 폭 1 = 블렌더 Y 폭 1
        배 = 1.0 / max(폭[1], 1e-9)
    좌 *= 배
    mn, mx = 좌.min(axis=0), 좌.max(axis=0)
    가운데 = (mn + mx) / 2
    if 규약 == "중심":
        좌 -= 가운데                  # 한복판이 원점
    else:
        # 밑동(블렌더 Z 최소)을 0 으로, 나머지 두 축은 한복판
        좌[:, 0] -= 가운데[0]
        좌[:, 1] -= 가운데[1]
        좌[:, 2] -= mn[2]
    me.vertices.foreach_set("co", 좌.ravel())
    me.update()
    끝 = 좌.max(axis=0) - 좌.min(axis=0)
    print(f"  규약 «{규약}» 맞춤 — 블렌더 폭 "
          f"{끝[0]:.4f} × {끝[1]:.4f} × {끝[2]:.4f} (배율 {배:.5f})")
    print(f"    → glTF 폭 x {끝[0]:.4f} · y {끝[2]:.4f} · z {끝[1]:.4f}")

# ── 베이스컬러 이미지 찾기 ──────────────────────────────────
def 바탕이미지(ob):
    """재질 노드에서 **베이스컬러**에 물린 이미지를 집는다.
    러프니스·노멀 맵도 같이 오므로 아무거나 집으면 회색 덩어리가 된다."""
    for 슬롯 in ob.material_slots:
        m = 슬롯.material
        if not m or not m.use_nodes:
            continue
        출 = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if 출:
            바탕 = 출.inputs.get("Base Color")
            if 바탕 and 바탕.is_linked:
                n = 바탕.links[0].from_node
                if n.type == "TEX_IMAGE" and n.image:
                    return n.image
        # 물려 있지 않으면 이미지 노드 중 첫 번째
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                return n.image
    return None


그림 = 바탕이미지(ob)
if 그림 is None:
    raise SystemExit("베이스컬러 이미지를 못 찾았다 — 텍스처 포함으로 받았는지 확인해라")
너비, 높이 = 그림.size
print(f"  텍스처: {그림.name or '(무명)'} {너비}×{높이}")

# 픽셀을 numpy 로 (RGBA float, 아래에서 위로 쌓여 있다)
픽 = np.empty(너비 * 높이 * 4, dtype=np.float32)
그림.pixels.foreach_get(픽)
픽 = 픽.reshape(높이, 너비, 4)

# ── UV 를 따라 색을 뜬다 ────────────────────────────────────
# [왜 루프 도메인인가]  UV 는 **면마다** 달려 있다(같은 꼭짓점도 면에 따라
#   UV 가 다를 수 있다 — 이음매). 루프에 색을 쓰면 이음매가 안 뭉갠다.
uv층 = me.uv_layers.active
if uv층 is None:
    raise SystemExit("UV 가 없다")
루프수 = len(me.loops)
uv = np.empty(루프수 * 2, dtype=np.float32)
uv층.data.foreach_get("uv", uv)
uv = uv.reshape(-1, 2)

# 이중선형으로 뜬다 — 최근접이면 저해상도 텍스처에서 계단이 보인다
u = np.clip(uv[:, 0], 0.0, 1.0) * (너비 - 1)
v = np.clip(uv[:, 1], 0.0, 1.0) * (높이 - 1)
x0 = np.floor(u).astype(np.int32); x1 = np.minimum(x0 + 1, 너비 - 1)
y0 = np.floor(v).astype(np.int32); y1 = np.minimum(y0 + 1, 높이 - 1)
fx = (u - x0)[:, None]; fy = (v - y0)[:, None]
위 = 픽[y0, x0, :3] * (1 - fx) + 픽[y0, x1, :3] * fx
아래 = 픽[y1, x0, :3] * (1 - fx) + 픽[y1, x1, :3] * fx
색 = 위 * (1 - fy) + 아래 * fy

# ★ **sRGB → 선형으로 바꾼다.** 여기서 한 번 틀렸다 —
#   「블렌더 픽셀은 이미 선형이니 그냥 쓰면 된다」고 적어 두고 넘어갔는데,
#   실제로 뜬 평균이 0.302/0.276/0.224 였다. 어두운 구렁이의 **선형**값이면
#   0.07 대여야 한다. 즉 sRGB 값이 그대로 나온 것이다.
#   그걸 three 가 선형으로 읽으니 밝기가 두 배 가까이 떠서, 짙은 올리브
#   구렁이가 **허연 뱀**으로 나왔다(사용자 지적).
#   ※ 블렌더가 무엇을 돌려주는지는 이미지의 colorspace 설정에 달렸다.
#     값으로 판단하는 편이 확실하다 — 평균이 0.3 대면 sRGB 다.
직 = np.clip(색, 0.0, 1.0)
선형 = np.where(직 <= 0.04045, 직 / 12.92, ((직 + 0.055) / 1.055) ** 2.4)
색4 = np.ones((루프수, 4), dtype=np.float32)
색4[:, :3] = 선형
층 = me.color_attributes.new(name="바탕색", type="FLOAT_COLOR", domain="CORNER")
층.data.foreach_set("color", 색4.ravel())
me.update()
print(f"  색 뜸: 루프 {루프수:,} 개 · sRGB 평균 "
      f"{np.mean(직[:, 0]):.3f}/{np.mean(직[:, 1]):.3f}/{np.mean(직[:, 2]):.3f}"
      f" → 선형 {np.mean(색4[:, 0]):.3f}/{np.mean(색4[:, 1]):.3f}/{np.mean(색4[:, 2]):.3f}")

# ── 줄이기 ──────────────────────────────────────────────────
#   ★ 색을 **뜬 다음에** 줄인다. 거꾸로 하면 줄인 꼭짓점에서만 색을 떠서
#     무늬가 뭉갠다. 데시메이트는 정점 색을 보간해 준다.
현재 = len(me.polygons)
if 목표 > 0 and 현재 > 목표:
    비 = 목표 / 현재
    모 = ob.modifiers.new("줄이기", "DECIMATE")
    모.decimate_type = "COLLAPSE"
    모.ratio = 비
    모.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=모.name)
    print(f"  줄임: {현재:,} → {len(me.polygons):,} 면 (비 {비:.4f})")

# 재질은 버린다 — 색은 이미 정점에 있고, 재질이 남으면 three 가 텍스처를 찾는다
ob.data.materials.clear()

규약맞추기(ob, 규약, 크기옵)

os.makedirs(os.path.dirname(출력), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=출력,
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
print(f"  → {출력}  {os.path.getsize(출력)/1024/1024:.1f} MB · "
      f"{len(bpy.context.view_layer.objects.active.data.polygons):,} 면")
