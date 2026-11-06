// 로비 서버 설정과 운영 시작 검사(설계 v0.19 3.3절).
// 실행 프로필은 실행 명령의 --profile= 에서만 정한다. 설정 파일·환경값으로는 바꿀 수 없다.
// 실패 사유에는 항목 이름과 이유만 적는다 — 비밀값·원본 설정은 남기지 않는다.
import { readFileSync } from "node:fs";

export type Profile = "production" | "test";

export interface LobbyConfig {
  profile: Profile;
  port: number;
  /** 정확히 같은 문자열만 허용한다(예: https://play.example.com). 끝의 / 는 뗀다 */
  allowedOrigins: readonly string[];
  maxRooms: number;
  /** HS256 서명 키(UTF-8 바이트) */
  ticketSecret: Uint8Array;
  testHooks: boolean;
}

export const PRODUCTION_MAX_ROOMS = 5;
export const MIN_SECRET_BYTES = 32;
export const DEV_SECRET_PREFIX = "dev-";
export const DEFAULT_PORT = 2567;

/** 실행 프로필을 정하는 데 쓰지 않는다 — 파일이나 환경에 있어도 무시한다 */
const IGNORED_FILE_KEYS = new Set(["WAEGOK_RUN_PROFILE", "LOBBY_PROFILE"]);

export type ProfileResult = { profile: Profile } | { error: string };

/** CLI 인자에서 프로필을 읽는다. 없으면 production, 알 수 없는 값이나 두 번 적으면 실패. */
export function parseProfile(argv: readonly string[]): ProfileResult {
  const values = argv.filter((arg) => arg.startsWith("--profile")).map((arg) => arg.split("=")[1]);
  if (values.length === 0) return { profile: "production" };
  if (values.length > 1) return { error: "--profile: 두 번 적혔다" };
  const [value] = values;
  if (value === "production" || value === "test") return { profile: value };
  return { error: "--profile: production 또는 test 만 쓸 수 있다" };
}

/** `KEY=value` 줄들. 빈 줄·# 줄은 건너뛰고, 값의 앞뒤 따옴표 한 쌍은 벗긴다. */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export interface SettingsSource {
  env: Readonly<Record<string, string | undefined>>;
  /** test 프로필에서만 읽는 로비 전용 파일. 없으면 undefined */
  readLocalFile?: () => string | undefined;
}

/**
 * production: 프로세스 환경만(운영은 systemd EnvironmentFile 이 넣는다).
 * test: 프로세스 환경을 먼저 보고, 없는 항목만 로비 전용 파일(lobby/.env.lobby)에서 채운다.
 */
export function collectSettings(profile: Profile, source: SettingsSource): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(source.env)) {
    if (key.startsWith("LOBBY_") && value !== undefined && !IGNORED_FILE_KEYS.has(key)) settings[key] = value;
  }
  if (profile === "test") {
    const text = source.readLocalFile?.();
    if (text !== undefined) {
      for (const [key, value] of Object.entries(parseEnvFile(text))) {
        if (key.startsWith("LOBBY_") && !IGNORED_FILE_KEYS.has(key) && !(key in settings)) settings[key] = value;
      }
    }
  }
  return settings;
}

export type ConfigResult = { config: LobbyConfig } | { errors: string[] };

function parseInteger(raw: string | undefined): number | null {
  if (raw === undefined || !/^-?\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : null;
}

function parseOrigins(raw: string | undefined, errors: string[]): string[] {
  if (raw === undefined || raw.trim() === "") {
    errors.push("LOBBY_ALLOWED_ORIGINS: 비어 있다");
    return [];
  }
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().replace(/\/+$/, "");
    if (!value) continue;
    if (value.includes("*")) {
      errors.push("LOBBY_ALLOWED_ORIGINS: 와일드카드는 쓸 수 없다");
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      errors.push("LOBBY_ALLOWED_ORIGINS: 주소 형식이 아니다");
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== value) {
      errors.push("LOBBY_ALLOWED_ORIGINS: 경로 없는 http(s) 출처만 쓸 수 있다");
      continue;
    }
    origins.push(value);
  }
  if (origins.length === 0 && !errors.some((e) => e.startsWith("LOBBY_ALLOWED_ORIGINS"))) {
    errors.push("LOBBY_ALLOWED_ORIGINS: 비어 있다");
  }
  return origins;
}

/** 설정을 검사해 만든다. production 프로필에서 시험용 값이 들어 있으면 실패한다(3.3.2절). */
export function buildConfig(profile: Profile, settings: Readonly<Record<string, string>>): ConfigResult {
  const errors: string[] = [];
  const isProduction = profile === "production";

  const declaredEnv = settings.LOBBY_ENV?.trim();
  if (declaredEnv && declaredEnv !== profile) errors.push("LOBBY_ENV: 실행 프로필과 다르다");

  const portRaw = settings.LOBBY_PORT;
  const port = portRaw === undefined ? DEFAULT_PORT : parseInteger(portRaw);
  if (port === null || port < 1 || port > 65535) errors.push("LOBBY_PORT: 1~65535 정수가 아니다");

  const maxRoomsRaw = settings.LOBBY_MAX_ROOMS;
  const maxRooms = maxRoomsRaw === undefined ? (isProduction ? null : PRODUCTION_MAX_ROOMS) : parseInteger(maxRoomsRaw);
  if (maxRooms === null || maxRooms < 1) errors.push("LOBBY_MAX_ROOMS: 1 이상 정수가 아니다");
  else if (isProduction && maxRooms !== PRODUCTION_MAX_ROOMS)
    errors.push(`LOBBY_MAX_ROOMS: 운영은 ${PRODUCTION_MAX_ROOMS}이어야 한다`);

  const allowedOrigins = parseOrigins(settings.LOBBY_ALLOWED_ORIGINS, errors);

  const secret = settings.LOBBY_TICKET_SECRET ?? "";
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.length === 0) errors.push("LOBBY_TICKET_SECRET: 없다");
  else if (isProduction && secret.startsWith(DEV_SECRET_PREFIX))
    errors.push("LOBBY_TICKET_SECRET: 운영에서 개발 키(dev-)를 쓸 수 없다");
  else if (isProduction && secretBytes.length < MIN_SECRET_BYTES)
    errors.push(`LOBBY_TICKET_SECRET: 운영 키는 ${MIN_SECRET_BYTES}바이트 이상이어야 한다`);

  const hooksRaw = settings.LOBBY_TEST_HOOKS?.trim();
  if (hooksRaw !== undefined && hooksRaw !== "" && hooksRaw !== "0" && hooksRaw !== "1")
    errors.push("LOBBY_TEST_HOOKS: 0 또는 1 이어야 한다");
  const testHooks = hooksRaw === "1";
  if (isProduction && testHooks) errors.push("LOBBY_TEST_HOOKS: 운영 프로필에서 켤 수 없다");

  if (errors.length > 0) return { errors };
  return {
    config: {
      profile,
      port: port as number,
      allowedOrigins,
      maxRooms: maxRooms as number,
      ticketSecret: secretBytes,
      testHooks,
    },
  };
}

/** 실행 명령·환경·(test 면) 로비 전용 파일에서 설정을 읽어 검사한다. */
export function loadConfig(argv: readonly string[], env: SettingsSource["env"], localFilePath: string): ConfigResult {
  const profileResult = parseProfile(argv);
  if ("error" in profileResult) return { errors: [profileResult.error] };
  const settings = collectSettings(profileResult.profile, {
    env,
    readLocalFile: () => {
      try {
        return readFileSync(localFilePath, "utf8");
      } catch {
        return undefined;
      }
    },
  });
  return buildConfig(profileResult.profile, settings);
}
