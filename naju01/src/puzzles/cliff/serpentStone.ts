/**
 * 구렁이 바위 — 미끄러진 자국 곁의 낮은 너럭바위. 윗면이 구렁이 한 마리가 누웠다 간 모양으로 파였다.
 * 홈은 구렁이상 모형을 위에서 내려다본 윤곽에서 바로 뜬다 — 그래서 끼우면 꼭 맞는다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import * as THREE from "three";

import { M } from "../units";
import { SERPENT_STONE } from "./cliffShape";
import { planar, topOf } from "./riteScene";

/** 윤곽 그림 한 변(px) · 홈 판이 구렁이상보다 큰 배(둘레 여백) */
const OUTLINE_PIXELS = 256;
const OUTLINE_MARGIN = 1.12;
/** 홈 판의 격자 칸 수(한 변) */
const GROOVE_CELLS = 14;
/** 끼울 때 이만큼(미터) 위에서 내려앉는다 · 걸리는 시간(초) */
const SEAT_DROP = 0.1;
/** 들어앉은 구렁이상이 홈에 잠기는 깊이(미터) — 몸통이 윗면 위로 떠 있으면 비스듬히 볼 때 홈과 어긋나 보인다 */
const SEAT_SINK = 0.01;
/** 들어앉은 뒤 이만큼(초) 지나면 돌이 풀리듯 살아나 홈을 떠난다(serpentRun) */
export const ALIVE_AT = 1.1;
/** 윗면의 기울기를 재는 간격(미터) */
const SLOPE_SPAN = 0.14;
const SEAT_SECONDS = 0.45;
const WHITE = new THREE.MeshBasicMaterial({ color: "#FFFFFF" });

/**
 * 파인 홈 — 윤곽 안은 어둡게 꺼지고, 테두리를 따라 깎인 모서리가 달빛에 가늘게 선다. 홈은 구렁이상의 윤곽 그대로다.
 * uSeated 가 1 이면(구렁이상이 들어앉으면) 안쪽 어둠이 옅어져 구렁이상이 보인다.
 */
function makeGrooveMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uMask: { value: null as THREE.Texture | null }, uSeated: { value: 0 } },
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
      uniform sampler2D uMask;
      uniform float uSeated;
      varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float px = 1.0 / ${OUTLINE_PIXELS}.0;
        // 윤곽을 조금 넓힌 것과 조금 좁힌 것 — 그 사이의 띠가 깎인 모서리다
        float inside = texture2D(uMask, vUv).r;
        float wide = inside;
        float narrow = inside;
        for (int k = 0; k < 8; k++) {
          float a = float(k) * 0.7854;
          vec2 step = vec2(cos(a), sin(a)) * px;
          wide = max(wide, texture2D(uMask, vUv + step * 2.0).r);
          narrow = min(narrow, texture2D(uMask, vUv + step * 2.0).r);
        }
        float edge = wide - narrow;
        vec3 color = mix(vec3(0.012, 0.014, 0.022), vec3(0.6, 0.68, 0.86), edge * 0.85);
        float alpha = max(inside * mix(0.9, 0.3, uSeated), edge * 0.8);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
}

export function buildSerpentStone() {
  const root = new THREE.Group();
  root.name = "cliff.serpentStone";
  const grooveMaterial = makeGrooveMaterial();
  // 홈 판 — 꼭짓점마다 바위 윗면에 붙인다(fitStone). 윗면이 고르지 않아 평평한 판은 바위에 묻힌다
  const groove = new THREE.Mesh(new THREE.BufferGeometry(), grooveMaterial);
  groove.renderOrder = 1;
  groove.visible = false;
  // 끼운 구렁이상 — 홈과 같은 방향으로, 윗면의 기울기를 따라 눕는다(fitStone 이 기울기를 잰다)
  const figure = new THREE.Group();
  figure.rotation.y = SERPENT_STONE.grooveYaw;
  figure.scale.setScalar(M);
  figure.visible = false;
  root.add(groove, figure);
  // 모형을 읽기 전의 어림 — 윗면 높이(유닛)
  const top = planar(SERPENT_STONE.x, SERPENT_STONE.z, SERPENT_STONE.size * 0.3).y;
  const part = {
    root,
    groove,
    grooveMaterial,
    figure,
    /** 윗면 높이(유닛) · 겨누는 자리 */
    top,
    target: new THREE.Vector3(SERPENT_STONE.x * M, top + 0.08 * M, SERPENT_STONE.z * M),
    outline: null as THREE.WebGLRenderTarget | null,
  };
  placeOnTop(part, top);
  layGroove(part.groove, () => top);
  return part;
}

export type SerpentStone = ReturnType<typeof buildSerpentStone>;

/**
 * 홈 판을 다시 짠다 — 홈 방향으로 돌린 격자의 꼭짓점을 하나하나 윗면(heightAt, 유닛)에 올린다. uv 는 윤곽 그림과 맞춘다
 */
function layGroove(groove: THREE.Mesh, heightAt: (x: number, z: number) => number) {
  const side = SERPENT_STONE.groove * OUTLINE_MARGIN;
  const cos = Math.cos(SERPENT_STONE.grooveYaw);
  const sin = Math.sin(SERPENT_STONE.grooveYaw);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= GROOVE_CELLS; row++) {
    for (let column = 0; column <= GROOVE_CELLS; column++) {
      const u = column / GROOVE_CELLS;
      const v = row / GROOVE_CELLS;
      // 판 자리(가로 u, 세로 v — v 가 커질수록 −z)를 홈 방향으로 돌려 놓는다
      const localX = (u - 0.5) * side;
      const localZ = (0.5 - v) * side;
      const x = SERPENT_STONE.x + localX * cos + localZ * sin;
      const z = SERPENT_STONE.z - localX * sin + localZ * cos;
      positions.push(x * M, heightAt(x, z) + 0.005 * M, z * M);
      uvs.push(u, v);
      if (row < GROOVE_CELLS && column < GROOVE_CELLS) {
        const here = row * (GROOVE_CELLS + 1) + column;
        const above = here + GROOVE_CELLS + 1;
        indices.push(here, here + 1, above, here + 1, above + 1, above);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  groove.geometry.dispose();
  groove.geometry = geometry;
}

function placeOnTop(part: Pick<SerpentStone, "target"> & { top: number }, top: number) {
  part.top = top;
  part.target.set(SERPENT_STONE.x * M, top + 0.08 * M, SERPENT_STONE.z * M);
}

/** 바위 모형을 놓고 윗면 높이를 잰다 */
export function fitStone(part: SerpentStone, source: THREE.Object3D) {
  const stone = source.clone(true);
  stone.traverse((node) => {
    node.castShadow = true;
    node.receiveShadow = true;
  });
  stone.position.copy(planar(SERPENT_STONE.x, SERPENT_STONE.z));
  stone.rotation.y = SERPENT_STONE.yaw;
  stone.scale.multiplyScalar(M);
  part.root.add(stone);
  stone.updateMatrixWorld(true);
  const center = topOf(stone, SERPENT_STONE.x, SERPENT_STONE.z);
  if (center === null) return;
  const heightAt = (x: number, z: number) => topOf(stone, x, z) ?? center;
  // 윗면은 고르지도 판판하지도 않다 — 홈 둘레 네 곳을 재어 높이는 평균으로, 기울기는 그 차이로 잡는다
  const { x, z } = SERPENT_STONE;
  const east = heightAt(x + SLOPE_SPAN, z);
  const west = heightAt(x - SLOPE_SPAN, z);
  const south = heightAt(x, z + SLOPE_SPAN);
  const north = heightAt(x, z - SLOPE_SPAN);
  placeOnTop(part, (center * 2 + east + west + south + north) / 6);
  const run = 2 * SLOPE_SPAN * M;
  const normal = new THREE.Vector3(-(east - west) / run, 1, -(south - north) / run).normalize();
  part.figure.quaternion
    .setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SERPENT_STONE.grooveYaw));
  layGroove(part.groove, heightAt);
}

/** 구렁이상 모형을 끼울 것으로 달고, 위에서 내려다본 윤곽을 떠 홈에 입힌다 */
export function fitFigure(part: SerpentStone, gl: THREE.WebGLRenderer, source: THREE.Object3D) {
  const seated = source.clone(true);
  seated.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    // 돌빛으로 밝혀 어두운 홈 안에서도 몸이 보이게 한다
    const stone = (mesh.material as THREE.MeshStandardMaterial).clone();
    stone.color.setRGB(2.6, 2.7, 2.9);
    stone.emissive?.set("#2A313C");
    mesh.material = stone;
  });
  part.figure.add(seated);
  const stage = new THREE.Scene();
  const flat = source.clone(true);
  flat.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) mesh.material = WHITE;
  });
  stage.add(flat);
  const half = (SERPENT_STONE.groove * OUTLINE_MARGIN) / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 10);
  camera.position.set(0, 5, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const outline = new THREE.WebGLRenderTarget(OUTLINE_PIXELS, OUTLINE_PIXELS);
  const previous = gl.getRenderTarget();
  const color = gl.getClearColor(new THREE.Color());
  const alpha = gl.getClearAlpha();
  gl.setRenderTarget(outline);
  gl.setClearColor(0x000000, 1);
  gl.clear();
  gl.render(stage, camera);
  gl.setRenderTarget(previous);
  gl.setClearColor(color, alpha);
  part.outline?.dispose();
  part.outline = outline;
  part.grooveMaterial.uniforms.uMask.value = outline.texture;
  part.groove.visible = true;
}

/** 살아난 뒤 돌상이 풀려 사라지는 데 걸리는 시간(초) — 그동안 산 몸이 그 자리에서 풀려나온다 */
const MELT_SECONDS = 0.5;

/** 끼운 뒤 seconds 초의 모습 — 안 끼웠으면 음수. 살아나 홈을 떠난 뒤(ALIVE_AT)에는 빈 홈만 남는다 */
export function updateSerpentStone(part: SerpentStone, seconds: number) {
  const isSeated = seconds >= 0 && seconds < ALIVE_AT + MELT_SECONDS;
  const seat = isSeated ? THREE.MathUtils.smootherstep(seconds / SEAT_SECONDS, 0, 1) : 0;
  part.figure.visible = isSeated;
  part.figure.position.set(
    SERPENT_STONE.x * M,
    part.top + (SEAT_DROP * (1 - seat) - SEAT_SINK) * M,
    SERPENT_STONE.z * M,
  );
  // 살아나기 직전 몸이 한 번 꿈틀하고, 살아나면 돌상은 산 몸에 빨려들듯 줄어 사라진다
  const stir = isSeated ? THREE.MathUtils.smoothstep(seconds, ALIVE_AT - 0.45, ALIVE_AT) : 0;
  const melt = 1 - THREE.MathUtils.smoothstep(seconds, ALIVE_AT, ALIVE_AT + MELT_SECONDS);
  part.figure.scale.setScalar(M * melt * (1 + 0.06 * stir * Math.sin(seconds * 40)));
  part.grooveMaterial.uniforms.uSeated.value = seat * melt;
}
