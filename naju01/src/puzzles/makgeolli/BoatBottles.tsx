/**
 * 안쪽 배의 술병 셋 — 기우제 제물 「막걸리」.
 * 둘은 버려져 나뒹굴고(깨지고 비었다), 하나만 입구가 꼭 막혀 멀쩡하다. 멀쩡한 것만 [E] 로 챙긴다.
 * 흰 백자라 배 그늘에서도 눈에 띈다. 멀쩡한 술병은 본편 본부실처럼 겨누면 스스로 빛나며 살짝 커진다(겨냥 강조 · 팀 기준값과 같은 색·세기).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { audio } from "../../scene/immersion/audio";
import { M } from "../fishTrap/shared";
import { aimedId, registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makgeolliBottle } from "./makgeolliState";

/** 술병(자기) — 라이브러리 경량본(CC BY 4.0). 막걸리 통은 라이브러리에 없어 가장 가까운 술병을 쓴다 */
const BOTTLE_MODEL = `${import.meta.env.BASE_URL}_sf_local/lib/ast-prop-liquor-bottle-porcelain-01.glb`;
/** 키(미터) — 실물 25 cm 보다 조금 크게, 배 안을 내려다볼 때 읽히게 */
const BOTTLE_HEIGHT = 0.32;

/** 배 바닥(미터) — 안쪽 배(x 40~45 · z 42~45.5) 바닥을 재서 골랐다 */
const SPOTS = {
  intact: { x: 42.85, y: 0.17, z: 43.9, yaw: 0.6 },
  broken: [
    { x: 41.85, y: 0.25, z: 43.15, yaw: 2.2, note: "입구가 깨져 나가 속이 비었다. 빗물만 고여 있다." },
    { x: 43.35, y: 0.17, z: 44.25, yaw: -0.9, note: "몸통에 금이 가 술이 다 새어 나갔다." },
  ],
};

const INTACT_ID = "boat-bottle-intact";

/** 본편 「겨냥 강조」 팀 기준값 */
const AIM_GLOW = { color: new THREE.Color("#fffed7"), strength: 0.45, grow: 0.08 };

type EmissiveMaterial = THREE.Material & { emissive?: THREE.Color };

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

/** 빛남이 다른 술병으로 번지지 않게 재질을 따로 갖는 복제 */
function cloneWithOwnMaterials(source: THREE.Object3D) {
  const copy = source.clone(true);
  copy.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  return copy;
}

export default function BoatBottles() {
  const [template, setTemplate] = useState<THREE.Object3D | null>(null);
  const [isTaken, setIsTaken] = useState(false);

  useEffect(() => {
    let isAlive = true;
    // 라이브러리 경량본은 meshopt·KTX2 압축 — 기본 로더로는 조용히 실패한다
    createCompressedGltfLoader().load(
      BOTTLE_MODEL,
      (gltf) => isAlive && setTemplate(fitModel(gltf.scene)),
      undefined,
      (error) => console.warn("[BoatBottles] 술병 모형을 못 읽었다:", error),
    );
    return () => {
      isAlive = false;
    };
  }, []);

  const bottles = useMemo(() => {
    if (!template) return null;
    const place = (spot: { x: number; y: number; z: number; yaw: number }, lying: boolean) => {
      const group = new THREE.Group();
      group.position.set(spot.x * M, spot.y * M, spot.z * M);
      group.rotation.y = spot.yaw;
      group.scale.setScalar(BOTTLE_HEIGHT * M);
      const body = cloneWithOwnMaterials(template);
      // 버린 것은 옆으로 쓰러져 있다 — 눕히면 반지름만큼 떠서 조금 내린다
      if (lying) {
        body.rotation.z = Math.PI / 2 - 0.15;
        body.position.y = 0.32;
      }
      group.add(body);
      return group;
    };
    return {
      intact: place(SPOTS.intact, false),
      broken: SPOTS.broken.map((spot) => place(spot, true)),
    };
  }, [template]);

  useEffect(
    () => () => {
      if (!bottles) return;
      for (const group of [bottles.intact, ...bottles.broken])
        group.traverse((node) => {
          const material = (node as THREE.Mesh).material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
        });
    },
    [bottles],
  );

  // ── 상호작용 ──
  useEffect(() => {
    if (!bottles) return;
    const center = (spot: { x: number; y: number; z: number }) =>
      new THREE.Vector3(spot.x * M, (spot.y + BOTTLE_HEIGHT * 0.5) * M, spot.z * M);
    const disposers = [
      registerInteractable({
        id: INTACT_ID,
        position: center(SPOTS.intact),
        label: "막걸리 술병 챙기기",
        radius: 0.3 * M,
        reach: 2.6 * M,
        enabled: () => !isTaken,
        use: () => {
          if (!inventory.add("makgeolli")) {
            showNotice("소지품이 가득 찼다. [I] 로 열어 하나 꺼내 두자.");
            return;
          }
          setIsTaken(true);
          makgeolliBottle.take();
          audio.play("단서");
          showNotice("입구가 꼭 막힌 술병이다. 막걸리가 찰랑인다. [I] 소지품");
        },
      }),
      ...SPOTS.broken.map((spot, index) =>
        registerInteractable({
          id: `boat-bottle-broken-${index}`,
          position: center(spot),
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

  // ── 겨냥 강조 — 본편 AimHighlight 와 같은 셈: 원래 발광에 더하고, 바닥 가운데를 기준으로 키운다 ──
  const glow = useRef(0);
  const originalEmissive = useRef(new WeakMap<THREE.Material, THREE.Color>());
  const glowColor = useMemo(() => new THREE.Color(), []);
  useFrame((_, delta) => {
    if (!bottles || isTaken) return;
    const goal = aimedId() === INTACT_ID ? 1 : 0;
    const before = glow.current;
    glow.current += (goal - glow.current) * (1 - Math.exp(-delta * 14));
    if (glow.current < 0.002 && before < 0.002) return;
    bottles.intact.scale.setScalar(BOTTLE_HEIGHT * M * (1 + AIM_GLOW.grow * glow.current));
    glowColor.copy(AIM_GLOW.color).multiplyScalar(glow.current * AIM_GLOW.strength);
    bottles.intact.traverse((node) => {
      const material = (node as THREE.Mesh).material as EmissiveMaterial | EmissiveMaterial[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (!m.emissive) continue;
        let original = originalEmissive.current.get(m);
        if (!original) {
          original = m.emissive.clone();
          originalEmissive.current.set(m, original);
        }
        m.emissive.copy(original).add(glowColor);
      }
    });
  });

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
