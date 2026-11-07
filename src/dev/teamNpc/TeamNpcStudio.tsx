// 팀 캐릭터 꾸미기(개발 서버 전용, 검토 22회차) — 로비에 늘 돌아다니는 다섯 명을 미르가 직접 꾸며 저장한다.
// 카드를 고르면 플레이어가 쓰는 캐릭터 생성 화면을 그대로 띄운다(naju01 코드는 고치지 않는다). 완료하면 개발 서버 창구
// (vite.lobby-preview.config.ts → /__dev/team-npcs)가 lobby/data/team-npcs.json 에 쓰고, 로비 서버가 그 파일을 따라
// 방마다 NPC 모습을 바꾼다.
//   · 완료 데이터는 색을 supportedColorValues 로, 다시 열 초안은 colors 로 읽는다 — 옮겨 담지 않으면 다시 열 때 색이 처음으로
//     돌아간다(Codex 22).
//   · 다른 사람으로 바꿀 때는 key 를 바꿔 화면을 새로 띄운다(initialValue 는 처음 한 번만 읽힌다).
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { UI, UI_FONT } from "@/game/gameUi";

import {
  parseTeamFile,
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
import { DEFAULT_CATALOG, SLOT_LABELS } from "../../../naju01/src/characterCreation/catalog";
import CharacterCreationScreen from "../../../naju01/src/characterCreation/CharacterCreationScreen";
import type { NameChecker } from "../../../naju01/src/characterCreation/nameRules";
import { SCREEN_CSS } from "../../../naju01/src/characterCreation/styles";

const ROUTE = "/__dev/team-npcs";
/** 팀 캐릭터용 선택지 — 지금은 플레이어와 같다. 전용 옷(모자 · 바지 · 해병대 티)은 C단계에서 더한다 */
const TEAM_CATALOG = DEFAULT_CATALOG;

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
const itemLabel = (id: string | null) => DEFAULT_CATALOG.items.find((item) => item.id === id)?.label ?? "—";

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
          로비에 늘 돌아다니는 다섯 명이에요. 고르면 캐릭터 만들기 화면이 열리고, 끝까지 만들면 저장돼 로비에 바로
          반영돼요.
        </p>
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
            <li key={slot.key} style={{ listStyle: "none" }}>
              <button
                type="button"
                style={card}
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
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: 16,
  margin: 0,
  padding: 0,
  maxWidth: 1180,
};
const card: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 168,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  padding: "18px 18px 14px",
  borderRadius: 16,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  color: UI.text,
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
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
