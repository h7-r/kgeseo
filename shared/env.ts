/// <reference types="vite/client" />
/**
 * 배포 환경값 — 웹사이트·본편·나주 세 앱이 같은 규칙으로 읽는다(11/5 미르 님 규칙).
 *   VITE_ASSET_BASE  CDN 기본 주소만, 끝에 / 없이(예: https://assets.도메인). 비면 "" → 지금처럼 /models/… 그대로
 *                    케이스 파일의 버전 경로는 서버가 세션의 asset_base_path 로 내려 주고 setAssetVersionPath 로 넣는다
 *   VITE_SHARED_BUILD 공용 파일(/models)의 빌드 번호. 빌드가 tools/shared-asset-build.mjs 로 채우고, CDN 경로 /shared/<해시> 가 된다
 *   VITE_API_ORIGIN  경로 없이, 끝에 / 없이(예: https://api.도메인). 비면 "" → 같은 출처 /api proxy 그대로.
 *                    세진 님 통합 브랜치의 이름·검사(deploymentUrls.apiOrigin — 운영 빌드는 HTTPS 만)를 그대로 쓴다
 *   VITE_LOBBY_URL   wss://… 비면 "" → 로비 접속 끔(혼자 모드)
 * 주소는 assetUrl · apiUrl 로만 만든다 — 나중에 CDN 으로 바꿀 때 여기 한 곳만 고친다.
 */
import { apiOrigin } from "./deploymentUrls";

const trimEnd = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\/+$/, "") : "");

export const ASSET_BASE = trimEnd(import.meta.env.VITE_ASSET_BASE);
export const API_ORIGIN = apiOrigin(import.meta.env.VITE_API_ORIGIN, import.meta.env.PROD);
export const LOBBY_URL =
  typeof import.meta.env.VITE_LOBBY_URL === "string" ? import.meta.env.VITE_LOBBY_URL.trim() : "";

const VERSION_KEY = "waegok.assetVersionPath";

function readStoredVersion(): string {
  try {
    return sessionStorage.getItem(VERSION_KEY) ?? "";
  } catch {
    return "";
  }
}

let versionPath = readStoredVersion();

/**
 * 세션의 에셋 버전 경로를 정한다(asset_base_path, 예: /c/naju-angam-01/v1). 진행 중인 플레이어는 새 판이 게시돼도 자기 판 파일을 계속 읽는다.
 * 본편과 나주는 페이지가 달라서 탭 저장소로 넘긴다. 비우면 버전 없는 주소로 돌아간다.
 */
export function setAssetVersionPath(path: string | null | undefined): void {
  const trimmed = (path ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (trimmed.split("/").some((part) => part === "." || part === "..") || trimmed.includes("://"))
    throw new Error("에셋 버전 경로가 올바르지 않습니다.");
  versionPath = trimmed && `/${trimmed}`;
  try {
    if (versionPath) sessionStorage.setItem(VERSION_KEY, versionPath);
    else sessionStorage.removeItem(VERSION_KEY);
  } catch {
    // 저장소를 못 써도 이 페이지에서는 그대로 쓴다.
  }
}

const localAssetUrl = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

/**
 * 케이스 에셋 주소(나주 _sf_local · vfx). path 는 "/" 로 시작하는 공개 폴더 경로.
 * 부를 때의 버전 경로를 쓰므로 주소를 모듈 상수로 잡아 두지 않는다.
 * CDN 이 없으면 파일은 공개 폴더 한 벌뿐이라 버전 경로도 붙이지 않는다.
 */
export const assetUrl = (path: string) =>
  ASSET_BASE ? `${ASSET_BASE}${versionPath}${path}` : localAssetUrl(path);

const SHARED_BUILD = trimEnd(import.meta.env.VITE_SHARED_BUILD);

/** 공용 에셋 주소(/models). 판이 바뀌어도 그대로라 세션의 버전 경로를 따르지 않는다. */
export const sharedAssetUrl = (path: string) =>
  ASSET_BASE ? `${ASSET_BASE}${SHARED_BUILD && `/shared/${SHARED_BUILD}`}${path}` : localAssetUrl(path);
/** 백엔드 주소. path 는 "/api/v1/…" 전체 경로. */
export const apiUrl = (path: string) => `${API_ORIGIN}${path}`;
