// 팀 캐릭터 꾸미기(개발 서버 전용, 검토 22회차) — 로비에 늘 돌아다니는 다섯 명을 미르가 직접 꾸며 저장한다.
// 카드를 고르면 플레이어가 쓰는 캐릭터 생성 화면을 그대로 띄운다(naju01 코드는 고치지 않는다). 완료하면 개발 서버 창구
// (vite.lobby-preview.config.ts → /__dev/team-npcs)가 lobby/data/team-npcs.json 에 쓰고, 로비 서버가 그 파일을 따라
// 방마다 NPC 모습을 바꾼다.
//   · 완료 데이터는 색을 supportedColorValues 로, 다시 열 초안은 colors 로 읽는다 — 옮겨 담지 않으면 다시 열 때 색이 처음으로
//     돌아간다(Codex 22).
//   · 다른 사람으로 바꿀 때는 key 를 바꿔 화면을 새로 띄운다(initialValue 는 처음 한 번만 읽힌다).
//   · 카드마다 로비에서 읊조릴 대사 2개를 적는다(미르 11/8, 검토 25회차). 대사 저장은 외형을, 외형 저장은 대사를
//     건드리지 않는다(저장 창구가 나눠 받는다). 로비에서는 10~30초마다 대사와 그 사람의 고유 외침(명단의 call)을 번갈아
//     한다(검토 26회차) — 외침은 고정이라 여기서는 보여 주기만 한다.
//   · 대사마다 칠 때의 동작을 고른다(미르 11/8 「가용한 애니메이션 목록 다 보여주면 돼」, 검토 27회차) — 인사 동작 6 + 치비 클립
//     47(lobby/src/npc/teamGestures.ts). 안 고르면 지금처럼 무작위 인사 동작. 대사와 동작은 늘 짝으로 저장한다.
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { UI, UI_FONT } from "@/game/gameUi";
import { TEAM_CATALOG } from "@/lobby/teamCatalog";

import {
  parseTeamFile,
  TEAM_LINE_MAX_LENGTH,
  TEAM_LINES_MAX,
  TEAM_SLOTS,
  type TeamEntry,
  type TeamFile,
  type TeamSlot,
} from "../../../lobby/src/npc/teamRoster";
import {
  createDefaultDraft,
  type CharacterDraft,
  type CompletedCharacter,
  type CompleteResult,
} from "../../../naju01/src/characterCreation/appearanceData";
import { SLOT_LABELS } from "../../../naju01/src/characterCreation/catalog";
import CharacterCreationScreen from "../../../naju01/src/characterCreation/CharacterCreationScreen";
import type { NameChecker } from "../../../naju01/src/characterCreation/nameRules";
import { SCREEN_CSS } from "../../../naju01/src/characterCreation/styles";
import {
  TEAM_CLIP_MOTIONS,
  TEAM_EMOTE_MOTIONS,
  LOOP_PLAY_SECONDS,
  type TeamMotion,
} from "../../../lobby/src/npc/teamGestures";
import { EMOTES } from "../lobbyPreview/emotes";

/** 「안녕!」과 · 「비켜!」와 — 마지막 한글 글자에 받침이 있으면 「과」 */
function withAnd(text: string) {
  const last = [...text].reverse().find((char) => char >= "가" && char <= "힣");
  return last && (last.charCodeAt(0) - 0xac00) % 28 !== 0 ? "과" : "와";
}

const ROUTE = "/__dev/team-npcs";
// 팀 캐릭터용 선택지 — 플레이어 옷 + 팀 전용 옷(캡은 헤어에, 해병대 반팔은 상의에). 바지는 C2 단계에서 더한다

type View = { mode: "list" } | { mode: "edit"; slot: TeamSlot; mount: number };

/** 이름은 팀 캐릭터끼리만 쓰므로 서버에 묻지 않는다 — 형식은 화면이 먼저 본다 */
const checkName: NameChecker = async () => ({ status: "available" });

/**
 * 화면에 넣을 초안. 저장값은 모양만 검사한 것이라 그대로 넘기고, 체형 범위 · 없어진 아이템은 화면(normalizeDraft)이
 * 기본값으로 보정한다 — initialValue 는 믿지 않는 값으로 받는다(unknown)
 */
function draftOf(
  slot: TeamSlot,
  entry: TeamEntry | undefined,
): CharacterDraft | (Omit<CharacterDraft, "appearance"> & { appearance: TeamEntry["appearance"] }) {
  const fresh = createDefaultDraft(TEAM_CATALOG, entry?.appearance.gender ?? slot.gender);
  if (!entry) return { ...fresh, displayName: slot.name };
  return { schemaVersion: fresh.schemaVersion, displayName: entry.displayName, appearance: entry.appearance };
}

const genderLabel = (gender: string) => (gender === "feminine" ? "여성" : "남성");
const itemLabel = (id: string | null) => TEAM_CATALOG.items.find((item) => item.id === id)?.label ?? "—";

const lineLength = (text: string) => [...text.replace(/\s+/gu, " ").trim()].length;

const secondsText = (motion: TeamMotion) =>
  motion.loop ? `반복 ${LOOP_PLAY_SECONDS}초` : `${motion.seconds.toFixed(motion.seconds < 1 ? 2 : 1)}초`;

/** 동작 선택지 — 안 고름(무작위 인사 동작) · 인사 동작 6 · 치비 클립 전부 */
const GESTURE_OPTIONS = (
  <>
    <option value="">무작위 인사 동작(지금처럼)</option>
    <optgroup label="인사 동작">
      {TEAM_EMOTE_MOTIONS.map((motion) => (
        <option key={motion.id} value={motion.id}>
          {motion.label}
        </option>
      ))}
    </optgroup>
    <optgroup label="전체 동작 — 제자리에서 흉내만(실제로 움직이거나 때리지 않아요)">
      {TEAM_CLIP_MOTIONS.map((motion) => (
        <option key={motion.id} value={motion.id}>
          {motion.label} · {secondsText(motion)}
        </option>
      ))}
    </optgroup>
  </>
);

interface DraftLine {
  text: string;
  /** teamGestures.ts ID, "" = 무작위 인사 동작 */
  gesture: string;
}

const tidy = (text: string) => text.replace(/\s+/gu, " ").trim();

/**
 * 대사 2개와 그 동작 — 저장된 값이 바뀌면(저장 뒤) key 로 새로 띄워 입력칸을 맞춘다. 채팅과 같이 40자까지, 연락처 · 금칙어가 든
 * 대사는 로비 서버가 말하지 않는다(그 대사 차례는 외침만). 빈 대사의 동작은 고를 수 없고 저장하지 않는다
 */
function LinesEditor({
  slot,
  entry,
  onSaved,
}: {
  slot: TeamSlot;
  entry: TeamEntry | undefined;
  onSaved: (file: TeamFile, message: string) => void;
}) {
  const savedLines = entry?.lines ?? [];
  const savedGestures = entry?.lineGestures ?? [];
  const [draft, setDraft] = useState<DraftLine[]>(() =>
    Array.from({ length: TEAM_LINES_MAX }, (_, i) => ({ text: savedLines[i] ?? "", gesture: savedGestures[i] ?? "" })),
  );
  const [state, setState] = useState<{ kind: "idle" | "saving" } | { kind: "error"; message: string }>({
    kind: "idle",
  });
  const tooLong = draft.some((line) => lineLength(line.text) > TEAM_LINE_MAX_LENGTH);
  const dirty = draft.some(
    (line, i) =>
      tidy(line.text) !== (savedLines[i] ?? "") || (tidy(line.text) ? line.gesture : "") !== (savedGestures[i] ?? ""),
  );
  const disabled = !entry || state.kind === "saving";
  const callText = EMOTES[slot.call - 1]?.text ?? "";
  const update = (i: number, patch: Partial<DraftLine>) =>
    setDraft((current) => current.map((line, n) => (n === i ? { ...line, ...patch } : line)));

  const submit = async () => {
    setState({ kind: "saving" });
    // 빈 대사는 그 동작과 함께 뺀다(짝이 어긋나지 않게)
    const kept = draft.filter((line) => line.text.trim());
    let response: Response;
    try {
      response = await fetch(ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: slot.key,
          lines: kept.map((line) => line.text.trim()),
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
    setState({ kind: "idle" });
    onSaved(
      parseTeamFile(await response.json()),
      `${entry?.displayName ?? slot.name} 대사 · 동작을 저장했어요 — 로비에 곧 반영돼요.`,
    );
  };

  return (
    <form
      style={linesBox}
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !tooLong && !disabled) void submit();
      }}
    >
      <span style={linesTitle}>
        읊조릴 대사 · 외침 「{callText}」{withAnd(callText)} 번갈아 10~30초마다
      </span>
      {draft.map((line, i) => {
        const length = lineLength(line.text);
        const id = `${slot.key}-line-${i}`;
        const gestureId = `${slot.key}-gesture-${i}`;
        const blank = !line.text.trim();
        return (
          <div key={id} style={lineBlock}>
            <label htmlFor={id} style={lineRow}>
              <span style={lineLabel}>대사 {i + 1}</span>
              <input
                id={id}
                type="text"
                value={line.text}
                disabled={disabled}
                placeholder={entry ? "비워 두면 외침만 해요" : "먼저 꾸미기를 저장해 주세요"}
                onChange={(event) => update(i, { text: event.target.value })}
                style={{ ...lineInput, borderColor: length > TEAM_LINE_MAX_LENGTH ? UI.danger : UI.border }}
              />
              <span style={{ ...lineCount, color: length > TEAM_LINE_MAX_LENGTH ? UI.danger : UI.textSubtle }}>
                {length}/{TEAM_LINE_MAX_LENGTH}
              </span>
            </label>
            <label htmlFor={gestureId} style={lineRow}>
              <span style={lineLabel}>동작</span>
              <select
                id={gestureId}
                value={line.gesture}
                disabled={disabled || blank}
                title={blank ? "대사를 먼저 적어 주세요" : undefined}
                onChange={(event) => update(i, { gesture: event.target.value })}
                style={{ ...lineInput, ...gestureSelect, ...(disabled || blank ? gestureSelectOff : null) }}
              >
                {GESTURE_OPTIONS}
              </select>
              <span style={lineCount} />
            </label>
          </div>
        );
      })}
      <div style={linesFoot}>
        <span role={state.kind === "error" ? "alert" : undefined} style={{ color: UI.danger, fontSize: 12 }}>
          {state.kind === "error" ? state.message : tooLong ? `대사는 ${TEAM_LINE_MAX_LENGTH}자까지예요.` : ""}
        </span>
        <button
          type="submit"
          disabled={!dirty || tooLong || disabled}
          style={{ ...linesSave, ...(!dirty || tooLong || disabled ? linesSaveOff : null) }}
        >
          {state.kind === "saving" ? "저장 중…" : "대사 저장"}
        </button>
      </div>
    </form>
  );
}

function formatSavedAt(iso: string) {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TeamNpcStudio() {
  const [file, setFile] = useState<TeamFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: "list" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(ROUTE, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((json: unknown) => alive && setFile(parseTeamFile(json)))
      .catch(
        () =>
          alive &&
          setLoadError(
            "저장 창구가 없어요 — 로비 미리보기 서버(npx vite --config vite.lobby-preview.config.ts)에서 열어 주세요.",
          ),
      );
    return () => {
      alive = false;
    };
  }, []);

  const backToList = useCallback(() => setView({ mode: "list" }), []);

  const save = useCallback(async (slot: TeamSlot, payload: CompletedCharacter): Promise<CompleteResult> => {
    const { appearance } = payload;
    const entry = {
      displayName: payload.displayName,
      appearance: {
        gender: appearance.gender,
        bodyParameters: appearance.bodyParameters,
        hairId: appearance.hairId,
        equipmentIds: appearance.equipmentIds,
        colors: appearance.supportedColorValues,
      },
    };
    let response: Response;
    try {
      response = await fetch(ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: slot.key, entry }),
      });
    } catch {
      return { ok: false, reason: "failed", message: "개발 서버에 닿지 못했어요." };
    }
    if (!response.ok) return { ok: false, reason: "failed", message: `저장하지 못했어요(${response.status}).` };
    setFile(parseTeamFile(await response.json()));
    // 완료 표시를 잠깐 보여 준 뒤 목록으로 — 화면은 스스로 넘어가지 않는다
    setTimeout(() => {
      setView({ mode: "list" });
      setNotice(`${payload.displayName} 저장했어요 — 로비에 곧 반영돼요.`);
    }, 900);
    return { ok: true };
  }, []);

  if (view.mode === "edit") {
    const { slot } = view;
    return (
      <div style={{ position: "fixed", inset: 0 }}>
        <style>{SCREEN_CSS}</style>
        <CharacterCreationScreen
          key={`${slot.key}:${view.mount}`}
          initialValue={draftOf(slot, file?.npcs[slot.key])}
          catalog={TEAM_CATALOG}
          checkName={checkName}
          onComplete={(payload) => save(slot, payload)}
          onCancel={backToList}
        />
      </div>
    );
  }

  return (
    <main style={page}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={title}>팀 캐릭터 꾸미기</h1>
        <p style={lead}>
          로비에 늘 돌아다니는 다섯 명이에요. 카드를 누르면 캐릭터 만들기 화면이 열리고, 끝까지 만들면 저장돼 로비에
          바로 반영돼요. 카드 아래에는 로비에서 읊조릴 대사 두 개와 그 대사를 칠 때의 동작을 골라요 — 10~30초마다
          대사(둘 중 하나 + 고른 동작)와 그 사람의 고유 외침(목소리 포함)을 번갈아 해요.
        </p>
        <nav aria-label="동작 미리보기" style={previewLinks}>
          <span style={previewHint}>동작 미리보기</span>
          <a href="/motion-gallery.html" target="_blank" rel="noopener" style={previewLink}>
            전체 동작 보기
          </a>
          <a href="/gesture-gallery.html" target="_blank" rel="noopener" style={previewLink}>
            손짓 보기(안녕 · 미안해 · 고마워 · 알았어)
          </a>
          <span style={previewHint}>신난다는 「춤」, 비켜는 「테이블 물건 줍기」와 같은 동작이에요.</span>
        </nav>
        {notice && (
          <p role="status" style={noticeStyle}>
            {notice}
          </p>
        )}
        {loadError && (
          <p style={{ ...noticeStyle, color: UI.danger, borderColor: "rgba(248,113,113,.4)" }}>{loadError}</p>
        )}
      </header>
      <ul style={grid}>
        {TEAM_SLOTS.map((slot) => {
          const entry = file?.npcs[slot.key];
          const gender = entry?.appearance.gender ?? slot.gender;
          return (
            <li key={slot.key} style={{ ...card, listStyle: "none" }}>
              <button
                type="button"
                style={cardButton}
                disabled={!file}
                onClick={() => {
                  setNotice(null);
                  setView({ mode: "edit", slot, mount: Date.now() });
                }}
              >
                <span style={cardName}>{entry?.displayName ?? slot.name}</span>
                <span style={cardMeta}>{genderLabel(gender)}</span>
                {entry ? (
                  <span style={cardDetail}>
                    {SLOT_LABELS.hair} {itemLabel(entry.appearance.hairId)} · {SLOT_LABELS.top}{" "}
                    {itemLabel(entry.appearance.equipmentIds.top)} · {SLOT_LABELS.bottom}{" "}
                    {itemLabel(entry.appearance.equipmentIds.bottom)}
                  </span>
                ) : (
                  <span style={{ ...cardDetail, color: UI.textSubtle }}>아직 안 꾸밈 — 기본 모습으로 돌아다녀요</span>
                )}
                <span style={cardFoot}>
                  {entry?.savedAt ? `저장 ${formatSavedAt(entry.savedAt)}` : ""}
                  <span style={cardAction}>꾸미기 →</span>
                </span>
              </button>
              <LinesEditor
                key={`${slot.key}:${(entry?.lines ?? []).join("\n")}:${(entry?.lineGestures ?? []).join(",")}:${entry ? 1 : 0}`}
                slot={slot}
                entry={entry}
                onSaved={(next, message) => {
                  setFile(next);
                  setNotice(message);
                }}
              />
            </li>
          );
        })}
      </ul>
    </main>
  );
}

const page: CSSProperties = {
  boxSizing: "border-box",
  height: "100%",
  overflowY: "auto",
  padding: "48px clamp(16px, 5vw, 64px)",
  background: "radial-gradient(120% 90% at 20% 0%, #0d1a36 0%, #050b1a 55%, #02040a 100%)",
  color: UI.text,
  font: `500 14px/1.5 ${UI_FONT.body}`,
};
const title: CSSProperties = { margin: 0, font: `700 28px/1.2 ${UI_FONT.title}` };
const lead: CSSProperties = { margin: "10px 0 0", color: UI.textMuted, maxWidth: 640 };
const previewLinks: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14 };
const previewHint: CSSProperties = { color: UI.textSubtle, fontSize: 12.5 };
const previewLink: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 10,
  border: `1px solid ${UI.border}`,
  color: UI.text,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
};
const noticeStyle: CSSProperties = {
  display: "inline-block",
  margin: "16px 0 0",
  padding: "8px 14px",
  borderRadius: 10,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
};
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
  gap: 16,
  margin: 0,
  padding: 0,
  maxWidth: 1180,
};
const card: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  overflow: "hidden",
};
const cardButton: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 150,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  padding: "18px 18px 14px",
  border: "none",
  background: "transparent",
  color: UI.text,
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
};
const linesBox: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  margin: 0,
  padding: "12px 18px 16px",
  borderTop: `1px solid ${UI.border}`,
};
const linesTitle: CSSProperties = { color: UI.textMuted, fontSize: 12, fontWeight: 600 };
const lineRow: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 8 };
/** 대사 한 줄과 그 동작 칸 */
const lineBlock: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
/** 동작 고르기 — 입력칸과 같은 틀, 펼친 목록도 어두운 색으로 */
const gestureSelect: CSSProperties = { colorScheme: "dark", cursor: "pointer", fontSize: 13, paddingRight: 8 };
const gestureSelectOff: CSSProperties = { opacity: 0.5, cursor: "default" };
const lineLabel: CSSProperties = { color: UI.textSubtle, fontSize: 12, whiteSpace: "nowrap", minWidth: "3.4em" };
const lineInput: CSSProperties = {
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
const lineCount: CSSProperties = {
  fontSize: 11.5,
  fontVariantNumeric: "tabular-nums",
  minWidth: 36,
  textAlign: "right",
};
/** 저장할 것이 없거나 저장 중 — 흐리게 */
const linesSaveOff: CSSProperties = { opacity: 0.45, cursor: "default" };
const linesFoot: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const linesSave: CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 10,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  flexShrink: 0,
};
const cardName: CSSProperties = { font: `700 20px/1.2 ${UI_FONT.title}` };
const cardMeta: CSSProperties = { color: UI.accent, fontSize: 13, fontWeight: 600 };
const cardDetail: CSSProperties = { color: UI.textMuted, fontSize: 12.5, flex: 1 };
const cardFoot: CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  color: UI.textSubtle,
  fontSize: 12,
};
const cardAction: CSSProperties = { color: UI.accent, fontWeight: 600 };
