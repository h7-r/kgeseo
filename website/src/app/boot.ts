import { OPENING_FILM } from "@/data/videos";
import { runWhenIdle } from "@/lib/idle";
import { warmUpImages } from "@/lib/imageWarmup";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";
import { getSessionUser } from "@/services/session";

import { preloadAllPages } from "./pageRegistry";

function onPageLoad(callback: () => void) {
  if (document.readyState === "complete") callback();
  else window.addEventListener("load", callback, { once: true });
}

const warmUpImagesSoon = () => window.setTimeout(warmUpImages, 800);

// 로그인한 사람만 게임 전환 영상의 첫 장면을 미리 받는다. 영상 본편은 누를 때 흘려 받는다.
let openingPosterPrefetched = false;
function prefetchOpeningPoster() {
  if (openingPosterPrefetched || !getSessionUser()) return;
  openingPosterPrefetched = true;
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = OPENING_FILM.poster;
  document.head.appendChild(link);
}
const prefetchOpeningPosterWhenIdle = () => runWhenIdle(prefetchOpeningPoster, 6000, 3000);

/** 첫 렌더 전에 한 번 부른다. 첫 쪽 바뀜 알림보다 먼저 듣고 있어야 한다. */
export function startBackgroundLoading(): void {
  // 첫 화면이 다 뜬 뒤 한가할 때 나머지 화면 코드와 그림을 미리 받아 둔다.
  onPageLoad(() => runWhenIdle(preloadAllPages, 4000, 2000));

  onPageLoad(warmUpImagesSoon);
  window.addEventListener(PAGE_CHANGE_EVENT, warmUpImagesSoon);

  onPageLoad(prefetchOpeningPosterWhenIdle);
  window.addEventListener(PAGE_CHANGE_EVENT, prefetchOpeningPosterWhenIdle);
}
