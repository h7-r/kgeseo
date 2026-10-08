/**
 * 웹사이트 「게임 시작」 → 캐릭터 생성 → 튜토리얼(/) 을 잇는 라우트.
 * 오프닝 영상은 naju01 로딩 영상이 `?transition=` 초부터 이어 튼다. 완료하면 외형을 로비 아바타 저장소에 적고
 * 로딩 영상으로 덮은 뒤 / 로 간다.
 * App 밖에 두는 이유: 생성 화면 뒤에서 역 씬을 같이 돌리면 GPU 를 두 벌 쓴다. / 로 넘어갈 때 App 이
 * 처음 마운트되며 새 외형을 읽는다(마운트 때 한 번만 읽는다).
 * 이름 확인·저장은 원래 서버 몫이다. 서버가 생기면 checkName · handleComplete 속만 바꾸면 된다.
 */
import { Suspense, useCallback, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { PLAYER_MESHY_APPEARANCE_KEY } from "@/engine/storage";
import {
  CharacterCreationScreen,
  DEFAULT_CATALOG,
  DEFAULT_MESH_CONFIG,
  normalizeMeshConfig,
  showLoadingVideo,
  toRendererConfig,
  validateNameFormat,
  type CompletedCharacter,
  type CompleteResult,
  type NameCheckResult,
} from "@/naju";

export const CHARACTER_CREATION_PATH = "/character-creation";

const DRAFT_STORAGE_KEY = "kgeseo.character.draft.v1";
const CHARACTER_STORAGE_KEY = "kgeseo.character.v1";

// 「뒤로」 가 돌아갈 웹사이트 주소. 개발 서버에서는 안 적어도 웹사이트 개발 서버(5175)로 간다.
const SITE_URL: string = import.meta.env.VITE_SITE_URL || (import.meta.env.DEV ? "http://localhost:5175" : "");

/** 생성 화면이 내보내는 초안 중 여기서 만지는 부분 */
interface CharacterDraft {
  appearance?: { hairId?: unknown; gender?: unknown; [field: string]: unknown };
  [field: string]: unknown;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isDraft(value: unknown): value is CharacterDraft {
  return typeof value === "object" && value !== null;
}

/** 완료 데이터의 외형 → 로비 아바타 설정(MeshAppearanceConfig) */
function toLobbyMeshConfig(appearance: CompletedCharacter["appearance"]) {
  // toRendererConfig 는 초안 모양(colors)을 받는다 — 완료 데이터는 supportedColorValues 로 나간다
  const rendered = toRendererConfig({ ...appearance, colors: appearance.supportedColorValues }, DEFAULT_CATALOG);
  // 걷기·달리기·주먹 쥠 같은 게임 쪽 값은 기본을 쓰고 외형만 덮는다
  return normalizeMeshConfig({
    ...DEFAULT_MESH_CONFIG,
    ...rendered,
    motion: "자동",
    walkMotion: DEFAULT_MESH_CONFIG.walkMotion,
    runMotion: DEFAULT_MESH_CONFIG.runMotion,
    fistHands: DEFAULT_MESH_CONFIG.fistHands,
  });
}

/** 지난 초안이 있으면 그 모습에서 이어 만든다. 긴 머리 모델은 귀 문제가 있어 처음 값으로는 단발로 돌려 연다. */
function readInitialDraft() {
  const stored = readJson(DRAFT_STORAGE_KEY);
  if (!isDraft(stored)) return stored;
  const appearance = stored.appearance;
  if (!appearance) return stored;
  const hairId = appearance.hairId;
  if (typeof hairId === "string" && hairId.endsWith(".long"))
    return {
      ...stored,
      appearance: {
        ...appearance,
        hairId: appearance.gender === "feminine" ? "hair.f.bob" : "hair.m.crop",
      },
    };
  return stored;
}

export default function CharacterCreationRoute() {
  const navigate = useNavigate();
  const [initialValue] = useState(readInitialDraft);
  const hasLeft = useRef(false);

  // 지금은 형식만 본다(서버가 생기면 여기서 중복을 묻는다)
  const checkName = useCallback(async (name: string): Promise<NameCheckResult> => {
    const result = validateNameFormat(name);
    if (!result.ok) return { status: "invalid", message: result.message };
    return { status: "available" };
  }, []);

  const handleDraftChange = useCallback((draft: unknown) => {
    writeJson(DRAFT_STORAGE_KEY, draft);
  }, []);

  const handleComplete = useCallback(
    async (payload: CompletedCharacter): Promise<CompleteResult> => {
      const isSaved =
        writeJson(PLAYER_MESHY_APPEARANCE_KEY, toLobbyMeshConfig(payload.appearance)) &&
        writeJson(CHARACTER_STORAGE_KEY, payload);
      if (!isSaved) return { ok: false, reason: "failed", message: "이 브라우저에 저장할 수 없습니다." };
      // 화면은 완료 상태로 멈춰 있다 — 로딩 영상으로 먼저 덮고(0.35초) / 로 보낸다.
      // 영상 막은 main 에 있어 주소가 바뀌어도 살아 있고, 역 씬이 다 뜨면 스스로 걷힌다. 두 번 눌려도 한 번만 간다.
      if (!hasLeft.current) {
        hasLeft.current = true;
        showLoadingVideo("tutorial");
        setTimeout(() => navigate("/", { replace: true }), 350);
      }
      return { ok: true };
    },
    [navigate],
  );

  // 웹사이트로 돌아간다(주소를 모르면 이전 페이지로)
  const handleCancel = useCallback(() => {
    if (SITE_URL) window.location.assign(SITE_URL);
    else window.history.back();
  }, []);

  return (
    <div style={rootStyle}>
      <Suspense fallback={null}>
        <CharacterCreationScreen
          initialValue={initialValue}
          checkName={checkName}
          onDraftChange={handleDraftChange}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      </Suspense>
    </div>
  );
}

const rootStyle: CSSProperties = { position: "fixed", inset: 0, background: "#02040a" };
