/**
 * 살아난 구렁이 — 바위의 홈에 끼운 구렁이상이 몸을 풀고 내려와, 곁을 스르르 지나 미끄러진 자국을 따라 벼랑 끝으로 사라진다.
 * 몸은 등뼈를 따라 고리를 이어 붙인 한 줄기 관이다 — 머리가 낸 굽잇길을 몸이 그대로 따라간다(뱀이 기는 법).
 * 홈에서 풀려나오며 돌상 크기에서 제 크기로 자란다. 좌표는 미터, 그리는 것은 유닛(M 배). 시각은 살아난 뒤 흐른 초.
 */
import * as THREE from "three";

import { makeToonMaterial } from "../materials";
import { M } from "../units";
import { EDGE_RIFT, FALL_SPOT, SERPENT_STONE } from "./cliffShape";
import { floorAt } from "./riteScene";

/** 몸 — 길이 · 가장 굵은 데의 반지름(미터) · 등뼈를 나눈 고리 수 · 고리 하나의 꼭짓점 수 */
// 11/11 움직임 점검 — 밤 바위 위에서 거의 안 보였다(굵기 0.034 · 제 빛 0.32). 조금 굵게, 제 빛을 올린다
const BODY = { length: 1.75, girth: 0.043, rings: 84, sides: 12 };
/** 기는 빠르기(m/s) */
const SPEED = 0.95;
/** 굽잇길 — 좌우 너비(미터) · 한 굽이의 길이(미터) */
const WAVE = { width: 0.075, length: 0.6 };
/** 풀려나올 때의 크기(제 크기의 배) · 제 크기로 자라는 데 걸리는 시간(초) */
const GROW = { from: 0.4, seconds: 1.6 };
/** 머리를 드는 높이(미터) — 막 풀려났을 때 · 기어갈 때. 목 길이(미터)만큼이 들린다 */
const HEAD_LIFT = { waking: 0.13, crawling: 0.035, neck: 0.3 };
/** 비늘 무늬 한 벌이 덮는 몸 길이(미터) */
const SCALE_TILE = 0.13;

/** 구렁이가 지나는 길 — 홈에서 바위를 내려와, 다가선 사람 곁(북서)을 돌아 미끄러진 자국을 따라 벼랑 끝 너머로 */
const ROUTE: readonly (readonly [number, number])[] = [
  [SERPENT_STONE.x, SERPENT_STONE.z],
  [SERPENT_STONE.x - 0.5, SERPENT_STONE.z - 0.35],
  [SERPENT_STONE.x - 1.05, SERPENT_STONE.z - 0.55],
  [FALL_SPOT.x - 0.25, FALL_SPOT.z - 0.55],
  [FALL_SPOT.x, FALL_SPOT.z],
  [EDGE_RIFT.x, EDGE_RIFT.z + 0.15],
  [EDGE_RIFT.x + 0.05, EDGE_RIFT.z + 0.9],
];

/**
 * 비늘 무늬 — 가로는 몸 길이 쪽(되풀이), 세로는 몸 둘레(가운데가 등, 위아래 끝이 배).
 * 누런 몸에 검은 얼룩이 등에 얹히고 배는 희누렇다(황구렁이). 비늘은 엇갈린 마름모 금으로 넣는다
 */
function makeScaleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  const skin = g.createLinearGradient(0, 0, 0, 256);
  skin.addColorStop(0, "#E4D7A0");
  skin.addColorStop(0.2, "#B79B4A");
  skin.addColorStop(0.5, "#6E5A26");
  skin.addColorStop(0.8, "#B79B4A");
  skin.addColorStop(1, "#E4D7A0");
  g.fillStyle = skin;
  g.fillRect(0, 0, 256, 256);
  // 등의 검은 얼룩 — 한 벌에 둘, 가장자리가 톱니처럼 번진다
  g.fillStyle = "rgba(34,26,12,0.62)";
  for (const [center, wide, tall] of [
    [58, 24, 40],
    [186, 30, 34],
  ]) {
    g.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const jag = 1 + 0.2 * Math.sin(a * 7 + center);
      g.lineTo(center + Math.cos(a) * wide * jag, 128 + Math.sin(a) * tall * jag);
    }
    g.fill();
  }
  // 비늘 — 엇갈린 마름모 금. 배 쪽(위아래 끝)은 가로로 긴 배비늘
  g.lineWidth = 1.4;
  for (let row = 0; row < 16; row++) {
    const y = row * 16;
    const isBelly = row < 2 || row > 13;
    g.strokeStyle = isBelly ? "rgba(90,70,30,0.35)" : "rgba(20,15,6,0.42)";
    for (let column = 0; column < 16; column++) {
      const x = column * 16 + (row % 2) * 8;
      g.beginPath();
      if (isBelly) {
        g.moveTo(x, y);
        g.lineTo(x, y + 16);
      } else {
        g.moveTo(x, y + 8);
        g.lineTo(x + 8, y);
        g.lineTo(x + 16, y + 8);
        g.lineTo(x + 8, y + 16);
        g.closePath();
      }
      g.stroke();
    }
  }
  // 비늘마다 윗모서리에 달빛이 살짝 걸린다
  g.fillStyle = "rgba(255,246,210,0.16)";
  for (let row = 2; row < 14; row++) {
    for (let column = 0; column < 16; column++) g.fillRect(column * 16 + (row % 2) * 8 + 5, row * 16 + 2, 5, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** 몸 길이의 t(0 주둥이 ~ 1 꼬리 끝) 자리의 굵기(가장 굵은 데의 배) — 주둥이는 둥글고, 머리가 목보다 넓고, 꼬리로 가늘어진다 */
function girthAt(t: number) {
  if (t < 0.03) return 1.22 * Math.sin((t / 0.03) * (Math.PI / 2)) ** 0.6;
  if (t < 0.075) return THREE.MathUtils.lerp(1.22, 0.8, (t - 0.03) / 0.045);
  if (t < 0.3) return THREE.MathUtils.lerp(0.8, 1, (t - 0.075) / 0.225);
  if (t < 0.58) return 1;
  return Math.max(0, 1 - (t - 0.58) / 0.42) ** 0.8;
}

export function buildSerpentRun() {
  const curve = new THREE.CatmullRomCurve3(ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const length = curve.getLength();
  const ringSize = BODY.sides + 1;
  const count = BODY.rings * ringSize;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uvs = new Float32Array(count * 2);
  const indices: number[] = [];
  for (let ring = 0; ring < BODY.rings; ring++) {
    for (let side = 0; side <= BODY.sides; side++) {
      const index = ring * ringSize + side;
      uvs[index * 2] = ((ring / (BODY.rings - 1)) * BODY.length) / SCALE_TILE;
      // 고리는 배 아래에서 시작해 한 바퀴 — 무늬의 세로 가운데가 등에 온다
      uvs[index * 2 + 1] = side / BODY.sides;
      if (ring < BODY.rings - 1 && side < BODY.sides) {
        const next = index + ringSize;
        indices.push(index, next, index + 1, index + 1, next, next + 1);
      }
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const scales = makeScaleTexture();
  // 밤이라 제 빛을 조금 낸다 — 달빛만으로는 무늬가 묻힌다
  const skin = makeToonMaterial("#FFFFFF", {
    map: scales,
    emissive: new THREE.Color("#FFFFFF"),
    emissiveMap: scales,
    emissiveIntensity: 0.62,
  });
  const body = new THREE.Mesh(geometry, skin);
  body.frustumCulled = false;
  body.castShadow = true;
  body.visible = false;
  // 눈 — 머리 양옆, 검은 눈에 달빛 한 점
  const eyes = [-1, 1].map(() => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: "#0B0906" }));
    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 6, 5),
      new THREE.MeshBasicMaterial({ color: "#FFF3C4", toneMapped: false }),
    );
    glint.position.set(0.3, 0.55, 0.5);
    eye.add(glint);
    eye.visible = false;
    return eye;
  });
  // 혀 — 끝이 둘로 갈라진 붉은 혀가 날름거린다. 앞(+z)으로 뻗는다
  const tongueShape = new THREE.Shape();
  tongueShape.moveTo(-0.08, 0);
  tongueShape.lineTo(-0.08, 0.6);
  tongueShape.lineTo(-0.32, 1);
  tongueShape.lineTo(0, 0.74);
  tongueShape.lineTo(0.32, 1);
  tongueShape.lineTo(0.08, 0.6);
  tongueShape.lineTo(0.08, 0);
  const tongue = new THREE.Mesh(
    new THREE.ShapeGeometry(tongueShape).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#B3202A", side: THREE.DoubleSide }),
  );
  tongue.visible = false;
  const root = new THREE.Group();
  root.name = "cliff.serpentRun";
  root.add(body, ...eyes, tongue);
  return {
    root,
    body,
    eyes,
    tongue,
    curve,
    length,
    /** 다 지나가는 데 걸리는 시간(초) */
    seconds: (length + BODY.length) / SPEED,
    /** 바위 윗면 높이(미터) — 모형을 읽은 뒤 serpentStone 이 잰 값을 넣는다 */
    stoneTop: floorAt(SERPENT_STONE.x, SERPENT_STONE.z) + SERPENT_STONE.size * 0.3,
    /** 등뼈 — 고리마다의 자리(유닛) · 그 자리의 굵기(미터) */
    spine: Array.from({ length: BODY.rings }, () => new THREE.Vector3()),
    girths: new Float32Array(BODY.rings),
    at: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    side: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
}

type SerpentRun = ReturnType<typeof buildSerpentRun>;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** 길 위 along 미터 자리의 바닥 높이(미터) — 바위 위에서는 윗면, 내려서며 땅으로 */
function heightAt(run: SerpentRun, x: number, z: number, along: number) {
  const ground = floorAt(x, z);
  // 처음 반 미터 남짓은 바위 위 · 가장자리를 타고 내려온다
  const onStone = 1 - THREE.MathUtils.smoothstep(along, 0.3, 0.75);
  // 벼랑 끝을 넘으면 틈 속으로 잠긴다
  const sink = THREE.MathUtils.smoothstep(along, run.length - 0.7, run.length) * 0.5;
  return THREE.MathUtils.lerp(ground, run.stoneTop, onStone) - sink;
}

/** 살아난 뒤 seconds 초의 모습 — 아직이거나 다 지나갔으면 감춘다 */
export function updateSerpentRun(run: SerpentRun, seconds: number, time: number) {
  const isOut = seconds >= 0 && seconds < run.seconds + 0.3;
  run.body.visible = isOut;
  run.tongue.visible = false;
  for (const eye of run.eyes) eye.visible = isOut;
  if (!isOut) return;
  const grow = THREE.MathUtils.lerp(GROW.from, 1, THREE.MathUtils.smoothstep(seconds, 0, GROW.seconds));
  const bodyLength = BODY.length * grow;
  const head = seconds * SPEED;
  const lift = THREE.MathUtils.lerp(
    HEAD_LIFT.waking,
    HEAD_LIFT.crawling,
    THREE.MathUtils.smoothstep(seconds, 0.5, 1.5),
  );
  const { at, tangent, side, up, spine, girths } = run;

  // 1) 등뼈 — 머리가 지나간 굽잇길 위에 고리를 놓는다
  for (let ring = 0; ring < BODY.rings; ring++) {
    const t = ring / (BODY.rings - 1);
    const behind = t * bodyLength;
    const along = head - behind;
    // 아직 홈에서 안 풀려난 데 · 벌써 틈으로 사라진 데는 굵기 없이 접는다
    const isShown = along > 0 && along < run.length;
    const u = THREE.MathUtils.clamp(along / run.length, 0, 1);
    run.curve.getPointAt(u, at);
    run.curve.getTangentAt(u, tangent);
    // 굽이는 땅에 그려진 길이다 — 홈을 막 나선 데서는 좁고 차츰 넓어진다
    const sway =
      Math.sin((along / WAVE.length) * Math.PI * 2) * WAVE.width * THREE.MathUtils.smoothstep(along, 0, 0.5) * grow;
    const x = at.x - tangent.z * sway;
    const z = at.z + tangent.x * sway;
    const girth = isShown ? BODY.girth * grow * girthAt(t) : 0;
    // 목을 든다 — 머리로 갈수록 높이, 숨 쉬듯 조금 까딱인다
    const neck = Math.max(0, 1 - behind / (HEAD_LIFT.neck * grow)) ** 2;
    const raised = neck * (lift + 0.012 * Math.sin(time * 2.6)) * grow;
    girths[ring] = girth;
    spine[ring].set(x * M, (heightAt(run, x, z, Math.max(along, 0)) + girth * 0.8 + raised) * M, z * M);
  }

  // 2) 살 — 고리마다 등뼈 둘레로 꼭짓점을 돌린다. 몸은 위아래로 조금 눌렸다
  const positions = run.body.geometry.attributes.position as THREE.BufferAttribute;
  const normals = run.body.geometry.attributes.normal as THREE.BufferAttribute;
  for (let ring = 0; ring < BODY.rings; ring++) {
    const ahead = spine[Math.max(ring - 1, 0)];
    const back = spine[Math.min(ring + 1, BODY.rings - 1)];
    tangent.subVectors(ahead, back);
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1);
    tangent.normalize();
    side.crossVectors(WORLD_UP, tangent);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    up.crossVectors(tangent, side);
    const wide = girths[ring] * M;
    const tall = wide * 0.8;
    for (let k = 0; k <= BODY.sides; k++) {
      // 배 아래(−up)에서 시작해 한 바퀴
      const angle = (k / BODY.sides) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const index = ring * (BODY.sides + 1) + k;
      positions.setXYZ(
        index,
        spine[ring].x + side.x * cos * wide + up.x * sin * tall,
        spine[ring].y + side.y * cos * wide + up.y * sin * tall,
        spine[ring].z + side.z * cos * wide + up.z * sin * tall,
      );
      normals.setXYZ(index, side.x * cos + up.x * sin, side.y * cos + up.y * sin, side.z * cos + up.z * sin);
    }
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;

  // 3) 머리 — 눈과 혀. 머리가 가장 넓은 고리(주둥이 뒤) 양옆에 눈을 단다
  const headRing = Math.round(0.03 * (BODY.rings - 1));
  const headAt = spine[headRing];
  const headGirth = girths[headRing] * M;
  tangent.subVectors(spine[0], spine[headRing + 1]).normalize();
  side.crossVectors(WORLD_UP, tangent).normalize();
  up.crossVectors(tangent, side);
  run.eyes.forEach((eye, index) => {
    const sign = index === 0 ? -1 : 1;
    eye.visible = headGirth > 0;
    eye.position
      .copy(headAt)
      .addScaledVector(side, sign * headGirth * 0.78)
      .addScaledVector(up, headGirth * 0.42)
      .addScaledVector(tangent, headGirth * 0.2);
    eye.scale.setScalar(headGirth * 0.2);
    eye.lookAt(at.copy(eye.position).addScaledVector(side, sign).addScaledVector(up, 0.4));
  });
  // 혀는 짧게 날름 — 1.3초에 한 번, 두 번 떤다
  const flick = (time % 1.3) / 1.3;
  const out = flick < 0.3 ? Math.sin((flick / 0.3) * Math.PI) : 0;
  run.tongue.visible = headGirth > 0 && out > 0.05;
  if (run.tongue.visible) {
    run.tongue.position.copy(spine[0]).addScaledVector(up, -headGirth * 0.15);
    run.tongue.scale.set(headGirth * 0.5, headGirth, headGirth * 1.6 * out);
    run.tongue.lookAt(at.copy(run.tongue.position).add(tangent));
    run.tongue.rotateX(Math.sin(time * 46) * 0.22);
  }
}
