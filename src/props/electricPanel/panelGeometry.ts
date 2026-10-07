/** 배전반 함·기기 몸통 지오. 실물 저압 분전반 그대로 — 위: 주차단기·변류기함·접지 동판, 가운데: 부스바, 아래: 분기 스위치. */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { mergeBoxes, type MergeBox } from "@/engine/geometry";

import type { PanelLayout } from "./panelLayout";

function mergeAndDispose(pieces: THREE.BufferGeometry[]) {
  if (pieces.length === 1) return pieces[0];
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

/** 함 속 통 — 앞이 열린 어두운 상자 */
function shell({ X, innerWidth, innerHeight, dims }: PanelLayout) {
  const back = X(0.03);
  const { depth } = dims;
  return mergeBoxes([
    { size: [0.06, innerHeight, innerWidth], position: [back, 0, 0] },
    { size: [depth * 0.9, 0.06, innerWidth], position: [0, innerHeight / 2, 0] },
    { size: [depth * 0.9, 0.06, innerWidth], position: [0, -innerHeight / 2, 0] },
    { size: [depth * 0.9, innerHeight, 0.06], position: [0, 0, -innerWidth / 2] },
    { size: [depth * 0.9, innerHeight, 0.06], position: [0, 0, innerWidth / 2] },
  ]);
}

/** 기기를 볼트로 물리는 뒷판 + 네 귀퉁이 받침 */
function backPlate({ X, plateT, plateThickness, innerWidth, innerHeight, depthScale, deep }: PanelLayout) {
  const boxes: MergeBox[] = [
    { size: [plateThickness, innerHeight - 0.12, innerWidth - 0.12], position: [X(plateT), 0, 0] },
  ];
  for (const sy of [-1, 1])
    for (const sz of [-1, 1])
      boxes.push({
        size: [0.05 * depthScale, 0.05, 0.05],
        position: [deep(-0.045), sy * (innerHeight / 2 - 0.11), sz * (innerWidth / 2 - 0.11)],
      });
  return mergeBoxes(boxes);
}

/** 동판 — 접지바 · 세로 부스바 · 줄마다 뻗는 접속편. 접속편이 있어야 차단기가 무엇에 물렸는지 읽힌다. */
function copper(layout: PanelLayout) {
  const { deep, depthScale, groundTop, groundBottom, groundZ, busTop, busBottom, busZ, busThickness } = layout;
  const { rowYs, columnZ, breakerWidth, dims } = layout;
  const boxes: MergeBox[] = [];
  const groundLength = Math.max(0.1, groundTop - groundBottom);
  boxes.push({
    size: [0.022 * depthScale, groundLength, dims.groundWidth],
    position: [deep(0.011), (groundTop + groundBottom) / 2, groundZ],
  });
  const busLength = Math.max(0.1, busTop - busBottom);
  for (const bz of busZ)
    boxes.push({
      size: [0.022 * depthScale, busLength, busThickness],
      position: [deep(0.045), (busTop + busBottom) / 2, bz],
    });
  // 줄마다 물리는 상(相)이 돈다(R→S→T)
  rowYs.forEach((y, r) => {
    const bz = busZ[r % 3];
    for (const s of [-1, 1]) {
      const innerEnd = columnZ[s > 0 ? 1 : 0] - s * (breakerWidth / 2);
      const length = Math.abs(innerEnd - bz) + 0.02;
      boxes.push({
        size: [0.032 * depthScale, 0.024, length],
        position: [deep(0.06), y, (bz + innerEnd) / 2],
      });
    }
  });
  return mergeBoxes(boxes);
}

/** 분기 스위치 몸통. 전부 같은 회색 — 이을 짝을 알려 주는 건 스위치가 아니라 선의 색이다. */
function breakerBodies({ rowYs, columnZ, breakerDepth, breakerHeight, breakerWidth, depthScale, deep }: PanelLayout) {
  const boxes: MergeBox[] = [];
  rowYs.forEach((y) => {
    for (const z of columnZ)
      boxes.push({
        size: [breakerDepth * depthScale, breakerHeight, breakerWidth],
        position: [deep(breakerDepth / 2), y, z],
      });
  });
  return mergeBoxes(boxes);
}

/**
 * 어두운 면 — 주차단기·변류기함 몸통, 단자 덮개, 접속함, 클램프, 스위치 앞 창.
 * 몸통이 전부 흰색이면 흰 벽돌 더미라 앞면만 어둡게 덮어 한 줄 한 줄 기기로 끊는다.
 * 주차단기는 앞·옆·위·아래가 같은 색이라야 한 덩어리로 보여 몸통째 여기 둔다.
 */
function darkFaces(layout: PanelLayout) {
  const { deep, depthScale, mainY, mainZ, mainWidth, mainDepth, mainHeight } = layout;
  const { meterZ, meterWidth, meterHeight, junctionY, junctionDepth, junctionHeight } = layout;
  const { innerWidth, innerHeight, inletWidth, inletCenter, dims } = layout;
  const { rowYs, columnZ, breakerDepth, breakerHeight, breakerWidth } = layout;
  const boxes: MergeBox[] = [
    { size: [mainDepth * depthScale, mainHeight, mainWidth], position: [deep(mainDepth / 2), mainY, mainZ] },
    // 변류기함 — 안쪽 밝은 창만 따로 낸다
    { size: [0.12 * depthScale, meterHeight, meterWidth], position: [deep(0.06), mainY, meterZ] },
    // 주차단기 앞 면 + 위아래 단자 덮개
    {
      size: [0.02 * depthScale, mainHeight * 0.76, mainWidth * 0.9],
      position: [deep(mainDepth + 0.008), mainY, mainZ],
    },
    ...[-1, 1].map((sy): MergeBox => ({
      size: [0.05 * depthScale, mainHeight * 0.16, mainWidth * 0.95],
      position: [deep(mainDepth - 0.02), mainY + sy * mainHeight * 0.42, mainZ],
    })),
    // 끊어진 자리의 접속함 — 굵은 케이블이 허공에서 가는 선 셋으로 바뀌면 마술처럼 보인다.
    // 덮개(불 들어오는 판)는 함 전체가 같이 빛나지 않게 따로 그린다.
    {
      size: [0.1 * depthScale, junctionHeight, innerWidth * dims.junctionWidth],
      position: [deep(junctionDepth), junctionY, 0],
    },
    // 인입 다발 클램프 — 없으면 케이블이 허공에서 시작한 것처럼 보인다
    {
      size: [0.055 * depthScale, 0.024, inletWidth],
      position: [deep(0.085), innerHeight / 2 - 0.055, inletCenter],
    },
  ];
  // 실물 배선용 차단기는 앞면 한가운데가 네모나게 파여 그 안에 손잡이가 선다.
  // 손잡이가 좌우로 미끄러지는 창이라 가로로 길다.
  rowYs.forEach((y) => {
    for (const s of [-1, 1]) {
      const z = columnZ[s > 0 ? 1 : 0];
      boxes.push({
        size: [0.022 * depthScale, breakerHeight * 0.56, breakerWidth * 0.54],
        position: [deep(breakerDepth + 0.004), y, z],
      });
      // 창 위아래 가로띠
      for (const sy of [-1, 1])
        boxes.push({
          size: [0.016 * depthScale, breakerHeight * 0.08, breakerWidth * 0.76],
          position: [deep(breakerDepth + 0.004), y + sy * breakerHeight * 0.38, z],
        });
      // 바깥 끝 단자 덮개
      boxes.push({
        size: [0.06 * depthScale, breakerHeight * 0.9, 0.03],
        position: [deep(breakerDepth * 0.72), y, z + s * (breakerWidth / 2 - 0.012)],
      });
    }
  });
  return mergeBoxes(boxes);
}

/** 관창 구멍 — 동그라미를 그리면 스티커로 보여 실제로 판다. 바닥은 벽보다 어둡게 따로 그린다. */
function socket({ dims, socketRadius, socketY, socketHollow, plateFront, X, meterZ }: PanelLayout) {
  if (!dims.hasSocket) return null;
  const { d } = dims;
  const rimRadius = socketRadius * 1.34;
  const front = plateFront;
  const back = plateFront - socketHollow;
  const ring = new THREE.RingGeometry(socketRadius, rimRadius, 20, 1);
  ring.rotateY((d * Math.PI) / 2);
  ring.translate(X(front + 0.016), socketY, meterZ);
  const rimWall = new THREE.CylinderGeometry(rimRadius, rimRadius, 0.016, 20, 1, true);
  rimWall.rotateZ(Math.PI / 2);
  rimWall.translate(X(front + 0.008), socketY, meterZ);
  const rim = mergeAndDispose([ring, rimWall]);
  const bore = new THREE.CylinderGeometry(socketRadius, socketRadius, socketHollow + 0.016, 20, 1, true);
  bore.rotateZ(Math.PI / 2);
  bore.translate(X((back + front + 0.016) / 2), socketY, meterZ);
  const bottom = new THREE.CircleGeometry(socketRadius * 0.99, 20);
  bottom.rotateY((d * Math.PI) / 2);
  bottom.translate(X(back), socketY, meterZ);
  return { rim, bore, bottom };
}

/** 표시등 원판. which 를 주면 그 한 알만. */
function lampDisc(
  { lampYs, lampZ, depthScale, deep }: PanelLayout,
  outerRadius: number,
  innerRadius: number,
  thickness: number,
  depthOffset: number,
  which?: 0 | 1,
) {
  const ys = which === undefined ? lampYs : [lampYs[which]];
  return mergeAndDispose(
    ys.map((y) => {
      const g = new THREE.CylinderGeometry(outerRadius, innerRadius, thickness * depthScale, 14, 1);
      g.rotateZ(Math.PI / 2); // 앞을 보게 눕힌다
      g.translate(deep(depthOffset), y, lampZ);
      return g;
    }),
  );
}

/** 볼트·단자 나사·변류기 고리. 부스바 꼭대기 볼트는 회로마다 따로 켜져야 해서 여기 없다. */
function metalParts(layout: PanelLayout) {
  const {
    deep,
    depthScale,
    groundTop,
    groundBottom,
    groundZ,
    busZ,
    busBottom,
    mainY,
    meterZ,
    meterWidth,
    meterHeight,
  } = layout;
  const pieces: THREE.BufferGeometry[] = [];
  const bolt = (x: number, y: number, z: number) => {
    const g = new THREE.CylinderGeometry(0.016, 0.016, 0.03 * depthScale, 6, 1);
    g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    pieces.push(g);
  };
  const n = Math.max(2, Math.floor((groundTop - groundBottom) / 0.09));
  for (let k = 0; k < n; k++) bolt(deep(0.035), groundBottom + ((k + 0.5) * (groundTop - groundBottom)) / n, groundZ);
  for (const bz of busZ) bolt(deep(0.07), busBottom + 0.03, bz);
  for (let k = 0; k < 3; k++) {
    const g = new THREE.TorusGeometry(meterHeight * 0.17, Math.min(meterHeight * 0.055, 0.03 * depthScale), 6, 12);
    g.rotateY(Math.PI / 2);
    g.translate(deep(0.07), mainY, meterZ + (k - 1) * meterWidth * 0.28);
    pieces.push(g);
  }
  return mergeAndDispose(pieces);
}

export function buildPanelGeometries(layout: PanelLayout) {
  const { deep, depthScale, dims, mainY, mainZ, mainWidth, mainDepth, mainHeight } = layout;
  const { meterZ, meterWidth, meterHeight, junctionY, junctionDepth, junctionHeight, innerWidth } = layout;
  const { lampRadius, busZ, busTop, rowYs, breakerHeight, breakerWidth, tagWidth } = layout;
  return {
    shell: shell(layout),
    backPlate: backPlate(layout),
    copper: copper(layout),
    breakerBodies: breakerBodies(layout),
    darkFaces: darkFaces(layout),
    // 계기창 안쪽 밝은 판 — 테두리와 한 메시면 테두리까지 같이 빛난다
    display: mergeBoxes([
      {
        size: [0.022 * depthScale, meterHeight * dims.displayHeight, meterWidth * dims.displayWidth],
        position: [deep(0.132), mainY, meterZ],
      },
    ]),
    // 접속함 덮개 — 세 색이 제 짝을 찾으면 전기가 이 매듭을 지나간다는 걸 빛으로 말한다
    junctionCover: mergeBoxes([
      {
        size: [0.03 * depthScale, junctionHeight * 0.72, innerWidth * dims.junctionWidth * 0.74],
        position: [deep(junctionDepth + 0.055), junctionY, 0],
      },
    ]),
    socket: socket(layout),
    lampRims: lampDisc(layout, lampRadius * 0.885, lampRadius, 0.05, 0.025),
    // 알은 색이 달라 따로. 위가 빨강, 아래가 초록.
    redLamp: lampDisc(layout, lampRadius * dims.redLampSize, lampRadius * dims.redLampSize * 0.91, 0.026, 0.056, 0),
    greenLamp: lampDisc(
      layout,
      lampRadius * dims.greenLampSize,
      lampRadius * dims.greenLampSize * 0.91,
      0.026,
      0.056,
      1,
    ),
    // 주차단기 레버 — 위쪽으로. 가운데면 바로 아래 「전기위험」 딱지를 덮는다.
    mainLever: mergeBoxes([
      {
        size: [0.055 * depthScale, mainHeight * 0.26, mainWidth * 0.16],
        position: [deep(mainDepth + 0.026), mainY + mainHeight * 0.24, mainZ],
        rotation: [0.26, 0, 0],
      },
    ]),
    knob: new THREE.BoxGeometry(0.05 * depthScale, breakerHeight * dims.knobHeight, breakerWidth * dims.knobWidth),
    metal: metalParts(layout),
    // 부스바 꼭대기 볼트 셋 — 색 하나가 선도 잇고 차단기도 올라가면 그 자리에 불이 든다
    indicatorBolts: busZ.map((bz) => {
      const g = new THREE.CylinderGeometry(0.019, 0.019, 0.034 * depthScale, 10, 1);
      g.rotateZ(Math.PI / 2);
      g.translate(deep(0.07), busTop - 0.03, bz);
      return g;
    }),
    // 노란 회로 표찰 — 줄마다 가운데 한 장
    tags: mergeBoxes(
      rowYs.map((y): MergeBox => ({
        size: [0.008 * depthScale, Math.min(0.034, breakerHeight * 0.44), tagWidth],
        position: [deep(0.092), y, 0],
      })),
    ),
  };
}

export type PanelGeometries = ReturnType<typeof buildPanelGeometries>;

export function disposePanelGeometries(geometries: PanelGeometries) {
  const { socket: socketParts, indicatorBolts, ...rest } = geometries;
  Object.values(rest).forEach((g) => g?.dispose());
  indicatorBolts.forEach((g) => g.dispose());
  socketParts?.rim.dispose();
  socketParts?.bore.dispose();
  socketParts?.bottom.dispose();
}
