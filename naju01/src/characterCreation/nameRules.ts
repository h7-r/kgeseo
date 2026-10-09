// 캐릭터명 규칙 — 정규화·글자 수·형식 검사.
// 서버 규칙이 아직 없어 PRD 의 2~12자를 따른다. 확정되면 `nameRules` prop 하나만 바꿔 넘기면 화면 전체가 따라온다.
// 글자 수는 코드 포인트로 센다 — `.length` 로 세면 이모지가 2 가 되어 화면과 서버의 길이가 달라진다.

export interface NameRules {
  min: number;
  max: number;
  /** 허용 형식(정규식 원문, u 플래그) */
  allowedPattern: string;
  /** 형식이 어긋났을 때 보여 줄 안내 */
  allowedHint: string;
}

export const DEFAULT_NAME_RULES: NameRules = {
  min: 2,
  max: 12,
  // 한글·영문·숫자와 가운데 한 칸 공백만
  allowedPattern: "^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]+( [가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]+)*$",
  allowedHint: "한글·영문·숫자를 쓸 수 있습니다.",
};

export type NameFormatResult = { ok: true; name: string } | { ok: false; message: string; isEmpty?: boolean };

/** 서버(지금은 부모)가 돌려주는 이름 확인 결과 */
export type NameCheckResult = { status: "available" } | { status: "taken" | "invalid"; message?: string };

export type NameChecker = (name: string, options: { signal?: AbortSignal }) => Promise<NameCheckResult>;

// 앞뒤 공백을 떼고, 가운데 연속 공백을 한 칸으로, 한글 조합형을 완성형으로 맞춘다.
// NFC 를 안 맞추면 눈으로 같은 「가」가 서버에서 다른 문자열이 된다.
export function normalizeName(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function countCharacters(value: unknown): number {
  return [...normalizeName(value)].length;
}

/** 화면에 바로 보여 줄 형식 검사. 서버 판정(중복·금칙어)은 하지 않는다. */
export function validateNameFormat(value: unknown, rules: NameRules = DEFAULT_NAME_RULES): NameFormatResult {
  const name = normalizeName(value);
  const count = [...name].length;
  if (count === 0) return { ok: false, isEmpty: true, message: "캐릭터명을 입력해 주세요." };
  if (count < rules.min) return { ok: false, message: `${rules.min}자 이상 입력해 주세요.` };
  if (count > rules.max) return { ok: false, message: `${rules.max}자까지 쓸 수 있습니다.` };
  if (rules.allowedPattern) {
    // 규칙이 깨져 있으면 형식 검사를 건너뛴다 — 입력을 아예 막는 쪽이 더 나쁘다.
    let pattern: RegExp | null;
    try {
      pattern = new RegExp(rules.allowedPattern, "u");
    } catch {
      pattern = null;
    }
    if (pattern && !pattern.test(name)) {
      return { ok: false, message: rules.allowedHint ?? "쓸 수 없는 문자가 있습니다." };
    }
  }
  return { ok: true, name };
}

/** 바깥에서 받은 규칙을 믿을 수 있는 모양으로 */
export function normalizeNameRules(rules: unknown): NameRules {
  const source: Partial<Record<keyof NameRules, unknown>> = rules && typeof rules === "object" ? rules : {};
  const min = Number.isFinite(Number(source.min)) ? Math.max(1, Number(source.min)) : DEFAULT_NAME_RULES.min;
  const max = Number.isFinite(Number(source.max)) ? Math.max(min, Number(source.max)) : DEFAULT_NAME_RULES.max;
  return {
    min,
    max,
    allowedPattern:
      typeof source.allowedPattern === "string" ? source.allowedPattern : DEFAULT_NAME_RULES.allowedPattern,
    allowedHint: typeof source.allowedHint === "string" ? source.allowedHint : DEFAULT_NAME_RULES.allowedHint,
  };
}
