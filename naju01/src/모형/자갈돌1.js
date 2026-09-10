// ═══════════════════════════════════════════════════════════════
//  자갈돌1모형 — Meshy 모형을 구운 것 (**손으로 고치지 않는다**)
// ═══════════════════════════════════════════════════════════════
//  원본:  자갈돌1.glb
//  삼각형 90 · 꼭짓점 47
//  규약: **중심** (가장 긴 쪽 0.8 · 한복판 원점)
//  다시 구우려면:  node 도구/모형굽기.mjs 에셋/모형/자갈돌1.glb src/모형/자갈돌1.js 자갈돌1모형 중심
//
//  ※ 노멀·꼭짓점 색은 여기 없다. 불러오는 쪽이 `computeVertexNormals` 로
//    만들고 흰색을 깐다 — 실제 색은 `instanceColor` 가 곱한다.

export const 자갈돌1모형 = {
  // Z 폭을 1 로 맞췄을 때의 세 폭 — 놓는 쪽이 `키` 를 정할 때 본다
  폭: { x: 0.7448, y: 0.4093, z: 0.8000 },
  꼭짓점: 47,
  삼각형: 90,
  위치: "46y+vjPdp7s+Arm9L6WbvmliBb1hyKa+Y7eovj38C75wTi++ji+dvhpz2z2/kyu+y1qUvu7HUL5X24G9un6kvhajtL1VzQo+EaOdvu2z7bxl8ka9mGiTvojR+L1qAa29/iqAvm6x7b1TIae+fXZ4vnkUgj2pJAc9Ofx9vvirtz26/pe+4TVjvpAFc713urQ+YJSBvpzf/rzNzMy+ZDQ1vliaSr7+SZQ+OLAEvh+3Pz7HxzC+2fAcvqfDZr2s4rC+R9IPvvCdG73NzMw+neXvvYj/Gj5chmW9PYcgvUwOzz2HNgQ+KrlHvXAf7DxDmJg+fRTpvWXbLr7xq7q+9/VKvcNBHT5TNLO+3ZN/PS62UL7NpqQ+ppo1vdKLS75TCZm+TQH3u2ItT72cErS+o/mKu6mJUT4KJSa+Kv55PR5Pp72IUaw+9Bg1O12e3T2pfpI9wJW/vFnIFruE0ZW+j6H1PYVVnTwkD7A+yh5qPUAOKT4KnS69HjMDO5rm+T2eS769/wqPPUp3Kz6OorC+iyMEPheTAb4nY5O+gj86Pvp8pz0wM4++idolPiNXkD06gnA+ypGHPqljUb5Z/SS+qSyJPjhHib12S6k+53poPpMUTb6AfJY8sbWPPqmJUb6WSac97R6kPkdr5LwDxj+++ISaPszG3jwzx6e7+YxxPputJL7EoT8+bUuEPmolKL5nWia8aDKMPhADpLzr8mM+46y+PiqFWb2yw+g7dZStPk4krL3v6Fc+",
  인덱스: "AAABAAIAAAADAAEABAAFAAYABgAAAAcABAAGAAcAAgABAAgABgAJAAAAAwAAAAkAAAACAAcABQAJAAYAAwAKAAEABQALAAkAAgAEAAcAAQAMAAgAAQAKAAwABAANAAUACwAFAA0ACQAOAAMAAgAIAAQADAAPAAgACwANABAAAwAOAAoADgAJABEADAAKAA8ACwASAAkAEwALABAADwAUAAgACAAUAAQACwATABIACgAOABUADQAEABYACQASABEABAAUABcAFAAPABcADwAKABUADwAYABcAEQAZAA4ADwAVABgAEAANABoAEQASABsAEgATABsAFwAYABwADQAWABoAGwATAB0AEQAeABkAGQAeAB8AEQAbAB4ADgAgABUAEAAaAB0ABAAXABYAFwAcACEADgAZACAAFQAgABgAHwAgABkAEAAdABMAHwAeACAAGAAgABwAHAAgACIAGwAjAB4AGwAdACMAIQAkABcAHQAaACMAFwAkABYAGgAWACUAHAAiACEAFgAkACYAJgAnABYAIAAoACIAGgAlACMAIgAoACEAHgAjACkAFgAnACoAIAAeACgAJgAkACsAFgAqACUAIwAlACwAIQAoACQAIwAsACkAJQAqACwAKwAkACkAHgApACgAKwAnACYAJAAoACkAKwApAC0ALAAqAC4ALgAqACcAKwAtACcAKQAsAC4AKQAuAC0ALgAnAC0A",
};
