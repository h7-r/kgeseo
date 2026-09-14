// ═══════════════════════════════════════════════════════════════
//  자갈돌6모형 — Meshy 모형을 구운 것 (**손으로 고치지 않는다**)
// ═══════════════════════════════════════════════════════════════
//  원본:  자갈돌6.glb
//  삼각형 90 · 꼭짓점 47
//  규약: **중심** (가장 긴 쪽 0.8 · 한복판 원점)
//  다시 구우려면:  node 도구/모형굽기.mjs 에셋/모형/자갈돌6.glb src/모형/자갈돌6.js 자갈돌6모형 중심
//
//  ※ 노멀·꼭짓점 색은 여기 없다. 불러오는 쪽이 `computeVertexNormals` 로
//    만들고 흰색을 깐다 — 실제 색은 `instanceColor` 가 곱한다.

export const 자갈돌6모형 = {
  // Z 폭을 1 로 맞췄을 때의 세 폭 — 놓는 쪽이 `키` 를 정할 때 본다
  폭: { x: 0.8000, y: 0.6253, z: 0.7071 },
  꼭짓점: 47,
  삼각형: 90,
  위치: "zczMvrAQ2D0yH3+9v5CkvnuPWb3bXXg+/Ce+vpGz7j1mNkU+dm9cvuHnnb7tQsg9xTqmvnDWwLyeqH69D+u5vobGNb5TFxK+LMuHvjcUSr43BAC9DCEovpT02j3bq569FpCTvkPsvbuvn1m+aOxgvhgtl74uygS+MhtIvqGUab7sTmG+d6WAvl1cJb0JuLO+CIEwvoF9Sz7fOna9nUFhvlgS6z1uIoA+CXQovmqwM712zHk+inkTvv1fLT53p+I9CIYQvuPUjj081WG+wZl7vc0unb0u6aG+fSEtvZLFW77WAYC+kXwDvhEmXDyv4iI+dtciPKG4k76eD0o+dFiZvZERhT5Jfoi+HtXKPbgqcrrztvc9b23+PG0V6z1MY+A9WvgNPFWjm74W0ge+oHozvMzdZ70Iz4O+4+mOPUo0Q71zFUy+4LQiPYpfnr60TfY9OM5aPbsLPj3eBbW+hqB5PeyulT5o+Iu+Qw45PncQoD7RYX69SgcoPmiodz5pcMo9nepAPnaNab7vGpO+GfN4PqThOz5Trik+LgRpPncQoL46Dic+ammEPqK8Wz56eCO+loeVPqfImb56VXm+OX5KPnUOOb3eBbU+zBSKPkXjnb6usZO9xnhkPvnYSb54tqU+XcRtPkQIZ7t/BRc+Q/uJPilV5b2dl3u+tbuGPnixhT7K72c9102ePvP+L761Sp8+x++lPutEvTx71BS+zczMPl5L771aEcC9PNOUPhOwhr3SX6U+",
  인덱스: "AAABAAIAAQAAAAMABAAFAAYAAAAEAAYAAAAHAAQAAAAGAAMABAAIAAUACQAFAAoABQAJAAYABQAIAAsAAAACAAwACwAKAAUAAgABAA0AAQADAA4ADAACAA8ABwAAAAwACAAQAAsACQADAAYAAQAOAA0ACwARABIACwASAAoACAAEAAcAAgANAA8ACwAQABEACAAHABAABwAMAA8ADQAOABMAAwAUAA4ADQATAA8ABwAPABMAEAAHABUAEwAWAAcABwAWABcACgAYAAkACgASABgAFwAVAAcACQAYAAMAEAAZABEAEAAVABkAEwAOABYAEgAaABgAFAADABsAFQAcABkAGwADABgAEQAZABoAFQAdABwAEQAaABIADgAUABYAGgAZABwAHgAVABcAFQAeAB0AFAAbABYAFwAfAB4AGAAaACAAHwAXACEAGAAiABsAHQAjABwAIAAkABgAGwAlABYAJgAiABgAHQAeACMAFwAWACEAHAAjABoAJQAbACcAJgAYACQAFgAlACgAGgApACAAHwAqAB4AGwAiACcAGgAjACkAFgAoACEAIgArACcAJQAnACsAHgAqACMAJQAsACgAHwAhACoAIwAsACkAJgAtACIAJAAgACYAIwAqACwAJQArAC4AJQAuACwAIAApACYAIQAoACwAKQAsAC0AJgApAC0ALgArACwAKgAhACwALQArACIAKwAtACwA",
};
