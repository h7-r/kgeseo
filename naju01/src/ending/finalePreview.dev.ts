/**
 * (개발 서버) `?stage=4&ending=finale` — 마지막 퍼즐(다섯 횃불)을 막 푼 순간부터 본다: 끝 연출(불기둥 → 가락지 → 아비사의 작별) → 엔딩 필름.
 * 바위 위에서 시작해 틈을 건너 굿판에 내려서고(굿판은 틈을 지나야 제대로 차려진다) 가락지를 올린 뒤 횃불 다섯을 차례로 켠다 —
 * 실제 흐름을 개발 손잡이로 빠르게 넘기는 것이라 20초쯤 걸린다. 배포 빌드에는 들어가지 않는다(dropLocalOnly · 동적 import).
 */
import { cliff } from "../puzzles/cliff/cliffState";
import { STAKE_TAGS } from "../puzzles/gut/gutShape";

interface Hooks {
  naju?: { teleport?: { current?: (x: number, z: number, heading: string) => void } };
  najuRiftDev?: { open: () => void; spot: () => { rift: { x: number; z: number } } };
  najuGutDev?: { begin: () => void; light: (stake: number) => void };
}

const hooks = () => (window as unknown as { __game?: Hooks }).__game ?? {};
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs: number) {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) return false;
    await wait(200);
  }
  return true;
}

let hasRun = false;

export async function runFinalePreview() {
  if (hasRun) return;
  hasRun = true;
  const isReady = await until(
    () => !!(hooks().najuRiftDev && hooks().najuGutDev && hooks().naju?.teleport?.current),
    20000,
  );
  if (!isReady) return console.warn("[엔딩 미리 보기] 개발 손잡이가 없다 — 주소에 stage=4 가 있는지 보라");
  // 바위 위의 일을 다 끝낸 것으로 — 구렁이상을 끼우고 틈을 연다
  cliff.restore({ ...cliff.state(), stage: "done" });
  await wait(400);
  hooks().najuRiftDev?.open();
  await wait(3000);
  const rift = hooks().najuRiftDev!.spot().rift;
  const teleport = hooks().naju!.teleport!.current!;
  teleport(rift.x - 0.6, rift.z, "+X");
  if (!(await until(() => cliff.stage() === "crossed", 5000))) {
    teleport(rift.x, rift.z, "+X");
    if (!(await until(() => cliff.stage() === "crossed", 8000))) return console.warn("[엔딩 미리 보기] 틈을 못 건넜다");
  }
  // 굿판에 내려섰다 — 가락지를 올리고, 횃불 다섯을 일이 일어난 차례대로 켠다
  await wait(6000);
  hooks().najuGutDev?.begin();
  await wait(2500);
  for (let tag = 0; tag < STAKE_TAGS.length; tag += 1) {
    hooks().najuGutDev?.light(STAKE_TAGS.indexOf(tag as (typeof STAKE_TAGS)[number]));
    await wait(500);
  }
}
