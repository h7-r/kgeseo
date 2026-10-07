import { useState } from "react";

const CONSENT_REQUIRED_MESSAGE = "필수 항목에 모두 동의해주세요.";

/**
 * 「전체」(terms)는 아래 두 항목이 다 켜졌는지로 정한다.
 * 처리방침은 공개 문서라 동의 대상은 「수집·이용」이고, 만 14세 미만은 법정대리인 동의가 필요해 나이를 따로 받는다.
 */
export interface Consents {
  terms: boolean;
  privacyCollection: boolean;
  over14: boolean;
}

export type ConsentChoice = "all" | "privacyCollection" | "over14";

/** 가입 동의 체크 상태와 「필수 항목」 오류. */
export function useConsents() {
  // 개인정보 보호법은 동의를 본인이 직접 표시하게 한다. 미리 켜 두지 않는다.
  const [consents, setConsents] = useState<Consents>({ terms: false, privacyCollection: false, over14: false });
  const [error, setError] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const allAgreed = consents.privacyCollection && consents.over14;

  const update = (which: ConsentChoice, checked: boolean) => {
    const next: Consents =
      which === "all"
        ? { terms: checked, privacyCollection: checked, over14: checked }
        : { ...consents, [which]: checked };
    next.terms = next.privacyCollection && next.over14;
    setConsents(next);
    // 한 번 혼난 뒤에는 다 켜는 순간 바로 풀어 준다.
    if (hasSubmitted) setError(next.terms ? "" : CONSENT_REQUIRED_MESSAGE);
  };

  /** 제출 단추를 누른 순간 부른다. */
  const markSubmitted = () => setHasSubmitted(true);

  /** 필수 동의를 검사해 오류를 띄우고 통과 여부를 돌려준다. */
  const check = () => {
    setError(allAgreed ? "" : CONSENT_REQUIRED_MESSAGE);
    return allAgreed;
  };

  return { consents, allAgreed, error, update, markSubmitted, check };
}
