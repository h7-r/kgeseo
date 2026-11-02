import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PropName } from "./najuProps";
import {
  createSiteLights,
  createSiteMaterial,
  MAX_SITE_LIGHTS,
  SEAM_DOWN_FLAG,
  SITE_MODE,
  type SiteLights,
  type SiteStates,
} from "./siteMaterial";
import {
  createTorchGeometry,
  HOUSE_LANTERN,
  MODERN_BUILDERS,
  MODERN_LIGHT,
  SITES,
  TORCH_FLAME,
  type SiteDefinition,
} from "./siteCatalog";
import { PALETTE, riverCenterX, type SharedUniforms } from "./world";

// 강가 자리들을 그린다. 진행도에 따라 자리마다 솔기를 옮기고, 가로등 머리와 횃불 불꽃의 빛을 켜고 끈다.
// 자리마다 위치·방향을 지오메트리에 구워 겹(지금·옛날·외곽선)마다 하나로 묶는다(siteMaterial 주석).

const LED_LIGHT = new THREE.Color("#cfe0ee").multiplyScalar(0.9);
const TORCH_LIGHT = PALETTE.lamp.clone();
/** 외곽선 껍데기 두께(m). 게임 화면처럼 모형 크기와 상관없이 고르게. */
const OUTLINE_WIDTH = 0.06;

interface SiteLamp {
  site: SiteDefinition;
  /** 솔기가 훑는 높이(월드 y). */
  span: THREE.Vector2;
  /** 지금 건물 쪽 빛(가로등 머리·가게 유리)과 옛 쪽 빛(횃불·처마 등불)의 월드 자리. */
  head: THREE.Vector3 | null;
  flame: THREE.Vector3 | null;
}

/** 자리 하나의 지오메트리를 월드로 옮기고 자리 번호를 단다. 빛나지 않는 모형엔 aGlow 0 을 채운다. */
function place(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, site: number): THREE.BufferGeometry {
  const placed = geometry.clone().applyMatrix4(matrix);
  const count = placed.attributes.position.count;
  if (!placed.attributes.aGlow) placed.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(count), 1));
  placed.setAttribute("aSite", new THREE.BufferAttribute(new Float32Array(count).fill(site), 1));
  return placed;
}

/** 모형 한가운데에서 바깥으로 부풀린 껍데기(모형 단위 → 두께는 키로 나눠 고르게). */
function inflate(geometry: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const shell = geometry.clone();
  const position = shell.attributes.position as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const center = new THREE.Vector3(0, 0.45, 0);
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    point.addScaledVector(point.clone().sub(center).normalize(), width);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  return shell;
}

/** 건물이 앉을 평평한 둑. 능선 비탈만으로는 세울 자리가 없다. */
function createBankFloor(): THREE.BufferGeometry {
  const ground = new THREE.Color("#2a3346");
  const positions: number[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 64; i += 1) {
      const z0 = 30 - i * 4.4;
      const z1 = z0 - 4.4;
      const a = [riverCenterX(z0) + side * 23, 0.4, z0];
      const b = [riverCenterX(z0) + side * 72, 0.4, z0];
      const c = [riverCenterX(z1) + side * 72, 0.4, z1];
      const d = [riverCenterX(z1) + side * 23, 0.4, z1];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < colors.length; i += 3) colors.set([ground.r, ground.g, ground.b], i);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

interface SitesProps {
  uniforms: SharedUniforms;
  props: Record<PropName, THREE.BufferGeometry>;
  /** 카메라가 실제로 선 진행도(RiverScene 이 매 프레임 쓴다). */
  progress: { value: number };
  pixelRatio: number;
}

export default function Sites({ uniforms, props, progress, pixelRatio }: SitesProps) {
  const lights = useMemo<SiteLights>(() => createSiteLights(), []);

  const built = useMemo(() => {
    const torch = createTorchGeometry();
    // 마지막 칸은 둑 바닥(늘 그대로).
    const states: SiteStates = {
      morphs: new Array(SITES.length + 1).fill(0),
      shapes: Array.from({ length: SITES.length + 1 }, () => new THREE.Vector3(0, 0, SITE_MODE.still)),
    };
    const modern: THREE.BufferGeometry[] = [];
    const past: THREE.BufferGeometry[] = [];
    const outline: THREE.BufferGeometry[] = [];
    const lamps: SiteLamp[] = [];

    SITES.forEach((site, index) => {
      const matrix = new THREE.Matrix4().compose(
        site.position,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), site.yaw),
        new THREE.Vector3(1, 1, 1),
      );
      const modernGeometry = site.modern ? MODERN_BUILDERS[site.modern]() : null;
      const modernHeight = modernGeometry?.boundingBox?.max.y ?? 0;
      // 횃불 짝은 가로등과 키를 맞춘다 — 솔기가 위에서 내려오면 쇠기둥 끝에서 불이 탄다.
      const pastScale = site.past === "torch" ? modernHeight / 3.4 : site.pastHeight;
      const pastSource = site.past === "torch" ? torch : site.past ? props[site.past] : null;
      const span = new THREE.Vector2(site.position.y, site.position.y + Math.max(modernHeight, pastScale));
      const mode = site.modern && site.past ? SITE_MODE.seam : SITE_MODE.slices;
      states.shapes[index].set(span.x + (site.seam === "down" ? SEAM_DOWN_FLAG : 0), span.y, mode);

      if (modernGeometry) modern.push(place(modernGeometry, matrix, index));
      if (pastSource) {
        const scaled = new THREE.Matrix4().multiplyMatrices(
          matrix,
          new THREE.Matrix4().makeScale(pastScale, pastScale, pastScale),
        );
        past.push(place(pastSource, scaled, index));
        outline.push(place(inflate(pastSource, OUTLINE_WIDTH / pastScale), scaled, index));
      }

      const toWorld = (local: THREE.Vector3) => local.clone().applyMatrix4(matrix);
      const modernLight = site.modern ? MODERN_LIGHT[site.modern] : undefined;
      const flameLocal =
        site.past === "torch" ? TORCH_FLAME : site.past === "house1" || site.past === "house3" ? HOUSE_LANTERN : null;
      lamps.push({
        site,
        span,
        head: modernLight ? toWorld(modernLight) : null,
        flame: flameLocal ? toWorld(flameLocal.clone().multiplyScalar(pastScale)) : null,
      });
    });
    modern.push(place(createBankFloor(), new THREE.Matrix4(), SITES.length));

    const merge = (parts: THREE.BufferGeometry[]) => {
      // 지오메트리마다 법선이 있어야 묶인다(모형은 najuProps 에서, 덩어리는 BoxGeometry 가 만든다).
      for (const part of parts) if (!part.attributes.normal) part.computeVertexNormals();
      return mergeGeometries(parts) ?? new THREE.BufferGeometry();
    };
    return { states, lamps, modern: merge(modern), past: merge(past), outline: merge(outline) };
  }, [props]);

  const materials = useMemo(
    () => ({
      modern: createSiteMaterial(uniforms, lights, built.states, "modern"),
      past: createSiteMaterial(uniforms, lights, built.states, "past"),
      outline: createSiteMaterial(uniforms, lights, built.states, "outline"),
    }),
    [uniforms, lights, built],
  );
  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose());
      built.modern.dispose();
      built.past.dispose();
      built.outline.dispose();
    },
    [materials, built],
  );

  const glows = useMemo(() => {
    const points = built.lamps.flatMap(({ head, flame }) => [
      head ?? new THREE.Vector3(0, -1e4, 0),
      flame ?? new THREE.Vector3(0, -1e4, 0),
    ]);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
    return geometry;
  }, [built]);
  const glowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: pixelRatio } },
        vertexShader: /* glsl */ `
          uniform float uPixelRatio;
          attribute vec3 aColor;
          varying vec3 vColor;
          void main() {
            vColor = aColor;
            vec4 view = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(1300.0 / -view.z, 6.0, 90.0) * uPixelRatio;
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(vColor * (exp(-d * d * 90.0) * 1.6 + exp(-d * d * 12.0) * 0.35), 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [pixelRatio],
  );

  useFrame(() => {
    const t = progress.value;
    const time = uniforms.uTime.value;
    const glowColors = glows.attributes.aColor as THREE.BufferAttribute;
    let light = 0;
    built.lamps.forEach(({ site, span, head, flame }, i) => {
      const morph = THREE.MathUtils.smoothstep(t, site.from, site.to) * site.amount;
      built.states.morphs[i] = morph;
      // 솔기 위치 — 셰이더와 같은 식(토막 어긋남은 뺀다).
      const travel = site.seam === "down" ? 1 - morph : morph;
      const seam = THREE.MathUtils.lerp(span.x - 0.6, span.y + 0.6, travel);
      const isPast = (y: number) => (site.seam === "down" ? y > seam : y < seam);
      const ledOn = head && !isPast(head.y) ? 1 : 0;
      const fireOn = flame && isPast(flame.y) ? 0.85 + 0.15 * Math.sin(time * 9 + i) : 0;
      glowColors.setXYZ(i * 2, LED_LIGHT.r * ledOn, LED_LIGHT.g * ledOn, LED_LIGHT.b * ledOn);
      glowColors.setXYZ(i * 2 + 1, TORCH_LIGHT.r * fireOn, TORCH_LIGHT.g * fireOn, TORCH_LIGHT.b * fireOn);
      // 빛은 켜진 쪽 하나만 비춘다.
      const source = fireOn > 0 ? flame : ledOn > 0 ? head : null;
      if (source && light < MAX_SITE_LIGHTS) {
        lights.positions[light].copy(source);
        lights.colors[light].copy(fireOn > 0 ? TORCH_LIGHT : LED_LIGHT).multiplyScalar(fireOn > 0 ? fireOn : 0.7);
        light += 1;
      }
    });
    for (; light < MAX_SITE_LIGHTS; light += 1) lights.colors[light].setScalar(0);
    glowColors.needsUpdate = true;
  });

  return (
    <>
      <mesh geometry={built.modern} material={materials.modern} />
      <mesh geometry={built.past} material={materials.past} />
      <mesh geometry={built.outline} material={materials.outline} />
      <points geometry={glows} material={glowMaterial} frustumCulled={false} renderOrder={6} />
    </>
  );
}
