"""Build one runtime-switchable Sidekick character library from the Unity package.

The licensed Unity package stays outside the repository.  This script reads it
directly, imports only the Starter Pack FBX parts, binds every part to one shared
89-bone armature, and exports a GLB whose object names encode customization slots.

Usage:
  Blender --background --factory-startup \
    --python build_sidekick_modular_library.py -- \
    --unity-package ~/Downloads/SIDEKICK_Starter_Unity_2021_3_v1_0_4.unitypackage \
    --blend-output /tmp/sidekick-customizer.blend \
    --glb-output public/models/sidekick-customizer.glb
"""

from __future__ import annotations

import argparse
import sys
import tarfile
import tempfile
from pathlib import Path

import bpy


BASE = "SK_HUMN_BASE_01"
SCIFI = "SK_SCFI_CIVL_09"
KNIGHT = "SK_FANT_KNGT_17"

FIXED = [
    f"{BASE}_05EYEL_HU01",
    f"{BASE}_06EYER_HU01",
    f"{BASE}_37TONG_HU01",
]
HEADS = [
    "SK_HUMN_BASE_01_01HEAD_HU01",
    "SK_HUMN_BASE_02_01HEAD_HU01",
]
HAIRS = [
    *[f"SK_HUMN_BASE_{i:02d}_02HAIR_HU01" for i in range(1, 11)],
    "SK_SCFI_CIVL_09_02HAIR_HU01",
]
BROWS = [
    [f"SK_HUMN_BASE_{i:02d}_03EBRL_HU01", f"SK_HUMN_BASE_{i:02d}_04EBRR_HU01"]
    for i in range(1, 11)
]
EARS = [
    [f"SK_HUMN_BASE_{i:02d}_07EARL_HU01", f"SK_HUMN_BASE_{i:02d}_08EARR_HU01"]
    for i in range(1, 11)
]
FACIAL_HAIR = [f"SK_HUMN_BASE_{i:02d}_09FCHR_HU01" for i in range(1, 11)]
NOSES = [f"SK_HUMN_BASE_{i:02d}_35NOSE_HU01" for i in range(1, 12)]
TEETH = [f"SK_HUMN_BASE_{i:02d}_36TETH_HU01" for i in range(1, 11)]

ACCESSORIES = {
    "headwear": [
        "SK_SCFI_CIVL_09_22AHED_HU01",
        "SK_SCFI_CIVL_10_22AHED_HU01",
        "SK_FANT_KNGT_17_22AHED_HU01",
        "SK_HORR_VILN_01_22AHED_HU01",
    ],
    "faceAccessory": [
        "SK_SCFI_CIVL_09_23AFAC_HU01",
        "SK_FANT_KNGT_17_23AFAC_HU01",
    ],
    "backAccessory": [
        "SK_SCFI_CIVL_09_24ABAC_HU01",
        "SK_FANT_KNGT_17_24ABAC_HU01",
    ],
    "hipFront": [
        "SK_SCFI_CIVL_09_25AHPF_HU01",
        "SK_FANT_KNGT_17_25AHPF_HU01",
    ],
    "hipBack": [
        "SK_SCFI_CIVL_09_26AHPB_HU01",
        "SK_SCFI_CIVL_10_26AHPB_HU01",
        "SK_FANT_KNGT_17_26AHPB_HU01",
    ],
}

PAIRED_ACCESSORIES = {
    "hipSide": [
        ("SK_SCFI_CIVL_09_27AHPL_HU01", "SK_SCFI_CIVL_09_28AHPR_HU01"),
        ("SK_SCFI_CIVL_10_27AHPL_HU01", "SK_SCFI_CIVL_10_28AHPR_HU01"),
        ("SK_FANT_KNGT_17_27AHPL_HU01", "SK_FANT_KNGT_17_28AHPR_HU01"),
    ],
    "shoulderAccessory": [
        ("SK_SCFI_CIVL_09_29ASHL_HU01", "SK_SCFI_CIVL_09_30ASHR_HU01"),
        ("SK_SCFI_CIVL_10_29ASHL_HU01", "SK_SCFI_CIVL_10_30ASHR_HU01"),
        ("SK_FANT_KNGT_17_29ASHL_HU01", "SK_FANT_KNGT_17_30ASHR_HU01"),
    ],
    "elbowAccessory": [
        ("SK_SCFI_CIVL_09_31AEBL_HU01", "SK_SCFI_CIVL_09_32AEBR_HU01"),
        ("SK_FANT_KNGT_17_31AEBL_HU01", "SK_FANT_KNGT_17_32AEBR_HU01"),
    ],
    "kneeAccessory": [
        ("SK_SCFI_CIVL_09_33AKNL_HU01", "SK_SCFI_CIVL_09_34AKNR_HU01"),
        ("SK_FANT_KNGT_17_33AKNL_HU01", "SK_FANT_KNGT_17_34AKNR_HU01"),
    ],
}


def body_parts(prefix: str) -> list[str]:
    suffixes = [
        "10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR",
        "15HNDL", "16HNDR",
        "17HIPS", "18LEGL", "19LEGR", "20FOTL", "21FOTR",
    ]
    return [f"{prefix}_{suffix}_HU01" for suffix in suffixes]


BODY = {
    "base": body_parts(BASE),
    "scifi": body_parts(SCIFI),
    "knight": body_parts(KNIGHT),
}


def arguments() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--unity-package", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--glb-output", type=Path, required=True)
    return parser.parse_args(raw)


def package_index(archive: tarfile.TarFile) -> dict[str, str]:
    """Map the basename of every packaged pathname to its GUID directory."""
    index: dict[str, str] = {}
    for member in archive.getmembers():
        if not member.name.endswith("/pathname"):
            continue
        handle = archive.extractfile(member)
        if handle is None:
            continue
        pathname = handle.read().decode("utf-8", errors="replace").strip()
        base = Path(pathname.replace("\\", "/")).name
        if base:
            index[base] = member.name.rsplit("/", 1)[0]
    return index


def extract_named(
    archive: tarfile.TarFile,
    index: dict[str, str],
    filename: str,
    temp: Path,
) -> Path:
    guid = index.get(filename)
    if not guid:
        raise RuntimeError(f"Sidekick package is missing {filename}")
    member = archive.getmember(f"{guid}/asset")
    handle = archive.extractfile(member)
    if handle is None:
        raise RuntimeError(f"Cannot read packaged asset {filename}")
    output = temp / filename
    output.write_bytes(handle.read())
    return output


def make_material(name: str, image: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (1, 1, 1, 1)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Closest"
    shader.inputs["Roughness"].default_value = 0.82
    shader.inputs["Metallic"].default_value = 0.0
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def import_part(path: Path) -> tuple[bpy.types.Object, bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    added = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in added if obj.type == "MESH"]
    rigs = [obj for obj in added if obj.type == "ARMATURE"]
    if len(meshes) != 1 or len(rigs) != 1:
        raise RuntimeError(
            f"Unexpected FBX contents for {path.name}: "
            f"{len(meshes)} mesh(es), {len(rigs)} armature(s)"
        )
    return meshes[0], rigs[0]


def neutralize_shape_keys(mesh: bpy.types.Object) -> None:
    if not mesh.data.shape_keys:
        return
    for key in mesh.data.shape_keys.key_blocks:
        if key.name in {"masculineFeminine", "defaultHeavy", "defaultBuff", "defaultSkinny"}:
            key.value = 0.0


def main() -> None:
    args = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    with tarfile.open(args.unity_package.expanduser().resolve(), "r:gz") as archive:
        index = package_index(archive)
        with tempfile.TemporaryDirectory(prefix="sidekick_customizer_") as folder:
            temp = Path(folder)
            texture_path = extract_named(archive, index, "T_Starter_02ColorMap.png", temp)
            image = bpy.data.images.load(str(texture_path), check_existing=True)
            image.colorspace_settings.name = "sRGB"
            materials = {
                "skin": make_material("SKLIB_skin", image),
                "hair": make_material("SKLIB_hair", image),
                "base": make_material("SKLIB_base", image),
                "scifi": make_material("SKLIB_scifi", image),
                "knight": make_material("SKLIB_knight", image),
            }

            entries: list[tuple[str, str, int, str]] = []
            entries.extend((name, "fixed", 1, "skin") for name in FIXED)
            entries.extend((name, "head", i + 1, "skin") for i, name in enumerate(HEADS))
            entries.extend((name, "hair", i + 1, "hair") for i, name in enumerate(HAIRS))
            for i, names in enumerate(BROWS, start=1):
                entries.extend((name, "brows", i, "hair") for name in names)
            for i, names in enumerate(EARS, start=1):
                entries.extend((name, "ears", i, "skin") for name in names)
            entries.extend((name, "facialHair", i + 1, "hair") for i, name in enumerate(FACIAL_HAIR))
            entries.extend((name, "nose", i + 1, "skin") for i, name in enumerate(NOSES))
            entries.extend((name, "teeth", i + 1, "skin") for i, name in enumerate(TEETH))
            for slot, names in ACCESSORIES.items():
                entries.extend((name, slot, i + 1, "scifi" if "SCFI" in name else "knight") for i, name in enumerate(names))
            for slot, pairs in PAIRED_ACCESSORIES.items():
                for i, names in enumerate(pairs, start=1):
                    entries.extend((name, slot, i, "scifi" if "SCFI" in name else "knight") for name in names)
            for style_index, (style, names) in enumerate(BODY.items(), start=1):
                for name in names:
                    suffix = name.split("_")[-2]
                    if suffix in {"10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR", "15HNDL", "16HNDR"}:
                        slot = "top"
                    elif suffix in {"17HIPS", "18LEGL", "19LEGR"}:
                        slot = "bottom"
                    else:
                        slot = "shoes"
                    entries.append((name, slot, style_index, style))

            # A base torso is first so its complete armature becomes the shared rig.
            entries.sort(key=lambda item: (item[0] != f"{BASE}_10TORS_HU01", item[1], item[2], item[0]))
            master: bpy.types.Object | None = None
            meshes: list[bpy.types.Object] = []

            for part_name, slot, option, material_group in entries:
                fbx_path = extract_named(archive, index, f"{part_name}.fbx", temp)
                mesh, rig = import_part(fbx_path)
                if master is None:
                    master = rig
                    master.name = "SidekickCustomizerRig"
                    master.data.name = "SidekickCustomizerRig"
                else:
                    world = mesh.matrix_world.copy()
                    mesh.parent = master
                    mesh.matrix_world = world
                    for modifier in mesh.modifiers:
                        if modifier.type == "ARMATURE":
                            modifier.object = master
                    bpy.data.objects.remove(rig, do_unlink=True)

                mesh.name = f"SKLIB__{slot}__{option:02d}__{part_name}"
                mesh.data.name = f"{mesh.name}_Mesh"
                neutralize_shape_keys(mesh)
                chosen_material = materials[material_group]
                if not mesh.material_slots:
                    mesh.data.materials.append(chosen_material)
                else:
                    for material_slot in mesh.material_slots:
                        material_slot.material = chosen_material
                meshes.append(mesh)

    if master is None:
        raise RuntimeError("No shared Sidekick armature was imported")

    master.show_in_front = True
    master.display_type = "WIRE"
    master["source_package"] = "Synty Sidekick Modular Characters - Free Starter Pack"
    master["customization_slots"] = "head,hair,top,bottom,shoes"

    bpy.ops.object.select_all(action="DESELECT")
    master.select_set(True)
    bpy.context.view_layer.objects.active = master
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.object.select_all(action="DESELECT")
    master.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = master

    args.blend_output = args.blend_output.expanduser().resolve()
    args.glb_output = args.glb_output.expanduser().resolve()
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    args.glb_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output))
    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=True,
        export_apply=False,
        export_extras=True,
    )
    print(
        "SIDEKICK_CUSTOMIZER_OK "
        f"parts={len(meshes)} blend={args.blend_output} glb={args.glb_output}"
    )


if __name__ == "__main__":
    main()
