/**
 * 물에 뜬 돌 넷 — 기우제로 물이 차오르면 떠올라 물결 따라 까딱인다. [E] 로 주워 소지품에 넣는다. 넷을 다 건지면 강물이 갈라진다(puzzles/cave).
 * 물빛이 어두워 돌은 밝게 칠하고 둘레에 흰 물거품 고리를 둘러 멀리서도 읽히게 한다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { audio } from "../../scene/immersion/audio";
import { getUnderwater } from "../cave/caveState";
import { M, groundY } from "../fishTrap/shared";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { buildFloatStoneGeometry } from "../itemLooks";
import { prewarmShaders } from "../prewarm";
import { setPuzzlePanel } from "../puzzlePanel";
import { getWaterLevel, ritual, useRitualStage } from "./ritualState";

/** 뜬 돌 자리(미터) — 어귀(서쪽)에 하나, 나머지 셋은 마법진 앞쪽(강 쪽·동쪽) 자갈밭에. 마법진 · 장독대 · 배를 비킨다 */
const SPOTS = [
  { x: 41.2, z: 41.0 },
  { x: 48.8, z: 40.8 },
  { x: 50.4, z: 36.2 },
  { x: 52.6, z: 33.6 },
];
/** 물이 이만큼(미터) 차야 떠오른다 */
const SHOW_LEVEL = 0.2;
/** 돌 배율 — 실물보다 조금 크게, 물 위에서 읽히게 */
const STONE_SCALE = 1.55;

export default function FloatingStones() {
  const stage = useRitualStage();
  const [taken, setTaken] = useState<boolean[]>(() => SPOTS.map(() => false));
  const { stones, glows, lights, stoneGeometry, stoneMaterial, glowMaterial } = useMemo(() => {
    const stoneGeometry = buildFloatStoneGeometry();
    const stoneMaterial = new THREE.MeshToonMaterial({
      color: "#E8E2D3",
      emissive: new THREE.Color("#5A574E"), // 폭우 속 어스름에도 묻히지 않게 살짝 스스로 밝힌다
      gradientMap: TOON_GRADIENT,
    });
    const glowMaterial = new THREE.SpriteMaterial({ map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    const glows = SPOTS.map(() => {
      const sprite = new THREE.Sprite(glowMaterial);
      sprite.visible = false;
      return sprite;
    });
    const lights = SPOTS.map(() => {
      // 늘 켜 둔 채 세기만 0 — 조명을 켜고 끄면 빛 받는 재질 전부가 셰이더를 다시 굽느라 화면이 멈춘다
      return new THREE.PointLight("#FFFFFF", 0, 3 * M, 1.6);
    });
    const stones = SPOTS.map(() => {
      // 돌마다 재질을 따로 — 겨눈 돌만 밝아지게
      const mesh = new THREE.Mesh(stoneGeometry, stoneMaterial.clone());
      mesh.scale.setScalar(M * STONE_SCALE);
      mesh.visible = false;
      return mesh;
    });
    return { stones, glows, lights, stoneGeometry, stoneMaterial, glowMaterial };
  }, []);

  useEffect(
    () => () => {
      stoneGeometry.dispose();
      stoneMaterial.dispose();
      stones.forEach((mesh) => (mesh.material as THREE.Material).dispose());
      glowMaterial.map?.dispose();
      glowMaterial.dispose();
      setPuzzlePanel("float-stones", null);
    },
    [stones, stoneGeometry, stoneMaterial, glowMaterial],
  );

  // 뜬 돌 · 빛무리는 물이 찬 뒤 처음 보인다 — 그 순간 셰이더를 굽느라 멈추지 않게 불러올 때 미리 굽는다
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const timer = window.setTimeout(() => prewarmShaders(gl, scene, camera, [...stones, ...glows]), 2700);
    return () => window.clearTimeout(timer);
  }, [gl, scene, camera, stones, glows]);

  // [E] 로 겨누는 자리(유닛) — 물 높이를 따라 매 프레임 고친다
  const centers = useRef(SPOTS.map(({ x, z }) => new THREE.Vector3(x * M, 0, z * M)));

  useEffect(() => {
    const picks: (() => void)[] = [];
    const disposers = SPOTS.map((_, index) =>
      registerInteractable({
        id: `float-stone-${index}`,
        position: centers.current[index],
        label: "뜬 돌 줍기",
        highlight: () => stones[index],
        radius: 0.35 * M,
        reach: 2.8 * M,
        enabled: () => !taken[index] && getWaterLevel() > SHOW_LEVEL,
        use: (picks[index] = () => {
          if (!inventory.add("floatStone")) {
            showNotice("소지품이 가득 찼다. [I] 로 열어 하나 꺼내 두자.");
            return;
          }
          setTaken((previous) => previous.map((value, i) => value || i === index));
          audio.play("첨벙");
          const left = taken.filter((value) => !value).length - 1;
          // 갈라짐(ritual.part)은 매 프레임 쪽에서 — 물이 다 차기 전에 건져도 빠뜨리지 않게
          showNotice(left > 0 ? `물에 뜬 돌을 건졌다. (${SPOTS.length - left}/${SPOTS.length})` : "떠 있던 돌을 다 건졌다. 강 쪽 물이 술렁인다.", 4);
        }),
      }),
    );
    // 개발용 — 헤드리스는 마우스를 못 잠가 [E] 를 못 누른다. __game.najuFloatDev.take(0)
    if (import.meta.env.DEV) exposeDevHook("najuFloatDev", { take: (index: number) => picks[index]?.() });
    return () => disposers.forEach((dispose) => dispose());
  }, [taken, stones]);

  // 물이 찬 뒤 물을 헤치는 발소리 — 발이 물에 잠긴 채 걸을 때
  const wading = useRef({ x: 0, z: 0, step: 0 });

  useFrame(({ clock, camera }, rawDt) => {
    const level = getWaterLevel();
    const dt = Math.min(rawDt, 0.1);
    const w = wading.current;
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const speed = Math.hypot(px - w.x, pz - w.z) / Math.max(dt, 1e-3);
    w.x = px;
    w.z = pz;
    const ground = groundY(px, pz);
    const feetWet = level - ground > 0.04 && camera.position.y / M - 1.25 < level + 0.1 && !getUnderwater();
    if (feetWet && speed > 0.6 && speed < 12) {
      w.step += dt;
      if (w.step > (speed > 3 ? 0.32 : 0.46)) {
        w.step = 0;
        audio.play("물발소리");
      }
    } else w.step = 0.3;
    const time = clock.elapsedTime;
    const pulse = 0.75 + 0.25 * Math.sin(time * 2.4);
    let nearest = Infinity;
    SPOTS.forEach(({ x, z }, index) => {
      const shown = level > SHOW_LEVEL && !taken[index];
      stones[index].visible = shown;
      glows[index].visible = shown;
      if (!shown) {
        lights[index].intensity = 0;
        return;
      }
      nearest = Math.min(nearest, Math.hypot(camera.position.x / M - x, camera.position.z / M - z));
      // 빛무리 · 점광 — 숨 쉬듯 밝아졌다 어두워진다
      glows[index].position.set(x * M, (level + 0.12) * M, z * M);
      glows[index].scale.setScalar(M * (0.9 + 0.2 * pulse));
      lights[index].position.set(x * M, (level + 0.3) * M, z * M);
      lights[index].intensity = 0.6 + 0.5 * pulse;
      // 물결 따라 까딱이고 천천히 돈다
      const bob = Math.sin(time * 1.6 + index * 1.7) * 0.03;
      stones[index].position.set(x * M, (level + 0.02 + bob) * M, z * M);
      stones[index].rotation.set(Math.sin(time * 1.1 + index) * 0.12, time * 0.2 + index, Math.cos(time * 1.3 + index) * 0.1);
      centers.current[index].set(x * M, (level + 0.05) * M, z * M);
    });
    // 넷을 다 건졌으면 강물이 갈라진다. 단계는 한 칸씩만 가므로 물이 다 찬(flooded) 뒤에 올린다 —
    // 차오르는 중에 다 건져도 여기서 매 프레임 보다가 올린다
    const count = taken.filter(Boolean).length;
    if (count === SPOTS.length && ritual.stage() === "flooded") ritual.part();
    // 안내판 — 물이 찬 동안. 건진 수가 보이고, 넷을 다 건지면 강물이 갈라진다는 걸 알려 준다
    if (stage === "flooded" && level > SHOW_LEVEL)
      setPuzzlePanel("float-stones", {
        distance: nearest,
        title: "물에 뜬 돌",
        rule: "물 위에 흰빛을 두른 돌 넷이 떠 있다 — 어귀(서쪽)에 하나, 마법진 앞 강 쪽에 셋.\n가까이 가서 [E] 로 건진다. 넷을 다 건지면 강물이 양쪽으로 갈라진다.",
        rows: [{ label: "건진 돌", value: `${count} / ${SPOTS.length}`, ok: count === SPOTS.length }],
      });
    else setPuzzlePanel("float-stones", null);
  });

  return (
    <>
      {stones.map((mesh, index) => (
        <primitive key={`stone-${index}`} object={mesh} />
      ))}
      {glows.map((sprite, index) => (
        <primitive key={`glow-${index}`} object={sprite} />
      ))}
      {lights.map((light, index) => (
        <primitive key={`light-${index}`} object={light} />
      ))}
    </>
  );
}
