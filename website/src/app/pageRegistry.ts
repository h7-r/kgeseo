import { createElement, lazy, useState, type ComponentType } from "react";

import { ROUTES } from "@/navigation/routes";

type PageModule<P> = { default: ComponentType<P> };

/** lazy 페이지에 코드를 미리 받아 두는 preload() 를 붙인 것. */
export type PreloadablePage<P extends object> = ComponentType<P> & {
  preload: () => Promise<PageModule<P>>;
};

/**
 * React.lazy 는 코드를 이미 받아 둔 뒤에도 처음 그릴 때 한 번은 꼭 멈춰(Suspense) 전환이 한 박자 늦어진다.
 * 받아 둔 모듈은 기억해 두었다가 lazy 를 거치지 않고 바로 그린다.
 */
function preloadable<P extends object>(importer: () => Promise<PageModule<P>>): PreloadablePage<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<PageModule<P>> | null = null;

  const preload = () => {
    if (!pending) {
      pending = importer().then((module) => {
        loaded = module.default;
        return module;
      });
      // 잠깐 끊긴 망 등으로 실패하면 다음에 다시 받을 수 있게 비운다.
      pending.catch(() => {
        pending = null;
      });
    }
    return pending;
  };

  const LazyPage: ComponentType<P> = lazy(preload);

  function Page(props: P) {
    // 처음 그릴 때 한 번만 고른다. 그리는 도중 종류가 바뀌면 React 가 화면을 새로 만들어 입력값이 날아간다.
    const [Component] = useState(() => loaded ?? LazyPage);
    return createElement(Component, props);
  }

  return Object.assign(Page, { preload });
}

export const AuthPage = preloadable(() => import("@/pages/AuthPage"));
export const AboutPage = preloadable(() => import("@/pages/AboutPage"));
export const TermsPage = preloadable(() => import("@/pages/TermsPage"));
export const SupportPage = preloadable(() => import("@/pages/SupportPage"));
export const PricingPage = preloadable(() => import("@/pages/PricingPage"));
export const MyPage = preloadable(() => import("@/pages/MyPage"));
export const MediaPage = preloadable(() => import("@/pages/MediaPage"));
export const SearchPage = preloadable(() => import("@/pages/SearchPage"));

interface Preloadable {
  preload: () => Promise<unknown>;
}

// 홈("/")은 처음부터 들어 있어 여기 없다.
const PAGE_BY_PATH: Readonly<Record<string, Preloadable | undefined>> = {
  [ROUTES.about]: AboutPage,
  [ROUTES.terms]: TermsPage,
  [ROUTES.support]: SupportPage,
  [ROUTES.pricing]: PricingPage,
  [ROUTES.myPage]: MyPage,
  [ROUTES.media]: MediaPage,
  [ROUTES.search]: SearchPage,
  [ROUTES.login]: AuthPage,
  [ROUTES.signup]: AuthPage,
  [ROUTES.forgotPassword]: AuthPage,
  [ROUTES.verifyCode]: AuthPage,
  [ROUTES.resetPassword]: AuthPage,
};

/** 이 주소의 화면 코드를 미리 받는다. 이미 받았거나 모르는 주소면 아무 일도 없다. */
export function preloadRoute(path: string): Promise<void> {
  const page = PAGE_BY_PATH[path.split("?")[0]];
  return page
    ? page.preload().then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

/** 첫 화면이 다 뜬 뒤 한가할 때 전부 미리 받는다. */
export function preloadAllPages() {
  for (const page of [AuthPage, AboutPage, TermsPage, SupportPage, PricingPage, MyPage, MediaPage, SearchPage]) {
    page.preload().catch(() => {});
  }
}
