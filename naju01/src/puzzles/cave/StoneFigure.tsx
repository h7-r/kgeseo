/**
 * 석상 — 아비사와 아랑사. 한 돌로 깎아 색은 하나지만 실루엣이 확 다르게. 돌은 아래로 갈수록 물때가 앉아 어둡고 발치엔 이끼가 끼었다(꼭짓점 색).
 *   아비사 — 어부. 상투에 망건, 깃 단 저고리와 대님 맨 바지, 매듭 늘어진 허리띠, 허리에 종다래끼. 키보다 긴 노를 비스듬히 잡았고, 바닥에 닿은 노 날에서 빛이 난다
 *   아랑사 — 처녀. 길게 땋아 댕기를 늘인 머리, 깃·끝동 단 저고리에 긴 옷고름, 주름이 퍼지는 긴 치마. 두 손으로 든 청사초롱이 등처럼 빛난다
 * 미터, 발밑(받침 윗면)이 원점, 앞이 −z. 빛나는 조각(초롱 몸통 · 노 날)은 따로 그리고, glow(0~1)에 따라 밝아진다.
 */
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { M } from "../units";

type Kind = "아비사" | "아랑사";

const lathe = (points: [number, number][], segments = 20) =>
  new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );

/** 두 점 사이 원기둥(팔·다리·노) */
function limb(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1 = r0, segments = 10) {
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(r1, r0, length, segments);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()),
  );
  geometry.translate(from.x, from.y, from.z);
  return geometry;
}

const sphere = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) =>
  new THREE.SphereGeometry(r, 16, 12).scale(sx, sy, sz).translate(x, y, z);

/** 주름 — 둘레를 따라 물결지게(치마·저고리 자락) */
function pleat(geometry: THREE.BufferGeometry, count: number, depth: number, from: number) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(z, x);
    const k = 1 + depth * Math.sin(a * count) * THREE.MathUtils.smoothstep(from - y, -0.2, 0.6);
    position.setXYZ(i, x * k, y, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** 빛나는 조각 — 지오 · 빛이 나는 자리(미터) */
interface GlowPart {
  geometry: THREE.BufferGeometry;
  at: THREE.Vector3;
}

const OAR_TOP = new THREE.Vector3(0.12, 1.75, -0.32);
const OAR_BOTTOM = new THREE.Vector3(-0.34, 0.02, -0.1);

/** 노 날 — 넓적하고 끝이 둥근 판. 바닥에 닿은 끝이 아래 */
function buildOarBlade() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.025, 0.46);
  shape.lineTo(-0.07, 0.3);
  shape.quadraticCurveTo(-0.085, 0.05, 0, 0);
  shape.quadraticCurveTo(0.085, 0.05, 0.07, 0.3);
  shape.lineTo(0.025, 0.46);
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 1,
  });
  blade.translate(0, 0, -0.011);
  blade.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), OAR_TOP.clone().sub(OAR_BOTTOM).normalize()),
  );
  blade.translate(OAR_BOTTOM.x, OAR_BOTTOM.y, OAR_BOTTOM.z);
  return blade;
}

function buildAbisa(): { parts: THREE.BufferGeometry[]; glow: GlowPart } {
  const parts: THREE.BufferGeometry[] = [];
  // 다리 — 통 넓은 바지, 무릎께 주름, 발목에 대님
  for (const side of [-1, 1]) {
    parts.push(limb(new THREE.Vector3(side * 0.09, 0.1, 0), new THREE.Vector3(side * 0.1, 0.82, 0), 0.07, 0.1, 12));
    parts.push(sphere(0.085, side * 0.095, 0.46, -0.01, 1, 0.55, 1));
    parts.push(new THREE.TorusGeometry(0.058, 0.016, 6, 14).rotateX(Math.PI / 2).translate(side * 0.09, 0.13, 0));
    // 짚신 — 코가 들린 납작한 신
    parts.push(new THREE.BoxGeometry(0.1, 0.05, 0.25).translate(side * 0.09, 0.025, -0.04));
    parts.push(sphere(0.045, side * 0.09, 0.04, -0.16, 1.1, 0.6, 1));
  }
  // 저고리 — 어깨가 넓고 허리에서 좁다. 자락이 엉덩이를 덮는다
  const coat = lathe(
    [
      [0.21, 0.74],
      [0.22, 0.82],
      [0.2, 1.08],
      [0.225, 1.28],
      [0.16, 1.4],
      [0.07, 1.44],
      [0, 1.44],
    ],
    28,
  );
  coat.scale(1.25, 1, 0.85);
  parts.push(coat);
  // 깃 — 목에서 가슴으로 비스듬히 여민 띠 · 동정
  parts.push(new THREE.BoxGeometry(0.045, 0.36, 0.02).rotateZ(0.42).translate(0.05, 1.2, -0.185));
  parts.push(new THREE.BoxGeometry(0.035, 0.18, 0.02).rotateZ(-0.42).translate(-0.04, 1.32, -0.17));
  // 허리띠 · 매듭과 늘어진 끈
  parts.push(
    new THREE.TorusGeometry(0.205, 0.024, 6, 28)
      .rotateX(Math.PI / 2)
      .scale(1.22, 1, 0.84)
      .translate(0, 0.86, 0),
  );
  parts.push(sphere(0.03, 0.11, 0.86, -0.17));
  parts.push(new THREE.BoxGeometry(0.025, 0.2, 0.012).rotateZ(0.12).translate(0.12, 0.74, -0.175));
  parts.push(new THREE.BoxGeometry(0.025, 0.16, 0.012).rotateZ(-0.1).translate(0.09, 0.76, -0.177));
  // 종다래끼 — 허리 왼쪽에 매단 작은 물고기 바구니(위가 좁은 항아리꼴)
  const basket = lathe([
    [0.0, 0.0],
    [0.07, 0.01],
    [0.095, 0.08],
    [0.085, 0.15],
    [0.05, 0.19],
    [0.055, 0.21],
    [0, 0.21],
  ]);
  pleat(basket, 14, 0.05, 0.3);
  parts.push(basket.translate(-0.27, 0.6, 0.05));
  parts.push(limb(new THREE.Vector3(-0.22, 0.86, 0.02), new THREE.Vector3(-0.27, 0.8, 0.05), 0.008, 0.008, 5));
  // 목 · 머리 · 망건 · 상투 · 얼굴(눈두덩 · 코 · 짧은 수염) · 귀
  parts.push(limb(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0, 1.5, 0), 0.05));
  parts.push(sphere(0.105, 0, 1.6, 0, 0.95, 1.1, 1));
  parts.push(new THREE.TorusGeometry(0.1, 0.012, 6, 24).rotateX(Math.PI / 2).translate(0, 1.645, 0.005));
  parts.push(sphere(0.045, 0, 1.75, 0.01, 1, 1.25, 1));
  parts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6).rotateZ(Math.PI / 2).translate(0, 1.76, 0.01));
  parts.push(new THREE.BoxGeometry(0.15, 0.018, 0.03).translate(0, 1.625, -0.09));
  parts.push(new THREE.ConeGeometry(0.02, 0.045, 6).rotateX(-Math.PI / 2).translate(0, 1.595, -0.112));
  parts.push(new THREE.ConeGeometry(0.035, 0.07, 8).rotateX(Math.PI).translate(0, 1.5, -0.075));
  for (const side of [-1, 1]) parts.push(sphere(0.022, side * 0.1, 1.6, 0, 0.6, 1, 1));
  // 팔 — 소매를 걷어 팔뚝이 드러난다. 오른손은 위, 왼손은 아래로 노를 쥔다
  const along = (t: number) => OAR_BOTTOM.clone().lerp(OAR_TOP, t);
  const gripHigh = along(0.72);
  const gripLow = along(0.47);
  const shoulderR = new THREE.Vector3(0.23, 1.32, 0);
  const shoulderL = new THREE.Vector3(-0.23, 1.32, 0);
  const elbowR = new THREE.Vector3(0.3, 1.1, -0.14);
  const elbowL = new THREE.Vector3(-0.28, 1.0, -0.08);
  parts.push(
    limb(shoulderR, elbowR, 0.065, 0.06),
    sphere(0.06, elbowR.x, elbowR.y, elbowR.z),
    limb(elbowR, gripHigh, 0.045, 0.04),
    sphere(0.045, gripHigh.x, gripHigh.y, gripHigh.z, 1.1, 1, 1),
  );
  parts.push(
    limb(shoulderL, elbowL, 0.065, 0.06),
    sphere(0.06, elbowL.x, elbowL.y, elbowL.z),
    limb(elbowL, gripLow, 0.045, 0.04),
    sphere(0.045, gripLow.x, gripLow.y, gripLow.z, 1.1, 1, 1),
  );
  // 노 — 긴 자루와 손잡이(날은 빛나는 조각으로 따로)
  parts.push(limb(along(0.2), OAR_TOP, 0.022, 0.018, 8));
  parts.push(limb(OAR_TOP, OAR_TOP.clone().add(new THREE.Vector3(0.06, 0.01, -0.03)), 0.016, 0.016, 6));
  return { parts, glow: { geometry: buildOarBlade(), at: along(0.08) } };
}

function buildArangsa(): { parts: THREE.BufferGeometry[]; glow: GlowPart } {
  const parts: THREE.BufferGeometry[] = [];
  // 치마 — 가슴께에서 매어 아래로 넓게 퍼지고 주름이 잡힌다. 밑단이 살짝 끌린다
  const skirt = lathe(
    [
      [0.31, 0],
      [0.32, 0.035],
      [0.28, 0.3],
      [0.215, 0.7],
      [0.165, 1.05],
      [0.155, 1.18],
      [0.0, 1.2],
    ],
    56,
  );
  pleat(skirt, 22, 0.06, 1.0);
  skirt.scale(1, 1, 0.92);
  parts.push(skirt);
  // 치마말기 — 가슴에 두른 띠
  parts.push(
    new THREE.TorusGeometry(0.16, 0.018, 6, 28)
      .rotateX(Math.PI / 2)
      .scale(1.05, 1, 0.9)
      .translate(0, 1.12, 0),
  );
  // 짧은 저고리 — 소매가 둥글다
  const coat = lathe(
    [
      [0.16, 1.12],
      [0.17, 1.2],
      [0.18, 1.3],
      [0.13, 1.39],
      [0.06, 1.42],
      [0, 1.42],
    ],
    28,
  );
  coat.scale(1.15, 1, 0.85);
  parts.push(coat);
  // 깃 · 동정 — 왼쪽으로 여민다
  parts.push(new THREE.BoxGeometry(0.04, 0.22, 0.018).rotateZ(-0.5).translate(-0.03, 1.3, -0.15));
  parts.push(new THREE.BoxGeometry(0.03, 0.12, 0.018).rotateZ(0.5).translate(0.04, 1.36, -0.13));
  // 옷고름 — 매듭에서 길게 늘어진 두 가닥
  parts.push(sphere(0.022, 0.045, 1.2, -0.168));
  parts.push(new THREE.BoxGeometry(0.035, 0.34, 0.012).rotateZ(-0.12).translate(0.06, 1.02, -0.168));
  parts.push(new THREE.BoxGeometry(0.03, 0.26, 0.012).rotateZ(0.14).translate(0.085, 1.06, -0.165));
  // 목 · 머리 · 가르마 머리 · 얼굴 · 뒤로 땋은 머리와 댕기
  parts.push(limb(new THREE.Vector3(0, 1.38, 0), new THREE.Vector3(0, 1.48, 0), 0.042));
  parts.push(sphere(0.098, 0, 1.57, 0, 0.92, 1.1, 1));
  parts.push(sphere(0.104, 0, 1.6, 0.012, 0.95, 1.02, 1.0));
  parts.push(new THREE.BoxGeometry(0.006, 0.02, 0.18).translate(0, 1.705, -0.01));
  parts.push(new THREE.BoxGeometry(0.13, 0.014, 0.025).translate(0, 1.6, -0.085));
  parts.push(new THREE.ConeGeometry(0.016, 0.035, 6).rotateX(-Math.PI / 2).translate(0, 1.565, -0.1));
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    parts.push(sphere(0.034 - t * 0.009, 0, 1.52 - t * 0.64, 0.1 + Math.sin(t * 2) * 0.03, 1, 1.25, 0.9));
  }
  // 댕기 — 땋은 끝에 묶어 길게 늘인 넓은 끈, 끝이 제비꼬리
  parts.push(new THREE.BoxGeometry(0.075, 0.26, 0.012).rotateZ(0.06).translate(0.005, 0.76, 0.145));
  parts.push(new THREE.ConeGeometry(0.04, 0.06, 3).rotateZ(Math.PI).scale(1, 1, 0.2).translate(0.012, 0.6, 0.145));
  // 팔 — 둥근 소매(배래)에 끝동, 두 손을 모아 가슴 앞에서 초롱 자루를 쥔다
  const hands = new THREE.Vector3(0, 1.04, -0.28);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 0.18, 1.33, 0);
    const elbow = new THREE.Vector3(side * 0.21, 1.1, -0.12);
    const hand = hands.clone().add(new THREE.Vector3(side * 0.035, 0, 0));
    parts.push(
      limb(shoulder, elbow, 0.065, 0.08),
      sphere(0.075, elbow.x, elbow.y, elbow.z),
      limb(elbow, hand, 0.07, 0.05),
    );
    const cuff = elbow.clone().lerp(hand, 0.82);
    parts.push(limb(cuff, cuff.clone().lerp(hand, 0.4), 0.056, 0.056, 12));
    parts.push(sphere(0.038, hand.x, hand.y, hand.z));
  }
  // 청사초롱 — 자루 · 고리 · 지붕 · 밑받침(몸통은 빛나는 조각으로 따로)
  parts.push(
    limb(
      hands.clone().add(new THREE.Vector3(0, 0.05, 0)),
      hands.clone().add(new THREE.Vector3(0, -0.13, -0.02)),
      0.011,
      0.011,
      6,
    ),
  );
  const lantern = new THREE.Vector3(hands.x, hands.y - 0.29, hands.z - 0.03);
  parts.push(new THREE.CylinderGeometry(0.035, 0.1, 0.06, 12).translate(lantern.x, lantern.y + 0.135, lantern.z));
  parts.push(new THREE.CylinderGeometry(0.1, 0.06, 0.045, 12).translate(lantern.x, lantern.y - 0.125, lantern.z));
  parts.push(
    new THREE.ConeGeometry(0.018, 0.08, 6).rotateX(Math.PI).translate(lantern.x, lantern.y - 0.185, lantern.z),
  );
  // 몸통 — 위 푸른 천, 아래 붉은 천 자리를 가로 띠로 나눈 둥근 등
  const body = new THREE.CylinderGeometry(0.088, 0.088, 0.21, 16);
  body.translate(lantern.x, lantern.y, lantern.z);
  return { parts, glow: { geometry: body, at: lantern.clone() } };
}

/** 물때 · 이끼 — 아래로 갈수록 어둡고 발치는 푸르스름한 이끼빛, 군데군데 얼룩 */
function weatherColors(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const moss = new THREE.Color("#7E8F72");
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const noise = Math.sin(x * 23.1 + y * 7.3) * Math.sin(z * 19.7 - y * 11.2) * 0.5 + 0.5;
    const grime = 0.72 + 0.28 * THREE.MathUtils.smoothstep(y, 0, 0.9);
    color.setScalar(grime * (0.92 + 0.12 * noise));
    const mossy = (1 - THREE.MathUtils.smoothstep(y, 0.02, 0.32)) * (0.4 + 0.6 * noise);
    color.lerp(moss, mossy * 0.55);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** glow 는 0~1 — 방에 불이 들 때 같이 켜진다 */
export default function StoneFigure({
  kind,
  material,
  glowTexture,
  glow,
}: {
  kind: Kind;
  material: THREE.Material;
  glowTexture: THREE.Texture;
  glow: RefObject<number>;
}) {
  const figure = useMemo(() => {
    const { parts, glow: part } = kind === "아비사" ? buildAbisa() : buildArangsa();
    // 조각마다 제 법선을 지닌 채 합친다 — 다시 계산하면 이음매가 각져 보인다
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((piece) => piece.dispose());
    weatherColors(merged);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: "#3A3934", toneMapped: false });
    const haloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: "#FFEFD2",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    return { merged, part, glowMaterial, haloMaterial };
  }, [kind, glowTexture]);
  useEffect(
    () => () => {
      figure.merged.dispose();
      figure.part.geometry.dispose();
      figure.glowMaterial.dispose();
      figure.haloMaterial.dispose();
    },
    [figure],
  );
  const light = useRef<THREE.PointLight>(null);
  const halo = useRef<THREE.Sprite>(null);
  const off = useMemo(() => new THREE.Color("#3A3934"), []);
  const on = useMemo(() => new THREE.Color(kind === "아랑사" ? "#FFF1D8" : "#FFF6E6"), [kind]);
  useFrame(({ clock }) => {
    const level = glow.current;
    // 초롱은 심지 불처럼 살짝 일렁이고, 노 날은 물빛처럼 천천히 숨 쉰다
    const t = clock.elapsedTime;
    const breathe =
      kind === "아랑사" ? 0.92 + 0.05 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 13.1) : 0.85 + 0.15 * Math.sin(t * 1.4);
    figure.glowMaterial.color.copy(off).lerp(on, level * breathe);
    figure.haloMaterial.opacity = level * (kind === "아랑사" ? 0.75 : 0.55) * breathe;
    if (halo.current) halo.current.scale.setScalar(kind === "아랑사" ? 1.1 : 0.9);
    if (light.current) light.current.intensity = level * (kind === "아랑사" ? 0.9 : 0.6) * breathe;
  });
  const at = figure.part.at;
  return (
    <>
      <mesh geometry={figure.merged} material={material} castShadow receiveShadow />
      <mesh geometry={figure.part.geometry} material={figure.glowMaterial} />
      <sprite ref={halo} material={figure.haloMaterial} position={[at.x, at.y, at.z]} />
      <pointLight
        ref={light}
        color="#FFE6C0"
        intensity={0}
        distance={3.2 * M}
        decay={1.6}
        position={[at.x, at.y, at.z - 0.08]}
      />
    </>
  );
}
