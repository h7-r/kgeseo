// ═══════════════════════════════════════════════════════════════
//  자갈돌7모형 — Meshy 모형을 구운 것 (**손으로 고치지 않는다**)
// ═══════════════════════════════════════════════════════════════
//  원본:  자갈돌7.glb
//  삼각형 90 · 꼭짓점 47
//  규약: **중심** (가장 긴 쪽 0.8 · 한복판 원점)
//  다시 구우려면:  node 도구/모형굽기.mjs 에셋/모형/자갈돌7.glb src/모형/자갈돌7.js 자갈돌7모형 중심
//
//  ※ 노멀·꼭짓점 색은 여기 없다. 불러오는 쪽이 `computeVertexNormals` 로
//    만들고 흰색을 깐다 — 실제 색은 `instanceColor` 가 곱한다.

export const 자갈돌7모형 = {
  // Z 폭을 1 로 맞췄을 때의 세 폭 — 놓는 쪽이 `키` 를 정할 때 본다
  폭: { x: 0.7809, y: 0.5307, z: 0.8000 },
  꼭짓점: 47,
  삼각형: 90,
  위치: "2fTBvvQCmT1tVf896wvAvlnetbvTgzO9CVysvkuuyr1mbVS7d+jHvgenRb0CJCK+ifutvpOdtLx2erw+N5SivpvjAD0Prpg+SomhvsfiSz4jsqA9oDmivic0Bz6neUs+s49ivu8Ab76HtY29puiivliAFr7k8rw+OriqvkNZhDxOkrC+BeqlvmZ1e77booI+zbuPvoEPhj5hTUa6ccqgvoqWcb6tx8Y9KQV+vmoXVr6j4EW+oCxWvo5CLT5QrqQ+nS6KvhN4CT4BiZa+ZytrvipkKz4cT0k+alx4vsn8Jb0N08I+n13bvY7vJD3NzMw+TUVGvdViG73NzMy+W4HgvRmrTr47AGa8yaWtvYjiwb2YQMA+wT2fPUgX2z1loLC+p8uPvf3ehz67Nxc9VBsyvTyhgr7ugos9RZ8FPfQKhL65qLI+xIRUvexf6T2a67I+JX+2PZagd766xhq+wjMQPfxGhb7zoIA+mp3GPVQcdb5hewY+5+lTPlMT3ryg76G+8JUWPsHsbT6r2ZW99VzYPRjJSj7ufGQ+IR4MPlDPcj7Y0jA98zVlPVankT3VKbM+Yj0IPikIM75hk3S+RLJ4PnKRfL6gmlK9ew5VPkgOTr6fXMM+AjWLPv3eh75qdz8+d+jHPs2Zfj3xw2k+Q8t8PjXOeL5pjKg+xcAUPqVYBz7rm8O9blC0PjIn6D2DZiW90TOyPscLLT2/ao29of6QPnLdgz1dy5s9HsW7Pj7hs70ri6E+",
  인덱스: "AAABAAIAAQADAAIABAAFAAAAAAAGAAEAAAAFAAcACAACAAMAAAACAAQACQAEAAIAAQAKAAMACQACAAsAAQAGAAwACwACAA0AAwAKAA4AAgAIAA0AAQAMAAoABwAPAAYABgAAAAcADAAQAAoABgAPAAwABwARAA8ACAADAA4ABQASABMABQAEABIACgAQABQABwAFABEADgAVAAgACQASAAQADwARAAUABQATAA8ADgAKABQACQAWABIAEAAXABQADwAYAAwAEgAWABMADQAIABkAGAAQAAwAFQAZAAgAFwAQABgACwANABoAGwAYAA8ADgAcABUAFAAcAA4ACwAaAAkADwATABsAFgAJABoAGQAdAA0ADQAdABoAGQAVAB4AHAAUAB8AFwAYACAAHQAZAB4AGAAhACIAGAAjACEAGAAbACMAHAAfACQAEwAjABsAHAAlABUAFgAjABMAGgAmABYAIAAYACIAJgAjABYAHQAeABoAFQAlAB4AGgAeACcAFAAXAB8AIwAoACEAGgApACYAKgAXACAAHAAkACUAIQAoACIAIAArACoAHgAlACcALAAqACsAJwApABoAKgAsABcAHwAXACwAHwAlACQAIgAoAC0AIAAiACsAHwAsACUAIwAmACgAIgAtACsAKAAmAC4ALQAsACsALQAuACwAJwAlAC4ALQAoAC4AJQAsAC4AKQAuACYAJwAuACkA",
};
