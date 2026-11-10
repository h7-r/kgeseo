// 캐릭터 시작 모습 정하기(start-look.html, 개발 서버 전용) — 미르 11/10 「남자, 여자를 눌렀을 때 초기에 보여 줄 캐릭터의 모습을 내가
// 정할 수 있게」. 실제 캐릭터 생성 화면을 그대로 띄우고, 위 판에서 지금 성별의 모습을 그 성별 시작 모습으로 저장한다.
// 저장은 naju01/src/characterCreation/startLooks.json(GET · POST /__dev/start-looks) — 커밋해야 모두에게 반영된다.
// 화면 카탈로그는 파일에서 막 읽은 시작 모습으로 만든다(모듈에 묶인 JSON 이 저장 뒤 늦게 바뀌어도 이 창은 파일과 같다).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { AvatarGender } from "../../../naju01/src/avatar/sidekickOptions";
import {
  createDefaultDraft,
  getStartAppearance,
  type CharacterDraft,
  type CompleteResult,
  type DraftAppearance,
} from "../../../naju01/src/characterCreation/appearanceData";
import { DEFAULT_CATALOG, type CharacterCatalog } from "../../../naju01/src/characterCreation/catalog";
import CharacterCreationScreen from "../../../naju01/src/characterCreation/CharacterCreationScreen";
import type { NameChecker } from "../../../naju01/src/characterCreation/nameRules";
import {
  isStartLookGender,
  toCatalogStartLooks,
  type StartLookFile,
} from "../../../naju01/src/characterCreation/startLookFile";
import { FONTS } from "../../../naju01/src/characterCreation/styles";

const ROUTE = "/__dev/start-looks";
const GENDER_PARAM = "gender";
const GENDER_LABELS: Record<AvatarGender, string> = { masculine: "남성", feminine: "여성" };

/** 이름은 이 창에서 쓰지 않는다 */
const checkName: NameChecker = async () => ({ status: "available" });
const refuseComplete = async (): Promise<CompleteResult> => ({
  ok: false,
  reason: "failed",
  message: "이 창에서는 게임을 시작하지 않습니다. 위 판의 「시작 모습으로 저장」을 누르세요.",
});

function readGenderParam(): AvatarGender {
  const value = new URLSearchParams(window.location.search).get(GENDER_PARAM);
  return isStartLookGender(value) ? value : "masculine";
}

/** 다시 열어도(저장 뒤 새로고침 포함) 보던 성별로 열리게 주소에 적는다 */
function writeGenderParam(gender: AvatarGender) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(GENDER_PARAM) === gender) return;
  url.searchParams.set(GENDER_PARAM, gender);
  window.history.replaceState(null, "", url);
}

/** 같은 모습인가 — 색은 대소문자를 가리지 않는다 */
function lookKey(appearance: DraftAppearance) {
  return JSON.stringify([
    appearance.gender,
    Object.entries(appearance.bodyParameters).sort(([a], [b]) => a.localeCompare(b)),
    appearance.hairId,
    [appearance.equipmentIds.top, appearance.equipmentIds.bottom, appearance.equipmentIds.shoes],
    Object.entries(appearance.colors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, color]) => [key, color.toLowerCase()]),
  ]);
}

/** 11/10 15:39 */
function formatSavedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Status = { kind: "idle" | "busy" | "ok" | "error"; text: string };

/** 파일의 시작 모습으로 만든 화면 카탈로그(성별을 처음 누를 때 · 갈래 초기화 · 되돌리기가 이 값을 쓴다) */
const catalogOf = (file: StartLookFile): CharacterCatalog => ({
  ...DEFAULT_CATALOG,
  startLooks: toCatalogStartLooks(file),
});

/** 화면을 (다시) 연다 — 화면은 처음 값을 한 번만 읽어 열 때마다 key 를 바꾼다 */
interface Mount {
  key: number;
  initial: CharacterDraft;
}

export default function StartLookStudio() {
  const [file, setFile] = useState<StartLookFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mount, setMount] = useState<Mount | null>(null);
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const isBusy = useRef(false);

  useEffect(() => {
    let isAlive = true;
    fetch(ROUTE, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as StartLookFile;
      })
      .then((loaded) => {
        if (!isAlive) return;
        setFile(loaded);
        setMount({ key: 0, initial: createDefaultDraft(catalogOf(loaded), readGenderParam()) });
      })
      .catch((error: unknown) => {
        if (isAlive) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      isAlive = false;
    };
  }, []);

  const catalog = useMemo(() => (file ? catalogOf(file) : null), [file]);

  const handleDraftChange = useCallback((next: CharacterDraft) => {
    setDraft(next);
    writeGenderParam(next.appearance.gender);
  }, []);

  const gender = draft?.appearance.gender ?? mount?.initial.appearance.gender ?? "masculine";
  const savedEntry = file?.[gender] ?? null;
  const isSameAsStart = useMemo(() => {
    if (!catalog || !draft) return true;
    return lookKey(draft.appearance) === lookKey(getStartAppearance(draft.appearance.gender, catalog));
  }, [catalog, draft]);

  const post = async (body: { gender: AvatarGender; appearance: DraftAppearance | null }) => {
    const response = await fetch(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json().catch(() => null)) as StartLookFile | { error?: string } | null;
    if (!response.ok || !answer || !("version" in answer)) {
      throw new Error((answer && "error" in answer && answer.error) || `HTTP ${response.status}`);
    }
    return answer;
  };

  const saveCurrent = async () => {
    if (!draft || isBusy.current) return;
    isBusy.current = true;
    const target = draft.appearance.gender;
    setStatus({ kind: "busy", text: "저장하는 중…" });
    try {
      setFile(await post({ gender: target, appearance: draft.appearance }));
      setStatus({ kind: "ok", text: `${GENDER_LABELS[target]} 저장함 · 커밋해야 반영` });
    } catch (error) {
      setStatus({
        kind: "error",
        text: `저장하지 못했습니다(${error instanceof Error ? error.message : String(error)}).`,
      });
    } finally {
      isBusy.current = false;
    }
  };

  /** 지금 성별을 코드 기본값으로 — 저장 안 한 다른 성별 손질은 화면을 다시 열며 사라진다 */
  const resetToCode = async () => {
    if (isBusy.current) return;
    const target = gender;
    if (
      !window.confirm(
        `${GENDER_LABELS[target]} 시작 모습을 지우고 코드 기본값으로 되돌릴까요?\n저장 안 한 손질은 사라집니다.`,
      )
    )
      return;
    isBusy.current = true;
    setStatus({ kind: "busy", text: "되돌리는 중…" });
    try {
      const next = await post({ gender: target, appearance: null });
      setFile(next);
      setMount((previous) => ({
        key: (previous?.key ?? 0) + 1,
        initial: createDefaultDraft(catalogOf(next), target),
      }));
      setStatus({ kind: "ok", text: `${GENDER_LABELS[target]} 코드 기본값으로 되돌림` });
    } catch (error) {
      setStatus({
        kind: "error",
        text: `되돌리지 못했습니다(${error instanceof Error ? error.message : String(error)}).`,
      });
    } finally {
      isBusy.current = false;
    }
  };

  /** 손질을 버리고 저장된 시작 모습으로 다시 연다 */
  const reopen = () => {
    if (!catalog) return;
    if (!isSameAsStart && !window.confirm("저장 안 한 손질을 버리고 저장된 시작 모습으로 다시 열까요?")) return;
    setMount((previous) => ({ key: (previous?.key ?? 0) + 1, initial: createDefaultDraft(catalog, gender) }));
    setStatus({ kind: "idle", text: "" });
  };

  if (loadError) {
    return (
      <div style={messageStyle}>
        시작 모습 파일을 못 읽었습니다({loadError}). 본편 개발 서버(vite.config.ts)에서 열었는지 확인해 주세요.
      </div>
    );
  }
  if (!catalog || !file || !mount) return <div style={messageStyle}>불러오는 중…</div>;

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <CharacterCreationScreen
        key={mount.key}
        initialValue={mount.initial}
        catalog={catalog}
        checkName={checkName}
        onDraftChange={handleDraftChange}
        onComplete={refuseComplete}
        onCancel={null}
      />

      {/* 머리 줄 왼쪽 빈 자리에 세 줄로 — 무대 칸(이름표)을 가리지 않게 */}
      <section aria-label="시작 모습 정하기" style={panelStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>시작 모습 정하기</strong>
          {status.text ? (
            <span role="status" style={{ fontSize: 12, color: status.kind === "error" ? "#ff9a9a" : "#cfe6f2" }}>
              {status.text}
            </span>
          ) : (
            <span style={faintStyle}>개발 전용 · 저장 뒤 커밋해야 반영</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...primaryButton, opacity: status.kind === "busy" || isSameAsStart ? 0.55 : 1 }}
            disabled={status.kind === "busy" || isSameAsStart}
            onClick={() => void saveCurrent()}
          >
            이 모습을 {GENDER_LABELS[gender]} 시작 모습으로 저장
          </button>
          <span style={{ ...faintStyle, color: isSameAsStart ? "#9fe0b0" : "#ffd27a" }}>
            {isSameAsStart ? "저장된 시작 모습과 같음" : "저장 안 한 손질 있음"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
          {(["masculine", "feminine"] as const).map((key) => (
            <span key={key} style={{ opacity: key === gender ? 1 : 0.65 }}>
              {GENDER_LABELS[key]} {file[key] ? `${formatSavedAt(file[key].savedAt)} 저장` : "코드 기본값"}
            </span>
          ))}
          <button type="button" style={linkButton} onClick={reopen}>
            다시 불러오기
          </button>
          {savedEntry ? (
            <button type="button" style={linkButton} onClick={() => void resetToCode()}>
              코드 기본값으로
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "fixed",
  left: 16,
  top: 12,
  zIndex: 30,
  maxWidth: "min(460px, calc(100vw - 32px))",
  display: "grid",
  gap: 5,
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255, 210, 122, 0.55)",
  background: "rgba(24, 20, 10, 0.92)",
  color: "#f5f6f7",
  font: `500 13px/1.35 ${FONTS.body}`,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
};

const faintStyle: CSSProperties = { fontSize: 12, color: "rgba(245, 246, 247, 0.6)" };

const primaryButton: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 7,
  border: "1px solid #ffd27a",
  background: "#ffd27a",
  color: "#1a1408",
  font: `700 13px/1.2 ${FONTS.body}`,
  cursor: "pointer",
};

const linkButton: CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "#ffd27a",
  font: `600 12px/1.35 ${FONTS.body}`,
  textDecoration: "underline",
  cursor: "pointer",
};

const messageStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: 24,
  color: "#f5f6f7",
  font: `500 15px/1.5 ${FONTS.body}`,
  background: "#02040a",
  textAlign: "center",
};
