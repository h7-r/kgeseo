import { runWhenIdle } from "./idle";

/*
 * loading="lazy" 그림은 화면 가까이 와야 받고, 처음 그릴 때 decode 한다.
 * 빠르게 굴리면 이 둘이 스크롤을 못 따라가므로, 한가할 때 미리 받아 풀어 둔다.
 * 3장씩 끊어 주 스레드를 오래 잡지 않는다.
 */
const BATCH_SIZE = 3;

const whenIdle = (task: () => void) => runWhenIdle(task, 1500, 200);

/** 남은 lazy 그림을 한가할 때마다 3장씩 eager 로 바꾸고 미리 decode 한다. */
export function warmUpImages(): void {
  const images = [...document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')];
  let index = 0;
  const runBatch = () => {
    for (let count = 0; count < BATCH_SIZE && index < images.length; count++, index++) {
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
