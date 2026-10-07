import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { MAX_LENGTH, normalizeInput, validateFields } from "@/lib/validation";
import type { FieldErrors, FieldName, FormValues } from "@/lib/validation";

/** 저장소에 물어봐야 아는 검사(이메일·닉네임 중복). 통과하면 "", 아니면 보여 줄 말 */
export type AsyncCheck = (value: string | undefined) => Promise<string>;

export interface UseFormOptions {
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

export interface UseFormResult {
  values: FormValues;
  fieldProps: (name: FieldName) => FieldProps;
  /** 모든 칸을 검사한다. 비동기 검사까지 끝까지 기다리고, 통과했으면 true */
  validateAll: () => Promise<boolean>;
  /** 비밀번호처럼 남겨 두면 안 되는 칸을 비운다. */
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
  const [remoteErrors, setRemoteErrors] = useState<FieldErrors>({});
  const [checking, setChecking] = useState<Partial<Record<FieldName, boolean>>>({});
  // 늦게 온 이전 요청의 답을 버리기 위한 칸별 최신 요청 번호
  const requestIds = useRef<Partial<Record<FieldName, number>>>({});
  const timers = useRef<Partial<Record<FieldName, number>>>({});

  // 동기 검사는 상태로 들지 않고 매번 계산한다. 값과 어긋날 일이 없다.
  const ruleErrors = validateFields(fields, values, { isLogin });

  const runAsyncCheck = useCallback(
    (name: FieldName, nextValues: FormValues) => {
      const check = asyncChecks[name];
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
        let message = "";
        try {
          message = await check(nextValues[name]);
        } catch {
          // 저장소가 막혀도 입력은 이어 가야 한다. 최종 판단은 제출 때 한다.
          message = "";
        }
        if (requestIds.current[name] !== requestId) return;
        setRemoteErrors((prev) => ({ ...prev, [name]: message }));
        setChecking((prev) => ({ ...prev, [name]: false }));
      }, ASYNC_CHECK_DELAY_MS);
    },
    // 부모가 asyncChecks 를 매번 새로 만들어도 내용은 같아서 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLogin],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach((id) => window.clearTimeout(id));
  }, []);

  const handleChange = (name: FieldName) => (event: { target: { value: string } }) => {
    let next = normalizeInput(event.target.value);
    const max = MAX_LENGTH[name];
    if (max) next = next.slice(0, max);
    const nextValues = { ...values, [name]: next };
    setValues(nextValues);
    if (touched[name] || submitted) runAsyncCheck(name, nextValues);
  };

  const handleBlur = (name: FieldName) => () => {
    // 빈 칸을 스치고 지나간 것만으로는 혼내지 않는다.
    if (!values[name] && !submitted) return;
    setTouched((prev) => ({ ...prev, [name]: true }));
    runAsyncCheck(name, values);
  };

  const isShown = (name: FieldName) => Boolean(touched[name] || submitted);
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
      try {
        results[name] = await check(values[name]);
      } catch {
        results[name] = "";
      }
      setRemoteErrors((prev) => ({ ...prev, [name]: results[name] }));
    }
    return Object.values(results).every((message) => !message);
  };

  const clearFields = (names: readonly FieldName[]) =>
    setValues((prev) => {
      const next = { ...prev };
      for (const name of names) next[name] = "";
      return next;
    });

  const setField = (name: FieldName, value: string) => {
    const nextValues = { ...values, [name]: value };
    setValues(nextValues);
    setTouched((prev) => ({ ...prev, [name]: true }));
    runAsyncCheck(name, nextValues);
  };

  return { values, fieldProps, validateAll, clearFields, setField, submitted };
}

export interface CapsLockState {
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
