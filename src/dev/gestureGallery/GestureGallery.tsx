// 손짓 고르기(개발 전용) — 2026-11-07 미르: 「안녕은 손바닥을 보이고 흔들어야」, 미안해·고마워·알았어에 어울리는 동작 후보.
// 손짓은 클립이 아니라 그 성별 대기 위에 뼈를 덮어쓰는 절차 동작(naju01/src/avatar/gestures.ts). 게임과 같은 통로
// (AvatarLink.emote 의 gesture 단계)로 되풀이한다. 칸의 이름표를 누르면 그 칸만 처음부터 다시, 대사 목소리와 함께.
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";

import { LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import { exposeDevHook } from "@/debug/devHooks";
import { playVoice, type VoiceKind } from "@/dev/lobbyPreview/voices";
import type { AvatarAction, AvatarLink } from "@/engine/avatarLink";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import { DEFAULT_MESH_CONFIG, DEFAULT_OUTLINE, DEFAULT_TOON, GESTURE_BASE_MOTION, GESTURES, LobbyChibi } from "@/naju";
import { defaultLobbyLook, lobbyLookToRendererConfig } from "@/net/lobbyLook";

type Gender = "feminine" | "masculine";
type View = "front" | "angle" | "side";

interface Candidate {
  line: string;
  label: string;
  voice: VoiceKind;
  steps: AvatarAction["steps"];
}

const gestureSteps = (name: string): AvatarAction["steps"] => [
  { motion: GESTURE_BASE_MOTION, seconds: GESTURES[name]?.seconds ?? 1.5, gesture: name },
];

const CANDIDATES: readonly Candidate[] = [
  { line: "안녕!", label: "지금 — 손 내밀기", voice: "greet", steps: [{ motion: "Interact", seconds: 1.8 }] },
  { line: "안녕!", label: "① 머리 옆에서 흔들기", voice: "greet", steps: gestureSteps("waveSide") },
  { line: "안녕!", label: "② 머리 위로 크게", voice: "greet", steps: gestureSteps("waveBig") },
  { line: "안녕!", label: "③ 손 들고 까딱", voice: "greet", steps: gestureSteps("waveSmall") },
  { line: "미안해.", label: "① 살짝 숙이기", voice: "sorry", steps: gestureSteps("sorryBow") },
  { line: "미안해.", label: "② 두 손 모으고 꾸벅", voice: "sorry", steps: gestureSteps("sorryDeep") },
  { line: "고마워!", label: "① 가볍게 꾸벅", voice: "thanks", steps: gestureSteps("thanksBow") },
  { line: "고마워!", label: "② 가슴에 손", voice: "thanks", steps: gestureSteps("thanksChest") },
  { line: "알았어.", label: "① 두 번 끄덕", voice: "ok", steps: gestureSteps("okNod") },
  { line: "알았어.", label: "② 손 들어 「응」", voice: "ok", steps: gestureSteps("okHand") },
];

const TOON = { ...DEFAULT_TOON, enabled: true };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: true };
const COLUMNS = 5;
const SPACING_X = 3.6;
const SPACING_Y = 6.4;
const PAUSE_SECONDS = 0.9;
const FACING: Record<View, number> = { front: 0, angle: Math.PI / 4, side: Math.PI / 2 };
const VIEW_LABEL: Record<View, string> = { front: "정면", angle: "45°", side: "측면" };

let serial = 0;

function makeLink(x: number, y: number, facing: number): AvatarLink {
  return {
    position: new THREE.Vector3(x, y + EYE_HEIGHT, 0),
    groundY: y,
    footY: y,
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

const total = (steps: AvatarAction["steps"]) => steps.reduce((sum, step) => sum + step.seconds, 0);

function Cell({ index, candidate, gender, facing }: { index: number; candidate: Candidate; gender: Gender; facing: number }) {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const x = (column - (COLUMNS - 1) / 2) * SPACING_X;
  const y = -row * SPACING_Y;
  const linkRef = useRef<AvatarLink>(makeLink(x, y, facing));
  const nextAt = useRef(0);
  const voiceNext = useRef(false);
  useEffect(() => {
    linkRef.current.facing = facing;
  }, [facing]);
  const config = useMemo(() => {
    const base = lobbyLookToRendererConfig(JSON.stringify(defaultLobbyLook(gender)));
    return { ...base, motion: DEFAULT_MESH_CONFIG.motion };
  }, [gender]);

  useFrame(() => {
    const wall = performance.now() / 1000;
    if (wall < nextAt.current) return;
    serial += 1;
    linkRef.current.emote = { serial, at: wall, steps: candidate.steps };
    if (voiceNext.current) {
      voiceNext.current = false;
      playVoice(`gallery-${index}`, candidate.voice, gender);
    }
    nextAt.current = wall + total(candidate.steps) + PAUSE_SECONDS;
  });

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
      <group position={[x, y + EYE_HEIGHT + 1.15, 0]}>
        <Html center zIndexRange={[20, 0]}>
          <button
            type="button"
            title="처음부터 다시(목소리와 함께)"
            style={tagButton}
            onClick={() => {
              // 다음 프레임에 처음부터, 목소리와 함께
              nextAt.current = 0;
              voiceNext.current = true;
            }}
          >
            <span style={{ fontWeight: 700 }}>{candidate.line}</span> {candidate.label} ▶
          </button>
        </Html>
      </group>
    </>
  );
}

const tagButton: CSSProperties = {
  background: "rgba(16,18,22,0.82)",
  color: "#f0f0f0",
  padding: "3px 9px",
  borderRadius: 8,
  border: "1px solid #5b6270",
  font: "12px system-ui, sans-serif",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

function FitCamera({ count }: { count: number }) {
  const { camera, size, scene } = useThree();
  useEffect(() => exposeDevHook("gestureGallery", { scene }), [scene]);
  useEffect(() => {
    const rows = Math.max(1, Math.ceil(count / COLUMNS));
    const width = COLUMNS * SPACING_X + 1;
    const height = rows * SPACING_Y + 2.5;
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.min(size.width / width, size.height / height);
    ortho.position.set(0, EYE_HEIGHT * 0.55 - ((rows - 1) * SPACING_Y) / 2 + 1.2, 50);
    ortho.lookAt(0, ortho.position.y, 0);
    ortho.updateProjectionMatrix();
  }, [camera, size, count]);
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

export default function GestureGallery() {
  const [gender, setGender] = useState<Gender>("masculine");
  const [view, setView] = useState<View>("front");
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas orthographic dpr={[1, 2]} style={{ background: "#8d95a1" }}>
        <FitCamera count={CANDIDATES.length} />
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
        <directionalLight position={[3, 6, 8]} intensity={1.15} />
        {CANDIDATES.map((candidate, index) => (
          <Cell key={`${gender}:${index}`} index={index} candidate={candidate} gender={gender} facing={FACING[view]} />
        ))}
      </Canvas>
      <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={gender === "masculine" ? active : button} onClick={() => setGender("masculine")}>
          남
        </button>
        <button type="button" style={gender === "feminine" ? active : button} onClick={() => setGender("feminine")}>
          여
        </button>
        <span style={{ width: 10 }} />
        {(Object.keys(FACING) as View[]).map((item) => (
          <button key={item} type="button" style={view === item ? active : button} onClick={() => setView(item)}>
            {VIEW_LABEL[item]}
          </button>
        ))}
        <span style={{ color: "#e8e8e8", font: "12px system-ui, sans-serif", marginLeft: 8 }}>
          이름표를 누르면 그 칸만 처음부터 다시(목소리와 함께)
        </span>
      </div>
    </div>
  );
}
