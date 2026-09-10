// ═══════════════════════════════════════════════════════════════
//  자갈돌2모형 — Meshy 모형을 구운 것 (**손으로 고치지 않는다**)
// ═══════════════════════════════════════════════════════════════
//  원본:  자갈돌2.glb
//  삼각형 90 · 꼭짓점 47
//  규약: **중심** (가장 긴 쪽 0.8 · 한복판 원점)
//  다시 구우려면:  node 도구/모형굽기.mjs 에셋/모형/자갈돌2.glb src/모형/자갈돌2.js 자갈돌2모형 중심
//
//  ※ 노멀·꼭짓점 색은 여기 없다. 불러오는 쪽이 `computeVertexNormals` 로
//    만들고 흰색을 깐다 — 실제 색은 `instanceColor` 가 곱한다.

export const 자갈돌2모형 = {
  // Z 폭을 1 로 맞췄을 때의 세 폭 — 놓는 쪽이 `키` 를 정할 때 본다
  폭: { x: 0.8000, y: 0.5261, z: 0.7453 },
  꼭짓점: 47,
  삼각형: 90,
  위치: "zczMvmo6jz1apjQ+0VixvnXZPz22jLK7lw+zvs/I6r0P6Jo9Azi+viZEa75uaOs9liuAvgRGMD5cWJo9jS6ZvuBLUL6rvoo+d+2gvqr22r225nm9lkBcvu96eL7HFyi8d5ucvnZ5bT0ue4A+yrtwvtLPkD1M9u29ojR1vqks9b2YBQi+qAQnvppEQD4UdHc+6+oHvlcjYz4aNLI8iYc2vmhDlzwA1yW+IvpZvjhxU750zr4+3WVHvi/q1D2yias+J2/6veRsET5b9la+RheovVPMZr5sVKw+bk9wvSRFRDz4BJw+PPryvJb8cL7qVmK+INq4vYjgRLyhqaC+/AOJPRmuhj4W2PS96zzRuw9YGz7BpZs+3gJoPRmuhr6yzWA+EMqivJCjNTylOaW+J4r9PRuDf77MPck9d5FRPbxlUzyKWLA+nhayPbYyF74AfKG+gCW9PfG8zT2gdpm+eUUKPrmKS76gN7E+iiZHPsxZMT7UeEo+7XJXPvfgnz2fmbq+uFvxPd66Mb10zr6+5hdZPmYuDT0skIY+BQ9oPjNsab5b2ME8xXBdPp/TVD7O/Cu+ju2DPsQpSj64nbM9l5hMPtW3aL61koM+QQSAPlaivL2zzbW+pgeQPjRwMb5ZrJc+fQ+oPjWgIr7vKES+XrqyPplPC77TbbM8Ot62PgjswT0Kc7K9+ZurPvWQu7txB4a+j6K1PnDKJz1nDjs+bX2rPlvptz31WJc9zczMPosbJr4Y3ww+",
  인덱스: "AAABAAIAAwAAAAIAAQAAAAQAAAADAAUAAwACAAYAAwAGAAcABgACAAEAAAAFAAgAAwAHAAUAAAAIAAQAAQAEAAkAAQAKAAYACAALAAQABAAMAAkAAQANAAoABQAOAAgACAAOAA8ABgAKAAcACwAIAA8AAQAJAA0AEAANAAkABAALAAwACQAMABAADwAOABEAEQASAA8ABwAKABMACgANABQABQARAA4ACwAVAAwAEgAWAAsACgAUABMADwASAAsABQAXABEABQAHABcAEAAYAA0ADAAVABAABwAZABcAFAANABgAEQAaABIACwAWABUAEgAaABYAEwAbABkABwATABkAFAAYABsAFAAbABMAEAAcABgAEQAXAB0AHgAVABYAGAAfACAAGAAgABsAEQAdABoAGAAcAB8AGgAhABYAGQAbACIAFQAjABAAHgAWACEAFQAeACQAFwAlAB0AEAAjABwAHAAjAB8AGwAgACYAFwAZACUAHQAhABoAJAAjABUAHQAlACcAKAAiABsAHQAnACEAIAAfACYAGQAiACUAJQAiACcAIwAmAB8AIQAnAB4AIgAoACkAGwAmACgAIwAkACoAJgAjACsAJwAsAB4AHgAsACQAJgArACgAJAAsAC0AKgAkAC0AIwAqACsAKwApACgAKgApACsAJwAuACwALAApAC0ALQApACoAJwAiAC4AIgApAC4AKQAsAC4A",
};
