// GLB 를 라이브러리 없이 읽는 작은 도구들. Meshy 왕복 도구(텍스처 뽑기·합치기·모형 굽기)가 같이 쓴다.

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** 12 바이트 머리말 뒤 청크를 훑어 JSON 과 BIN 을 꺼낸다(BIN 은 원본 버퍼를 공유하는 조각) */
export function readGlbChunks(glb) {
  let cursor = 12;
  let json = null;
  let bin = null;
  while (cursor < glb.length) {
    const length = glb.readUInt32LE(cursor);
    const type = glb.readUInt32LE(cursor + 4);
    if (type === JSON_CHUNK) json = JSON.parse(glb.slice(cursor + 8, cursor + 8 + length).toString("utf8"));
    if (type === BIN_CHUNK) bin = glb.slice(cursor + 8, cursor + 8 + length);
    cursor += 8 + length;
  }
  return { json, bin };
}

/**
 * 첫 재질의 텍스처를 쓰임별로 꺼낸다 — { "base-color" | "roughness-metalness" | "normal": { data, mimeType } }.
 * Meshy 가 이름을 안 붙여 줄 수도 있어 재질 슬롯으로 쓰임을 가른다. 슬롯이 빈 쓰임은 빠진다.
 */
export function readMaterialTextures(json, bin) {
  const material = json.materials?.[0];
  const pbr = material?.pbrMetallicRoughness ?? {};
  const slots = {
    "base-color": pbr.baseColorTexture?.index,
    "roughness-metalness": pbr.metallicRoughnessTexture?.index,
    normal: material?.normalTexture?.index,
  };
  const textures = {};
  for (const [usage, textureIndex] of Object.entries(slots)) {
    if (textureIndex === undefined) continue;
    const image = json.images[json.textures[textureIndex].source];
    const view = json.bufferViews[image.bufferView];
    const start = view.byteOffset || 0;
    textures[usage] = { data: bin.slice(start, start + view.byteLength), mimeType: image.mimeType };
  }
  return textures;
}

export const TEXTURE_USAGES = ["base-color", "roughness-metalness", "normal"];
