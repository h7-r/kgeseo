import { Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";

import {
  AboutPage,
  AuthPage,
  MediaPage,
  MyPage,
  PricingPage,
  SearchPage,
  SupportPage,
  TermsPage,
} from "@/app/pageRegistry";
import RouteErrorBoundary from "@/app/RouteErrorBoundary";
import { useIsScrolling, useReadProgress } from "@/hooks/motion";
import { usePauseOffscreen } from "@/hooks/usePauseOffscreen";
import GameTransition from "@/layout/GameTransition";
import HeaderLayer from "@/layout/HeaderLayer";
import VideoModal from "@/layout/VideoModal";
import { dispatchPageChange, scrollToTopSilently } from "@/lib/pageEvents";
import { ROUTES, launchGame } from "@/navigation/routes";
import ErrorPage from "@/pages/ErrorPage";
import HomePage from "@/pages/home/HomePage";
import { getSessionUser, useSessionUser } from "@/services/session";
import { useHeroCovering } from "@/state/heroCover";
import { BACKDROP_ORIGIN } from "@/three/backdropOrigin";
import SceneSlot from "@/three/SceneSlot";

export default function App() {
  return (
    <>
      {/* 쪽 전환 바깥에 둬야 화면을 옮겨도 3D 배경이 다시 만들어지지 않는다. */}
      <SiteBackdrop />
      <ReadProgressBar />
      <HeaderLayer />
      <VideoModal />
      <GameTransition />
      <PageFrame>
        <Routes>
          <Route path={ROUTES.home} element={<HomePage />} />
          <Route path={ROUTES.login} element={<AuthPage mode="login" />} />
          <Route path={ROUTES.signup} element={<AuthPage mode="signup" />} />
          <Route path={ROUTES.forgotPassword} element={<AuthPage mode="forgotPassword" />} />
          <Route path={ROUTES.verifyCode} element={<AuthPage mode="verifyCode" />} />
          <Route path={ROUTES.resetPassword} element={<AuthPage mode="resetPassword" />} />
          <Route path={ROUTES.about} element={<AboutPage />} />
          <Route path={ROUTES.terms} element={<TermsPage />} />
          <Route path={ROUTES.support} element={<SupportPage />} />
          <Route path={ROUTES.pricing} element={<PricingPage />} />
          <Route
            path={ROUTES.myPage}
            element={
              <RequireSession>
                <MyPage />
              </RequireSession>
            }
          />
          <Route path={ROUTES.media} element={<MediaPage />} />
          <Route path={ROUTES.search} element={<SearchPage />} />
          <Route path={ROUTES.play} element={<PlayRedirect />} />
          <Route path={ROUTES.forbidden} element={<ErrorPage kind="403" />} />
          <Route path={ROUTES.serverError} element={<ErrorPage kind="500" />} />
          <Route path={ROUTES.maintenance} element={<ErrorPage kind="503" />} />
          <Route path={ROUTES.offline} element={<ErrorPage kind="offline" />} />
          <Route path="*" element={<ErrorPage kind="404" />} />
        </Routes>
      </PageFrame>
    </>
  );
}

/** 주소로 바로 들어온 사람을 게임 또는 로그인으로 보낸다. 로그인 뒤에는 게임이 아니라 사이트로 돌아온다. */
function PlayRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    // replace: 뒤로 가기로 이 중간 자리에 돌아와 다시 튕기지 않게.
    if (getSessionUser()) launchGame((path) => navigate(path, { replace: true }));
    else navigate(ROUTES.login, { replace: true });
  }, [navigate]);

  return <p style={{ padding: "160px 24px", textAlign: "center", color: "#8fa0c4" }}>게임으로 이동하는 중…</p>;
}

/** 로그인해야 들어가는 화면. 말없이 튕기지 않고 403 화면으로 이유를 알린다. 보안이 아니라 흐름용 잠금이다. */
function RequireSession({ children }: { children: ReactNode }) {
  const user = useSessionUser();
  return user ? children : <ErrorPage kind="403" />;
}

const BACKDROP_SHADE =
  `radial-gradient(150% 112% at ${Math.round(BACKDROP_ORIGIN.x * 100)}% ${Math.round(BACKDROP_ORIGIN.y * 100)}%,` +
  " rgba(1,4,10,0) 0%, rgba(1,4,10,0.05) 34%, rgba(1,4,10,0.6) 70%, rgba(1,4,10,1) 100%)";

/**
 * 스크롤하는 동안에만 보이는 3D 공간. 멈추면 사라지고 렌더도 멈춘다.
 * 소실점에서 멀어질수록 바탕색 덮개로 지워 본문 자리를 잔잔하게 둔다.
 */
function SiteBackdrop() {
  const isScrolling = useIsScrolling(900);
  const heroCovering = useHeroCovering();

  useEffect(() => {
    document.documentElement.classList.toggle("is-scrolling", isScrolling);
  }, [isScrolling]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: isScrolling ? 1 : 0,
        // 나타날 땐 빠르게, 사라질 땐 천천히.
        transition: isScrolling ? "opacity .22s ease-out" : "opacity .7s ease-in",
      }}
    >
      <SceneSlot scene="deepSpace" deferred active={isScrolling && !heroCovering} />
      {/* mask-image 는 WebGL 층마다 렌더 패스를 늘린다. 뒤가 단색이라 바탕색 덮개로 결과가 같다. */}
      <div style={{ position: "absolute", inset: 0, background: BACKDROP_SHADE }} />
    </div>
  );
}

function ReadProgressBar() {
  const barRef = useReadProgress();
  return <div ref={barRef} className="read-progress" aria-hidden="true" style={{ transform: "scaleX(0)" }} />;
}

/** 주소가 바뀌면 칸을 새로 만들고 맨 위에서 시작한다. */
function PageFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const frameRef = useRef<HTMLDivElement>(null);
  usePauseOffscreen(frameRef, pathname);

  // 그리기 전에 올려야 새 페이지가 이전 스크롤 자리로 한 번 그려졌다 튀지 않는다.
  useLayoutEffect(() => {
    scrollToTopSilently();
    dispatchPageChange();
  }, [pathname]);

  return (
    <div key={pathname} ref={frameRef} className="page-frame">
      <RouteErrorBoundary>
        <Suspense fallback={null}>{children}</Suspense>
      </RouteErrorBoundary>
    </div>
  );
}
