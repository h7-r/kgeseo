/**
 * 돌새 곁 — 물동이 물에 비친 그림과 두 기둥 사이 화석 자리.
 *   물동이: 들여다보면 고인 물 위에 두 새가 서로 마주 보는 그림자가 어른거린다(지금 돌새는 서로 등지고 있다).
 *     새들이 떠난 뒤에는 물 위 그림자가 바뀐다 — 똬리를 튼 구렁이(아랑사)의 그림자.
 *   화석 자리: 두 기둥 사이 땅에 박힌 돌판에 비늘 모양으로 팬 자국 — 무언가 오래 박혀 있다 빠진 자리다.
 *     두 새가 마주 보면 자국이 희미하게 빛나고, 강 밑 석실에서 가져온 푸른 비늘을 맞춰 넣으면 꼭 들어맞는다
 *     → 새가 깨어난다(ridge 「awakening」, RidgeBirds 가 잇는다).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { TOON_GRADIENT } from "@/engine/toon";

import { addDynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { M, groundY } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { buildScaleGeometry } from "../itemLooks";
import { ridge, ridgeQuest } from "./ridgeState";

/** 두 돌새(edits.json 「씬2.솟대」 0 · 1) 사이 · 물동이(「씬2.물동이」 0) */
const STATUES = [
  { x: 74.507, z: 20.891 },
  { x: 74.384, z: 22.211 },
];
const SLOT = { x: (STATUES[0].x + STATUES[1].x) / 2 + 0.15, z: (STATUES[0].z + STATUES[1].z) / 2 };
const JAR = { x: 74.084, z: 19.857 };
/** 돌판 윗면(땅 위 m) · 비늘이 눕는 높이 */
const SLAB_TOP = 0.09;
const SCALE_SEAT = { length: 0.16, width: 0.13 };

/** 비늘 꼴 — itemLooks.buildScaleGeometry 와 같은 윤곽(밑동 t=0 → 둥근 끝 t=1) */
const outline = (t: number) => Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 * (0.55 + 0.45 * t);

/** 돌판에 판 비늘 자국 — 어두운 홈, 결 따라 가는 줄(화석처럼). 빛나는 정도는 발광으로 */
function makeFossilTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d")!;
  const shape = (scale: number) => {
    c.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      c.lineTo(size / 2 + outline(t) * (SCALE_SEAT.width / SCALE_SEAT.length) * 0.5 * size * 0.86 * scale, size * (0.93 - t * 0.86 * scale));
    }
    for (let i = 40; i >= 0; i--) {
      const t = i / 40;
      c.lineTo(size / 2 - outline(t) * (SCALE_SEAT.width / SCALE_SEAT.length) * 0.5 * size * 0.86 * scale, size * (0.93 - t * 0.86 * scale));
    }
    c.closePath();
  };
  // 밝은 턱 → 어두운 홈 → 결
  c.translate(2, 3);
  shape(1);
  c.fillStyle = "rgba(214,206,190,0.55)";
  c.fill();
  c.translate(-2, -3);
  shape(1);
  c.fillStyle = "#2A2622";
  c.fill();
  c.save();
  shape(1);
  c.clip();
  c.strokeStyle = "rgba(150,142,130,0.5)";
  c.lineWidth = 3;
  for (let k = -6; k <= 6; k++) {
    c.beginPath();
    c.moveTo(size / 2, size * 0.9);
    c.quadraticCurveTo(size / 2 + k * 10, size * 0.5, size / 2 + k * 18, size * 0.05);
    c.stroke();
  }
  c.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 물에 비친 그림 — 하늘빛 물, 가운데 두 새가 서로 마주 본다(물결에 흔들린다) */
function makeReflectionTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d")!;
  const sky = c.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  sky.addColorStop(0, "#D8C2A4");
  sky.addColorStop(1, "#6E6458");
  c.fillStyle = sky;
  c.fillRect(0, 0, size, size);
  const bird = (x: number, facing: 1 | -1) => {
    c.save();
    c.translate(x, size / 2);
    c.scale(facing, 1);
    c.fillStyle = "rgba(34,30,26,0.82)";
    c.beginPath();
    c.ellipse(0, 0, 26, 12, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(24, -10, 9, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(31, -11);
    c.lineTo(46, -8);
    c.lineTo(31, -6);
    c.fill();
    // 위로 편 날개
    c.beginPath();
    c.moveTo(-8, -6);
    c.quadraticCurveTo(-20, -52, -46, -60);
    c.quadraticCurveTo(-24, -30, 10, -8);
    c.fill();
    c.beginPath();
    c.moveTo(-24, 0);
    c.lineTo(-44, -6);
    c.lineTo(-40, 6);
    c.fill();
    c.restore();
  };
  bird(size / 2 - 52, 1);
  bird(size / 2 + 52, -1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 새들이 떠난 뒤 물에 비친 그림 — 똬리를 틀고 고개를 든 구렁이 그림자 */
function makeSerpentTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d")!;
  const sky = c.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  sky.addColorStop(0, "#CDB89C");
  sky.addColorStop(1, "#5E564C");
  c.fillStyle = sky;
  c.fillRect(0, 0, size, size);
  c.strokeStyle = "rgba(30,26,22,0.85)";
  c.lineCap = "round";
  // 똬리 — 안으로 감기는 나선, 꼬리로 갈수록 가늘게
  const turns = 2.4;
  let previous: [number, number] | null = null;
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    const a = t * turns * Math.PI * 2;
    const r = 78 - t * 60;
    const point: [number, number] = [size / 2 + Math.cos(a) * r, size / 2 + 18 + Math.sin(a) * r * 0.7];
    if (previous) {
      c.lineWidth = 22 - t * 16;
      c.beginPath();
      c.moveTo(previous[0], previous[1]);
      c.lineTo(point[0], point[1]);
      c.stroke();
    }
    previous = point;
  }
  // 목 · 머리 — 똬리 바깥에서 고개를 든다
  c.lineWidth = 20;
  c.beginPath();
  c.moveTo(size / 2 + 78, size / 2 + 18);
  c.quadraticCurveTo(size / 2 + 96, size / 2 - 40, size / 2 + 60, size / 2 - 76);
  c.stroke();
  c.fillStyle = "rgba(30,26,22,0.9)";
  c.beginPath();
  c.ellipse(size / 2 + 52, size / 2 - 84, 18, 12, -0.5, 0, Math.PI * 2);
  c.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 돌판 — 땅에 반쯤 묻힌 넓적한 돌. 윗면만 반반하다 */
function buildSlab() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  const p = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 1 + Math.sin(v.x * 4.3 + v.z * 5.9) * 0.07;
    p.setXYZ(i, v.x * 0.3 * bump, Math.min(v.y, 0.55) * 0.18 - 0.0, v.z * 0.24 * bump);
  }
  geometry.translate(0, SLAB_TOP - 0.55 * 0.18, 0);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: "#868A86", gradientMap: TOON_GRADIENT }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createRig() {
  const group = new THREE.Group();
  const slab = buildSlab();
  group.add(slab);
  const fossil = new THREE.MeshToonMaterial({
    map: makeFossilTexture(),
    transparent: true,
    alphaTest: 0.2,
    gradientMap: TOON_GRADIENT,
    // 마주 본 뒤 자국에 드는 빛 — 푸른 기 없이 따뜻한 흰빛(비늘을 넣기 전엔 푸른 표식이 없어야 한다)
    emissive: new THREE.Color("#F2EDE2"),
    emissiveIntensity: 0,
  });
  const imprint = new THREE.Mesh(new THREE.PlaneGeometry(SCALE_SEAT.length * 1.2, SCALE_SEAT.length * 1.2), fossil);
  imprint.rotation.x = -Math.PI / 2;
  imprint.position.y = SLAB_TOP + 0.003;
  group.add(imprint);
  // 맞춰 넣은 비늘 — 눕혀서 자국 위에
  const scaleGeometry = buildScaleGeometry();
  scaleGeometry.rotateX(0.35 - Math.PI / 2);
  scaleGeometry.translate(0, SLAB_TOP + 0.004, SCALE_SEAT.length * 0.5 * 0.86);
  const scaleMaterial = new THREE.MeshToonMaterial({
    vertexColors: true,
    emissive: new THREE.Color("#2E7FB0"),
    emissiveIntensity: 0.4,
    gradientMap: TOON_GRADIENT,
    side: THREE.DoubleSide,
  });
  const scale = new THREE.Mesh(scaleGeometry, scaleMaterial);
  scale.visible = false;
  group.add(scale);
  group.scale.setScalar(M);
  const waterMaterial = new THREE.MeshToonMaterial({ map: makeReflectionTexture(), gradientMap: TOON_GRADIENT, emissive: new THREE.Color("#FFFFFF"), emissiveIntensity: 0.25 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 32), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.visible = false;
  return { group, fossil, scale, scaleMaterial, water, waterMaterial, serpentShown: false, setAt: -1, jarMeasured: false, jarTriedAt: -99, jarAt: new THREE.Vector3() };
}

export default function BirdHints() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const rig = useMemo(() => createRig(), []);

  useEffect(() => {
    const ground = groundY(SLOT.x, SLOT.z);
    rig.group.position.set(SLOT.x * M, ground * M, SLOT.z * M);
    // 비늘 밑동이 새 하나를, 끝이 다른 새를 가리키게
    rig.group.rotation.y = Math.atan2(STATUES[1].x - STATUES[0].x, STATUES[1].z - STATUES[0].z);
    scene.add(rig.group, rig.water);
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, [rig.group, rig.water]), 3300);
    const removeSolid = addDynamicSolid({ x: SLOT.x, z: SLOT.z, yaw: rig.group.rotation.y, halfX: 0.24, halfZ: 0.3, bottom: ground - 0.2, top: ground + SLAB_TOP, enabled: true });
    const removeSlot = registerInteractable({
      id: "ridge-fossil",
      position: new THREE.Vector3(SLOT.x * M, (ground + SLAB_TOP + 0.05) * M, SLOT.z * M),
      label: "두 기둥 사이 돌판",
      highlight: () => rig.group,
      radius: 0.35 * M,
      reach: 2.4 * M,
      enabled: () => ridge.stage() === "sealed" && !ridgeQuest.scaleSet,
      use: () =>
        showNotice(
          ridgeQuest.birdsFacing
            ? "비늘 모양으로 팬 자국이 희미하게 빛난다. 오래 박혀 있던 무언가가 빠진 자리 — 꼭 맞을 것을 가지고 있다면."
            : "돌판에 비늘 모양으로 움푹 팬 자국이 있다. 화석처럼 결까지 남았다. 아직은 아무 기척이 없다.",
          4.5,
        ),
      handLabel: (kind) => (kind === "scale" && ridgeQuest.birdsFacing && !ridgeQuest.scaleSet ? "푸른 비늘 맞춰 넣기" : null),
      receive: () => {
        rig.scale.visible = true;
        rig.setAt = performance.now() / 1000;
        ridgeQuest.set("scaleSet");
        audio.play("단서");
        audio.play("징");
        showNotice("푸른 비늘이 자국에 딱 들어맞는다 — 결까지 그대로 이어진다. 원래 이 자리에 있던 것이다. 기둥이 떨리기 시작한다…", 5);
        ridge.advance("awakening");
      },
    });
    const removeJar = registerInteractable({
      id: "ridge-jar-reflection",
      position: new THREE.Vector3(JAR.x * M, (groundY(JAR.x, JAR.z) + 0.55) * M, JAR.z * M),
      label: "물동이 들여다보기",
      radius: 0.35 * M,
      reach: 2.2 * M,
      enabled: () => ridge.isAtLeast("sealed"),
      use: () =>
        showNotice(
          rig.serpentShown
            ? "물에 비친 것이 바뀌었다 — 새들은 간데없고, 똬리를 튼 구렁이 그림자가 고개를 들고 있다."
            : ridgeQuest.birdsFacing
            ? "물에 비친 두 새와 돌새가 똑같이 서로를 보고 있다."
            : "고인 물에 하늘이 비친다. 그런데 물 위의 두 새 그림자는 서로 마주 보고 있다 — 저 위 돌새들은 서로 등을 돌렸는데.",
          5.5,
        ),
    });
    return () => {
      window.clearTimeout(warm);
      scene.remove(rig.group, rig.water);
      removeSolid();
      removeSlot();
      removeJar();
    };
  }, [scene, rig, gl, camera]);

  /** 물동이 물낯 — 공개 에셋 물동이의 테두리 높이 · 아가리 크기를 재서 그 조금 아래에 */
  const measureJar = (time: number) => {
    // 장면을 훑으니 1 초에 한 번, 다 재면 그만
    if (rig.jarMeasured || time - rig.jarTriedAt < 1) return;
    rig.jarTriedAt = time;
    scene.traverse((o) => {
      if (rig.jarMeasured || !(o as THREE.Mesh).isMesh || !o.name.endsWith("씬2.물동이") || !o.visible) return;
      const box = new THREE.Box3().setFromObject(o);
      const center = box.getCenter(new THREE.Vector3()).divideScalar(M);
      if (Math.hypot(center.x - JAR.x, center.z - JAR.z) > 0.5) return;
      const size = box.getSize(new THREE.Vector3()).divideScalar(M);
      rig.water.position.set(center.x * M, (box.max.y / M - Math.min(0.06, size.y * 0.12)) * M, center.z * M);
      rig.water.scale.setScalar(Math.min(size.x, size.z) * 0.32 * M);
      rig.water.visible = true;
      rig.jarMeasured = true;
    });
  };

  useFrame((frame) => {
    const time = frame.clock.elapsedTime;
    measureJar(time);
    // 마주 보면 자국이 숨 쉬듯 빛난다. 비늘을 넣으면 비늘이 밝게
    const glow = ridgeQuest.birdsFacing && !ridgeQuest.scaleSet ? 0.55 + 0.35 * Math.sin(time * 2.2) : 0;
    rig.fossil.emissiveIntensity += (glow - rig.fossil.emissiveIntensity) * 0.1;
    if (rig.setAt >= 0) rig.scaleMaterial.emissiveIntensity = 0.4 + 0.8 * Math.max(0, Math.sin((performance.now() / 1000 - rig.setAt) * 3));
    // 새들이 떠나면 물 위 그림자가 구렁이로 바뀐다
    if (!rig.serpentShown && ridge.isAtLeast("leaving")) {
      rig.serpentShown = true;
      rig.waterMaterial.map = makeSerpentTexture();
      rig.waterMaterial.needsUpdate = true;
    }
    // 물결에 그림자가 살짝 흔들린다
    rig.water.rotation.z = Math.sin(time * 0.7) * 0.06;
  });

  return null;
}
