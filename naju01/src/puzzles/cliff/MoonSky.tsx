/**
 * 바위 위의 달 — 강 쪽(남) 하늘에 낮게 뜬 둥근 달. 밤인 곳에 서 있을 때만 뜬다(바위 위 · 틈을 지나 내려선 굿판).
 * 굿이 풀려 밤이 걷히면 진다.
 * 카메라가 바위 위에서는 먼 면을 24 m 남짓으로 줄이므로(구역 초점) 달은 카메라에서 19 m 앞에 둔다 — 크기도 그 거리에 맞춘다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { currentZone } from "../../scene/immersion/focusFog";
import { makeGlowTexture } from "../glowTexture";
import { gut } from "../gut/gutState";
import { M } from "../units";
import { CLIFF_TOP, MOON_DIR } from "./cliffShape";
import { cliff } from "./cliffState";

const MOON_DISTANCE = 19;
/** 달 지름 · 달무리 지름(미터, 그 거리에서) */
const MOON_SIZE = 1.5;
const HALO_SIZE = 7;
/** 밤인 곳에 들어서고 나설 때 달이 떠오르고 지는 빠르기(1/초) */
const FADE_SPEED = 0.8;

/** 달 얼굴 — 흰 원에 옅은 바다 얼룩 몇 개 */
function makeMoonTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const disc = g.createRadialGradient(size * 0.45, size * 0.42, 4, size / 2, size / 2, size * 0.48);
  disc.addColorStop(0, "#FFFDF2");
  disc.addColorStop(0.85, "#F1EEDD");
  disc.addColorStop(1, "rgba(235,232,215,0)");
  g.fillStyle = disc;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(170, 176, 182, 0.35)";
  for (const [x, y, r] of [
    [0.38, 0.4, 0.13],
    [0.6, 0.55, 0.1],
    [0.48, 0.66, 0.07],
    [0.63, 0.34, 0.06],
  ]) {
    g.beginPath();
    g.arc(size * x, size * y, size * r, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const isOnCliffTop = (camera: THREE.Camera) => {
  const x = camera.position.x / M;
  const z = camera.position.z / M;
  return (
    x > CLIFF_TOP.x[0] &&
    x < CLIFF_TOP.x[1] &&
    z > CLIFF_TOP.z[0] &&
    z < CLIFF_TOP.z[1] &&
    camera.position.y / M > CLIFF_TOP.minY
  );
};

export default function MoonSky() {
  const scene = useThree((state) => state.scene);
  const moon = useMemo(() => {
    const disc = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeMoonTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    disc.scale.setScalar(MOON_SIZE * M);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: "#9FB3D6",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    );
    halo.scale.setScalar(HALO_SIZE * M);
    const group = new THREE.Group();
    group.name = "cliff.moon";
    group.add(halo, disc);
    group.visible = false;
    // 하늘 — 바위·나무보다 먼저 그려 앞의 것에 가려진다
    halo.renderOrder = -1;
    disc.renderOrder = -1;
    return { group, disc, halo, shown: 0 };
  }, []);

  useEffect(() => {
    scene.add(moon.group);
    return () => {
      scene.remove(moon.group);
      (moon.disc.material as THREE.SpriteMaterial).map?.dispose();
      moon.disc.material.dispose();
      (moon.halo.material as THREE.SpriteMaterial).map?.dispose();
      moon.halo.material.dispose();
    };
  }, [scene, moon]);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const isAtNightRite = cliff.stage() === "crossed" && gut.stage() !== "dawn" && currentZone() === "Z2";
    const target = isOnCliffTop(camera) || isAtNightRite ? 1 : 0;
    moon.shown += Math.sign(target - moon.shown) * Math.min(Math.abs(target - moon.shown), dt * FADE_SPEED);
    moon.group.visible = moon.shown > 0.001;
    if (!moon.group.visible) return;
    moon.group.position.copy(camera.position).addScaledVector(MOON_DIR, MOON_DISTANCE * M);
    (moon.disc.material as THREE.SpriteMaterial).opacity = moon.shown;
    (moon.halo.material as THREE.SpriteMaterial).opacity = moon.shown * 0.55;
  });

  return null;
}
