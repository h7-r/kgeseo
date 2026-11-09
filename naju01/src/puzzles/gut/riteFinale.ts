/**
 * 굿이 풀리는 연출 — 불기둥이 하늘로 치솟고, 불길이 횃불대를 타고 내려와 땅을 달려 소반에 모인다.
 * 소반이 타오르며 가락지 한 쌍이 불길 위로 떠올라 하늘로 사라지고, 불과 바람이 잦아든다.
 * 언제 무엇이 일어나는지는 gutShape.FINALE 이 정한다. 여기는 만들고, 풀린 뒤 r 초의 모습으로 놓는 것만 한다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import * as THREE from "three";

import { buildGroundRibbon, floorAt, planar } from "../cliff/riteScene";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { makeGlowTexture } from "../glowTexture";
import { M, groundY } from "../units";
import { FINALE, STAKES, TABLE } from "./gutShape";
import { FIRE_SEAT } from "./torchPost";

/**
 * 불기둥 하나의 불티 수 · 횃불대를 타는 불 · 땅을 달리는 불(줄마다) · 소반의 불 · 소반에서 터지는 불똥 · 가락지를 따르는 빛가루
 */
const SURGE_POINTS = 130;
const POST_POINTS = 22;
const LINE_POINTS = 44;
const TABLE_POINTS = 220;
const BURST_POINTS = 80;
const TRAIL_POINTS = 36;
/** 소반의 불 — 불길 높이 · 밑동 반지름(미터) */
const TABLE_FIRE = { height: 3.2, radius: 0.5 };
/** 불똥이 터지는 때 — 불이 붙는 순간 · 소반이 무너지는 순간. 한 번 터져 날아가는 시간(초) · 날아가는 거리(미터) */
const BURST = { seconds: 1.5, reach: 2.6 };
/** 땅을 달린 불이 남기는 그을음 너비(미터) */
const SCORCH_WIDTH = 0.34;

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
const smooth = THREE.MathUtils.smoothstep;

/** 그을음 — 불이 지나간 자리가 검게 타고, 가장자리에 불씨가 잠깐 벌겋다(uHeat 1 → 0) */
function makeScorchMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uHeat: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uHeat;
      varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        #include <logdepthbuf_fragment>
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float ragged = 0.3 * noise(vec2(vUv.x * 26.0, 2.0)) + 0.2 * noise(vec2(vUv.x * 70.0, 9.0));
        float body = smoothstep(ragged, ragged + 0.4, across);
        float reached = 1.0 - smoothstep(uProgress - 0.03, uProgress, vUv.x);
        float ember = smoothstep(0.55, 0.9, noise(vUv * vec2(90.0, 9.0))) * uHeat;
        vec3 color = mix(vec3(0.02, 0.016, 0.014), vec3(1.6, 0.5, 0.12), ember * body);
        float alpha = reached * body * 0.72;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
  });
}

export function buildFinale() {
  const root = new THREE.Group();
  root.name = "gut.finale";
  const tableTop = groundY(TABLE.x, TABLE.z) + TABLE.top;
  const lines = STAKES.map((stake) => {
    // 횃불대 발치에서 소반 발치까지 — 곧게, 조금 휘어
    const bend = {
      x: (stake.x + TABLE.x) / 2 + (TABLE.z - stake.z) * 0.07,
      z: (stake.z + TABLE.z) / 2 + (stake.x - TABLE.x) * 0.07,
    };
    const path: [number, number][] = [
      [stake.x, stake.z],
      [bend.x, bend.z],
      [TABLE.x + (stake.x - TABLE.x) * 0.06, TABLE.z + (stake.z - TABLE.z) * 0.06],
    ];
    const material = makeScorchMaterial();
    const scorch = new THREE.Mesh(buildGroundRibbon(path, SCORCH_WIDTH, 0.8), material);
    scorch.renderOrder = 1;
    scorch.visible = false;
    root.add(scorch);
    return {
      scorch,
      material,
      curve: new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z))),
      base: planar(stake.x, stake.z),
      top: planar(stake.x, stake.z, FIRE_SEAT),
    };
  });
  const surge = makeGlowPoints(lines.length * SURGE_POINTS, { additive: true, softness: 1.5 });
  const count = lines.length * (POST_POINTS + LINE_POINTS) + TABLE_POINTS + BURST_POINTS + TRAIL_POINTS;
  const flames = makeGlowPoints(count, { additive: true, softness: 1.5 });
  surge.points.visible = false;
  flames.points.visible = false;
  // 소반이 탄 자리 — 검게 그을린 둥근 자국
  const ash = new THREE.Mesh(
    new THREE.CircleGeometry(0.95 * M, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: "#050404",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  ash.position.copy(planar(TABLE.x, TABLE.z, 0.012));
  ash.renderOrder = 1;
  // 섬광 — 소반에 불이 붙는 순간과 무너지는 순간, 굿판이 한 번 환해진다
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: "#FFC27A",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  flash.position.set(TABLE.x * M, (tableTop + 0.5) * M, TABLE.z * M);
  flash.visible = false;
  root.add(surge.points, flames.points, ash, flash);
  return {
    root,
    lines,
    surge,
    flames,
    ash,
    flash,
    seeds: Float32Array.from({ length: (lines.length * SURGE_POINTS + count) * 3 }, () => Math.random()),
    tableAt: new THREE.Vector3(TABLE.x * M, tableTop * M, TABLE.z * M),
    scratch: new THREE.Vector3(),
  };
}

type Finale = ReturnType<typeof buildFinale>;

/**
 * 굿이 풀린 뒤 r 초의 모습으로 놓는다(그 전이면 음수). 그 순간의 세기들을 돌려준다 —
 *   surge 불기둥 · wind 바람 · tableFire 소반의 불 · charred 소반이 탄 정도 · flash 섬광
 *   ringsRise 가락지가 오른 높이(미터) · ringsFade 가락지가 사라진 정도
 */
export function updateFinale(
  finale: Finale,
  r: number,
  time: number,
  view: { gl: THREE.WebGLRenderer; camera: THREE.Camera },
) {
  const isOn = r >= 0;
  const surge = isOn ? smooth(r, 0, FINALE.rise) * (1 - smooth(r, FINALE.descendAt, FINALE.runAt)) : 0;
  const wind = isOn ? smooth(r, 0, 1.2) * (1 - smooth(r, FINALE.descendAt, FINALE.burntAt)) : 0;
  const descend = isOn ? clamp01((r - FINALE.descendAt) / (FINALE.runAt - FINALE.descendAt)) : 0;
  const run = isOn ? smooth(r, FINALE.runAt, FINALE.igniteAt) : 0;
  /** 횃불대와 땅의 불은 소반에 옮겨붙은 뒤 차례로 꺼진다 */
  const dying = isOn ? smooth(r, FINALE.igniteAt + 0.6, FINALE.igniteAt + 3.6) : 0;
  const tableFire = isOn
    ? smooth(r, FINALE.igniteAt, FINALE.igniteAt + 0.9) * (1 - smooth(r, FINALE.burntAt, FINALE.endAt))
    : 0;
  /** 소반이 탄 정도 — 불이 붙으며 그을리기 시작해 burntAt 에 다 탄다 */
  const charred = isOn ? smooth(r, FINALE.igniteAt, FINALE.burntAt) : 0;
  /** 불똥이 터진 뒤 흐른 시간(초) — 붙는 순간과 무너지는 순간 두 번. 안 터지는 동안은 음수 */
  const sinceBurst = !isOn
    ? -1
    : r >= FINALE.burntAt
      ? r - FINALE.burntAt
      : r >= FINALE.igniteAt && r < FINALE.igniteAt + BURST.seconds
        ? r - FINALE.igniteAt
        : -1;
  const burst = sinceBurst >= 0 && sinceBurst < BURST.seconds ? sinceBurst / BURST.seconds : -1;
  const flash = burst >= 0 ? (1 - burst) ** 3 : 0;
  const ringsU = isOn ? clamp01((r - FINALE.ringsAt) / 7.5) : 0;
  const ringsRise = FINALE.ringsRise * ringsU * ringsU * (3 - 2 * ringsU);
  const ringsFade = isOn ? smooth(r, FINALE.ringsAt + 4, FINALE.ringsAt + 7.5) : 0;
  const { seeds } = finale;

  // 불기둥 — 밑동은 좁고 위로 갈수록 퍼지며 비틀려 오른다
  finale.surge.points.visible = surge > 0.01;
  if (finale.surge.points.visible) {
    const height = FINALE.height * surge;
    finale.lines.forEach((line, k) => {
      for (let j = 0; j < SURGE_POINTS; j++) {
        const i = k * SURGE_POINTS + j;
        const life = 0.8 + seeds[i * 3] * 0.9;
        const u = (time / life + seeds[i * 3 + 1]) % 1;
        const reach = seeds[i * 3 + 2];
        const angle = reach * Math.PI * 2 + u * 5 + time * 1.4;
        const radius = (0.1 + 0.8 * u * u) * (0.5 + 0.8 * reach);
        // 바람에 위쪽이 한쪽으로 쏠린다
        const lean = u * u * 1.6 * wind;
        finale.surge.position.setXYZ(
          i,
          line.top.x + (Math.cos(angle) * radius + lean) * M,
          line.top.y + u * height * (0.55 + 0.45 * reach) * M,
          line.top.z + Math.sin(angle) * radius * M,
        );
        finale.surge.size.setX(i, (0.85 * (1 - u) + 0.16) * M * (0.6 + 0.4 * surge));
        finale.surge.alpha.setX(i, (1 - u) ** 1.2 * 0.92 * surge);
        finale.surge.color.setXYZ(i, 2.1, 1.35 - u * 0.95, 0.5 - u * 0.4);
      }
    });
    finale.surge.commit();
    finale.surge.material.uniforms.uPointScale.value = pointScaleFor(view.gl, view.camera);
  }

  // 횃불대를 타는 불 · 땅을 달리는 불 · 소반의 불 · 가락지를 따르는 빛가루
  const isBurning = isOn && (descend > 0 || tableFire > 0 || ringsU > 0) && r < FINALE.endAt + 8;
  finale.flames.points.visible = isBurning;
  const offset = finale.lines.length * SURGE_POINTS;
  let i = 0;
  const put = (x: number, y: number, z: number, size: number, alpha: number, hot: number) => {
    finale.flames.position.setXYZ(i, x, y, z);
    finale.flames.size.setX(i, size * M);
    finale.flames.alpha.setX(i, alpha);
    finale.flames.color.setXYZ(i, 2.0, 0.5 + hot * 0.9, 0.1 + hot * hot * 0.5);
    i++;
  };
  if (isBurning) {
    const at = finale.scratch;
    finale.lines.forEach((line) => {
      // 횃불대 — 불이 위에서부터 타고 내려온다. 내려온 데까지만 탄다
      for (let j = 0; j < POST_POINTS; j++) {
        const seed = (offset + i) * 3;
        const along = j / (POST_POINTS - 1);
        const life = 0.35 + seeds[seed] * 0.3;
        const u = (time / life + seeds[seed + 1]) % 1;
        const isLit = along <= descend;
        put(
          line.base.x + (seeds[seed + 2] - 0.5) * 0.12 * M,
          THREE.MathUtils.lerp(line.top.y, line.base.y, along) + u * 0.22 * M,
          line.base.z + (seeds[seed] - 0.5) * 0.12 * M,
          0.2 * (1 - u * 0.6),
          isLit ? (1 - u) * 0.8 * (1 - dying) : 0,
          1 - u,
        );
      }
      // 땅 — 발치에서 소반까지 불이 달려간다. 지나간 자리에 잔불이 남았다가 횃불대 쪽부터 꺼진다
      for (let j = 0; j < LINE_POINTS; j++) {
        const seed = (offset + i) * 3;
        const along = (j + seeds[seed + 2] * 0.8) / LINE_POINTS;
        line.curve.getPointAt(Math.min(1, along), at);
        const life = 0.4 + seeds[seed] * 0.35;
        const u = (time / life + seeds[seed + 1]) % 1;
        const isLit = along <= run;
        // 달리는 머리는 크고 밝다
        const head = isLit ? clamp01(1 - (run - along) * 7) : 0;
        const fade = 1 - smooth(dying, along * 0.7, along * 0.7 + 0.3);
        put(
          at.x * M,
          (floorAt(at.x, at.z) + 0.03 + u * (0.4 + 0.5 * head)) * M,
          at.z * M,
          (0.3 + 0.3 * head) * (1 - u * 0.6),
          isLit ? (1 - u) * (0.8 + 0.2 * head) * fade : 0,
          1 - u,
        );
      }
      line.scorch.visible = run > 0;
      line.material.uniforms.uProgress.value = run;
      line.material.uniforms.uHeat.value = run > 0 ? 1 - smooth(r, FINALE.igniteAt + 2, FINALE.endAt) : 0;
    });
    // 소반 — 상 위 제물째 타오른다. 바람이 잦아들수록 곧게 선다
    for (let j = 0; j < TABLE_POINTS; j++) {
      const seed = (offset + i) * 3;
      const life = 0.5 + seeds[seed] * 0.6;
      const u = (time / life + seeds[seed + 1]) % 1;
      const angle = seeds[seed + 2] * Math.PI * 2;
      const radius = TABLE_FIRE.radius * Math.sqrt(seeds[seed]) * (1 - u * 0.6);
      put(
        finale.tableAt.x + (Math.cos(angle) * radius + u * u * 0.5 * wind) * M,
        finale.tableAt.y + (u * TABLE_FIRE.height * tableFire - 0.3 * (1 - tableFire)) * M,
        finale.tableAt.z + Math.sin(angle) * radius * M,
        0.62 * (1 - u * 0.65),
        (1 - u) * 0.9 * tableFire,
        1 - u,
      );
    }
    // 불똥 — 소반에서 사방으로 튀어 올랐다 땅으로 떨어지며 식는다
    for (let j = 0; j < BURST_POINTS; j++) {
      const seed = (offset + i) * 3;
      const angle = seeds[seed] * Math.PI * 2;
      const power = 0.35 + seeds[seed + 1] * 0.65;
      const b = Math.max(burst, 0);
      const out = BURST.reach * power * (1 - (1 - b) ** 2);
      put(
        finale.tableAt.x + Math.cos(angle) * out * M,
        finale.tableAt.y + (power * (1.6 + seeds[seed + 2]) * 4 * b * (1 - b) - 0.3 * b) * M,
        finale.tableAt.z + Math.sin(angle) * out * M,
        0.16 * (1 - b * 0.5),
        burst >= 0 ? (1 - b) ** 1.5 : 0,
        1 - b,
      );
    }
    // 가락지를 따라 오르는 빛가루 — 아래로 길게 흩어진다
    for (let j = 0; j < TRAIL_POINTS; j++) {
      const seed = (offset + i) * 3;
      const lag = seeds[seed] * 2.4;
      const angle = seeds[seed + 1] * Math.PI * 2 + time * 0.8;
      const spread = 0.05 + 0.3 * seeds[seed + 2] * (lag / 2.4);
      finale.flames.position.setXYZ(
        i,
        finale.tableAt.x + Math.cos(angle) * spread * M,
        finale.tableAt.y + Math.max(0, ringsRise - lag) * M,
        finale.tableAt.z + Math.sin(angle) * spread * M,
      );
      finale.flames.size.setX(i, 0.07 * M);
      finale.flames.alpha.setX(
        i,
        ringsU > 0 && ringsRise > lag ? 0.7 * (1 - ringsFade) * (0.5 + 0.5 * Math.sin(time * 7 + j)) : 0,
      );
      finale.flames.color.setXYZ(i, 1.6, 1.5, 1.2);
      i++;
    }
    finale.flames.commit();
    finale.flames.material.uniforms.uPointScale.value = pointScaleFor(view.gl, view.camera);
  } else {
    // 불이 땅을 달리기 전(불기둥이 솟는 동안)에는 그을음이 없다. 다 끝난 뒤(이어 하기 포함)에는 그을음만 남는다
    const isOver = isOn && r >= FINALE.igniteAt;
    finale.lines.forEach((line) => {
      line.scorch.visible = isOver;
      line.material.uniforms.uProgress.value = 1;
      line.material.uniforms.uHeat.value = 0;
    });
  }
  (finale.ash.material as THREE.MeshBasicMaterial).opacity = 0.85 * charred;
  finale.flash.visible = flash > 0.01;
  finale.flash.material.opacity = flash;
  finale.flash.scale.setScalar((5 + 6 * (1 - flash)) * M);

  return { surge, wind, tableFire, charred, flash, ringsRise, ringsFade };
}
