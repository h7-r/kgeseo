"""Create an isolated Blender work file from the Meshy high-detail source.

Run with Blender in background mode.  This never alters the downloaded GLB or
the user's open Blender scene.
"""

from pathlib import Path

import bpy


SOURCE = Path("/Users/derrick/Downloads/Meshy_AI_Sunny_Stroll_0914011040_generate.glb")
OUTPUT = Path("/Users/derrick/Downloads/NAJU_avatar_high_source_work.blend")


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))

    imported = list(bpy.context.selected_objects)
    source_collection = bpy.data.collections.new("NAJU_HIGH_SOURCE")
    bpy.context.scene.collection.children.link(source_collection)
    root = bpy.data.objects.new("NAJU_HIGH_SOURCE_ROOT", None)
    source_collection.objects.link(root)

    for obj in imported:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        source_collection.objects.link(obj)
        obj.parent = root

    triangles = sum(len(obj.data.polygons) for obj in imported if obj.type == "MESH")
    vertices = sum(len(obj.data.vertices) for obj in imported if obj.type == "MESH")
    root["source_file"] = str(SOURCE)
    root["source_triangles"] = triangles
    root["source_vertices"] = vertices
    root["purpose"] = "Preserved high-detail source. Derive the game mesh in a separate collection."

    bpy.context.scene["avatar_pipeline_stage"] = "high_source_preserved"
    bpy.context.scene["avatar_source_triangles"] = triangles
    bpy.context.scene["avatar_source_vertices"] = vertices
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(f"NAJU_AVATAR_SOURCE_READY objects={len(imported)} triangles={triangles} vertices={vertices} output={OUTPUT}")


if __name__ == "__main__":
    main()
