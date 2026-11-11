/**
 * 돌새 곁 — 물동이 물에 비친 그림과 두 기둥 사이 화석 자리.
 *   물동이: 들여다보면 고인 물 위에 두 새가 서로 마주 보는 그림자가 어른거린다(지금 돌새는 서로 등지고 있다).
 *     새들이 떠난 뒤에는 물 위 그림자가 바뀐다 — 똬리를 튼 구렁이(아랑사)의 그림자.
 *   화석 자리: 두 기둥 사이 땅에 박힌 돌판에 비늘 모양으로 팬 자국 — 무언가 오래 박혀 있다 빠진 자리다.
 *     두 새가 마주 보면 자국이 희미하게 빛나고, 강 밑 석실에서 가져온 푸른 눈물(비늘꼴)을 맞춰 넣으면 꼭 들어맞는다
 *     → 새가 깨어난다(ridge 「awakening」, RidgeBirds 가 잇는다).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { addDynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { registerInteractable, showNotice } from "../interaction";
import { buildScaleGeometry } from "../itemLooks";
import { makeToonMaterial } from "../materials";
import { prewarmShaders } from "../prewarm";
import { M, groundY } from "../units";
import {
  SCALE_SEAT,
  SLAB_TOP,
  buildSlab,
  makeFossilTexture,
  makeReflectionTexture,
  makeSerpentTexture,
} from "./birdHintArt";
import { ridge, ridgeQuest } from "./ridgeState";

/** 두 돌새(씬2 솟대 0 · 1) 사이 · 물동이(씬2 물동이 0) */
const STATUES = [
  { x: 74.507, z: 20.891 },
  { x: 74.384, z: 22.211 },
];
const SLOT = { x: (STATUES[0].x + STATUES[1].x) / 2 + 0.15, z: (STATUES[0].z + STATUES[1].z) / 2 };
const JAR = { x: 74.084, z: 19.857 };

/**
 * 물동이의 테두리 상자(유닛). 배치 물건은 같은 모양끼리 한 묶음(InstancedMesh)으로 그려지고, 멀리 있으면 그리는 목록(count)에서
 * 빠진다(전체 목록은 userData.fullSet — GateAltar 횃불과 같다). 묶음에 저장된 상자는 비어 있을 때 한 번 재고 남기도 해서
 * Box3.setFromObject 로는 물동이를 영영 못 찾았다(11/11 「물동이 물에 두 새가 안 비친다」). 묶음이면 물동이 하나하나의 자리로 잰다.
 */
function jarBoxes(mesh: THREE.Mesh): THREE.Box3[] {
  if (!(mesh as THREE.InstancedMesh).isInstancedMesh) return [new THREE.Box3().setFromObject(mesh)];
  const instanced = mesh as THREE.InstancedMesh;
  if (!instanced.geometry.boundingBox) instanced.geometry.computeBoundingBox();
  const local = instanced.geometry.boundingBox!;
  instanced.updateWorldMatrix(true, false);
  const full = instanced.userData.fullSet as { matrices: Float32Array; n: number } | undefined;
  const matrix = new THREE.Matrix4();
  return Array.from({ length: full ? full.n : instanced.count }, (_, index) => {
    if (full) matrix.fromArray(full.matrices, index * 16);
    else instanced.getMatrixAt(index, matrix);
    return local.clone().applyMatrix4(matrix.premultiply(instanced.matrixWorld));
  });
}

function buildHintProps() {
  const group = new THREE.Group();
  group.add(buildSlab());
  // 마주 본 뒤 자국에 드는 빛 — 비늘을 넣기 전엔 푸른 표식이 없다
  const fossil = makeToonMaterial("#FFFFFF", {
    map: makeFossilTexture(),
    transparent: true,
    alphaTest: 0.2,
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
  const scaleMaterial = makeToonMaterial("#FFFFFF", {
    vertexColors: true,
    emissive: new THREE.Color("#2E7FB0"),
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
  });
  const scale = new THREE.Mesh(scaleGeometry, scaleMaterial);
  scale.visible = false;
  group.add(scale);
  group.scale.setScalar(M);
  const waterMaterial = makeToonMaterial("#FFFFFF", {
    map: makeReflectionTexture(),
    emissive: new THREE.Color("#FFFFFF"),
    emissiveIntensity: 0.25,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 32), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.visible = false;
  return {
    group,
    fossil,
    scale,
    scaleMaterial,
    water,
    waterMaterial,
    isSerpentShown: false,
    /** 비늘을 맞춰 넣은 때(초, −1 이면 아직) */
    scaleSetAt: -1,
    isJarMeasured: false,
    jarTriedAt: -99,
  };
}

export default function BirdHints() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const props = useMemo(() => buildHintProps(), []);

  useEffect(() => {
    const ground = groundY(SLOT.x, SLOT.z);
    props.group.position.set(SLOT.x * M, ground * M, SLOT.z * M);
    // 비늘 밑동이 새 하나를, 끝이 다른 새를 가리키게
    props.group.rotation.y = Math.atan2(STATUES[1].x - STATUES[0].x, STATUES[1].z - STATUES[0].z);
    scene.add(props.group, props.water);
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, [props.group, props.water]), 3300);
    const removeSolid = addDynamicSolid({
      x: SLOT.x,
      z: SLOT.z,
      yaw: props.group.rotation.y,
      halfX: 0.24,
      halfZ: 0.3,
      bottom: ground - 0.2,
      top: ground + SLAB_TOP,
      enabled: true,
    });
    const removeSlot = registerInteractable({
      id: "ridge-fossil",
      position: new THREE.Vector3(SLOT.x * M, (ground + SLAB_TOP + 0.05) * M, SLOT.z * M),
      label: "두 기둥 사이 돌판",
      highlight: () => props.group,
      radius: 0.35 * M,
      reach: 2.4 * M,
      enabled: () => ridge.stage() === "sealed" && !ridgeQuest.scaleSet,
      use: () =>
        showNotice(
          ridgeQuest.birdsFacing
            ? "눈물 모양으로 팬 자국이 희미하게 빛난다. 오래 박혀 있던 무언가가 빠진 자리 — 꼭 맞을 것을 가지고 있다면."
            : "돌판에 눈물 모양으로 움푹 팬 자국이 있다. 화석처럼 결까지 남았다. 아직은 아무 기척이 없다.",
          4.5,
        ),
      handLabel: (kind) =>
        kind === "scale" && ridgeQuest.birdsFacing && !ridgeQuest.scaleSet ? "푸른 눈물 맞춰 넣기" : null,
      receive: () => {
        props.scale.visible = true;
        props.scaleSetAt = performance.now() / 1000;
        ridgeQuest.set("scaleSet");
        audio.play("단서");
        audio.play("징");
        showNotice(
          "푸른 눈물이 자국에 딱 들어맞는다 — 결까지 그대로 이어진다. 원래 이 자리에 있던 것이다. 주위가 숨을 죽인 듯 고요하다…",
          5,
        );
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
          props.isSerpentShown
            ? "물에 비친 것이 바뀌었다 — 새들은 간데없고, 똬리를 튼 구렁이 그림자가 고개를 들고 있다."
            : ridgeQuest.birdsFacing
              ? "물에 비친 두 새와 돌새가 똑같이 서로를 보고 있다."
              : "고인 물에 하늘이 비친다. 그런데 물 위의 두 새 그림자는 서로 마주 보고 있다 — 저 위 돌새들은 서로 등을 돌렸는데.",
          5.5,
        ),
    });
    return () => {
      window.clearTimeout(warm);
      scene.remove(props.group, props.water);
      removeSolid();
      removeSlot();
      removeJar();
    };
  }, [scene, props, gl, camera]);

  /** 물동이 물낯 — 공개 에셋 물동이의 테두리 높이 · 아가리 크기를 재서 그 조금 아래에. 장면을 훑으니 1 초에 한 번 */
  const measureJar = (time: number) => {
    if (props.isJarMeasured || time - props.jarTriedAt < 1) return;
    props.jarTriedAt = time;
    scene.traverse((object) => {
      if (
        props.isJarMeasured ||
        !(object as THREE.Mesh).isMesh ||
        !object.name.endsWith("씬2.물동이") ||
        !object.visible
      )
        return;
      const box = jarBoxes(object as THREE.Mesh).find((candidate) => {
        const center = candidate.getCenter(new THREE.Vector3()).divideScalar(M);
        return Math.hypot(center.x - JAR.x, center.z - JAR.z) <= 0.5;
      });
      if (!box) return;
      const center = box.getCenter(new THREE.Vector3()).divideScalar(M);
      const size = box.getSize(new THREE.Vector3()).divideScalar(M);
      props.water.position.set(center.x * M, (box.max.y / M - Math.min(0.06, size.y * 0.12)) * M, center.z * M);
      props.water.scale.setScalar(Math.min(size.x, size.z) * 0.32 * M);
      props.water.visible = true;
      props.isJarMeasured = true;
    });
  };

  useFrame((frame) => {
    const time = frame.clock.elapsedTime;
    measureJar(time);
    // 마주 보면 자국이 숨 쉬듯 빛난다. 비늘을 넣으면 비늘이 밝게
    const glow = ridgeQuest.birdsFacing && !ridgeQuest.scaleSet ? 0.55 + 0.35 * Math.sin(time * 2.2) : 0;
    props.fossil.emissiveIntensity += (glow - props.fossil.emissiveIntensity) * 0.1;
    if (props.scaleSetAt >= 0)
      props.scaleMaterial.emissiveIntensity =
        0.4 + 0.8 * Math.max(0, Math.sin((performance.now() / 1000 - props.scaleSetAt) * 3));
    // 새들이 떠나면 물 위 그림자가 구렁이로 바뀐다
    if (!props.isSerpentShown && ridge.isAtLeast("leaving")) {
      props.isSerpentShown = true;
      props.waterMaterial.map = makeSerpentTexture();
      props.waterMaterial.needsUpdate = true;
    }
    // 물결에 그림자가 살짝 흔들린다
    props.water.rotation.z = Math.sin(time * 0.7) * 0.06;
  });

  return null;
}
