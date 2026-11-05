import { useEffect, useRef, useState, type CSSProperties } from "react";

import googleIcon from "@/assets/images/imgComponent12.svg";
import { mountGoogleButton, type GoogleButtonHandlers } from "@/services/account/googleAuth";
import { COLOR } from "@/styles/tokens";

const BUTTON_SIZE = "44px";
// 구글이 이 주소를 거절하면 단추가 크기 0 으로 숨는다. 이만큼 기다려도 안 보이면 까닭을 알린다.
const BUTTON_APPEAR_TIMEOUT_MS = 8000;
const BUTTON_CHECK_INTERVAL_MS = 500;
const NOT_ALLOWED_MESSAGE = () =>
  `Google 로그인 단추를 불러오지 못했습니다. 이 주소(${window.location.origin})가 Google 콘솔에 등록되어 있는지 확인해 주세요.`;

/** 구글 공식 단추. 키가 없거나 스크립트를 못 받으면 같은 자리의 단추가 누를 때 까닭을 알려 준다. */
export default function GoogleButton({ onBusyChange, onResult, onError }: GoogleButtonHandlers) {
  const slotRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef<GoogleButtonHandlers>({ onBusyChange, onResult, onError });
  const [unavailableReason, setUnavailableReason] = useState("");
  const [isButtonHidden, setIsButtonHidden] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    handlersRef.current = { onBusyChange, onResult, onError };
  });

  useEffect(() => {
    let unmount: (() => void) | undefined;
    let isGone = false;
    const slot = slotRef.current;
    if (!slot) return;
    let appearCheck: ReturnType<typeof setInterval> | undefined;
    mountGoogleButton(slot, {
      onBusyChange: (busy) => {
        setIsBusy(busy);
        handlersRef.current.onBusyChange(busy);
      },
      onResult: (result) => handlersRef.current.onResult(result),
      onError: (message) => handlersRef.current.onError(message),
    })
      .then((finish) => {
        if (isGone) {
          finish();
          return;
        }
        unmount = finish;
        // 스크립트를 받느라 걸린 시간은 빼고 단추를 그린 뒤부터 잰다. 늦게라도 나타나면 안내를 거둔다.
        const startedAt = Date.now();
        appearCheck = setInterval(() => {
          const isVisible = Boolean(slot.querySelector("iframe")?.getBoundingClientRect().width);
          if (isVisible) {
            clearInterval(appearCheck);
            setIsButtonHidden(false);
          } else if (Date.now() - startedAt > BUTTON_APPEAR_TIMEOUT_MS) {
            setIsButtonHidden(true);
          }
        }, BUTTON_CHECK_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (!isGone)
          setUnavailableReason((error instanceof Error && error.message) || "Google 로그인을 쓸 수 없습니다.");
      });
    return () => {
      isGone = true;
      clearInterval(appearCheck);
      unmount?.();
    };
  }, []);

  const fallback = (
    <button
      type="button"
      className="button"
      style={fallbackStyle}
      onClick={() => onError(unavailableReason || NOT_ALLOWED_MESSAGE())}
      title="Google 계정으로 계속하기"
      aria-label="Google 계정으로 계속하기"
    >
      <img src={googleIcon} alt="Google" style={{ width: "18px", height: "18px", display: "block" }} />
    </button>
  );
  if (unavailableReason) return fallback;
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div
        ref={slotRef}
        aria-busy={isBusy}
        style={{ ...slotStyle, ...(isBusy ? busyStyle : {}) }}
        data-testid="google-button"
      />
      {isButtonHidden && <div style={{ position: "absolute", inset: 0 }}>{fallback}</div>}
    </div>
  );
}

const slotStyle: CSSProperties = {
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const busyStyle: CSSProperties = { opacity: 0.65, pointerEvents: "none" };
const fallbackStyle: CSSProperties = {
  ...slotStyle,
  borderRadius: "22px",
  border: "1px solid rgba(50,82,150,0.18)",
  background: COLOR.white,
  boxSizing: "border-box",
  cursor: "pointer",
};
