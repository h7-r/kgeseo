// 0단계 화면 성능 예비 측정(로비 설계 v0.19 6절)의 가짜 아바타 — 고정 외형과 고정 동선.
// 측정 때마다 같은 그림이 나와야 1명·10명을 견줄 수 있으므로 난수를 쓰지 않는다.
import { WALK_SPEED } from "@/engine/movement/constants";
import { DEFAULT_CATALOG, DEFAULT_MESH_CONFIG, toRendererConfig, type ChibiConfig } from "@/naju";

type Appearance = Parameters<typeof toRendererConfig>[0];
type Gender = Appearance["gender"];

/** 가짜 아바타는 최대 9명(나 + 9 = 방 정원 10) */
export const MAX_BOTS = 9;

/**
 * 측정 때 내가 서는 자리와 시선. 구석(−18, 11)에 서면 3인칭 카메라가 뒷벽에 막혀 당겨지면서 내 캐릭터가 사라진다
 * (BoomFade). 여기서는 카메라가 약 5 유닛 뒤에 서고 내 캐릭터와 가짜 아바타 9명이 한 화면에 다 보인다(11/6 화면 확인).
 */
export const VIEWER_SPOT = { x: -14, z: 7 } as const;
/** 본부실 한가운데(−2, −1)를 비스듬히 내려다본다. 카메라 yaw θ 의 앞 = (−sin θ, −cos θ). */
export const VIEWER_YAW = Math.atan2(-(-2 - VIEWER_SPOT.x), -(-1 - VIEWER_SPOT.z));
export const VIEWER_PITCH = -0.12;

interface Loop {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

// 본부실 벽 안(x −20~16, z −14~12, src/station/layout/dimensions.ts). 원격 캐릭터는 충돌을 안 하므로 책상을 지나가도 된다.
const LOOPS: readonly Loop[] = [
  { cx: -6, cz: 0, rx: 6, rz: 4 },
  { cx: 2, cz: -4, rx: 5, rz: 3 },
  { cx: -10, cz: -7, rx: 4, rz: 3 },
];

export interface BotPose {
  x: number;
  z: number;
  facing: number;
  speed: number;
}

/** i 번째 가짜 아바타가 t 초에 있는 자리. 세 고리에 셋씩, 1/3 바퀴 간격, 고리마다 도는 방향을 바꾼다. */
export function botPose(index: number, t: number): BotPose {
  const loop = LOOPS[index % LOOPS.length];
  const direction = Math.floor(index / LOOPS.length) % 2 === 0 ? 1 : -1;
  const phase = (Math.floor(index / LOOPS.length) * 2 * Math.PI) / 3;
  const omega = (WALK_SPEED / ((loop.rx + loop.rz) / 2)) * direction;
  const theta = phase + omega * t;
  const vx = -loop.rx * Math.sin(theta) * omega;
  const vz = loop.rz * Math.cos(theta) * omega;
  return {
    x: loop.cx + loop.rx * Math.cos(theta),
    z: loop.cz + loop.rz * Math.sin(theta),
    // 앞 = (sin f, cos f) — ChibiGameAvatar 규약
    facing: Math.atan2(vx, vz),
    speed: Math.hypot(vx, vz),
  };
}

const HAIR_BY_GENDER: Record<Gender, readonly string[]> = {
  masculine: ["hair.m.crop", "hair.buzz"],
  feminine: ["hair.f.bob", "hair.buzz"],
};

const pickColor = (slot: keyof typeof DEFAULT_CATALOG.palettes, index: number) => {
  const palette = DEFAULT_CATALOG.palettes[slot];
  return palette[index % palette.length][0];
};

/** i 번째 가짜 아바타의 외형. 성별·머리·색·체형을 번갈아 바꾸고 옷은 카탈로그의 기본 착장을 입힌다. */
export function botAppearance(index: number): ChibiConfig {
  const gender: Gender = index % 2 === 0 ? "masculine" : "feminine";
  const hairs = HAIR_BY_GENDER[gender];
  const step = (index % 5) - 2; // −2 … 2
  const appearance: Appearance = {
    gender,
    hairId: hairs[Math.floor(index / 2) % hairs.length],
    equipmentIds: { top: "top.tee.white", bottom: "bottom.shorts.black", shoes: "shoes.sneaker.white" },
    // 캐릭터 생성 화면의 범위 안(appearanceData.ts BODY_FIELDS)에서만 고른다
    bodyParameters: {
      heightScale: 1 + step * 0.04,
      headScale: 0.85,
      handScale: 0.9,
      footScale: 1,
      shoulderWidth: gender === "masculine" ? 1.15 : 1.05,
      hipWidth: gender === "feminine" ? 1.05 : 1,
      armLength: 0.9,
      legLength: 1,
      armThickness: 0.85,
      legThickness: gender === "masculine" ? 1 : 0.85,
      build: step * 0.15,
      buff: index % 3 === 0 ? 0.2 : 0,
    },
    colors: {
      skin: pickColor("skin", index),
      hair: pickColor("hair", index + 3),
      cloth: pickColor("cloth", index + 1),
      bottom: pickColor("bottom", index),
      shoes: pickColor("shoes", index),
    },
  };
  // toRendererConfig 기본 동작은 「대기 고정」이다 — 자동으로 넘겨야 이동 상태를 따라 걷는다.
  return toRendererConfig(appearance, DEFAULT_CATALOG, { motion: DEFAULT_MESH_CONFIG.motion });
}
