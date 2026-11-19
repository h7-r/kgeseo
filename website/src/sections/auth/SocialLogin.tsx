import { useState } from "react";

import { FONT } from "@/lib/style";
import type { OnboardingRequired } from "@/services/account/socialAuthApi";
import type { SessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import GoogleButton from "./GoogleButton";
import NaverButton from "./NaverButton";

interface SocialLoginProps {
  /** 구글은 이 화면에서 끝나므로 로그인한 사용자를 넘긴다. 네이버는 콜백 화면이 맡는다. */
  onSignedIn: (user: SessionUser) => void;
  /** 처음 온 구글 계정. 로그인시키지 않고 가입 화면으로 넘긴다. */
  onOnboardingRequired: (onboarding: OnboardingRequired) => void;
  /** 네이버는 화면을 떠났다 돌아오므로 마친 뒤 갈 곳을 미리 넘긴다. 없으면 기본 경로로 간다. */
  returnTo?: string | null;
}

/** 키(.env)가 없으면 창을 띄우지 않고 그 자리에서 까닭을 알려 준다. */
export default function SocialLogin({ onSignedIn, onOnboardingRequired, returnTo = null }: SocialLoginProps) {
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", width: "100%" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "center" }}>
        <GoogleButton
          onBusyChange={(busy) => {
            setIsBusy(busy);
            if (busy) setMessage("");
          }}
          onResult={(result) => {
            if (result.kind === "signedIn") onSignedIn(result.user);
            else onOnboardingRequired(result.onboarding);
          }}
          onError={setMessage}
        />
        <NaverButton
          returnTo={returnTo}
          action="로그인"
          onMessage={(next) => {
            // 구글 창이 떠 있는 동안은 네이버로 떠나지 않는다.
            if (!isBusy) setMessage(next);
          }}
        />
      </div>
      {message && (
        <span style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textMuted, textAlign: "center" }}>
          {message}
        </span>
      )}
    </div>
  );
}

