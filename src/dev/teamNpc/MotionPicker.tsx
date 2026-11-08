// 동작 보고 고르기(팀 캐릭터 꾸미기 창, 미르 11/8 「이름만 들어서는 어떤 동작인지 눈에 보이질 않는다」, 검토 28회차).
// 그 NPC 의 저장 외형을 입은 치비 12명이 로비에서와 같은 단계(인사 동작 = EMOTES, 클립 = teamMotionSteps — 반복 클립 3초)를
// 게임과 같은 통로(AvatarLink.emote → useMotionPlayer)로 끝나면 잠깐 쉬고 되풀이한다. 몸이나 이름표를 누르면 그 동작으로
// 정하고 닫는다(로비 반영은 꾸미기 창의 「대사 저장」 — 닫기 · Esc 는 아무것도 바꾸지 않는다). 쪽: 인사 동작 6 · 전체 동작 47
// (넓은 화면 12씩 4열, 640px 미만 6씩 2열 — Codex 28). 닫으면 캔버스를 내린다. 창은 body 에 띄우고 뒤 화면(#root)은 inert,
// 포커스는 창 안에서만 돌고 닫으면 연 버튼으로 돌아간다.
import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";

import { LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import type { AvatarAction, AvatarLink } from "@/engine/avatarLink";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import { UI, UI_FONT } from "@/game/gameUi";
import { DEFAULT_CATALOG, DEFAULT_OUTLINE, DEFAULT_TOON, LobbyChibi } from "@/naju";
import { lobbyLookToRendererConfig } from "@/net/lobbyLook";

import {
  LOOP_PLAY_SECONDS,
  TEAM_CLIP_MOTIONS,
  TEAM_EMOTE_MOTIONS,
  type TeamMotion,
} from "../../../lobby/src/npc/teamGestures";
import type { TeamAppearance } from "../../../lobby/src/npc/teamRoster";
import { EMOTES, teamMotionSteps } from "../lobbyPreview/emotes";

type View = "front" | "angle" | "side";

const TOON = { ...DEFAULT_TOON, enabled: true };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: true };
const SPACING_X = 3.8;
const SPACING_Y = 7.6;
/** 이름표 자리 — 머리(캡 포함 약 5.2) 위 */
const LABEL_Y = EYE_HEIGHT + 1.6;
const FRAME_X = 0.6;
const FRAME_Y = 1.2;

/** 칸 수에 맞춰 캐릭터가 가장 크게 보이는 열 수와 배율 */
function layoutFor(count: number, width: number, height: number) {
  let best = { columns: 1, rows: count, zoom: 0 };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const zoom = Math.min(width / (columns * SPACING_X + FRAME_X), height / (rows * SPACING_Y + FRAME_Y));
    if (zoom > best.zoom + 1e-6) best = { columns, rows, zoom };
  }
  return best;
}
/** 동작이 끝나고 다음 되풀이까지 쉬는 시간(초) */
const PAUSE_SECONDS = 1;
const FACING: Record<View, number> = { front: 0, angle: Math.PI / 4, side: Math.PI / 2 };
const VIEW_LABEL: Record<View, string> = { front: "정면", angle: "45°", side: "측면" };

interface Choice {
  motion: TeamMotion;
  steps: AvatarAction["steps"];
}

const emoteChoices: Choice[] = TEAM_EMOTE_MOTIONS.map((motion, i) => ({ motion, steps: EMOTES[i]?.steps ?? [] }));
const clipChoices: Choice[] = TEAM_CLIP_MOTIONS.map((motion) => ({ motion, steps: teamMotionSteps(motion.id) ?? [] }));
interface Page {
  label: string;
  choices: Choice[];
}

/** 쪽 — 0 은 인사 동작, 1~ 은 전체 동작 size 개씩 */
function pagesOf(size: number): Page[] {
  return [
    { label: `인사 동작 ${emoteChoices.length}`, choices: emoteChoices },
    ...Array.from({ length: Math.ceil(clipChoices.length / size) }, (_, i) => ({
      label: `전체 ${i + 1}`,
      choices: clipChoices.slice(i * size, (i + 1) * size),
    })),
  ];
}

/** 그 동작이 든 쪽(없으면 0) — 쪽 크기가 바뀌어도 동작 ID 로 다시 찾는다 */
const pageOf = (pages: Page[], id: string) =>
  Math.max(
    0,
    pages.findIndex((page) => page.choices.some((choice) => choice.motion.id === id)),
  );
const isNarrow = () => window.innerWidth < 640;
const motionSecondsText = (motion: TeamMotion) =>
  motion.loop ? `반복 ${LOOP_PLAY_SECONDS}초` : `${motion.seconds.toFixed(motion.seconds < 1 ? 2 : 1)}초`;

/** 저장 외형 → 로비가 받는 look 문자열과 같은 모양(팀 전용 옷 번호까지 lobbyLookToRendererConfig 가 푼다) */
function lookJson(appearance: TeamAppearance) {
  return JSON.stringify({
    catalog: DEFAULT_CATALOG.version,
    gender: appearance.gender,
    hair: appearance.hairId ?? "hair.none",
    top: appearance.equipmentIds.top ?? "top.none",
    bottom: appearance.equipmentIds.bottom ?? "bottom.none",
    shoes: appearance.equipmentIds.shoes ?? "shoes.none",
    colors: appearance.colors,
    body: appearance.bodyParameters,
  });
}

let serial = 0;

function makeLink(): AvatarLink {
  return {
    position: new THREE.Vector3(0, EYE_HEIGHT, 0),
    groundY: 0,
    footY: 0,
    facing: 0,
    moving: false,
    running: false,
    speed: 0,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
  };
}

/** 칸 하나 — 치비 + 몸을 덮는 투명 상자(누르면 고름) + 이름표 버튼 */
function Cell({
  index,
  columns,
  choice,
  config,
  facing,
  selected,
  paused,
  labelWidth,
  onPick,
}: {
  index: number;
  columns: number;
  choice: Choice;
  config: ReturnType<typeof lobbyLookToRendererConfig>;
  facing: number;
  selected: boolean;
  paused: boolean;
  /** 이름표 최대 폭(px) — 칸 폭보다 넓으면 옆 칸 · 화면 밖으로 삐져나간다 */
  labelWidth: number;
  onPick: (id: string) => void;
}) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = (column - (columns - 1) / 2) * SPACING_X;
  const y = -row * SPACING_Y;
  const linkRef = useRef<AvatarLink>(makeLink());
  const nextAt = useRef(0);
  const [hovered, setHovered] = useState(false);
  const total = choice.steps.reduce((sum, step) => sum + step.seconds, 0);

  useEffect(() => {
    const link = linkRef.current;
    link.position.set(x, y + EYE_HEIGHT, 0);
    link.groundY = y;
    link.footY = y;
  }, [x, y]);

  useFrame(() => {
    const link = linkRef.current;
    link.facing = facing;
    const wall = performance.now() / 1000;
    // 멈춤이면 새로 틀지 않는다(트는 중인 것은 끝까지)
    if (!paused && wall >= nextAt.current) {
      serial += 1;
      link.emote = { serial, at: wall, steps: choice.steps };
      nextAt.current = wall + total + PAUSE_SECONDS;
    }
  });

  const pick = () => onPick(choice.motion.id);
  const lit = selected || hovered;
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
      <mesh
        position={[x, y + 2.7, 0.5]}
        onClick={(event) => {
          event.stopPropagation();
          pick();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[SPACING_X * 0.85, 5.6, 1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group position={[x, y + LABEL_Y, 0]}>
        <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <button
            type="button"
            onClick={pick}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            aria-pressed={selected}
            style={{
              ...tagButton,
              maxWidth: labelWidth,
              ...(lit ? tagLit : null),
              ...(selected ? tagSelected : null),
            }}
          >
            {selected ? "✓ " : ""}
            {choice.motion.label}
            <span style={tagSeconds}> · {motionSecondsText(choice.motion)}</span>
          </button>
        </Html>
      </group>
    </>
  );
}

/** 칸이 다 들어오게 정사영 카메라를 맞춘다(열 수는 화면 비율에 맞춰 layoutFor 가 고른다) */
function FitCamera({ count, onLayout }: { count: number; onLayout: (columns: number, zoom: number) => void }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const { columns, rows, zoom } = layoutFor(count, size.width, size.height);
    onLayout(columns, zoom);
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = zoom;
    // 칸 묶음 가운데(발 0 ~ 이름표 위)를 화면 가운데로
    ortho.position.set(0, (LABEL_Y + 0.6) / 2 - ((rows - 1) * SPACING_Y) / 2, 50);
    ortho.lookAt(0, ortho.position.y, 0);
    ortho.updateProjectionMatrix();
  }, [camera, size, count, onLayout]);
  return null;
}

export interface MotionPickerProps {
  /** 「이해랑 · 대사 1」 */
  who: string;
  line: string;
  appearance: TeamAppearance;
  /** 지금 고른 동작 ID, "" = 무작위 인사 동작 */
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** 3D 화면을 못 띄울 때(웹GL 없음 · 모델 못 받음) — 안내와 다시 해 보기 */
class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  override state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed)
      return (
        <div key={this.state.attempt} style={{ position: "absolute", inset: 0 }}>
          {this.props.children}
        </div>
      );
    return (
      <div role="alert" style={failBox}>
        <p style={{ margin: 0 }}>3D 미리보기를 띄우지 못했어요(웹GL 또는 모델 불러오기 실패).</p>
        <button
          type="button"
          style={pill}
          onClick={() => this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))}
        >
          다시 해 보기
        </button>
      </div>
    );
  }
}

const FOCUSABLE = "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export default function MotionPicker({ who, line, appearance, value, onPick, onClose }: MotionPickerProps) {
  const [narrow, setNarrow] = useState(isNarrow);
  const pages = useMemo(() => pagesOf(narrow ? 6 : 12), [narrow]);
  // 지금 쪽은 그 쪽 첫 동작 ID 로 기억한다 — 화면 폭이 바뀌어 쪽 크기가 달라져도 같은 동작이 보이게
  const [anchor, setAnchor] = useState(value);
  const page = pageOf(pages, anchor);
  const [view, setView] = useState<View>("front");
  const [paused, setPaused] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const config = useMemo(() => lobbyLookToRendererConfig(lookJson(appearance), appearance.gender), [appearance]);
  const { choices } = pages[page]!;
  const [layout, setLayout] = useState({ columns: narrow ? 2 : 4, zoom: 30 });
  const onLayout = useCallback(
    (columns: number, zoom: number) =>
      setLayout((current) => (current.columns === columns && current.zoom === zoom ? current : { columns, zoom })),
    [],
  );
  const labelWidth = Math.max(64, Math.min(150, SPACING_X * layout.zoom - 8));
  const goPage = (to: number) => setAnchor(pages[(to + pages.length) % pages.length]!.choices[0]?.motion.id ?? "");
  const views = Object.keys(FACING) as View[];

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      // 포커스는 창 안에서만 돈다
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => setNarrow(isNarrow());
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      root?.removeAttribute("inert");
      document.body.style.cursor = "";
      opener?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="motion-picker-title"
      aria-describedby="motion-picker-hint"
      style={overlay}
    >
      <header style={bar}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <h2 id="motion-picker-title" style={{ ...heading, ...(narrow ? { fontSize: 15 } : null) }}>
            {who} — 이 대사를 칠 때의 동작
          </h2>
          <div style={lineText}>「{line}」</div>
          <div id="motion-picker-hint" style={hint}>
            {narrow
              ? "누르면 골라져요 · 반영은 「대사 저장」"
              : "캐릭터나 이름표를 누르면 골라지고 창이 닫혀요. 로비에 넣으려면 그다음 「대사 저장」을 눌러 주세요. 닫기 · Esc 는 아무것도 바꾸지 않아요."}
          </div>
        </div>
        <div style={barButtons}>
          <button
            type="button"
            onClick={() => onPick("")}
            aria-pressed={value === ""}
            style={{ ...pill, ...(value === "" ? pillOn : null) }}
          >
            {value === "" ? "✓ " : ""}무작위 인사 동작으로 두기
          </button>
          <button ref={closeRef} type="button" onClick={onClose} style={pill} aria-label="닫기">
            닫기 ✕
          </button>
        </div>
      </header>
      <nav style={tabs} aria-label="동작 쪽">
        {narrow ? (
          // 좁은 화면은 쪽 단추 9개 대신 앞뒤로(캐릭터 칸을 넓게)
          <>
            <button type="button" onClick={() => goPage(page - 1)} aria-label="앞 쪽" style={pill}>
              ◀
            </button>
            <span aria-live="polite" style={pageLabel}>
              {pages[page]!.label} · {page + 1}/{pages.length}
            </span>
            <button type="button" onClick={() => goPage(page + 1)} aria-label="다음 쪽" style={pill}>
              ▶
            </button>
          </>
        ) : (
          pages.map((item, i) => (
            <button
              key={item.label}
              type="button"
              onClick={() => goPage(i)}
              aria-current={page === i ? "page" : undefined}
              style={{ ...pill, ...(page === i ? pillOn : null) }}
            >
              {item.label}
            </button>
          ))
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setPaused((on) => !on)} aria-pressed={paused} style={pill}>
          {paused ? "▶ 다시 틀기" : "❚❚ 멈춤"}
        </button>
        {narrow ? (
          <button
            type="button"
            onClick={() => setView(views[(views.indexOf(view) + 1) % views.length]!)}
            aria-label={`보는 방향 바꾸기 — 지금 ${VIEW_LABEL[view]}`}
            style={pill}
          >
            {VIEW_LABEL[view]} ↻
          </button>
        ) : (
          views.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              aria-pressed={view === item}
              style={{ ...pill, ...(view === item ? pillOn : null) }}
            >
              {VIEW_LABEL[item]}
            </button>
          ))
        )}
      </nav>
      <div style={stage}>
        <StageBoundary>
          <Canvas orthographic dpr={[1, 1.5]} style={{ background: "#8d95a1" }}>
            <FitCamera count={choices.length} onLayout={onLayout} />
            <ambientLight intensity={0.85} />
            <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
            <directionalLight position={[3, 6, 8]} intensity={1.15} />
            {choices.map((choice, index) => (
              <Cell
                key={`${page}:${choice.motion.id}`}
                index={index}
                columns={layout.columns}
                choice={choice}
                config={config}
                facing={FACING[view]}
                selected={value === choice.motion.id}
                paused={paused}
                labelWidth={labelWidth}
                onPick={onPick}
              />
            ))}
          </Canvas>
        </StageBoundary>
      </div>
    </div>,
    document.body,
  );
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  flexDirection: "column",
  background: UI.surface,
  color: UI.text,
  fontFamily: UI_FONT.body,
};
const bar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: 12,
  padding: "max(12px, env(safe-area-inset-top)) 16px 8px",
};
const heading: CSSProperties = { margin: 0, font: `700 17px/1.3 ${UI_FONT.title}` };
const lineText: CSSProperties = {
  marginTop: 2,
  color: UI.accent,
  fontSize: 14,
  fontWeight: 600,
  overflowWrap: "anywhere",
};
const hint: CSSProperties = { marginTop: 4, color: UI.textSubtle, fontSize: 12.5 };
const barButtons: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const tabs: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  padding: "0 16px 10px",
};
const pill: CSSProperties = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 10,
  border: `1px solid ${UI.border}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: "inherit",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const pillOn: CSSProperties = { background: UI.navy, borderColor: UI.accent };
const stage: CSSProperties = { position: "relative", flex: 1, minHeight: 0 };
const pageLabel: CSSProperties = {
  minWidth: 0,
  color: UI.textMuted,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const tagButton: CSSProperties = {
  pointerEvents: "auto",
  minHeight: 44,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,.18)",
  background: "rgba(16,18,22,0.82)",
  color: "#f0f0f0",
  font: "600 12.5px/1.25 system-ui, sans-serif",
  // 좁은 칸에서는 두 줄로(「상호작용(손 내밀기) · 2.0초」)
  width: "max-content",
  whiteSpace: "normal",
  textAlign: "center",
  cursor: "pointer",
};
const tagLit: CSSProperties = { background: "rgba(46,72,137,0.95)", borderColor: UI.accent };
const tagSelected: CSSProperties = { background: "#2f6b4f", borderColor: "#7ee2a8" };
const tagSeconds: CSSProperties = { opacity: 0.7, fontWeight: 500 };
const failBox: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 16,
  color: UI.textMuted,
  textAlign: "center",
};
