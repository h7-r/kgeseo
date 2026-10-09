import { REGIONS } from "@/data/regions";

/**
 * 입력 검사 규칙. 맞으면 "", 틀리면 보여 줄 말을 돌려준다. 화면 표시는 useForm 이 맡는다.
 * 프론트 검사는 편의일 뿐이다 — 서버가 붙으면 서버도 같은 규칙으로 다시 검사해야 한다.
 */

export type FieldName =
  | "email"
  | "password"
  | "passwordConfirm"
  | "newPassword"
  | "nickname"
  | "region"
  | "code"
  | "title"
  | "content"
  | "inquiryType";

export type FormValues = Partial<Record<FieldName, string>>;
export type FieldErrors = Partial<Record<FieldName, string>>;

// eslint-disable-next-line no-control-regex -- 복사·붙여넣기로 몰래 들어오는 제어 문자와 폭 없는 글자를 걸러 낸다.
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]/g;

/**
 * 검사 전에 값을 다듬는다. 맥에서 복사한 한글은 자모가 풀린(NFD) 채로 올 수 있어
 * NFC 로 모으지 않으면 같아 보이는 닉네임이 둘 생긴다.
 */
export function normalizeInput(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "");
}

// ERD(app_user) 와 맞춘 값: email varchar(255), nickname varchar(12).
const MAX = {
  email: 254,
  password: 64,
  newPassword: 64,
  passwordConfirm: 64,
  nickname: 12,
  region: 10,
  code: 6,
} as const;

/** 칸마다 받을 수 있는 최대 길이. input 의 maxLength 로도 쓴다. */
export const MAX_LENGTH: Readonly<Partial<Record<FieldName, number>>> = MAX;

const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+-]{1,64}(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** 한글이 섞였나. 영문만 받는 칸에 쓴다. */
export function hasHangul(value: string | null | undefined): boolean {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value || "");
}

/** 영문 전용 칸에 한글을 치면 칸 오른쪽에 바로 띄우는 말 */
export const ENGLISH_ONLY_HINT = "영문으로 입력해주세요";

export const ENGLISH_ONLY_FIELDS: ReadonlySet<FieldName> = new Set<FieldName>([
  "email",
  "password",
  "passwordConfirm",
  "newPassword",
]);

// 「형식이 아닙니다」만으로는 어디를 고칠지 모르니 틀린 까닭을 짚어 준다.
function checkEmail(raw: unknown): string {
  const value = normalizeInput(raw).trim();
  if (!value) return "이메일을 입력해주세요.";
  if (hasHangul(value)) return "이메일에는 한글을 쓸 수 없습니다.";
  if (/\s/.test(value)) return "이메일 형식이 아닙니다. 띄어쓰기를 빼주세요.";
  const atCount = (value.match(/@/g) || []).length;
  if (atCount === 0) return "이메일 형식이 아닙니다. @ 가 빠졌어요. (예: explorer@escape.kr)";
  if (atCount > 1) return "이메일 형식이 아닙니다. @ 는 하나만 쓸 수 있어요.";
  if (value.length > MAX.email) return "이메일이 너무 깁니다.";
  const [local, domain] = value.split("@");
  if (!local) return "이메일 형식이 아닙니다. @ 앞에 아이디가 없어요.";
  if (!domain || !domain.includes(".")) return "이메일 형식이 아닙니다. @ 뒤 주소를 확인해주세요. (예: naver.com)";
  if (!EMAIL_PATTERN.test(value)) return "이메일 형식이 아닙니다. (예: explorer@escape.kr)";
  return "";
}

const COMMON_MAIL_DOMAINS = [
  "naver.com",
  "gmail.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "nate.com",
  "icloud.com",
  "outlook.com",
  "hotmail.com",
];

/** 편집 거리. 한 글자 틀림·빠짐·바뀜을 1 로 센다. */
function editDistance(a: string, b: string): number {
  const table: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) table[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return table[a.length][b.length];
}

/**
 * 「gmial.com」 → 「혹시 …@gmail.com 인가요?」. 없으면 "".
 * 틀린 게 아닐 수도 있어 막지는 않고 제안만 한다.
 */
export function suggestEmailTypo(raw: unknown): string {
  const value = normalizeInput(raw).trim().toLowerCase();
  const domain = value.split("@")[1];
  if (!domain || COMMON_MAIL_DOMAINS.includes(domain)) return "";
  const closest = COMMON_MAIL_DOMAINS.find((d) => editDistance(domain, d) <= 2);
  return closest ? `혹시 ${value.split("@")[0]}@${closest} 인가요?` : "";
}

// 서버(nickname_policy)와 같은 목록. 서버가 마지막에 한 번 더 막는다.
const RESERVED_NICKNAMES = ["관리자", "운영자", "운영팀", "admin", "administrator", "root", "system", "왜곡", "gm"];
const BANNED_WORDS = ["시발", "씨발", "병신", "개새끼", "좆", "보지", "자지", "fuck", "shit", "bitch"];
// 숫자로 글자를 흉내 낸 우회(adm1n, 5hit)를 잡는다.
const LEET: Record<string, string> = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t" };

// 닉네임 칸이 반쪽 폭이라 문구는 16자 안팎으로 짧게 둔다.
function checkNickname(raw: unknown): string {
  const original = String(raw ?? "");
  // 다듬기 전에 본다. 끝에 붙은 탭 같은 제어 문자가 trim 으로 몰래 사라지지 않게.
  if (/\p{C}/u.test(original)) return "사용할 수 없는 닉네임입니다.";
  const value = original.normalize("NFKC").trim();
  if (!value) return "닉네임을 입력해주세요.";
  if (value.length < 2) return "2자 이상 입력해주세요.";
  if (value.length > MAX.nickname) return "12자까지 쓸 수 있습니다.";
  if (/\s/.test(value)) return "띄어쓰기는 쓸 수 없어요.";
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(value)) return "자음·모음만 따로 쓸 수 없어요.";
  if (!/^[가-힣A-Za-z0-9_]+$/.test(value)) return "특수문자는 _ 만 쓸 수 있어요.";
  const key = value.toLowerCase().replaceAll("_", "");
  // 통째로 같을 때만 막는다. 짧은 금칙어가 들어 있다고 멀쩡한 낱말까지 막지 않게.
  const candidates = [key, key.replace(/[013457]/g, (c) => LEET[c]), key.replace(/[0-9]+$/, "")];
  if (candidates.some((c) => RESERVED_NICKNAMES.includes(c) || BANNED_WORDS.includes(c))) {
    return "사용할 수 없는 닉네임입니다.";
  }
  return "";
}

const COMMON_PASSWORDS = [
  "password",
  "qwerty",
  "qwer1234",
  "asdf1234",
  "abcd1234",
  "iloveyou",
  "letmein",
  "welcome",
  "admin123",
  "12345678",
  "11111111",
  "1q2w3e4r",
  "zxcv1234",
  "passw0rd",
];

/** 비밀번호 규칙이 함께 보는 값. 이메일 아이디·닉네임이 들어간 비밀번호를 막는다. */
interface PasswordContext {
  email?: string;
  nickname?: string;
}

function checkPassword(raw: unknown, context: PasswordContext = {}): string {
  const value = String(raw ?? "");
  if (!value) return "비밀번호를 입력해주세요.";
  if (hasHangul(value)) return "비밀번호에는 한글을 쓸 수 없습니다.";
  if (/\s/.test(value)) return "공백은 쓸 수 없습니다.";
  if (value.length < 8) return "8자 이상이어야 합니다.";
  if (value.length > MAX.password) return "64자까지 쓸 수 있습니다.";
  if (!/[A-Z]/.test(value)) return "영문 대문자를 한 자 이상 넣어주세요.";
  if (!/[a-z]/.test(value)) return "영문 소문자를 한 자 이상 넣어주세요.";
  if (!/\d/.test(value)) return "숫자를 한 자 이상 넣어주세요.";
  if (/(.)\1\1/.test(value)) return "같은 글자를 세 번 이상 잇달아 쓸 수 없습니다.";
  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.some((p) => lower.includes(p))) return "너무 흔한 비밀번호입니다. 다른 조합을 써주세요.";
  const localPart = normalizeInput(context.email).trim().toLowerCase().split("@")[0];
  if (localPart && localPart.length >= 3 && lower.includes(localPart))
    return "비밀번호에 이메일 아이디를 넣을 수 없습니다.";
  const nickname = normalizeInput(context.nickname).trim().toLowerCase();
  if (nickname && nickname.length >= 3 && lower.includes(nickname)) return "비밀번호에 닉네임을 넣을 수 없습니다.";
  return "";
}

/** 칸별 규칙. 통과하면 "", 아니면 보여 줄 말 */
export const RULES = {
  nickname: (value?: string) => checkNickname(value),
  region: (value?: string) => {
    const picked = normalizeInput(value).trim();
    if (!picked) return "지역을 선택해주세요.";
    return REGIONS.includes(picked) ? "" : "목록에 있는 지역을 골라주세요.";
  },
  email: (value?: string) => checkEmail(value),
  password: (value?: string, context?: PasswordContext) => checkPassword(value, context),
  // 로그인은 비었는지만 본다. 가입 규칙을 걸면 규칙이 바뀌기 전 계정(테스트 계정 포함)이 못 들어온다.
  loginPassword: (value?: string) =>
    !value ? "비밀번호를 입력해주세요." : value.length > MAX.password ? "64자까지 쓸 수 있습니다." : "",
  code: (value?: string) =>
    !value?.trim() ? "인증코드를 입력해주세요." : !/^\d{6}$/.test(value.trim()) ? "숫자 6자리입니다." : "",
  title: (value?: string) => (!value?.trim() ? "제목을 입력해주세요." : ""),
  content: (value?: string) =>
    !value?.trim() ? "내용을 입력해주세요." : value.trim().length < 10 ? "10자 이상 적어주세요." : "",
  inquiryType: (value?: string) => (!value ? "문의 유형을 선택해주세요." : ""),
} as const;

/** 비밀번호 확인 칸. 비밀번호 칸 값이 있어야 판단할 수 있다. */
export function validatePasswordConfirm(password: string | undefined, confirm: string | undefined): string {
  if (!confirm) return "비밀번호를 한 번 더 입력해주세요.";
  return password === confirm ? "" : "비밀번호가 서로 다릅니다.";
}

/** 비밀번호 세기 0~3. 회원가입의 막대 세 칸에 쓴다. */
export function computePasswordStrength(password = ""): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score += 1;
  return score;
}

/** 칸에 들어온 순간 띄우는 쓰는 법. 틀린 뒤에 알려 주는 것보다 한 번에 끝난다. */
export const FIELD_HINTS: Readonly<Partial<Record<FieldName, string>>> = {
  email: "영문 이메일 주소를 적어주세요. 예) explorer@escape.kr",
  password: "8자 이상 · 영문 대문자와 소문자 · 숫자를 각각 한 자 이상 섞어주세요.",
  newPassword: "8자 이상 · 영문 대문자와 소문자 · 숫자를 각각 한 자 이상 섞어주세요.",
  passwordConfirm: "위에 적은 비밀번호를 그대로 한 번 더 적어주세요.",
  nickname: "2~12자 · 한글·영문·숫자·밑줄(_). 다른 모험가에게 보이는 이름입니다.",
  region: "목록에서 지역을 고르세요. 나중에 바꿀 수 있습니다.",
  code: "메일로 받은 숫자 6자리를 적어주세요.",
};

interface PasswordCheck {
  label: string;
  test: (value: string | undefined) => boolean;
}

/** 치는 동안 하나씩 체크가 들어오는 비밀번호 조건 */
export const PASSWORD_CHECKS: readonly PasswordCheck[] = [
  { label: "8자 이상", test: (value) => (value || "").length >= 8 },
  { label: "영문 대문자", test: (value) => /[A-Z]/.test(value || "") },
  { label: "영문 소문자", test: (value) => /[a-z]/.test(value || "") },
  { label: "숫자", test: (value) => /\d/.test(value || "") },
];

interface ValidateOptions {
  /** true 면 비밀번호는 비었는지만 본다. */
  isLogin?: boolean;
}

/** 여러 칸을 한 번에 검사한다. */
export function validateFields(
  fields: readonly FieldName[],
  values: FormValues,
  { isLogin = false }: ValidateOptions = {},
): FieldErrors {
  const errors: FieldErrors = {};
  for (const name of fields) {
    if (name === "passwordConfirm")
      errors[name] = validatePasswordConfirm(values.password ?? values.newPassword, values.passwordConfirm);
    else if (name === "newPassword") errors[name] = RULES.password(values.newPassword, values);
    else if (name === "password")
      errors[name] = isLogin ? RULES.loginPassword(values.password) : RULES.password(values.password, values);
    else errors[name] = RULES[name](values[name]);
  }
  return errors;
}

export function hasNoErrors(errors: FieldErrors): boolean {
  return Object.values(errors).every((message) => !message);
}
