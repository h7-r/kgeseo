// 동작 보기(개발 전용) — 치비가 쓸 수 있는 동작 47개를 남녀로 틀어 보고, 남녀 대기 자세를 고른다.
// 반복 동작(…_Loop)은 그 클립을 계속 틀고, 끝이 있는 동작은 게임과 같은 통로(AvatarLink.emote)로 한 번씩 되풀이한다.
// 같은 이름(대기·걷기·조깅)은 동작 출처로 가른다(Tripo / Quaternius). 고른 대기는 브라우저 저장소와 개발 훅에 남는다.
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

import { CLIPS, type GalleryClip, IDLE_CANDIDATES } from "./clips";

type Gender = "feminine" | "masculine";
type View = "front" | "angle" | "side";
type Choice = { masculine: string; feminine: string };

const TOON = { ...DEFAULT_TOON, enabled: true };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: true };
const COLUMNS = 4;
const PAGE_SIZE = 12;
const SPACING_X = 3.8;
const SPACING_Y = 6.4;
const PAUSE_SECONDS = 0.8;
const PANEL_WIDTH = 360;
const STORAGE_KEY = "kgeseo.motionGallery.v1";
const CURRENT_IDLE = "tripo:Idle_Loop";
const FACING: Record<View, number> = { front: 0, angle: Math.PI / 4, side: Math.PI / 2 };
const PAGES = Math.ceil(CLIPS.length / PAGE_SIZE);
const byId = new Map(CLIPS.map((clip) => [clip.id, clip]));

let serial = 0;

function loadChoice(): Choice {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Choice> | null;
    return {
      masculine: value?.masculine && byId.has(value.masculine) ? value.masculine : CURRENT_IDLE,
      feminine: value?.feminine && byId.has(value.feminine) ? value.feminine : CURRENT_IDLE,
    };
  } catch {
    return { masculine: CURRENT_IDLE, feminine: CURRENT_IDLE };
  }
}

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

const sourceName = (clip: GalleryClip) => (clip.source === "tripo" ? "Tripo" : "Quaternius");

function Cell({
  index,
  number,
  clip,
  gender,
  facing,
  badge,
}: {
  index: number;
  number: number;
  clip: GalleryClip;
  gender: Gender;
  facing: number;
  badge: string;
}) {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const x = (column - (COLUMNS - 1) / 2) * SPACING_X;
  const y = -row * SPACING_Y;
  const linkRef = useRef<AvatarLink>(makeLink(x, y, facing));
  const nextAt = useRef(0);
  const config = useMemo(() => {
    const base = lobbyLookToRendererConfig(JSON.stringify(defaultLobbyLook(gender)));
    // 반복 동작은 그 클립을 고정으로, 끝이 있는 동작은 「자동」으로 두고 인사 통로로 되풀이한다
    return { ...base, motion: clip.loop ? clip.name : DEFAULT_MESH_CONFIG.motion, motionSource: clip.source };
  }, [gender, clip]);

  useFrame(() => {
    const link = linkRef.current;
    link.facing = facing;
    if (clip.loop) return;
    const wall = performance.now() / 1000;
    if (wall >= nextAt.current) {
      serial += 1;
      link.emote = { serial, at: wall, steps: [{ motion: clip.name, seconds: clip.seconds }] };
      nextAt.current = wall + clip.seconds + PAUSE_SECONDS;
    }
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
        <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            {badge && <div style={{ ...tagStyle, background: "#4b7bd8", fontWeight: 700 }}>{badge}</div>}
            <div style={tagStyle}>
              {number}. {clip.label}
            </div>
            <div style={{ ...tagStyle, background: "rgba(16,18,22,0.55)", fontSize: 10 }}>
              {clip.name} · {sourceName(clip)} · {clip.seconds}초
            </div>
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

function FitCamera({ count }: { count: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const rows = Math.max(1, Math.ceil(count / COLUMNS));
    const width = COLUMNS * SPACING_X + 1;
    // 위쪽 단추 줄과 첫 줄 이름표가 겹치지 않게 위를 넉넉히
    const height = rows * SPACING_Y + 3;
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.min(size.width / width, size.height / height);
    ortho.position.set(0, EYE_HEIGHT * 0.55 - ((rows - 1) * SPACING_Y) / 2 + 1.5, 50);
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

export default function MotionGallery() {
  // 0 = 대기 고르기, 1.. = 전체 쪽
  const [tab, setTab] = useState(0);
  const [gender, setGender] = useState<Gender>("masculine");
  const [view, setView] = useState<View>("front");
  const [choice, setChoice] = useState<Choice>(() => loadChoice());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // 저장소를 못 쓰면 화면에만 남는다
    }
    exposeDevHook("motionGallery", {
      choice: () => ({
        masculine: { id: choice.masculine, label: byId.get(choice.masculine)?.label },
        feminine: { id: choice.feminine, label: byId.get(choice.feminine)?.label },
      }),
    });
  }, [choice]);

  const clips: GalleryClip[] =
    tab === 0
      ? IDLE_CANDIDATES.map((id) => byId.get(id)).filter((clip): clip is GalleryClip => !!clip)
      : CLIPS.slice((tab - 1) * PAGE_SIZE, tab * PAGE_SIZE);
  const firstNumber = tab === 0 ? 1 : (tab - 1) * PAGE_SIZE + 1;
  const badgeFor = (clip: GalleryClip) => {
    const marks = [];
    if (choice.masculine === clip.id) marks.push("남자 대기");
    if (choice.feminine === clip.id) marks.push("여자 대기");
    return marks.join(" · ");
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <Canvas orthographic dpr={[1, 2]} style={{ background: "#8d95a1" }}>
          <FitCamera count={clips.length} />
          <ambientLight intensity={0.85} />
          <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
          <directionalLight position={[3, 6, 8]} intensity={1.15} />
          {clips.map((clip, index) => (
            <Cell
              key={`${tab}:${clip.id}`}
              index={index}
              number={firstNumber + index}
              clip={clip}
              gender={gender}
              facing={FACING[view]}
              badge={badgeFor(clip)}
            />
          ))}
        </Canvas>
        <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={tab === 0 ? active : button} onClick={() => setTab(0)}>
            대기 고르기
          </button>
          {Array.from({ length: PAGES }, (_, page) => (
            <button
              key={page}
              type="button"
              style={tab === page + 1 ? active : button}
              onClick={() => setTab(page + 1)}
            >
              전체 {page + 1}/{PAGES}
            </button>
          ))}
          <span style={{ width: 10 }} />
          <button type="button" style={gender === "masculine" ? active : button} onClick={() => setGender("masculine")}>
            남
          </button>
          <button type="button" style={gender === "feminine" ? active : button} onClick={() => setGender("feminine")}>
            여
          </button>
          <span style={{ width: 10 }} />
          {(["front", "angle", "side"] as const).map((item) => (
            <button key={item} type="button" style={view === item ? active : button} onClick={() => setView(item)}>
              {item === "front" ? "정면" : item === "angle" ? "45°" : "측면"}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          width: PANEL_WIDTH,
          overflowY: "auto",
          padding: "14px 14px 40px",
          background: "#14171c",
          font: "13px system-ui, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>동작 보기 · 대기 자세 고르기</div>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 10 }}>
          「대기 고르기」에서 남녀 대기 자세를 고르세요. 「전체」 쪽에서는 쓸 수 있는 동작 {CLIPS.length}개를 12개씩 볼
          수 있습니다. 반복 동작은 계속, 끝이 있는 동작은 한 번씩 되풀이합니다.
        </div>
        <div style={{ background: "#1e232b", borderRadius: 10, padding: 10, marginBottom: 14, lineHeight: 1.7 }}>
          <div>
            남자 대기: <b>{byId.get(choice.masculine)?.label}</b>
          </div>
          <div>
            여자 대기: <b>{byId.get(choice.feminine)?.label}</b>
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            지금 게임은 남녀 모두 「{byId.get(CURRENT_IDLE)?.label}」입니다.
          </div>
        </div>

        {clips.map((clip, index) => (
          <div key={clip.id} style={{ borderTop: "1px solid #2a2f37", padding: "9px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <b>
                {firstNumber + index}. {clip.label}
              </b>
              <span style={{ fontSize: 11, opacity: 0.55 }}>
                {clip.name} · {sourceName(clip)} · {clip.seconds}초{clip.loop ? " · 반복" : ""}
              </span>
            </div>
            {tab === 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  style={choice.masculine === clip.id ? active : button}
                  onClick={() => setChoice((current) => ({ ...current, masculine: clip.id }))}
                >
                  남자 대기로
                </button>
                <button
                  type="button"
                  style={choice.feminine === clip.id ? active : button}
                  onClick={() => setChoice((current) => ({ ...current, feminine: clip.id }))}
                >
                  여자 대기로
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
