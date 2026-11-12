// 본편 엔트리 — 지금은 PC(키보드 · 마우스)에서만 연다(미르 11/11). 휴대폰 · 태블릿이면 게임 모듈 · 에셋을 받기 전에 안내만 그린다.
// 판정 · 문구는 shared/playDevicePolicy(웹사이트 · 나주와 같다). 로그인하지 않았으면 로그인 안내(shared/playLoginGate, 미르 11/11).
// 통과하면 boot.tsx(예전 main.tsx)를 불러온다.
import { apiOrigin } from "../shared/deploymentUrls";
import { isPlayDeviceBlocked, renderPcOnlyNotice } from "../shared/playDevicePolicy";
import { isLoginGateEnabled, passLoginGate } from "../shared/playLoginGate";
import { canCreateWebGl, showGraphicsFailure, watchGraphicsFailure } from "../shared/graphicsFailure";
import { startMeasureProbe } from "../shared/measureProbe";
import { LOW_QUALITY_TEXTURE_MAX, capDecodedImages } from "../shared/lowQualityDecode";
import { resolveQuality } from "../shared/qualityChoice";
import { askQualityOnce } from "../shared/qualityChooser";
import { bootBeta } from "./beta/betaBoot";
import { SITE_URL } from "./lib/siteUrl";

// 실기기 측정기(?measure) — 게임 모듈이 WebGL 을 열기 전에 건다. 표시가 없으면 아무것도 하지 않는다
startMeasureProbe("main");

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다");

// 우회(?device=any)는 개발 서버 · 검수 빌드(VITE_ALLOW_DEVICE_OVERRIDE=1)에서만
const isBlocked = isPlayDeviceBlocked({ allowOverride: import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEVICE_OVERRIDE === "1" });
// 베타 기록(로그인한 계정 · 참여 코드가 있을 때만 — 로그인 안 했으면 /me 확인 뒤 스스로 멈춘다). 막힌 기기도 「열었다」는 남긴다
bootBeta("main", { blocked: isBlocked });
if (isBlocked) {
  renderPcOnlyNotice(root, SITE_URL);
} else if (!canCreateWebGl()) {
  // 그래픽 연결을 아예 못 만든다(브라우저가 그래픽 가속을 꺼 둔 상태 등) — 게임을 받기 전에 안내한다
  showGraphicsFailure("unavailable");
} else {
  // 끊김 안내는 본편 화면(CrashOverlays)이 맡는다 — 여기서는 연결 생성 실패만 지켜본다
  watchGraphicsFailure({ lost: false });
  void passLoginGate(root, loginGateOptions()).then((isPassed) => {
    // 처음이면 그래픽 품질을 먼저 묻는다 — 3D 를 받기 전에(고른 값이 바로 적용된다)
    if (isPassed)
      void askQualityOnce({ dev: import.meta.env.DEV }).then(() => {
        // 저사양 모드 — 모형 속 큰 그림을 풀 때 줄인다. 게임 모듈이 그림을 읽기 전에 건다
        if (resolveQuality().mode === "low") capDecodedImages(LOW_QUALITY_TEXTURE_MAX);
        return import("./boot");
      });
  });
}

function loginGateOptions() {
  const env = import.meta.env;
  let origin: string;
  try {
    origin = apiOrigin(env.VITE_API_ORIGIN, env.PROD);
  } catch {
    origin = "";
  }
  return {
    enabled: isLoginGateEnabled({ prod: env.PROD, requireLogin: env.VITE_REQUIRE_LOGIN, allowGuestPlay: env.VITE_ALLOW_GUEST_PLAY }),
    apiOrigin: origin,
    siteUrl: SITE_URL,
  };
}
