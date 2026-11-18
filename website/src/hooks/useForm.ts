import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  MAX_LENGTH,
  normalizeInput,
  validateFields,
  type FieldErrors,
  type FieldName,
  type FormValues,
} from "@/lib/validation";
import { DuplicateCheckLimitedError, isEmailTaken, isNicknameTaken } from "@/services/account/authApi";
import type { ConsentKind } from "@/services/account/db";

/** 저장소에 물어봐야 아는 검사(이메일·닉네임 중복). 통과하면 "", 아니면 보여 줄 말 */
type AsyncCheck = (value: string | undefined) => Promise<string>;

// 칸을 떠나거나 고치다 멈추면 서버에 「이미 있나」를 묻는다.
export const SIGNUP_DUPLICATE_CHECKS: Partial<Record<FieldName, AsyncCheck>> = {
  email: async (value) => ((await isEmailTaken(value)) ? "이미 가입된 이메일입니다." : ""),
  nickname: async (value) => ((await isNicknameTaken(value)) ? "이미 사용 중인 닉네임입니다." : ""),
};

/** 서버 답 하나. 어느 값을 물었는지 같이 둬야 제출 때 같은 값인지 견줄 수 있다. */
interface CheckAnswer {
  value: string;
  message: string;
}

/** 검사 한 번의 결과. answer 는 서버가 답했을 때만 있고(기억해 둘 값), message 는 칸에 보여 줄 말이다. */
interface CheckOutcome {
  answer: CheckAnswer | null;
  message: string;
}

/**
 * 비동기 검사를 한 번 묻는다. 서버가 못 닿았거나 제한에 걸리면 answer 없이 돌려준다 —
 * 요청 제한만 칸에 알리고, 통신 실패는 입력을 막지 않는다(제출 때 다시 묻는다).
 */
async function askCheck(check: AsyncCheck, value: string | undefined): Promise<CheckOutcome> {
  try {
    const message = await check(value);
    return { answer: { value: value ?? "", message }, message };
  } catch (error) {
    return { answer: null, message: error instanceof DuplicateCheckLimitedError ? error.message : "" };
  }
}

interface UseFormOptions {
  fields: readonly FieldName[];
  /** true 면 비밀번호는 비었는지만 본다. */
  isLogin?: boolean;
  asyncChecks?: Partial<Record<FieldName, AsyncCheck>>;
  /** 처음 한 번만 채워 둘 값(예: 재설정 단계에서 이미 적은 이메일) */
  initialValues?: FormValues | null;
}

/** 입력 컴포넌트에 그대로 펼쳐 넣는 속성 묶음 */
export interface FieldProps {
  name: FieldName;
  value: string;
  // 인증코드 칸은 숫자만 걸러 { target: { value } } 를 직접 만들어 넘긴다.
  onChange: (event: { target: { value: string } }) => void;
  onBlur: () => void;
  error: string;
  isValid: boolean;
  isChecking: boolean;
  maxLength: number | undefined;
}

interface UseFormResult {
  values: FormValues;
  fieldProps: (name: FieldName) => FieldProps;
  /** 모든 칸을 검사한다. 비동기 검사까지 끝까지 기다리고, 통과했으면 true */
  /** 모든 칸을 검사해 걸린 칸과 이유만 돌려준다. 비어 있으면 통과다. */
  validateAll: () => Promise<FieldErrors>;
  /** 서버가 짚어 준 칸 오류(「이미 가입된 이메일」)를 그 칸에 띄운다. 값이 바뀌면 다시 검사하며 지워진다 */
  setRemoteError: (name: FieldName, message: string) => void;
  /** 비밀번호처럼 남겨 두면 안 되는 칸을 비운다. 비워서 생긴 「입력해 주세요」는 다시 만질 때까지 보이지 않는다. */
  clearFields: (names: readonly FieldName[]) => void;
  /** 한 칸만 밖에서 바꾼다(「혹시 gmail.com 인가요?」를 눌러 고칠 때). */
  setField: (name: FieldName, value: string) => void;
  submitted: boolean;
}

const ASYNC_CHECK_DELAY_MS = 400;

/**
 * 입력칸들의 값·검사·표시 상태를 한곳에서 다룬다.
 * 칸은 한 번 떠나야(blur) 결과를 보여 준다 — 치는 도중엔 혼내지 않고, 떠나면 바로 알려 준다.
 * 제출하면 모든 칸이 결과를 보여 주고, 그 뒤로는 칠 때마다 다시 검사한다.
 */
export function useForm({
  fields,
  isLogin = false,
  asyncChecks = {},
  initialValues = null,
}: UseFormOptions): UseFormResult {
  const [values, setValues] = useState<FormValues>(() => initialValues ?? {});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  // 프로그램이 비운 칸. 사람이 다시 만지기 전까지는 제출 뒤라도 오류를 보이지 않는다.
  const [cleared, setCleared] = useState<Partial<Record<FieldName, boolean>>>({});
  const [remoteErrors, setRemoteErrors] = useState<FieldErrors>({});
  const [checking, setChecking] = useState<Partial<Record<FieldName, boolean>>>({});
  // 늦게 온 이전 요청의 답을 버리기 위한 칸별 최신 요청 번호
  const requestIds = useRef<Partial<Record<FieldName, number>>>({});
  const timers = useRef<Partial<Record<FieldName, number>>>({});
  // 칸별 마지막 서버 답. 제출 때 같은 값이면 다시 묻지 않는다(blur 와 제출이 같은 요청을 두 번 보내지 않게).
  const lastAnswers = useRef<Partial<Record<FieldName, CheckAnswer>>>({});
  // 부모가 묶음을 렌더마다 새로 만들어도 내용은 같다. 처음 받은 것을 쓴다.
  const [blurChecks] = useState(asyncChecks);

  // 동기 검사는 상태로 들지 않고 매번 계산한다. 값과 어긋날 일이 없다.
  const ruleErrors = validateFields(fields, values, { isLogin });

  /** 같은 값에 대한 서버 답이 있으면 그것을, 없을 때만 서버에 묻는다. blur 와 제출이 같은 요청을 두 번 보내지 않게. */
  const askKnownOrServer = useCallback(
    async (name: FieldName, check: AsyncCheck, value: string | undefined): Promise<CheckOutcome> => {
      const known = lastAnswers.current[name];
      if (known && known.value === (value ?? "")) return { answer: known, message: known.message };
      return askCheck(check, value);
    },
    [],
  );

  const runAsyncCheck = useCallback(
    (name: FieldName, nextValues: FormValues) => {
      const check = blurChecks[name];
      if (!check) return;
      window.clearTimeout(timers.current[name]);
      // 형식부터 틀리면 저장소를 두드리지 않고 이전 답도 지운다.
      if (validateFields([name], nextValues, { isLogin })[name]) {
        setRemoteErrors((prev) => ({ ...prev, [name]: "" }));
        setChecking((prev) => ({ ...prev, [name]: false }));
        return;
      }
      const requestId = (requestIds.current[name] ?? 0) + 1;
      requestIds.current[name] = requestId;
      setChecking((prev) => ({ ...prev, [name]: true }));
      timers.current[name] = window.setTimeout(async () => {
        // 기다리는 사이 제출이 같은 값을 먼저 물었으면 그 답을 쓴다.
        const { answer, message } = await askKnownOrServer(name, check, nextValues[name]);
        if (requestIds.current[name] !== requestId) return;
        if (answer) lastAnswers.current[name] = answer;
        setRemoteErrors((prev) => ({ ...prev, [name]: message }));
        setChecking((prev) => ({ ...prev, [name]: false }));
      }, ASYNC_CHECK_DELAY_MS);
    },
    [askKnownOrServer, blurChecks, isLogin],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach((id) => window.clearTimeout(id));
  }, []);

  /** 사람이 칸을 만졌다 — 프로그램이 비워서 감춘 오류를 다시 보여도 된다. */
  const markHandled = (name: FieldName) => {
    if (cleared[name]) setCleared((prev) => ({ ...prev, [name]: false }));
  };

  const handleChange = (name: FieldName) => (event: { target: { value: string } }) => {
    let next = normalizeInput(event.target.value);
    const max = MAX_LENGTH[name];
    if (max) next = next.slice(0, max);
    const nextValues = { ...values, [name]: next };
    setValues(nextValues);
    markHandled(name);
    if (touched[name] || submitted) runAsyncCheck(name, nextValues);
  };

  const handleBlur = (name: FieldName) => () => {
    // 빈 칸을 스치고 지나간 것만으로는 혼내지 않는다.
    if (!values[name] && !submitted) return;
    setTouched((prev) => ({ ...prev, [name]: true }));
    markHandled(name);
    runAsyncCheck(name, values);
  };

  const isShown = (name: FieldName) => Boolean(touched[name] || submitted) && !cleared[name];
  const errorOf = (name: FieldName) => (isShown(name) ? ruleErrors[name] || remoteErrors[name] || "" : "");
  const isValidField = (name: FieldName) =>
    isShown(name) && Boolean(values[name]) && !ruleErrors[name] && !remoteErrors[name] && !checking[name];

  const fieldProps = (name: FieldName): FieldProps => ({
    name,
    value: values[name] ?? "",
    onChange: handleChange(name),
    onBlur: handleBlur(name),
    error: errorOf(name),
    isValid: isValidField(name),
    isChecking: Boolean(checking[name]),
    maxLength: MAX_LENGTH[name],
  });

  const validateAll = async () => {
    setSubmitted(true);
    const syncErrors = validateFields(fields, values, { isLogin });
    const results: FieldErrors = { ...syncErrors };
    for (const name of Object.keys(asyncChecks) as FieldName[]) {
      const check = asyncChecks[name];
      if (!check || !fields.includes(name) || syncErrors[name]) continue;
      // blur 가 이미 같은 값을 물었으면 그 답을 쓴다. 안 물었거나 값이 바뀌었으면 여기서 묻는다(안전망).
      const { answer, message } = await askKnownOrServer(name, check, values[name]);
      if (answer) lastAnswers.current[name] = answer;
      results[name] = message;
      setRemoteErrors((prev) => ({ ...prev, [name]: message }));
    }
    return Object.fromEntries(Object.entries(results).filter(([, message]) => message)) as FieldErrors;
  };

  /** 한 칸을 처음 상태로 — 값·서버 오류를 지우고, 다시 만질 때까지 규칙 오류도 감춘다. */
  const resetField = (name: FieldName) => {
    setValues((prev) => ({ ...prev, [name]: "" }));
    setRemoteErrors((prev) => ({ ...prev, [name]: "" }));
    setCleared((prev) => ({ ...prev, [name]: true }));
  };

  const clearFields = (names: readonly FieldName[]) => names.forEach(resetField);

  const setField = (name: FieldName, value: string) => {
    const nextValues = { ...values, [name]: value };
    setValues(nextValues);
    setTouched((prev) => ({ ...prev, [name]: true }));
    markHandled(name);
    runAsyncCheck(name, nextValues);
  };

  const setRemoteError = (name: FieldName, message: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    markHandled(name);
    setRemoteErrors((prev) => ({ ...prev, [name]: message }));
  };

  return { values, fieldProps, validateAll, clearFields, setField, setRemoteError, submitted };
}

interface CapsLockState {
  isOn: boolean;
  /** 키 이벤트마다 불러 잠금 상태를 읽는다. */
  detect: (event: KeyboardEvent) => void;
  reset: () => void;
}

/** 비밀번호는 가려져 있어 Caps Lock 이 켜진 줄 모르고 계속 틀린다. 키를 누를 때마다 확인한다. */
export function useCapsLock(): CapsLockState {
  const [isOn, setIsOn] = useState(false);
  const detect = (event: KeyboardEvent) => {
    if (typeof event.getModifierState === "function") setIsOn(event.getModifierState("CapsLock"));
  };
  return { isOn, detect, reset: () => setIsOn(false) };
}

/**
 * 한글 조합 중에 누른 키인가. 조합 중의 Enter 는 글자 확정이라 제출로 치면 두 번 보낸다.
 * Safari 는 조합을 먼저 끝내고 keydown 을 보내 isComposing 이 false 라 keyCode 229 로 알아본다.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

/** Enter 로 제출한다. 한글 조합 중의 Enter 는 무시한다. */
export function submitOnEnter(submit: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" && !isComposing(event)) {
      event.preventDefault();
      submit();
    }
  };
}

/**
 * 제출이 끝날 때까지 다시 누르지 못하게 잠근다.
 * isSubmitting 상태는 다음 렌더에야 바뀌어 빠른 두 번째 누름을 못 막으므로 잠금은 ref 로 건다.
 */
export function useSubmitLock() {
  const lockedRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setIsSubmitting(true);
    try {
      await task();
    } finally {
      lockedRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, run };
}

// 봇으로 보이면 어느 칸에서 걸렸는지는 알려 주지 않는다.
export const BOT_SUSPECTED_MESSAGE = "자동 입력으로 보여 막았습니다. 새로고침한 뒤 직접 입력해 주세요.";
// 봇은 화면이 뜨자마자 모든 칸을 채워 제출한다.
const MIN_FILL_TIME_MS = 1500;

/** 봇 막기: 숨은 칸(honeypot)이 채워졌거나 화면이 뜨고 너무 빨리 제출했는지 본다. */
export function useBotGuard() {
  const [honeypot, setHoneypot] = useState("");
  const [mountedAt] = useState(() => Date.now());
  const isLikelyBot = () => Boolean(honeypot) || Date.now() - mountedAt < MIN_FILL_TIME_MS;
  return { honeypot, setHoneypot, isLikelyBot };
}

const CONSENT_LABELS: Readonly<Record<ConsentKind, string>> = {
  terms: "이용약관",
  privacyCollection: "개인정보 수집·이용",
  over14: "만 14세 이상 확인",
};

/** 안 켠 항목을 이름으로 알려 준다. 다 켰으면 "" */
function consentProblem(consents: Consents): string {
  const missing = (Object.keys(CONSENT_LABELS) as ConsentKind[]).filter((kind) => !consents[kind]);
  return missing.length ? `${missing.map((kind) => CONSENT_LABELS[kind]).join(", ")}에 체크해 주세요.` : "";
}

const FIELD_LABELS: Readonly<Partial<Record<FieldName, string>>> = {
  nickname: "닉네임",
  region: "지역",
  email: "이메일",
  password: "비밀번호",
  passwordConfirm: "비밀번호 확인",
};

/** 제출 안내. 지켜보는 입력이 바뀌면 저절로 사라진다 — 이미 고친 칸이 아직 틀렸다고 남지 않게. */
export function useInputAlert(watched: readonly unknown[]) {
  const [alert, setAlert] = useState({ message: "", watched });
  const isCurrent = alert.watched.length === watched.length && alert.watched.every((v, i) => v === watched[i]);
  const setMessage = (message: string) => setAlert({ message, watched });
  return [isCurrent ? alert.message : "", setMessage] as const;
}

/** 안내가 뜰 때 화면 밖이면 보이는 곳까지 옮긴다. 안내 칸의 ref 로 쓴다. */
export function revealAlert(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "nearest" });
}

/** 제출이 막힌 이유를 칸 이름과 함께 한 번에 보여 줄 글. 막힌 게 없으면 "" */
export function describeBlockedSubmit(action: string, errors: FieldErrors, consentError = ""): string {
  const reasons = Object.entries(errors).map(
    ([name, message]) => `· ${FIELD_LABELS[name as FieldName] ?? name}: ${message}`,
  );
  if (consentError) reasons.push(`· 약관 동의: ${consentError}`);
  return reasons.length ? [`${action}을 완료하지 못했습니다. 아래 내용을 확인해 주세요.`, ...reasons].join("\n") : "";
}

/**
 * 「전체」는 저장하지 않고 세 항목이 다 켜졌는지로 정한다. 이용약관도 본인이 직접 켠 항목이어야 동의로 남는다.
 * 처리방침은 공개 문서라 동의 대상은 「수집·이용」이고, 만 14세 미만은 법정대리인 동의가 필요해 나이를 따로 받는다.
 */
export type Consents = Record<ConsentKind, boolean>;

export type ConsentChoice = "all" | ConsentKind;

/** 가입 동의 체크 상태와 「필수 항목」 오류. */
export function useConsents() {
  // 개인정보 보호법은 동의를 본인이 직접 표시하게 한다. 미리 켜 두지 않는다.
  const [consents, setConsents] = useState<Consents>({ terms: false, privacyCollection: false, over14: false });
  const [error, setError] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const allAgreed = consents.terms && consents.privacyCollection && consents.over14;

  const update = (which: ConsentChoice, checked: boolean) => {
    const next: Consents =
      which === "all"
        ? { terms: checked, privacyCollection: checked, over14: checked }
        : { ...consents, [which]: checked };
    setConsents(next);
    // 한 번 혼난 뒤에는 다 켜는 순간 바로 풀어 준다.
    if (hasSubmitted) setError(consentProblem(next));
  };

  /** 제출 단추를 누른 순간 부른다. */
  const markSubmitted = () => setHasSubmitted(true);

  /** 필수 동의를 검사해 오류를 띄우고 통과 여부를 돌려준다. */
  const check = () => {
    setError(consentProblem(consents));
    return allAgreed;
  };

  return { consents, allAgreed, error, problem: consentProblem(consents), update, markSubmitted, check };
}
