// 인사 고르기(개발 전용) — 후보 동작을 치비로 나란히 반복해 틀고, 대사를 골라 키패드 1~6 자리에 넣는다.
// 동작은 게임과 같은 통로(AvatarLink.emote → useMotionPlayer)로 튼다. 고른 결과는 브라우저 저장소와 개발 훅에 남는다.
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";

import { LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import { DEFAULT_OUTLINE, DEFAULT_TOON, LobbyChibi } from "@/naju";
import { defaultLobbyLook, lobbyLookToRendererConfig } from "@/net/lobbyLook";

import SpeechBubble from "../lobbyPreview/SpeechBubble";
import { CANDIDATES, type EmoteCandidate, INITIAL_SLOTS } from "./candidates";

type Gender = "feminine" | "masculine";
type View = "front" | "angle" | "side";
type Slot = { id: string; line: string } | null;

const TOON = { ...DEFAULT_TOON, enabled: true };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: true };
const COLUMNS = 4;
const SPACING_X = 3.8;
const SPACING_Y = 6.8;
/** 동작이 끝나고 다음 반복까지 쉬는 시간(초) */
const PAUSE_SECONDS = 1.2;
const PANEL_WIDTH = 380;
const STORAGE_KEY = "kgeseo.emoteGallery.v1";
const FACING: Record<View, number> = { front: 0, angle: Math.PI / 4, side: Math.PI / 2 };

let serial = 0;

function loadSaved(): { slots: Slot[]; lines: Record<string, string> } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { slots?: Slot[]; lines?: Record<string, string> };
    if (!Array.isArray(value.slots) || value.slots.length !== 6) return null;
    return { slots: value.slots, lines: value.lines ?? {} };
  } catch {
    return null;
  }
}

function save(slots: Slot[], lines: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots, lines }));
  } catch {
    // 저장소를 못 쓰면 화면에만 남는다
  }
}

const totalSeconds = (candidate: EmoteCandidate) => candidate.steps.reduce((sum, step) => sum + step.seconds, 0);

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

const tag = (candidate: EmoteCandidate): CSSProperties => ({
  background: candidate.fixed ? "#2f6b4f" : candidate.isNew ? "#5a4a8a" : "rgba(16,18,22,0.78)",
  color: "#f0f0f0",
  padding: "2px 8px",
  borderRadius: 8,
  font: "12px system-ui, sans-serif",
  whiteSpace: "nowrap",
});

/** 칸 하나 — 캐릭터 + 번호·이름표 + 동작 동안 말풍선 */
function Cell({
  index,
  candidate,
  line,
  gender,
  facing,
}: {
  index: number;
  candidate: EmoteCandidate;
  line: string;
  gender: Gender;
  facing: number;
}) {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const x = (column - (COLUMNS - 1) / 2) * SPACING_X;
  const y = -row * SPACING_Y;
  const linkRef = useRef<AvatarLink>(makeLink(x, y, facing));
  const nextAt = useRef(0);
  const [talking, setTalking] = useState(false);
  const config = useMemo(() => lobbyLookToRendererConfig(JSON.stringify(defaultLobbyLook(gender))), [gender]);
  const total = totalSeconds(candidate);

  useFrame(() => {
    const link = linkRef.current;
    link.facing = facing;
    const wall = performance.now() / 1000;
    if (wall >= nextAt.current) {
      serial += 1;
      link.emote = { serial, at: wall, steps: candidate.steps };
      nextAt.current = wall + total + PAUSE_SECONDS;
    }
    const showing = link.emote ? wall - link.emote.at < Math.max(total, 1.6) : false;
    if (showing !== talking) setTalking(showing);
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
      <group position={[x, y + EYE_HEIGHT + 1.2, 0]}>
        <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minHeight: 64 }}>
            <div style={{ visibility: talking ? "visible" : "hidden" }}>
              <SpeechBubble text={line || "…"} />
            </div>
            <div style={tag(candidate)}>
              {index + 1}. {candidate.label}
              {candidate.fixed ? " · 남김" : candidate.isNew ? " · 새 동작" : ""}
            </div>
          </div>
        </Html>
      </group>
    </>
  );
}

/** 모든 칸이 들어오게 정사영 카메라를 맞춘다 */
function FitCamera({ count }: { count: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const rows = Math.ceil(count / COLUMNS);
    const width = COLUMNS * SPACING_X + 1;
    const height = rows * SPACING_Y + 1;
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.min(size.width / width, size.height / height);
    ortho.position.set(0, EYE_HEIGHT * 0.55 - ((rows - 1) * SPACING_Y) / 2 + 0.6, 50);
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

export default function EmoteGallery() {
  const saved = useMemo(() => loadSaved(), []);
  const [gender, setGender] = useState<Gender>("feminine");
  const [view, setView] = useState<View>("front");
  const [slots, setSlots] = useState<Slot[]>(() => saved?.slots ?? [...INITIAL_SLOTS]);
  const [lines, setLines] = useState<Record<string, string>>(() => {
    const base = Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, candidate.lines[0] ?? ""]));
    return { ...base, ...(saved?.lines ?? {}) };
  });

  useEffect(() => {
    save(slots, lines);
    exposeDevHook("emoteGallery", {
      slots: () =>
        slots.map((slot, index) => {
          const candidate = slot ? CANDIDATES.find((item) => item.id === slot.id) : undefined;
          return { key: index + 1, id: slot?.id ?? null, label: candidate?.label ?? null, line: slot?.line ?? null };
        }),
    });
  }, [slots, lines]);

  const put = (slotIndex: number, candidate: EmoteCandidate) => {
    setSlots((current) =>
      current.map((slot, index) => (index === slotIndex ? { id: candidate.id, line: lines[candidate.id] } : slot)),
    );
  };
  const setLine = (candidate: EmoteCandidate, line: string) => {
    setLines((current) => ({ ...current, [candidate.id]: line }));
    // 이미 자리에 들어간 동작이면 그 자리 대사도 같이 바꾼다
    setSlots((current) => current.map((slot) => (slot?.id === candidate.id ? { ...slot, line } : slot)));
  };
  const summary = slots
    .map((slot, index) => {
      const candidate = slot ? CANDIDATES.find((item) => item.id === slot.id) : undefined;
      return `${index + 1}. ${candidate ? `${candidate.label} — 「${slot?.line}」` : "(비어 있음)"}`;
    })
    .join("\n");

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <Canvas orthographic dpr={[1, 2]} style={{ background: "#8d95a1" }}>
          <FitCamera count={CANDIDATES.length} />
          <ambientLight intensity={0.85} />
          <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
          <directionalLight position={[3, 6, 8]} intensity={1.15} />
          {CANDIDATES.map((candidate, index) => (
            <Cell
              key={candidate.id}
              index={index}
              candidate={candidate}
              line={lines[candidate.id]}
              gender={gender}
              facing={FACING[view]}
            />
          ))}
        </Canvas>
        <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 6 }}>
          <button type="button" style={gender === "feminine" ? active : button} onClick={() => setGender("feminine")}>
            여
          </button>
          <button type="button" style={gender === "masculine" ? active : button} onClick={() => setGender("masculine")}>
            남
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
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>인사 고르기 · 키패드 1~6</div>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 10 }}>
          왼쪽 캐릭터들이 동작을 반복합니다. 후보마다 대사를 고르거나 직접 쓰고, 숫자를 눌러 그 자리에 넣으세요. 고른
          내용은 이 브라우저에 저장됩니다.
        </div>

        <div style={{ background: "#1e232b", borderRadius: 10, padding: 10, marginBottom: 14 }}>
          {slots.map((slot, index) => {
            const candidate = slot ? CANDIDATES.find((item) => item.id === slot.id) : undefined;
            return (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                <b style={{ width: 16 }}>{index + 1}</b>
                <span style={{ flex: 1, opacity: candidate ? 1 : 0.45 }}>
                  {candidate ? `${candidate.label} — 「${slot?.line}」` : "비어 있음"}
                </span>
                {slot && (
                  <button
                    type="button"
                    style={{ ...button, padding: "2px 6px" }}
                    onClick={() => setSlots((current) => current.map((item, at) => (at === index ? null : item)))}
                  >
                    비우기
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {CANDIDATES.map((candidate, index) => (
          <div key={candidate.id} style={{ borderTop: "1px solid #2a2f37", padding: "10px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
              <b>
                {index + 1}. {candidate.label}
              </b>
              <span style={{ fontSize: 11, opacity: 0.55 }}>
                {candidate.steps.map((step) => step.motion).join(" → ")}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {candidate.lines.map((line) => (
                <button
                  key={line}
                  type="button"
                  style={lines[candidate.id] === line ? active : button}
                  onClick={() => setLine(candidate, line)}
                >
                  {line}
                </button>
              ))}
            </div>
            <input
              value={lines[candidate.id]}
              onChange={(event) => setLine(candidate, event.target.value.slice(0, 20))}
              placeholder="대사 직접 쓰기"
              style={{ width: "100%", boxSizing: "border-box", padding: "4px 6px", marginBottom: 6 }}
            />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>자리에 넣기</span>
              {[0, 1, 2, 3, 4, 5].map((slotIndex) => (
                <button
                  key={slotIndex}
                  type="button"
                  style={slots[slotIndex]?.id === candidate.id ? active : { ...button, padding: "2px 8px" }}
                  onClick={() => put(slotIndex, candidate)}
                >
                  {slotIndex + 1}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 10, opacity: 0.8 }}>고른 결과</div>
        <textarea readOnly value={summary} rows={7} style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }} />
      </div>
    </div>
  );
}
