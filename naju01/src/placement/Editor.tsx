// [E] 통합 편집 모드 — E 를 누르면 곧바로 「라이브러리 배치 + 이미 놓인 에셋 고치기」 한 화면(10/15 미르).
//   옛 편집기(클릭 고르기·끌어 옮기기·붓 팔레트·부감 휠)와 옛 L 「라이브러리 배치」를 하나로 합쳤다 — 조작은 검수 작업대 둘러보기와 같다.
//   실제 조작·저장은 LibraryPlaceMode(카메라·고르기·손잡이·키·서랍), 여기는 켜고 끄기만 한다.
//   지형·절벽·통로는 여전히 못 만진다 — 도면 숫자가 정하고, 마우스로 주무르면 그림과 걷는 판정이 갈라진다.
//   손 편집은 assets/edits.json(생성 무리)과 public/_sf_local/manifest.json 「놓기」(공개 에셋)에 남아 팀원 화면에도 같이 나온다.

import { useEffect, type Dispatch, type SetStateAction } from "react";

import { IS_PUBLIC_ASSETS_ENABLED } from "../loaders/publicAssets";
import type { Edits, InstanceGroup } from "./instanceGroups";
import { setEditModeActive } from "./libraryPlaceApi";
import LibraryPlaceMode from "./LibraryPlaceMode";

/** 공개·국가유산 GLB 를 manifest 「놓기」로 놓기 — 공개 에셋 화면 + 개발 서버(저장 주소 /__naju-place 가 있는 곳)에서만 */
const LIBRARY_AVAILABLE = IS_PUBLIC_ASSETS_ENABLED && import.meta.env.DEV;

interface EditorProps {
  enabled: boolean;
  edits: Edits;
  setEdits: Dispatch<SetStateAction<Edits>>;
  /** 생성 무리(편집 번호 → 지금 자리) — 고른 인스턴스의 원래 자리를 edits 를 얹어 읽는다 */
  instanceGroups: readonly InstanceGroup[];
  /** 게임 땅 판정(terrain.groundAt) — 공개 에셋 「놓기」와 같은 땅 높이로 세우게 */
  groundAt: (x: number, z: number) => { y: number; zone?: string | null } | null | undefined;
  /** 포인터락을 풀어야 마우스로 집는다 */
  unlockPointer?: () => void;
  overview: boolean;
  setOverview?: Dispatch<SetStateAction<boolean>>;
  /** 편집 모드 끄기(서랍의 「끝내기」 단추 — E 와 같다) */
  onExit: () => void;
}

export default function Editor({
  enabled,
  edits,
  setEdits,
  instanceGroups,
  groundAt,
  unlockPointer,
  overview,
  setOverview,
  onExit,
}: EditorProps) {
  // 걷기·안개를 멈추게 씬에 알린다(검수 카메라 붙잡기와 같은 뜻) · 공개 에셋 층의 Alt+클릭(덮기 판 빼기)도 쉰다
  useEffect(() => {
    setEditModeActive(enabled);
    return () => setEditModeActive(false);
  }, [enabled]);

  useEffect(() => {
    if (enabled && unlockPointer) unlockPointer();
  }, [enabled, unlockPointer]);

  if (!enabled) return null;
  return (
    <LibraryPlaceMode
      groundAt={groundAt}
      overview={overview}
      setOverview={setOverview}
      onExit={onExit}
      edits={edits}
      setEdits={setEdits}
      instanceGroups={instanceGroups}
      libraryAvailable={LIBRARY_AVAILABLE}
    />
  );
}
