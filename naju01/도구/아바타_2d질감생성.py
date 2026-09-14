"""모듈형 아바타의 작은 2D 반복 질감을 만든다.

외부 서비스 업로드 없이 Blender에서 PNG를 만들고 GLB 안에 포함한다.
나중에 손그림/AI 의상 PNG가 준비되면 이 파일들만 교체하면 된다.
"""
import bpy
from pathlib import Path

OUT = Path('/Users/derrick/Documents/GitHub/kgeseo/public/textures')
OUT.mkdir(parents=True, exist_ok=True)

palette = {
    'Hair_01': ((0.10, 0.055, 0.025), (0.18, 0.09, 0.035)),
    'Hair_02': ((0.18, 0.08, 0.035), (0.32, 0.14, 0.05)),
    'Hair_03': ((0.035, 0.055, 0.09), (0.06, 0.12, 0.20)),
    'Hair_04': ((0.38, 0.19, 0.08), (0.62, 0.34, 0.14)),
    'Top_01': ((0.10, 0.30, 0.70), (0.20, 0.48, 0.90)),
    'Top_02': ((0.08, 0.42, 0.25), (0.18, 0.62, 0.37)),
    'Top_03': ((0.62, 0.15, 0.12), (0.88, 0.30, 0.24)),
    'Top_04': ((0.08, 0.09, 0.13), (0.22, 0.24, 0.31)),
    'Bottom_01': ((0.04, 0.09, 0.20), (0.10, 0.18, 0.36)),
    'Bottom_02': ((0.14, 0.17, 0.25), (0.24, 0.29, 0.39)),
    'Bottom_03': ((0.24, 0.13, 0.07), (0.39, 0.23, 0.12)),
    'Bottom_04': ((0.08, 0.22, 0.15), (0.14, 0.38, 0.25)),
    'Shoes_01': ((0.75, 0.76, 0.74), (1.0, 1.0, 0.96)),
    'Shoes_02': ((0.03, 0.035, 0.045), (0.14, 0.15, 0.18)),
    'Shoes_03': ((0.42, 0.07, 0.05), (0.72, 0.16, 0.12)),
    'Shoes_04': ((0.06, 0.22, 0.38), (0.12, 0.42, 0.62)),
}

for name, (a, b) in palette.items():
    image = bpy.data.images.get(name + '_2D') or bpy.data.images.new(name + '_2D', 256, 256, alpha=True)
    pixels = []
    for y in range(256):
        for x in range(256):
            # 세로 직물 결 + 가는 가로 봉제선. UV가 있는 어떤 옷에도 읽힌다.
            stripe = (x // 20) % 2 == 0
            seam = y % 64 < 3
            c = b if stripe else a
            if seam:
                c = tuple(v * 0.58 for v in c)
            pixels.extend((*c, 1.0))
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(OUT / f'{name.lower()}_2d.png')
    image.file_format = 'PNG'
    image.save()

    mat = bpy.data.materials.get(name)
    if not mat:
        continue
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    tex = nodes.get('NAJU_2D_Texture') or nodes.new('ShaderNodeTexImage')
    tex.name = 'NAJU_2D_Texture'
    tex.image = image
    tex.interpolation = 'Closest'
    for link in list(bsdf.inputs['Base Color'].links):
        links.remove(link)
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print('NAJU_2D_TEXTURES_READY', len(palette), OUT)
