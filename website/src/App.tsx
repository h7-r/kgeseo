import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react";
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
import { useHeroCovering } from "@/app/siteState";
import { useIsScrolling, useReadProgress } from "@/hooks/motion";
import GameTransition from "@/layout/GameTransition";
import HeaderLayer from "@/layout/HeaderLayer";
import VideoModal from "@/layout/videoPlayer/VideoModal";
import { BACKDROP_ORIGIN } from "@/lib/layout";
import { dispatchPageChange, scrollToTopSilently } from "@/lib/pageEvents";
import { ROUTES, launchGame } from "@/navigation/routes";
import ErrorPage from "@/pages/ErrorPage";
import HomePage from "@/pages/HomePage";
import SocialCallbackPage from "@/pages/SocialCallbackPage";
import { getSessionUser, useSessionUser } from "@/services/session";
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
          <Route path={ROUTES.socialCallback} element={<SocialCallbackPage />} />
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
  return <div ref={barRef} className="read-progress-bar" aria-hidden="true" style={{ transform: "scaleX(0)" }} />;
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

/**
 * 화면 코드를 못 받거나 그리다 터지면 빈 화면 대신 500 화면을 보여 준다.
 * 주소마다 새로 만들어지는 칸 안에 두어, 다른 화면으로 가면 오류 상태가 함께 걷힌다.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    return this.state.hasError ? <ErrorPage kind="500" /> : this.props.children;
  }
}

/*
 * background-position · stroke-dashoffset · conic-gradient 각도를 돌리는 끝없는 장식은
 * 합성만으로 안 돼 매 프레임 다시 칠한다. 화면 밖(여유 200px)에 있을 때만 멈춘다.
 */
const ANIMATED_SELECTOR =
  ".u-shine-text, .divider-arc__glow, .heartbeat-line__pulse, .heartbeat-line__glow, .layered-rings__ring, .u-rotating-border";

/** root 안의 끝없는 장식 애니메이션이 화면 밖이면 .is-paused 를 붙인다. resetKey 가 바뀌면 다시 건다. */
function usePauseOffscreen(rootRef: RefObject<HTMLElement | null>, resetKey?: unknown): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.classList.toggle("is-paused", !entry.isIntersecting);
      },
      { rootMargin: "200px 0px" },
    );
    const seen = new WeakSet<Element>();
    const scan = () => {
      for (const el of root.querySelectorAll(ANIMATED_SELECTOR)) {
        if (seen.has(el)) continue;
        seen.add(el);
        observer.observe(el);
      }
    };
    scan();
    // lazy 화면처럼 늦게 붙는 구간도 잡는다.
    const mutationObserver = new MutationObserver(scan);
    mutationObserver.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [rootRef, resetKey]);
}
