// ═══════════════════════════════════════════════════════════════
//  소품.js — 여기저기 갖다 쓸 물건들을 미리 만들어 두는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 미리 만들어 두나]
//   배치할 때마다 새로 만들면 두 가지가 어긋난다 — 같은 물건인데 곳마다
//   모양·크기가 다르고, 편집으로 옮겼을 때 무엇이었는지 되짚을 수가 없다.
//   **표본을 몇 벌씩 미리 만들어 두고 인스턴스로 돌려쓴다.**
//   드로우콜은 종류당 몇 개로 묶이고, 하나씩 고르고 옮길 수 있다(편집기).
//
// [표본 규약]
//   `배치.js` 의 `밑동원점으로` 를 통과해 **높이 1 · 밑동이 원점**이 된다.
//   자리의 `키`(m)가 그대로 실제 높이가 되고, 자리의 y 가 땅에 닿는 점이다.
//
// [단위] 여기서는 **비율**만 다룬다(높이 1 기준). 실치수는 자리의 `키` 가 정한다.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 색입히기 } from "./바닥.js";
import { 밑동원점으로 } from "./배치.js";

const 풀기 = (g) => {
  const n = g.toNonIndexed();
  n.deleteAttribute("uv");
  n.deleteAttribute("uv1");
  g.dispose();
  return n;
};
const 상자 = (w, h, d) => 풀기(new THREE.BoxGeometry(w, h, d));
const 기둥 = (r1, r2, h, 각 = 6) =>
  풀기(new THREE.CylinderGeometry(r1, r2, h, 각, 1));
const 공 = (r, 겹 = 0) => {
  const g = new THREE.IcosahedronGeometry(r, 겹);
  g.deleteAttribute("uv");
  return g.toNonIndexed();
};

// 조각들을 색칠해 하나로 — 표본 만들기의 마지막 단계
const 묶기 = (조각) => {
  const g = mergeGeometries(조각, false);
  조각.forEach((v) => v.dispose());
  return 밑동원점으로(g);
};

// ── 꽃 ──────────────────────────────────────────────────────
//   줄기 + 잎 두엇 + 꽃잎 대여섯. 멀리서는 점이지만 발밑에서는 꽃으로 읽힌다.
export function 꽃표본들(수 = 5, 시드 = 3301) {
  const 난수 = makeRandom(시드);
  const 색표 = ["#E8E3D2", "#D9A7B0", "#E2C766", "#B9C7E0", "#D8CBE6"];
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 줄기색 = new THREE.Color("#5E6B45").offsetHSL(0, 0, (난수() - 0.5) * 0.1);
    const 꽃색 = new THREE.Color(색표[Math.floor(난수() * 색표.length)]);
    const 키 = 0.8 + 난수() * 0.25;
    const 줄 = 기둥(0.012, 0.018, 키, 4);
    줄.translate(0, 키 / 2, 0);
    조각.push(색입히기(줄, 줄기색));
    for (let k = 0; k < 2; k++) {
      const 잎 = 상자(0.09, 0.012, 0.05);
      잎.rotateY(난수() * Math.PI);
      잎.rotateZ(0.5 + 난수() * 0.3);
      잎.translate(0, 키 * (0.25 + k * 0.22), 0);
      조각.push(색입히기(잎, 줄기색));
    }
    const 잎수 = 5 + Math.floor(난수() * 3);
    for (let k = 0; k < 잎수; k++) {
      const a = (k / 잎수) * Math.PI * 2;
      const 꽃잎 = 상자(0.07, 0.014, 0.035);
      꽃잎.rotateY(a);
      꽃잎.translate(Math.cos(a) * 0.055, 키, Math.sin(a) * 0.055);
      조각.push(색입히기(꽃잎, 꽃색));
    }
    const 술 = 공(0.028, 0);
    술.translate(0, 키 + 0.01, 0);
    조각.push(색입히기(술, new THREE.Color("#C8A94A")));
    표본.push(묶기(조각));
  }
  return 표본;
}

// ── 횃불 ────────────────────────────────────────────────────
//   기둥 + 감은 천 + 불꽃. 불꽃은 `toneMapped` 를 안 타는 밝은 색으로 두어
//   밤이 아니어도 **빛나는 것**으로 읽히게 한다.
export function 횃불표본들(수 = 3, 시드 = 3302) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 나무색 = new THREE.Color("#5A4A38").offsetHSL(0, 0, (난수() - 0.5) * 0.12);
    const 천색 = new THREE.Color("#8A7550");
    const 대 = 기둥(0.035, 0.05, 1.55, 6);
    대.translate(0, 0.78, 0);
    조각.push(색입히기(대, 나무색));
    const 감 = 기둥(0.085, 0.075, 0.26, 6);
    감.translate(0, 1.62, 0);
    조각.push(색입히기(감, 천색));
    // 불꽃 — 겹친 뿔 셋
    const 불색 = [new THREE.Color("#FFD166"), new THREE.Color("#FF9E3D"), new THREE.Color("#FFF0C2")];
    for (let k = 0; k < 3; k++) {
      const h = 0.34 - k * 0.08;
      const 뿔 = 풀기(new THREE.ConeGeometry(0.09 - k * 0.02, h, 5));
      뿔.rotateY(난수() * Math.PI);
      뿔.translate((난수() - 0.5) * 0.03, 1.78 + k * 0.05 + h / 2, (난수() - 0.5) * 0.03);
      조각.push(색입히기(뿔, 불색[k]));
    }
    표본.push(묶기(조각));
  }
  return 표본;
}

// ── 장승 ────────────────────────────────────────────────────
//   마을 어귀에 서는 나무 기둥. **얼굴이 실루엣의 전부**다 —
//   눈두덩과 코, 벌린 입, 그리고 위로 뻗은 관(冠)만 있으면 장승으로 읽힌다.
export function 장승표본들(수 = 3, 시드 = 3303) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 몸색 = new THREE.Color("#6B5942").offsetHSL(0, 0, (난수() - 0.5) * 0.1);
    const 짙 = new THREE.Color("#3A2F22");
    const 몸 = 기둥(0.16, 0.2, 2.1, 7);
    몸.translate(0, 1.05, 0);
    조각.push(색입히기(몸, 몸색));
    // 관 — 머리 위로 뻗은 뭉툭한 마루
    const 관 = 기둥(0.1, 0.19, 0.3, 7);
    관.translate(0, 2.22, 0);
    조각.push(색입히기(관, 몸색));
    // 눈두덩 둘
    for (const 쪽 of [-1, 1]) {
      const 눈 = 상자(0.11, 0.07, 0.06);
      눈.translate(쪽 * 0.075, 1.72, 0.17);
      조각.push(색입히기(눈, 짙));
    }
    // 코 — 길게 내려온다
    const 코 = 상자(0.08, 0.34, 0.1);
    코.translate(0, 1.55, 0.19);
    조각.push(색입히기(코, 몸색));
    // 입 — 가로로 벌어진 홈
    const 입 = 상자(0.24, 0.09, 0.06);
    입.translate(0, 1.3, 0.18);
    조각.push(색입히기(입, 짙));
    // 이 — 입 안의 흰 조각 둘(장승의 인상)
    for (const 쪽 of [-1, 1]) {
      const 이 = 상자(0.05, 0.05, 0.04);
      이.translate(쪽 * 0.06, 1.31, 0.2);
      조각.push(색입히기(이, new THREE.Color("#D8CFBC")));
    }
    표본.push(묶기(조각));
  }
  return 표본;
}

// ── 비석 ────────────────────────────────────────────────────
//   받침돌 + 몸돌 + 지붕돌. 몸돌만 세우면 그냥 판때기다.
export function 비석표본들(수 = 3, 시드 = 3304) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 돌색 = new THREE.Color("#9A968C").offsetHSL(0, 0, (난수() - 0.5) * 0.12);
    const 짙 = new THREE.Color("#6E6A61");
    const 받침 = 상자(0.62, 0.16, 0.44);
    받침.translate(0, 0.08, 0);
    조각.push(색입히기(받침, 짙));
    const 몸 = 상자(0.4, 1.25, 0.16);
    몸.translate(0, 0.16 + 0.63, 0);
    조각.push(색입히기(몸, 돌색));
    const 지붕 = 상자(0.56, 0.13, 0.3);
    지붕.rotateZ((난수() - 0.5) * 0.03);
    지붕.translate(0, 1.48, 0);
    조각.push(색입히기(지붕, 짙));
    표본.push(묶기(조각));
  }
  return 표본;
}

// ── 무덤 ────────────────────────────────────────────────────
//   봉분(둥근 흙더미) + 앞의 상돌. 봉분만 있으면 그냥 언덕이다.
export function 무덤표본들(수 = 3, 시드 = 3305) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 풀색 = new THREE.Color("#67704B").offsetHSL(0, 0, (난수() - 0.5) * 0.08);
    const 돌색 = new THREE.Color("#9A968C");
    // ★ 봉분은 **납작하다.** 폭이 높이의 세 배쯤 된다.
    //   공에 가깝게 두면 무덤이 아니라 거대한 초록 구슬로 보인다(실제로 그랬다).
    const 봉 = 공(1, 1);
    봉.scale(1.55, 0.5, 1.4);
    조각.push(색입히기(봉, 풀색));
    const 상돌 = 상자(0.55, 0.1, 0.34);
    상돌.translate(0, 0.02, 1.62);
    조각.push(색입히기(상돌, 돌색));
    표본.push(묶기(조각));
  }
  return 표본;
}

// ── 마을 명패 ───────────────────────────────────────────────
//   기둥 둘 + 가로판. 어귀에 서서 「여기부터 진부촌」을 말한다.
export function 명패표본들(수 = 2, 시드 = 3306) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 조각 = [];
    const 나무색 = new THREE.Color("#6A5947").offsetHSL(0, 0, (난수() - 0.5) * 0.1);
    const 판색 = new THREE.Color("#8B7A5E");
    for (const 쪽 of [-1, 1]) {
      const 대 = 기둥(0.05, 0.06, 2.0, 5);
      대.translate(쪽 * 0.62, 1.0, 0);
      조각.push(색입히기(대, 나무색));
    }
    const 판 = 상자(1.55, 0.42, 0.07);
    판.translate(0, 1.72, 0);
    조각.push(색입히기(판, 판색));
    const 테 = 상자(1.62, 0.06, 0.09);
    테.translate(0, 1.96, 0);
    조각.push(색입히기(테, 나무색));
    표본.push(묶기(조각));
  }
  return 표본;
}
