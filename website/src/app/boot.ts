import { OPENING_FILM } from "@/data/videos";
import { runWhenIdle } from "@/lib/idle";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";
import { getSessionUser } from "@/services/session";

import { preloadAllPages } from "./pageRegistry";

function runAfterPageLoad(callback: () => void) {
  if (document.readyState === "complete") callback();
  else window.addEventListener("load", callback, { once: true });
}

/*
 * loading="lazy" 그림은 화면 가까이 와야 받고, 처음 그릴 때 decode 한다.
 * 빠르게 굴리면 이 둘이 스크롤을 못 따라가므로, 한가할 때 3장씩 미리 받아 풀어 둔다.
 */
const WARMUP_BATCH_SIZE = 3;

const whenIdle = (task: () => void) => runWhenIdle(task, 1500, 200);

function warmUpImages(): void {
  const images = [...document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')];
  let index = 0;
  const runBatch = () => {
    for (let count = 0; count < WARMUP_BATCH_SIZE && index < images.length; count++, index++) {
      const image = images[index];
      if (!image.isConnected) continue;
      image.loading = "eager";
      // 아직 안 왔거나 깨졌으면 조용히 넘어간다. 화면에 닿으면 원래대로 그린다.
      image.decode?.().catch(() => {});
    }
    if (index < images.length) whenIdle(runBatch);
  };
  whenIdle(runBatch);
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
  runAfterPageLoad(() => runWhenIdle(preloadAllPages, 4000, 2000));

  runAfterPageLoad(warmUpImagesSoon);
  window.addEventListener(PAGE_CHANGE_EVENT, warmUpImagesSoon);

  runAfterPageLoad(prefetchOpeningPosterWhenIdle);
  window.addEventListener(PAGE_CHANGE_EVENT, prefetchOpeningPosterWhenIdle);
}
