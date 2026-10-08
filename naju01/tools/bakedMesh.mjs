// 표본 JSON(src/models/baked/*.json)을 굽고 줄이는 두 도구(bake-model · decimate-models)가 같이 쓰는 메시 처리.

/** 같은 자리 꼭짓점을 하나로 합친다 — Meshy 생성본은 꼭짓점을 안 합쳐 내서, 그대로 줄이면 면이 조각조각 떨어진다 */
export function weldVertices(positions, indices) {
  // 소수점 5자리(0.01 mm)에서 같으면 같은 점으로 본다
  const keys = new Map();
  const weldedList = [];
  const remap = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i++) {
    const key =
      positions[i * 3].toFixed(5) + "," + positions[i * 3 + 1].toFixed(5) + "," + positions[i * 3 + 2].toFixed(5);
    let j = keys.get(key);
    if (j === undefined) {
      j = weldedList.length / 3;
      keys.set(key, j);
      weldedList.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const weldedIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) weldedIndices[i] = remap[indices[i]];
  return { positions: new Float32Array(weldedList), indices: weldedIndices };
}

/** 줄인 인덱스가 쓰는 꼭짓점만 남기고 번호를 다시 매긴다 */
export function compactVertices(indices, positions) {
  const used = new Map();
  const packedList = [];
  const packedIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const vertex = indices[i];
    let j = used.get(vertex);
    if (j === undefined) {
      j = packedList.length / 3;
      used.set(vertex, j);
      packedList.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    }
    packedIndices[i] = j;
  }
  return { positions: new Float32Array(packedList), indices: packedIndices };
}

export function boundingBox(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length / 3; i++)
    for (let c = 0; c < 3; c++) {
      const value = positions[i * 3 + c];
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
    }
  return { min, max };
}

/**
 * 표본 규약에 맞춰 옮기고 키운다.
 *   lying  Z 폭 1 · 밑동 y=0 · XZ 한복판      height  Y 폭 1 · 밑동 y=0 · XZ 한복판
 *   center 가장 긴 쪽 = centerSize · 자리 한복판이 원점(굴러다니는 것이라 밑동이 없다)
 */
export function normalizeToRule(positions, rule, centerSize) {
  const { min, max } = boundingBox(positions);
  const extent = [0, 1, 2].map((c) => max[c] - min[c]);
  const scale =
    rule === "height"
      ? 1 / (extent[1] || 1)
      : rule === "center"
        ? centerSize / (Math.max(extent[0], extent[1], extent[2]) || 1)
        : 1 / (extent[2] || 1);
  const offset =
    rule === "center"
      ? [-(min[0] + extent[0] / 2), -(min[1] + extent[1] / 2), -(min[2] + extent[2] / 2)]
      : [-(min[0] + extent[0] / 2), -min[1], -(min[2] + extent[2] / 2)];
  const vertexCount = positions.length / 3;
  const normalized = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++)
    for (let c = 0; c < 3; c++) normalized[i * 3 + c] = (positions[i * 3 + c] + offset[c]) * scale;
  const [x, y, z] = extent.map((value) => Number((value * scale).toFixed(4)));
  return { positions: normalized, size: { x, y, z } };
}

export const toBase64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");
