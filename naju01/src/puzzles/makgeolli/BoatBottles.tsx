/**
 * 안쪽 배의 술병 셋 — 기우제 제물 「막걸리」.
 * 둘은 버려져 나뒹굴고(깨지고 비었다), 하나만 입구가 꼭 막혀 멀쩡하다. 멀쩡한 것만 [E] 로 챙긴다.
 * 흰 백자라 배 그늘에서도 눈에 띈다.
 */
import { assetUrl } from "@/config/env";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { audio } from "../../scene/immersion/audio";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { M } from "../units";
import { makgeolliBottle } from "./makgeolliState";

/** 술병(자기) — 라이브러리 경량본(CC BY 4.0). 막걸리 통은 라이브러리에 없어 가장 가까운 술병을 쓴다 */
const BOTTLE_MODEL = "/_sf_local/lib/ast-prop-liquor-bottle-porcelain-01.glb";
/** 키(미터) — 실물 25 cm 보다 조금 크게, 배 안을 내려다볼 때 읽히게 */
const BOTTLE_HEIGHT = 0.32;

interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** 배 바닥(미터) — 안쪽 배(x 40~45 · z 42~45.5) 바닥 높이에 맞췄다 */
const INTACT_SPOT: Spot = { x: 42.85, y: 0.17, z: 43.9, yaw: 0.6 };
const BROKEN_SPOTS: (Spot & { note: string })[] = [
  { x: 41.85, y: 0.25, z: 43.15, yaw: 2.2, note: "입구가 깨져 나가 속이 비었다. 빗물만 고여 있다." },
  { x: 43.35, y: 0.17, z: 44.25, yaw: -0.9, note: "몸통에 금이 가 술이 다 새어 나갔다." },
];

/** 모형을 바닥이 원점에 닿고 키가 1 이 되게 맞춘 틀 */
function fitModel(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const unit = new THREE.Group();
  model.position.set(-center.x, -box.min.y, -center.z);
  unit.add(model);
  unit.scale.setScalar(1 / size.y);
  const fitted = new THREE.Group();
  fitted.add(unit);
  return fitted;
}

/** 겨냥 강조 빛남이 다른 술병으로 번지지 않게 재질을 따로 갖는 복제 */
function cloneWithOwnMaterials(source: THREE.Object3D) {
  const copy = source.clone(true);
  copy.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();
  });
  return copy;
}

/** 술병 하나를 배 바닥에 놓는다. 버린 것은 옆으로 쓰러져 있다 — 눕히면 반지름만큼 떠서 조금 내린다 */
function placeBottle(template: THREE.Object3D, spot: Spot, isLying: boolean) {
  const group = new THREE.Group();
  group.position.set(spot.x * M, spot.y * M, spot.z * M);
  group.rotation.y = spot.yaw;
  group.scale.setScalar(BOTTLE_HEIGHT * M);
  const body = cloneWithOwnMaterials(template);
  if (isLying) {
    body.rotation.z = Math.PI / 2 - 0.15;
    body.position.y = 0.32;
  }
  group.add(body);
  return group;
}

const bottleCenter = (spot: Spot) => new THREE.Vector3(spot.x * M, (spot.y + BOTTLE_HEIGHT * 0.5) * M, spot.z * M);

export default function BoatBottles() {
  const [template, setTemplate] = useState<THREE.Object3D | null>(null);
  const [isTaken, setIsTaken] = useState(makgeolliBottle.isTaken);

  useEffect(() => {
    let isAlive = true;
    // 라이브러리 경량본은 meshopt·KTX2 압축 — 기본 로더로는 조용히 실패한다
    createCompressedGltfLoader().load(
      assetUrl(BOTTLE_MODEL),
      (gltf) => isAlive && setTemplate(fitModel(gltf.scene)),
      undefined,
      (error) => console.warn("[BoatBottles] 술병 모형을 못 읽었다:", error),
    );
    return () => {
      isAlive = false;
    };
  }, []);

  const bottles = useMemo(
    () =>
      template && {
        intact: placeBottle(template, INTACT_SPOT, false),
        broken: BROKEN_SPOTS.map((spot) => placeBottle(template, spot, true)),
      },
    [template],
  );

  useEffect(
    () => () => {
      if (!bottles) return;
      for (const group of [bottles.intact, ...bottles.broken])
        group.traverse((node) => {
          const material = (node as THREE.Mesh).material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material?.dispose();
        });
    },
    [bottles],
  );

  useEffect(() => {
    if (!bottles) return;
    const disposers = [
      registerInteractable({
        id: "boat-bottle-intact",
        position: bottleCenter(INTACT_SPOT),
        label: "막걸리 술병 챙기기",
        // 겨누면 본부실처럼 스스로 빛나며 살짝 커진다
        highlight: () => bottles.intact,
        radius: 0.3 * M,
        reach: 2.6 * M,
        enabled: () => !isTaken,
        use: () => {
          if (!inventory.add("makgeolli")) {
            showNotice("소지품이 가득 찼다. [I] 로 열어 하나 꺼내 두자.", 3.2, { urgent: true, fleeting: true });
            return;
          }
          setIsTaken(true);
          makgeolliBottle.take();
          audio.play("단서");
          showNotice("입구가 꼭 막힌 술병이다. 막걸리가 찰랑인다. [I] 소지품");
        },
      }),
      ...BROKEN_SPOTS.map((spot, index) =>
        registerInteractable({
          id: `boat-bottle-broken-${index}`,
          position: bottleCenter(spot),
          label: "술병 살펴보기",
          radius: 0.3 * M,
          reach: 2.6 * M,
          use: () => {
            audio.play("똑");
            showNotice(spot.note);
          },
        }),
      ),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [bottles, isTaken]);

  if (!bottles) return null;
  return (
    <group>
      {!isTaken && <primitive object={bottles.intact} />}
      {bottles.broken.map((group, index) => (
        <primitive key={index} object={group} />
      ))}
    </group>
  );
}
