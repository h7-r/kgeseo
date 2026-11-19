// 발 크기 보기(개발 전용) — 발 크기 칸마다 신발 밖으로 발(살)이 나오는지 가까이 본다(2026-11-07 미르: 작은 신발에서
// 발이 튀어나온다). 실제 로비 캐릭터(LobbyChibi)에 발 크기·다리 길이만 바꿔 넣는다. 다리가 길수록 발목 살이
// 커지고(종아리 뼈 배율), 신발은 발뼈 배율만 따라 작아지므로 「작은 발 + 긴 다리」가 가장 나쁘다.
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";

import { LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import { DEFAULT_MESH_CONFIG, DEFAULT_OUTLINE, DEFAULT_TOON, LobbyChibi } from "@/naju";
import { defaultLobbyLook, lobbyLookToRendererConfig } from "@/net/lobbyLook";

type Gender = "feminine" | "masculine";
type View = "front" | "back" | "side" | "angle";
type MotionSource = "tripo" | "sidekick";
/**
 * 게임이 실제로 트는 동작 전부(useMotionPlayer 의 고르기 · 인사 · 맞기 · 주먹 · 생성 화면). 반복 클립은 제자리에서
 * 계속 틀고, 끝이 있는 동작(seconds)은 게임과 같은 통로(AvatarLink.emote)로 되풀이한다.
 */
const MOTIONS: readonly { label: string; motion?: string; source?: MotionSource; seconds?: number }[] = [
  { label: "대기" },
  { label: "걷기", motion: "Walk_Loop", source: "tripo" },
  { label: "달리기", motion: "Jog_Fwd_Loop", source: "tripo" },
  { label: "쪼그려 대기", motion: "Crouch_Idle_Loop", source: "sidekick" },
  { label: "춤", motion: "Dance_Loop", source: "sidekick" },
  { label: "전력 질주", motion: "Sprint_Loop", source: "sidekick" },
  { label: "말하며 대기", motion: "Idle_Talking_Loop", source: "sidekick" },
  { label: "앉아 걷기", motion: "Crouch_Fwd_Loop", source: "sidekick" },
  { label: "점프 공중", motion: "Jump_Loop", source: "sidekick" },
  { label: "A 포즈", motion: "A_TPose", source: "sidekick" },
  { label: "점프 시작", motion: "Jump_Start", seconds: 1.33 },
  { label: "착지", motion: "Jump_Land", seconds: 1.27 },
  { label: "잽", motion: "Punch_Jab", seconds: 0.87 },
  { label: "크로스", motion: "Punch_Cross", seconds: 1 },
  { label: "손 내밀기", motion: "Interact", seconds: 2 },
  { label: "줍기", motion: "PickUp_Table", seconds: 0.9 },
  { label: "가슴 맞기", motion: "Hit_Chest", seconds: 0.6 },
];
const PAUSE_SECONDS = 0.3;
let serial = 0;

const TOON = { ...DEFAULT_TOON, enabled: true };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: true };
/** 생성 화면 눈금(0.7·0.85·1.0·1.15·1.3 = 230~290mm) 사이까지 촘촘히 */
const FOOT_SCALES = [0.7, 0.775, 0.85, 0.925, 1, 1.15, 1.3];
/** 렌더러 범위(0.8~1.2). 로비 허용은 0.85~1.2 */
const LEG_LENGTHS = [0.8, 1, 1.2];
const SPACING_X = 2.4;
const FACING: Record<View, number> = { front: 0, back: Math.PI, side: Math.PI / 2, angle: (Math.PI * 3) / 4 };
const VIEW_LABEL: Record<View, string> = { front: "앞", back: "뒤", side: "옆", angle: "뒤 45°" };

/** 생성 화면 눈금 글자와 같은 환산(0.7 → 230mm, 1.3 → 290mm) */
const footMm = (scale: number) => Math.round(230 + (scale - 0.7) * 100);

function makeLink(x: number, facing: number): AvatarLink {
  return {
    position: new THREE.Vector3(x, EYE_HEIGHT, 0),
    groundY: 0,
    footY: 0,
    facing,
    moving: false,
    running: false,
    speed: 0,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
  };
}

function Cell({
  index,
  gender,
  footScale,
  legLength,
  motion,
  facing,
}: {
  index: number;
  gender: Gender;
  footScale: number;
  legLength: number;
  motion: number;
  facing: number;
}) {
  const x = (index - (FOOT_SCALES.length - 1) / 2) * SPACING_X;
  const linkRef = useRef<AvatarLink>(makeLink(x, facing));
  const nextAt = useRef(0);
  useEffect(() => {
    linkRef.current.facing = facing;
  }, [facing]);
  const chosen = MOTIONS[motion];
  useFrame(() => {
    if (!chosen.seconds || !chosen.motion) return;
    const wall = performance.now() / 1000;
    if (wall < nextAt.current) return;
    serial += 1;
    linkRef.current.emote = { serial, at: wall, steps: [{ motion: chosen.motion, seconds: chosen.seconds }] };
    nextAt.current = wall + chosen.seconds + PAUSE_SECONDS;
  });
  const config = useMemo(() => {
    const base = lobbyLookToRendererConfig(JSON.stringify(defaultLobbyLook(gender)));
    const picked = MOTIONS[motion];
    return {
      ...base,
      footScale,
      legLength,
      ...(picked.motion && !picked.seconds
        ? { motion: picked.motion, motionSource: picked.source }
        : { motion: DEFAULT_MESH_CONFIG.motion }),
    };
  }, [gender, footScale, legLength, motion]);
  return (
    <>
      <Suspense fallback={null}>
        <LobbyChibi
          visible
          playerRef={linkRef}
          config={config}
          body={LOBBY_AVATAR_BODY}
          toon={TOON}
          outline={OUTLINE}
        />
      </Suspense>
      <group position={[x, -0.25, 0]}>
        <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div style={tagStyle}>
            {footMm(footScale)}mm ({footScale.toFixed(3)})
          </div>
        </Html>
      </group>
    </>
  );
}

const tagStyle: CSSProperties = {
  background: "rgba(16,18,22,0.78)",
  color: "#f0f0f0",
  padding: "2px 8px",
  borderRadius: 8,
  font: "12px system-ui, sans-serif",
  whiteSpace: "nowrap",
};

/** 발 높이만 크게 — 위 칸이 없으니 가로 폭에 맞춘다 */
function FootCamera({ high }: { high: boolean }) {
  const { camera, size, scene, gl } = useThree();
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    const width = FOOT_SCALES.length * SPACING_X + 0.6;
    ortho.zoom = Math.min(size.width / width, size.height / 2.2);
    const lookY = 0.55;
    ortho.position.set(0, high ? 30 : lookY, 50);
    ortho.lookAt(0, lookY, 0);
    ortho.updateProjectionMatrix();
    exposeDevHook("footCheck", { scene, camera, gl });
  }, [camera, size, scene, gl, high]);
  return null;
}

const button: CSSProperties = {
  padding: "4px 9px",
  borderRadius: 7,
  border: "1px solid #5b6270",
  background: "#2a2f37",
  color: "#fff",
  cursor: "pointer",
  font: "12px system-ui, sans-serif",
};
const active: CSSProperties = { ...button, background: "#4b7bd8", borderColor: "#4b7bd8" };

export default function FootCheck() {
  const [gender, setGender] = useState<Gender>("masculine");
  const [legLength, setLegLength] = useState(1.2);
  const [motion, setMotion] = useState(0);
  const [view, setView] = useState<View>("back");
  const [high, setHigh] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas orthographic dpr={[1, 2]} style={{ background: "#8d95a1" }}>
        <FootCamera high={high} />
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
        <directionalLight position={[3, 6, 8]} intensity={1.15} />
        {FOOT_SCALES.map((footScale, index) => (
          <Cell
            key={`${gender}:${footScale}:${legLength}:${motion}`}
            index={index}
            gender={gender}
            footScale={footScale}
            legLength={legLength}
            motion={motion}
            facing={FACING[view]}
          />
        ))}
      </Canvas>
      <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={gender === "masculine" ? active : button} onClick={() => setGender("masculine")}>
          남
        </button>
        <button type="button" style={gender === "feminine" ? active : button} onClick={() => setGender("feminine")}>
          여
        </button>
        <span style={{ width: 10 }} />
        {LEG_LENGTHS.map((value) => (
          <button
            key={value}
            type="button"
            style={legLength === value ? active : button}
            onClick={() => setLegLength(value)}
          >
            다리 {value}
          </button>
        ))}
        <span style={{ width: 10 }} />
        {MOTIONS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            style={motion === index ? active : button}
            onClick={() => setMotion(index)}
          >
            {item.label}
          </button>
        ))}
        <span style={{ width: 10 }} />
        {(Object.keys(FACING) as View[]).map((item) => (
          <button key={item} type="button" style={view === item ? active : button} onClick={() => setView(item)}>
            {VIEW_LABEL[item]}
          </button>
        ))}
        <button type="button" style={high ? active : button} onClick={() => setHigh((value) => !value)}>
          위에서
        </button>
      </div>
    </div>
  );
}
