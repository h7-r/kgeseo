// Scene 05 「돌아온 이야기」가 요구하는 것들. 씬1~4 와 같은 원칙(유형 수준까지만).
// 조사점이 (45, 37) 하나뿐이다 — 셋 → 둘 → 하나, 흩어진 단서가 한 자리로 모인다. 그래서 한 자리만 만든다.
// 왜곡 해소(P04)는 distortion 의 단계표가 이미 갖고 있다. 이 모듈은 물건만 놓는다.
// 이야기가 돌아왔다 = 사람들이 다시 이야기한다. 비석이 아니라 여럿이 다녀간 흔적이다:
//   돌무지 여럿 · 금줄 · 소반. 돌무지는 씬1 의 돌탑 표본을 그대로 쓴다(한 사람이 남긴 것을 여럿이 잇는다).
//   무리 이름은 `씬5.돌무지` 로 따로 둔다 — 표본은 같아도 편집 열쇠는 달라야 한다.
// 색은 표본에 진짜로 굽는다. 단위는 도면 m, 표본은 높이 1.

import type * as THREE from "three";

import { createRandom } from "@/engine/random";

import type { Spot } from "../placement/instanceGroups";
import {
  applyColor,
  buildBall,
  buildBox,
  buildCylinder,
  mergePieces,
  placeOnGround,
  type SceneNote,
  type SceneSpotOptions,
} from "./pieceGeometry";

const SCENE5_STYLE = {
  post: "#6B5942",
  postDark: "#3E3327",
  straw: "#B9A472", // 왼새끼 — 금줄은 왼쪽으로 꼰다
  // 이 씬에서 처음으로 원색이 들어온다. 맵이 내내 누런 잿빛이었으니 색이 돌아오는 것 자체가 해소의 신호다.
  clothWhite: "#DCD6C6",
  clothRed: "#A83A33",
  clothBlue: "#3B5F86",
  stone: "#8A8375",
  stoneDark: "#4A463E",
  table: "#7A6647",
  brass: "#9C8A4E", // 놋그릇 — 자갈밭에서 유일한 금속빛
};

/**
 * 금줄 — 기둥 둘 사이에 새끼줄을 치고 천을 맨다. 「여기는 그냥 자갈밭이 아니다」.
 * 팽팽한 줄은 빨랫줄이다 — 제 무게로 가운데가 처져야 금줄로 본다. 줄은 국소 X 축을 따라 걸린다.
 */
export function buildSacredRopePrototypes(count = 2, seed = 8501): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const clothColors = [SCENE5_STYLE.clothWhite, SCENE5_STYLE.clothRed, SCENE5_STYLE.clothBlue];
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    const halfSpan = 1.35 + random() * 0.25; // 높이 1 기준 비율
    const postHeight = 1.0;
    const hangHeight = 0.88; // 줄이 기둥에 걸리는 높이
    const sag = 0.2 + random() * 0.05;
    // 바깥으로 조금 벌려 박는다. 곧게 서면 줄에 끌려 보인다.
    for (const s of [-1, 1]) {
      const post = buildCylinder(0.055, 0.075, postHeight, 6);
      post.translate(0, postHeight / 2, 0);
      post.rotateZ(-s * (0.04 + random() * 0.03));
      post.translate(s * halfSpan, 0, (random() - 0.5) * 0.08);
      pieces.push(applyColor(post, SCENE5_STYLE.post));
      const cap = buildCylinder(0.085, 0.06, 0.07, 6);
      cap.translate(s * halfSpan, postHeight - 0.01, 0);
      pieces.push(applyColor(cap, SCENE5_STYLE.postDark));
    }
    // 처진 줄 — 포물선을 도막으로 잇는다
    const segments = 14;
    const ropeHeight = (t: number) => hangHeight - Math.sin(Math.PI * t) * sag;
    for (let k = 0; k < segments; k++) {
      const t0 = k / segments;
      const t1 = (k + 1) / segments;
      const x0 = -halfSpan + 2 * halfSpan * t0;
      const x1 = -halfSpan + 2 * halfSpan * t1;
      const y0 = ropeHeight(t0);
      const y1 = ropeHeight(t1);
      const length = Math.hypot(x1 - x0, y1 - y0);
      const rope = buildCylinder(0.026, 0.026, length * 1.08, 4);
      rope.rotateZ(Math.PI / 2 - Math.atan2(y1 - y0, x1 - x0));
      rope.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
      pieces.push(applyColor(rope, SCENE5_STYLE.straw));
    }
    // 매단 천 다섯 자락. 금줄에 매는 천은 한 뼘 남짓 — 길면 색칠한 널빤지가 걸린 꼴이다.
    for (let k = 0; k < 5; k++) {
      const t = (k + 0.5) / 5;
      const x = -halfSpan + 2 * halfSpan * t;
      const top = ropeHeight(t);
      const length = 0.14 + random() * 0.11;
      const color = clothColors[k % 3];
      // 두 도막으로 — 바람에 조금 꺾인다
      let y = top;
      let lean = (random() - 0.5) * 0.35;
      for (let j = 0; j < 2; j++) {
        const strip = buildBox(0.045, length / 2, 0.01);
        strip.rotateZ(lean);
        strip.translate(x + Math.sin(lean) * (length / 4), y - length / 4, 0.02);
        pieces.push(applyColor(strip, color));
        y -= length / 2;
        lean += (random() - 0.5) * 0.45;
      }
    }
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

/**
 * 소반 — 누가 와서 차린 작은 상. 큰 제단은 관이 세운 것이고 소반은 사람이 들고 온 것이다.
 * 받침돌 + 소반 + 놋그릇 둘 + 얹은 돌 하나. 그 돌이 「이 자리의 이야기」와 잇는다.
 */
export function buildSmallTablePrototypes(count = 3, seed = 8502): THREE.BufferGeometry[] {
  const random = createRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const pieces: THREE.BufferGeometry[] = [];
    // 자갈밭에 그냥 놓으면 기운다
    const base = buildBall(0.62, 0);
    base.scale(1.15, 0.3, 1.0);
    base.translate(0, 0.1, 0);
    pieces.push(applyColor(base, SCENE5_STYLE.stone));
    const top = buildBox(0.95, 0.075, 0.72);
    top.translate(0, 0.36, 0);
    pieces.push(applyColor(top, SCENE5_STYLE.table));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = buildBox(0.07, 0.16, 0.07);
        leg.translate(sx * 0.38, 0.245, sz * 0.27);
        pieces.push(applyColor(leg, SCENE5_STYLE.table));
      }
    // 물 한 그릇, 밥 한 그릇
    for (let k = 0; k < 2; k++) {
      const r = 0.16 - k * 0.025;
      const bowl = buildCylinder(r * 0.62, r, 0.16, 9);
      bowl.translate(-0.2 + k * 0.42, 0.48, (random() - 0.5) * 0.12);
      pieces.push(applyColor(bowl, SCENE5_STYLE.brass));
      const rim = buildCylinder(r * 1.06, r * 1.06, 0.022, 9);
      rim.translate(-0.2 + k * 0.42, 0.565, 0);
      pieces.push(applyColor(rim, SCENE5_STYLE.brass));
    }
    // 밥과 물만이면 여느 제사다 — 돌무지에 얹는 그 돌이 하나 올라 있다
    const stone = buildBall(0.12, 0);
    stone.scale(1.1, 0.72, 0.9);
    stone.rotateY(random() * 6.3);
    stone.translate(0.06, 0.44, -0.2);
    pieces.push(applyColor(stone, SCENE5_STYLE.stoneDark));
    prototypes.push(mergePieces(pieces));
  }
  return prototypes;
}

type Scene5PropKey = "stonePile" | "sacredRope" | "smallTable";

export const SCENE5_NOTES: Record<Scene5PropKey, SceneNote> = {
  stonePile: { text: "돌무지 여럿 · 씬1 의 돌탑 하나를 여럿이 이었다", color: "#B9E0C8" },
  sacredRope: { text: "금줄 · 여기는 그냥 자갈밭이 아니다 (P04 · 색이 돌아온다)", color: "#F2C89A" },
  smallTable: { text: "소반 · 누가 와서 기렸다", color: "#CFE3B8" },
};

// (45, 37) 은 평탄하고 둘레 2~3 m 가 비었지만 1.9 m 앞에 큰 자갈이 있어 z 36~39 · x 43~48 띠에 몰아 놓는다.
// 금줄을 등지고(북·절벽 쪽) 소반, 사람이 오는 쪽(남·물가)에 돌무지 — 오면서 하나씩 얹은 모양이다.
export function computeScene5Spots({ heightAt }: SceneSpotOptions): Record<Scene5PropKey, Spot[]> {
  return {
    // 다 같은 키면 누가 한 번에 쌓은 것이 되어 「여럿이 하나씩」이 안 읽힌다
    stonePile: placeOnGround(heightAt, [
      { x: 45.0, z: 38.2, size: 0.95, shapeIndex: 0, rotation: 0.4, widthRatio: 0.6, depthRatio: 0.6 },
      { x: 43.9, z: 37.6, size: 0.62, shapeIndex: 1, rotation: 2.1, widthRatio: 0.62, depthRatio: 0.62 },
      { x: 46.2, z: 37.9, size: 0.55, shapeIndex: 2, rotation: 4.0, widthRatio: 0.6, depthRatio: 0.6 },
      { x: 44.4, z: 39.0, size: 0.42, shapeIndex: 0, rotation: 5.2, widthRatio: 0.64, depthRatio: 0.64 },
      { x: 46.0, z: 39.1, size: 0.36, shapeIndex: 1, rotation: 1.3, widthRatio: 0.66, depthRatio: 0.66 },
      { x: 43.5, z: 38.6, size: 0.3, shapeIndex: 2, rotation: 3.3, widthRatio: 0.68, depthRatio: 0.68 },
      // 조금 떨어져 하나 더 — 무리가 자라나는 중이라는 표시
      { x: 47.1, z: 38.7, size: 0.33, shapeIndex: 0, rotation: 0.9, widthRatio: 0.64, depthRatio: 0.64 },
    ]),

    // 자리 뒤쪽(−Z)에 하나. 키 1.5 m 면 눈높이 아래에 줄이 걸려 가리지 않고 구획한다.
    sacredRope: placeOnGround(heightAt, [{ x: 45.0, z: 36.2, size: 1.5, shapeIndex: 0, rotation: 0.12 }]),

    // 조사점 (45, 37) 그 자리. 한 사람이 들고 오는 크기(상판 0.73 m).
    smallTable: placeOnGround(heightAt, [{ x: 45.0, z: 37.0, size: 0.38, shapeIndex: 0, rotation: 0.12 }]),
  };
}
