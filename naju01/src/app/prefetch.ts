/**
 * 씬을 붙이기 전에 편집 파일과 모형 다섯을 받아 둔다.
 * 씬은 무리를 useMemo 로 세우는데, 이것들이 따로 도착할 때마다 무리가 통째로 다시 서서 첫 10~20 초가
 * 수백 ms 씩 멈췄다. 먼저 받아 각 모듈의 동기 캐시에 넣어 두면 씬이 첫 렌더에서 다 가진 채로 선다.
 * 하나가 실패해도 막지 않는다 — 각 모듈이 제 기본 표본으로 돌아간다.
 *
 * 구운 지형은 일부러 미리 받지 않는다. 자갈·수풀·길가 덤불 자리는 늘 「해석 지형으로 서고 → 연결로·바깥 들판이
 * 붙은 뒤 → 구운 땅이 도착」하는 순서로 깔려 왔고, 손 배치(assets/edits.json)가 그 생성 순서 번호로 남아 있다.
 * 구운 땅이 첫 렌더부터 있으면 자리가 달라져 지운 것·옮긴 것이 엉뚱한 물건에 붙는다.
 */
import { loadTexturedModel, TEXTURED_MODEL_LABELS, TEXTURED_MODEL_NAMES } from "../loaders/useTexturedModels";
import { prefetchEdits } from "../placement/editFile";

type PrefetchProgress = (done: number, total: number, label: string) => void;

/** 하나 끝날 때마다 onProgress(끝난 수, 전체 수, 이름). 거절하지 않는다. */
export async function prefetchNajuAssets(onProgress: PrefetchProgress = () => {}): Promise<void> {
  const jobs: [string, Promise<unknown>][] = [
    ["편집", prefetchEdits()],
    ...TEXTURED_MODEL_NAMES.map((name): [string, Promise<unknown>] => [
      `모형 ${TEXTURED_MODEL_LABELS[name]}`,
      loadTexturedModel(name),
    ]),
  ];
  let done = 0;
  onProgress(0, jobs.length, "");
  await Promise.all(
    jobs.map(([label, job]) =>
      job
        .catch(() => null)
        .then(() => {
          done += 1;
          onProgress(done, jobs.length, label);
        }),
    ),
  );
}
