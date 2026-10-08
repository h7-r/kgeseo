// 이름 입력과 중복확인. 입력이 바뀌면 진행 중인 확인을 버리고 처음부터 다시 확인받는다.
import { useRef, useState } from "react";

import { countCharacters, normalizeName, validateNameFormat, type CheckName, type NameRules } from "./nameRules";

export type NameStatusKind =
  "idle" | "checking" | "available" | "taken" | "forbidden" | "failed" | "notConnected" | "format";

interface NameStatus {
  kind: NameStatusKind;
  /** 확인을 마친 이름 — 입력이 바뀌면 다시 확인해야 한다 */
  checkedName: string | null;
  message?: string;
}

const NAME_STATUS_TEXT: Partial<Record<NameStatusKind, string>> = {
  idle: "이름 중복확인을 진행해 주세요.",
  checking: "확인하고 있습니다…",
  available: "사용할 수 있는 이름입니다.",
  taken: "이미 사용 중인 이름입니다. 다른 이름을 입력해 주세요.",
  forbidden: "사용할 수 없는 이름입니다. 다른 이름을 입력해 주세요.",
  failed: "이름을 확인하지 못했습니다. 다시 시도해 주세요.",
  notConnected: "이름 확인 기능이 연결되지 않았습니다.",
};

export function useNameCheck(initialName: string, rules: NameRules, checkName: CheckName | null) {
  const [name, setName] = useState(initialName);
  const [isComposing, setIsComposing] = useState(false);
  const [status, setStatus] = useState<NameStatus>({ kind: "idle", checkedName: null });
  const checkSerial = useRef(0);
  const checkAbort = useRef<AbortController | null>(null);

  const format = validateNameFormat(name, rules);
  const normalizedName = normalizeName(name);
  const isConfirmed = status.kind === "available" && status.checkedName === normalizedName && normalizedName.length > 0;
  const statusMessage =
    status.kind === "format" ? status.message : (status.message ?? NAME_STATUS_TEXT[status.kind] ?? "");
  // 확인 전에는 형식 오류를 먼저 알려 준다
  const message = status.kind === "idle" && !format.ok && !format.isEmpty ? format.message : statusMessage;

  const changeName = (value: string) => {
    setName(value);
    checkSerial.current += 1;
    checkAbort.current?.abort();
    checkAbort.current = null;
    setStatus({ kind: "idle", checkedName: null });
  };

  const checkDuplicate = async () => {
    if (isComposing) return;
    const candidate = normalizeName(name);
    const formatResult = validateNameFormat(candidate, rules);
    if (!formatResult.ok) {
      setStatus({ kind: "format", message: formatResult.message, checkedName: null });
      return;
    }
    if (typeof checkName !== "function") {
      setStatus({ kind: "notConnected", checkedName: null });
      return;
    }
    checkAbort.current?.abort();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    checkAbort.current = controller;
    checkSerial.current += 1;
    const serial = checkSerial.current;
    setStatus({ kind: "checking", checkedName: null });
    try {
      const answer = await checkName(candidate, { signal: controller?.signal });
      // 그 사이 입력이 바뀌었으면 앞 답은 버린다
      if (serial !== checkSerial.current) return;
      const answerStatus = answer?.status;
      if (answerStatus === "available") setStatus({ kind: "available", checkedName: candidate });
      else if (answerStatus === "taken") setStatus({ kind: "taken", message: answer.message, checkedName: null });
      else if (answerStatus === "invalid") setStatus({ kind: "forbidden", message: answer.message, checkedName: null });
      else setStatus({ kind: "failed", checkedName: null });
    } catch {
      if (serial !== checkSerial.current) return;
      setStatus({ kind: "failed", checkedName: null });
    }
  };

  /** 저장하다 이름이 이미 쓰였다고 돌아왔을 때 */
  const markTaken = (takenMessage: string | undefined) => {
    setStatus({ kind: "taken", message: takenMessage, checkedName: null });
  };

  return {
    name,
    normalizedName,
    characterCount: countCharacters(name),
    isComposing,
    setIsComposing,
    statusKind: status.kind,
    message,
    isConfirmed,
    changeName,
    checkDuplicate,
    markTaken,
  };
}
