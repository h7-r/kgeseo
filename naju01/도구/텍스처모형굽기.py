# ═══════════════════════════════════════════════════════════════
#  텍스처모형굽기.py — 텍스처를 **그대로 살려** 쓸 수 있게 줄인다
# ═══════════════════════════════════════════════════════════════
#  쓰는 법:
#    Blender --background --factory-startup -t 6 \
#      --python naju01/도구/텍스처모형굽기.py -- \
#      --입력 ~/Downloads/어떤.glb --출력 naju01/에셋/모형/어떤-텍스처.glb \
#      --삼각형 300000 --텍스처 2048
#
# [왜 `텍스처를정점색으로.py` 와 따로 있나]
#   그쪽은 **인스턴스로 수백 번 심는 것**(나무·수풀·바위)을 위한 길이다.
#   무리는 지오메트리 하나를 공유하므로 개체마다 텍스처를 물리면 묶음이
#   쪼개진다. 그래서 색을 정점에 구워 넣는다 — 대신 텍스처의 디테일과
#   노멀맵이 죽는다.
#
#   구렁이처럼 **한 마리뿐인 것**은 그 제약을 따를 이유가 없다. 텍스처를
#   그대로 물리면 Meshy 에서 본 그 모습이 그대로 나온다(노멀맵이 살아 비늘
#   요철도 빛을 받는다). 드로우콜 하나 더 쓰는 값이 전부다.
#
# [무엇이 무거웠나]
#   받은 파일이 104 MB 인데, 그건 **8192×8192 텍스처 3 장** 때문이지 면
#   수 때문이 아니다. 2048 로 줄이면 눈에 띄는 차이 없이 1/16 이 된다.

import bpy, sys, os
import numpy as np

인자 = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def 값(이름, 기본=None):
    return 인자[인자.index(이름) + 1] if 이름 in 인자 else 기본

입력 = os.path.expanduser(값("--입력"))
출력 = os.path.abspath(os.path.expanduser(값("--출력")))
목표 = int(값("--삼각형", "300000"))
규약 = 값("--규약", "눕힘")
크기옵 = float(값("--크기", "0.8"))
텍크기 = int(값("--텍스처", "2048"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=입력)

메시들 = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not 메시들:
    raise SystemExit("메시가 없다")
bpy.ops.object.select_all(action="DESELECT")
for o in 메시들:
    o.select_set(True)
bpy.context.view_layer.objects.active = 메시들[0]
if len(메시들) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
me = ob.data
print(f"  불러옴: {len(me.polygons):,} 면 · {len(me.vertices):,} 꼭짓점 · "
      f"재질 {len(ob.material_slots)}")


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

# ── 텍스처 줄이기 ───────────────────────────────────────────
#   ★ UV 는 그대로 두고 **이미지만** 줄인다. 8192 는 이 크기의 물건에
#     과하다 — 2 m 짜리 뱀이 화면에서 차지하는 픽셀보다 텍셀이 많다.
for 그림 in list(bpy.data.images):
    if 그림.size[0] <= 텍크기 and 그림.size[1] <= 텍크기:
        continue
    앞 = tuple(그림.size)
    그림.scale(텍크기, 텍크기)
    print(f"  텍스처 줄임: {그림.name or '(무명)'} {앞[0]}×{앞[1]} → {텍크기}×{텍크기}")

# ── 면 줄이기 ───────────────────────────────────────────────
현재 = len(me.polygons)
if 목표 > 0 and 현재 > 목표:
    비 = 목표 / 현재
    모 = ob.modifiers.new("줄이기", "DECIMATE")
    모.decimate_type = "COLLAPSE"
    모.ratio = 비
    모.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=모.name)
    print(f"  줄임: {현재:,} → {len(me.polygons):,} 면 (비 {비:.4f})")

규약맞추기(ob, 규약, 크기옵)

os.makedirs(os.path.dirname(출력), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=출력,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=True,       # ★ UV 를 살린다 — 이게 이 도구의 핵심이다
    export_materials="EXPORT",   # ★ 재질·텍스처도 같이 내보낸다
    export_image_format="JPEG",  # 사진 같은 결이라 JPEG 가 훨씬 작다
    export_cameras=False,
    export_lights=False,
)
print(f"  → {출력}  {os.path.getsize(출력)/1024/1024:.1f} MB · "
      f"{len(bpy.context.view_layer.objects.active.data.polygons):,} 면")
