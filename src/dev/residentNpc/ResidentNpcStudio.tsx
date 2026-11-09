// 로비 상주쌤 3명 꾸미기 — 이름 · 반복 대사 · 대사마다 동작을 고른다(개발 전용, 미르 11/9 「저번 상주 npc 5명 만들때처럼」).
// 팀 캐릭터 꾸미기 창(src/dev/teamNpc/TeamNpcStudio.tsx)의 대사 · 동작 고르기를 그대로 빌려 쓴다:
//   · 동작은 이름 목록이 아니라 보고 고른다 — 「보고 고르기」가 MotionPicker(치비들이 로비와 같은 동작을 되풀이)를 띄운다.
//     동작 고르기 창은 치비 인형으로 동작을 보여 준다. 로비에서는 고른 동작을 쌤 모델 뼈대로 옮겨 튼다(ResidentNpcs).
//   · 저장: 카드마다 이름 + 대사(1~5개) + 동작을 한 번에 /__dev/resident-npcs 로 → src/dev/residentNpc/residentNpcs.json(저장 뒤 커밋).
//   · 카드 위 미리보기는 로비에 선 모델(public/models/residents/p1~p3.glb, 차렷 자세)이 천천히 돈다.
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { sharedAssetUrl } from "@/config/env";

import { UI, UI_FONT } from "@/game/gameUi";

import { LOOP_PLAY_SECONDS, TEAM_CLIP_MOTIONS, TEAM_EMOTE_MOTIONS, type TeamMotion } from "../../../lobby/src/npc/teamGestures";
import type { TeamAppearance } from "../../../lobby/src/npc/teamRoster";
import {
  parseResidentFile,
  RESIDENT_LINE_MAX_LENGTH,
  RESIDENT_LINES_MAX,
  RESIDENT_NAME_MAX,
  RESIDENT_SLOTS,
  type ResidentEntry,
  type ResidentFile,
  type ResidentSlot,
} from "./residentNpcFile";

const MotionPicker = lazy(() => import("../teamNpc/MotionPicker"));
const ROUTE = "/__dev/resident-npcs";

/**
 * 동작 미리보기 인형 — 고르기 창은 로비 치비가 동작을 보여 준다(로비에서는 쌤 모델이 그대로 한다). 쌤 옷 색만 비슷하게(누구를 닮게 하려는 것이 아님)
 */
const MANNEQUIN_BODY = {
  heightScale: 1, headScale: 0.9, handScale: 0.85, footScale: 0.9, shoulderWidth: 1.2, hipWidth: 1,
  armLength: 0.8, legLength: 1, armThickness: 0.85, legThickness: 0.85, build: 0, buff: 0.3,
};
const MANNEQUIN: Record<string, TeamAppearance> = {
  p1: {
    gender: "masculine", bodyParameters: MANNEQUIN_BODY, hairId: "hair.m.crop",
    equipmentIds: { top: "top.tee.white", bottom: "bottom.pants.baggy", shoes: "shoes.sneaker.white" },
    colors: { skin: "#f0cdb8", hair: "#1c1c1e", cloth: "#2e3a66", bottom: "#6e7076", shoes: "#f2f2f2" },
  },
  p2: {
    gender: "masculine", bodyParameters: { ...MANNEQUIN_BODY, build: 0.6 }, hairId: "hair.m.crop",
    equipmentIds: { top: "top.tee.white", bottom: "bottom.pants.baggy", shoes: "shoes.sneaker.white" },
    colors: { skin: "#e8c4a6", hair: "#141414", cloth: "#2a2a2c", bottom: "#6e7076", shoes: "#1c1c1c" },
  },
  p3: {
    gender: "masculine", bodyParameters: MANNEQUIN_BODY, hairId: "hair.m.crop",
    equipmentIds: { top: "top.tee.white", bottom: "bottom.jeans.skinny", shoes: "shoes.sneaker.white" },
    colors: { skin: "#ece2c8", hair: "#141414", cloth: "#c9cbcf", bottom: "#5b7aa6", shoes: "#eeeeee" },
  },
};

const secondsText = (motion: TeamMotion) =>
  motion.loop ? `반복 ${LOOP_PLAY_SECONDS}초` : `${motion.seconds.toFixed(motion.seconds < 1 ? 2 : 1)}초`;
const MOTION_BY_ID = new Map([...TEAM_EMOTE_MOTIONS, ...TEAM_CLIP_MOTIONS].map((motion) => [motion.id, motion]));
const gestureText = (id: string) => {
  const motion = MOTION_BY_ID.get(id);
  return motion ? `${motion.label} · ${secondsText(motion)}` : "무작위 인사 동작";
};
const tidy = (text: string) => text.replace(/\s+/gu, " ").trim();
const count = (text: string) => [...tidy(text)].length;

interface DraftLine {
  text: string;
  gesture: string;
}

/** 고르기 창을 못 불러왔을 때 — 안내하고 닫을 수 있게 */
class PickerBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={pickerFallback}>
        <p style={{ margin: 0 }}>동작 고르기 창을 불러오지 못했어요. 개발 서버를 확인해 주세요.</p>
        <button type="button" style={saveButton} onClick={this.props.onClose}>
          닫기
        </button>
      </div>
    );
  }
}

/** 카드 위 모델 미리보기 — 발이 바닥, 천천히 돈다 */
function ModelView({ url }: { url: string }) {
  const gltf = useGLTF(sharedAssetUrl(url));
  const { root, height } = useMemo(() => {
    // 뼈대가 든 모델이라 뼈째 복제한다(그냥 clone 이면 메시가 원본 뼈를 따라간다)
    const scene = cloneSkinned(gltf.scene);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.side = THREE.DoubleSide));
    });
    // 키를 1 로 맞춘다 — 모델마다 원래 단위가 달라도 카메라(키 1 이 화면에 꽉 차게)를 하나로 쓴다
    const box = new THREE.Box3().setFromObject(scene);
    const h = box.max.y - box.min.y || 1;
    scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const group = new THREE.Group();
    group.add(scene);
    group.scale.setScalar(1 / h);
    return { root: group, height: 1 };
  }, [gltf]);
  return (
    <>
      <primitive object={root} />
      <OrbitControls target={[0, height * 0.5, 0]} autoRotate autoRotateSpeed={1.2} enablePan={false} enableZoom={false} />
    </>
  );
}

/** 미리보기 모델을 못 불러와도 카드(이름 · 대사 입력)는 쓸 수 있게 */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <div style={{ ...preview, ...previewFail }}>미리보기 모델을 불러오지 못했어요(public/models/residents 확인).</div>;
  }
}

function ModelPreview({ slot }: { slot: ResidentSlot }) {
  return (
    <PreviewBoundary>
    <div style={preview}>
      {/* 키 1 이 세로 화각(34°)에 여유 12% 두고 들어가는 거리: 0.5 / tan(17°) × 1.12 ≈ 1.83 */}
      <Canvas camera={{ position: [0, 0.55, 1.83], fov: 34 }} dpr={[1, 2]}>
        <color attach="background" args={["#0b1020"]} />
        <hemisphereLight args={["#ffffff", "#3a3f4a", 1.6]} />
        <directionalLight position={[1.5, 2.5, 2]} intensity={1.6} />
        <Suspense fallback={null}>
          <ModelView url={slot.model} />
        </Suspense>
      </Canvas>
    </div>
    </PreviewBoundary>
  );
}

function ResidentCard({
  slot,
  entry,
  onSaved,
}: {
  slot: ResidentSlot;
  entry: ResidentEntry | undefined;
  onSaved: (file: ResidentFile, message: string) => void;
}) {
  const savedName = entry?.displayName ?? "";
  const savedLines = entry?.lines ?? [];
  const savedGestures = entry?.lineGestures ?? [];
  const [name, setName] = useState(savedName);
  const [draft, setDraft] = useState<DraftLine[]>(() =>
    savedLines.length
      ? savedLines.map((text, i) => ({ text, gesture: savedGestures[i] ?? "" }))
      : [{ text: "", gesture: "" }],
  );
  const [state, setState] = useState<{ kind: "idle" | "saving" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [picking, setPicking] = useState<number | null>(null);
  const closePicker = useCallback(() => setPicking(null), []);

  const kept = draft.filter((line) => tidy(line.text));
  const nameLength = count(name);
  const nameBad = nameLength < 1 || nameLength > RESIDENT_NAME_MAX;
  const lineBad = draft.some((line) => count(line.text) > RESIDENT_LINE_MAX_LENGTH);
  const noLines = kept.length === 0;
  const dirty =
    tidy(name) !== savedName ||
    kept.length !== savedLines.length ||
    kept.some((line, i) => tidy(line.text) !== savedLines[i] || line.gesture !== (savedGestures[i] ?? ""));
  const saving = state.kind === "saving";
  const canSave = dirty && !nameBad && !lineBad && !noLines && !saving;
  const update = (i: number, patch: Partial<DraftLine>) =>
    setDraft((current) => current.map((line, n) => (n === i ? { ...line, ...patch } : line)));

  const submit = async () => {
    setState({ kind: "saving" });
    let response: Response;
    try {
      response = await fetch(ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: slot.key,
          displayName: tidy(name),
          lines: kept.map((line) => tidy(line.text)),
          lineGestures: kept.map((line) => line.gesture),
        }),
      });
    } catch {
      setState({ kind: "error", message: "개발 서버에 닿지 못했어요." });
      return;
    }
    if (!response.ok) {
      setState({ kind: "error", message: `저장하지 못했어요(${response.status}).` });
      return;
    }
    // 응답을 다 읽을 때까지 저장 중(입력 막힘)으로 둔다 — 먼저 풀면 그사이 입력이 카드 재생성으로 사라진다(16회차 Codex)
    let next: ResidentFile;
    try {
      next = parseResidentFile(await response.json());
    } catch {
      setState({ kind: "error", message: "저장은 됐을 수 있지만 응답을 읽지 못했어요 — 새로 고침해 확인해 주세요." });
      return;
    }
    setState({ kind: "idle" });
    onSaved(next, `${tidy(name)} — 이름 · 대사 · 동작을 저장했어요.`);
  };

  const untouched = !entry && !tidy(name) && noLines;
  const hint = state.kind === "error"
    ? state.message
    : untouched
      ? "이름과 대사를 적고 「저장」을 눌러 주세요."
      : nameBad
      ? `이름을 1~${RESIDENT_NAME_MAX}자로 적어 주세요.`
      : lineBad
        ? `대사는 ${RESIDENT_LINE_MAX_LENGTH}자까지예요.`
        : noLines
          ? "반복할 대사를 하나 이상 적어 주세요."
          : dirty
            ? "바뀐 것이 있어요 — 「저장」을 눌러 주세요."
            : entry
              ? "저장된 그대로예요."
              : "";

  return (
    <li style={card}>
      <ModelPreview slot={slot} />
      <form
        style={body}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void submit();
        }}
      >
        {/* 저장 중에는 입력을 막는다 — 저장 뒤 카드를 저장값으로 새로 띄우므로 그사이 입력이 사라졌다(15회차 Codex) */}
        <fieldset disabled={saving} style={fieldset}>
        <div style={cardHead}>
          <span style={cardTitle}>{slot.label}</span>
          <span style={cardDesc}>{slot.desc}</span>
        </div>
        <label style={row}>
          <span style={rowLabel}>이름</span>
          <input
            type="text"
            value={name}
            placeholder="로비에 보일 이름"
            onChange={(event) => setName(event.target.value)}
            style={{ ...input, borderColor: name && nameBad ? UI.danger : UI.border }}
          />
          <span style={{ ...counter, color: nameLength > RESIDENT_NAME_MAX ? UI.danger : UI.textSubtle }}>
            {nameLength}/{RESIDENT_NAME_MAX}
          </span>
        </label>
        <span style={sectionTitle}>반복할 대사 · 말할 때 동작</span>
        {draft.map((line, i) => {
          const length = count(line.text);
          const blank = !tidy(line.text);
          return (
            <div key={i} style={lineBlock}>
              <div style={row}>
                <span style={rowLabel}>대사 {i + 1}</span>
                <input
                  type="text"
                  value={line.text}
                  placeholder="쌤이 반복해서 할 말"
                  aria-label={`${slot.label} 대사 ${i + 1}`}
                  onChange={(event) => update(i, { text: event.target.value })}
                  style={{ ...input, borderColor: length > RESIDENT_LINE_MAX_LENGTH ? UI.danger : UI.border }}
                />
                <span style={{ ...counter, color: length > RESIDENT_LINE_MAX_LENGTH ? UI.danger : UI.textSubtle }}>
                  {length}/{RESIDENT_LINE_MAX_LENGTH}
                </span>
              </div>
              <div style={row}>
                <span style={rowLabel}>동작</span>
                <button
                  type="button"
                  disabled={blank}
                  title={blank ? "대사를 먼저 적어 주세요" : undefined}
                  onClick={() => setPicking(i)}
                  style={{ ...input, ...gestureButton, ...(blank ? off : null) }}
                >
                  <span style={gestureName}>{gestureText(line.gesture)}</span>
                  <span style={gestureOpen}>보고 고르기 ▸</span>
                </button>
                <button
                  type="button"
                  aria-label={`대사 ${i + 1} 지우기`}
                  disabled={draft.length <= 1}
                  onClick={() => setDraft((current) => current.filter((_, n) => n !== i))}
                  style={{ ...removeButton, ...(draft.length <= 1 ? off : null) }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          disabled={draft.length >= RESIDENT_LINES_MAX}
          onClick={() => setDraft((current) => [...current, { text: "", gesture: "" }])}
          style={{ ...addButton, ...(draft.length >= RESIDENT_LINES_MAX ? off : null) }}
        >
          + 대사 추가({draft.length}/{RESIDENT_LINES_MAX})
        </button>
        </fieldset>
        <div style={foot}>
          <span
            role={state.kind === "error" ? "alert" : undefined}
            style={{ color: state.kind === "error" || (dirty && (nameBad || lineBad || noLines)) ? UI.danger : UI.accent, fontSize: 12 }}
          >
            {hint}
          </span>
          <button type="submit" disabled={!canSave} style={{ ...saveButton, ...(!canSave ? off : null) }}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
      {picking !== null && (
        <PickerBoundary onClose={closePicker}>
          <Suspense fallback={<div style={pickerFallback}>동작 미리보기를 불러오는 중…</div>}>
            <MotionPicker
              who={`${tidy(name) || slot.label} · 대사 ${picking + 1}`}
              line={tidy(draft[picking]?.text ?? "")}
              appearance={MANNEQUIN[slot.key] ?? MANNEQUIN.p1!}
              value={draft[picking]?.gesture ?? ""}
              onPick={(id) => {
                update(picking, { gesture: id });
                setPicking(null);
              }}
              onClose={closePicker}
            />
          </Suspense>
        </PickerBoundary>
      )}
    </li>
  );
}

export default function ResidentNpcStudio() {
  const [file, setFile] = useState<ResidentFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(ROUTE, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((json: unknown) => alive && setFile(parseResidentFile(json)))
      .catch(() => alive && setLoadError("저장 창구에 닿지 못했어요 — 로비 미리보기 개발 서버(5173)에서 열어 주세요."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={page}>
      <header style={header}>
        <h1 style={title}>로비 상주쌤 꾸미기</h1>
        <p style={lead}>
          쌤마다 로비에 보일 이름, 반복해서 말할 대사, 말할 때의 동작을 골라 「저장」하세요. 동작은 「보고 고르기」에서 치비 인형이
          직접 보여 줘요(로비에서는 쌤이 말할 때 고른 동작을 해요. 저장한 뒤 src/dev/residentNpc/residentNpcs.json 을 커밋해야 모두에게 반영돼요).
        </p>
        {notice && (
          <p role="status" style={noticeStyle}>
            {notice}
          </p>
        )}
        {loadError && (
          <p role="alert" style={{ ...noticeStyle, color: UI.danger }}>
            {loadError}
          </p>
        )}
      </header>
      {file && (
        <ul style={grid}>
          {RESIDENT_SLOTS.map((slot) => {
            const entry = file.npcs[slot.key];
            return (
              <ResidentCard
                // 저장 뒤 값이 바뀌면 새로 띄워 입력칸을 저장값에 맞춘다
                key={`${slot.key}:${entry?.savedAt ?? ""}`}
                slot={slot}
                entry={entry}
                // 저장한 카드의 값만 바꿔 끼운다 — 응답 파일 통째로 바꾸면 다른 카드 저장 응답이 늦게 와 최신 값을 되돌렸다(17회차 Codex)
                onSaved={(next, message) => {
                  const saved = next.npcs[slot.key];
                  setFile((current) =>
                    current && saved ? { ...current, npcs: { ...current.npcs, [slot.key]: saved } } : current,
                  );
                  setNotice(message);
                }}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}

const page: CSSProperties = {
  boxSizing: "border-box",
  minHeight: "100%",
  padding: "28px 20px 48px",
  background: UI.surface,
  color: UI.text,
  fontFamily: UI_FONT.body,
};
const header: CSSProperties = { maxWidth: 1180, margin: "0 auto 20px" };
const title: CSSProperties = { margin: "0 0 8px", font: `700 26px/1.25 ${UI_FONT.title}` };
const lead: CSSProperties = { margin: 0, color: UI.textMuted, fontSize: 14, lineHeight: 1.6, maxWidth: 820 };
const noticeStyle: CSSProperties = { margin: "12px 0 0", color: UI.accent, fontSize: 13, fontWeight: 600 };
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
  gap: 16,
  maxWidth: 1180,
  margin: "0 auto",
  padding: 0,
  listStyle: "none",
};
const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  overflow: "hidden",
};
const preview: CSSProperties = { height: 280, background: "#0b1020" };
const previewFail: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", color: UI.textMuted, fontSize: 13 };
const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0, border: "none", minWidth: 0 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px 16px", margin: 0 };
const cardHead: CSSProperties = { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" };
const cardTitle: CSSProperties = { font: `700 20px/1.2 ${UI_FONT.title}` };
const cardDesc: CSSProperties = { color: UI.textMuted, fontSize: 12.5 };
const sectionTitle: CSSProperties = { color: UI.textMuted, fontSize: 12, fontWeight: 600, marginTop: 4 };
const row: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 8 };
const rowLabel: CSSProperties = { color: UI.textSubtle, fontSize: 12, whiteSpace: "nowrap", minWidth: "3.4em" };
const lineBlock: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const input: CSSProperties = {
  boxSizing: "border-box",
  minWidth: 0,
  width: "100%",
  minHeight: 44,
  padding: "0 12px",
  borderRadius: 10,
  border: `1px solid ${UI.border}`,
  background: "rgba(2,6,16,.55)",
  color: UI.text,
  font: "inherit",
  fontSize: 14,
};
const counter: CSSProperties = { fontSize: 11.5, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" };
const gestureButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  textAlign: "left",
  cursor: "pointer",
  fontSize: 13,
};
const gestureName: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const gestureOpen: CSSProperties = { flexShrink: 0, color: UI.accent, fontSize: 12, fontWeight: 600 };
const removeButton: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  borderRadius: 10,
  border: `1px solid ${UI.border}`,
  background: "transparent",
  color: UI.textMuted,
  font: "inherit",
  fontSize: 18,
  cursor: "pointer",
};
const addButton: CSSProperties = {
  alignSelf: "flex-start",
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 10,
  border: `1px dashed ${UI.borderStrong}`,
  background: "transparent",
  color: UI.accent,
  font: "inherit",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const foot: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 };
const saveButton: CSSProperties = {
  minHeight: 44,
  padding: "0 20px",
  borderRadius: 10,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  flexShrink: 0,
};
const off: CSSProperties = { opacity: 0.45, cursor: "default" };
const pickerFallback: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  background: UI.surface,
  color: UI.textMuted,
};
