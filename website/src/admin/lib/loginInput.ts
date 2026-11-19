/**
 * 관리자 로그인 422 안내 — 서버(main.py FIELD_ERRORS)가 주는 code 를 칸별 문구로 바꾼다.
 * 로그인 스키마(LocalLoginRequest)는 이메일 형식을 보지 않아 invalid_email 은 비었거나 254자를 넘을 때만 나고,
 * 실제로 닿는 422 는 비밀번호 128자 초과(invalid_password)다. 모르는 code 는 웹 로그인과 같은 중립 문구.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

export type LoginInputField = "email" | "password";

export interface LoginInputError {
  /** 문구를 붙일 칸 */
  field: LoginInputField;
  message: string;
}

const BY_CODE: Readonly<Record<string, LoginInputError>> = {
  invalid_email: { field: "email", message: "이메일 형식을 다시 확인해 주세요." },
  invalid_password: { field: "password", message: "비밀번호 형식을 다시 확인해 주세요." },
};

/** code 가 없거나(invalid_input · 본문 아님) 모르는 값일 때 — 어느 칸인지 모르니 비밀번호 칸 아래에 중립 문구 */
export const INPUT_FALLBACK: LoginInputError = { field: "password", message: "입력값을 다시 확인해 주세요." };

export const loginInputError = (code: string | undefined): LoginInputError =>
  (code && BY_CODE[code]) || INPUT_FALLBACK;
