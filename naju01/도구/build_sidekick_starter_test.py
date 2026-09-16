"""Assemble a licensed Synty Sidekick preset and export it for the NAJU R3F test map.

This intentionally keeps the downloaded source package outside the repository. Only
the assembled Blender/GLB test outputs are written to paths supplied on the command
line.

Usage:
  blender --background --factory-startup --python build_sidekick_starter_test.py -- \
    --package-root /tmp/reconstructed-unity-package \
    --preset Starter_02 \
    --blend-output /path/to/sidekick-starter-02.blend \
    --glb-output /path/to/sidekick-starter-02.glb
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import bpy


def arguments() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-root", type=Path, required=True)
    parser.add_argument("--preset", default="Starter_02")
    parser.add_argument("--exclude-part", action="append", default=[])
    parser.add_argument("--extra-part", action="append", default=[])
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--glb-output", type=Path, required=True)
    return parser.parse_args(raw)


def find_one(root: Path, filename: str) -> Path:
    matches = list(root.rglob(filename))
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {filename!r}; found {len(matches)}")
    return matches[0]


def read_part_names(preset_file: Path) -> list[str]:
    return re.findall(r"^- Name: (.+?)\s*$", preset_file.read_text(), flags=re.MULTILINE)


def import_part(path: Path) -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    added = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in added if obj.type == "MESH"]
    armatures = [obj for obj in added if obj.type == "ARMATURE"]
    if len(meshes) != 1 or len(armatures) != 1:
        raise RuntimeError(
            f"Unexpected FBX contents for {path.name}: "
            f"{len(meshes)} mesh(es), {len(armatures)} armature(s)"
        )
    return meshes, armatures


def make_palette_material(texture_path: Path, preset: str) -> bpy.types.Material:
    image = bpy.data.images.load(str(texture_path), check_existing=True)
    image.colorspace_settings.name = "sRGB"

    material = bpy.data.materials.new(f"Sidekick_{preset}_Palette")
    material.use_nodes = True
    material.diffuse_color = (1.0, 1.0, 1.0, 1.0)
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


def apply_preset_shape(mesh: bpy.types.Object) -> None:
    if not mesh.data.shape_keys:
        return
    keys = mesh.data.shape_keys.key_blocks
    if "masculineFeminine" in keys:
        keys["masculineFeminine"].value = 1.0
    if "defaultSkinny" in keys:
        keys["defaultSkinny"].value = 0.145


def main() -> None:
    args = arguments()
    package_root = args.package_root.expanduser().resolve()
    preset_file = find_one(package_root, f"{args.preset}.sk")
    texture_file = find_one(package_root, f"T_{args.preset}ColorMap.png")
    part_names = read_part_names(preset_file)
    excluded = set(args.exclude_part)
    part_names = [name for name in part_names if name not in excluded]
    part_names.extend(name for name in args.extra_part if name not in part_names)
    if not part_names:
        raise RuntimeError(f"No parts listed in {preset_file}")

    # The torso armature contains the complete shared deformation skeleton.
    part_names.sort(key=lambda name: ("_10TORS_" not in name, name))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    material = make_palette_material(texture_file, args.preset)
    master_armature: bpy.types.Object | None = None
    all_meshes: list[bpy.types.Object] = []

    for part_name in part_names:
        source = find_one(package_root, f"{part_name}.fbx")
        meshes, armatures = import_part(source)
        mesh = meshes[0]
        armature = armatures[0]

        if master_armature is None:
            master_armature = armature
            master_armature.name = "SidekickRig"
            master_armature.data.name = "SidekickRig"
        else:
            world_matrix = mesh.matrix_world.copy()
            mesh.parent = master_armature
            mesh.matrix_world = world_matrix
            for modifier in mesh.modifiers:
                if modifier.type == "ARMATURE":
                    modifier.object = master_armature
            bpy.data.objects.remove(armature, do_unlink=True)

        mesh.name = part_name
        mesh.data.name = f"{part_name}_Mesh"
        for slot_index in range(max(1, len(mesh.material_slots))):
            if slot_index >= len(mesh.material_slots):
                mesh.data.materials.append(material)
            else:
                mesh.material_slots[slot_index].material = material
        apply_preset_shape(mesh)
        all_meshes.append(mesh)

    if master_armature is None:
        raise RuntimeError("The preset did not create an armature")

    # Display and naming defaults that remain convenient if opened in Blender.
    master_armature.show_in_front = True
    master_armature.display_type = "WIRE"
    master_armature["source_package"] = "Synty Sidekick Modular Characters - Free Starter Pack"
    master_armature["source_preset"] = args.preset

    # Unity/FBX uses a 0.01 armature object scale. Leaving that object transform
    # unapplied makes glTF report a character about 100x too small even though the
    # Blender viewport looks correct. Bake rotation/scale into the rest skeleton
    # once, before animation and export.
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    master_armature.select_set(True)
    bpy.context.view_layer.objects.active = master_armature
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    master_armature.select_set(True)
    for mesh in all_meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = master_armature

    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    args.glb_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.expanduser().resolve()))

    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output.expanduser().resolve()),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=True,
        export_apply=False,
    )
    print(
        "SIDEKICK_BUILD_OK "
        f"preset={args.preset} parts={len(all_meshes)} "
        f"blend={args.blend_output} glb={args.glb_output}"
    )


if __name__ == "__main__":
    main()
