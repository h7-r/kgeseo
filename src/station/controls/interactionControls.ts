import { useSavedControls } from "@/engine/leva/savedControls";

/**
 * 「1인칭 몸」·「놓기 미리보기」·「겨냥 강조」.
 * 겨냥 강조는 글자 대신 물건 자체로 알린다 — 살짝 커지고 스스로 빛나 Bloom(임계 0.85)이 외곽을 번지게 한다.
 * color·strength·grow 가 HighlightSettings 필드와 같아 벽함 속 부품에 그대로 넘긴다.
 */
export function useInteractionControls() {
  // 아직 아바타 눈높이가 안 맞아 1인칭 몸은 기본 꺼짐 — 켜면 내려다볼 때 가슴이 화면을 막는다.
  const firstPersonBody = useSavedControls("1인칭 몸", {
    showFirstPersonBody: { value: false, label: "일인칭몸보기" },
  });
  // 형광색은 셀셰이딩 톤에서 혼자 튄다. 채도를 낮춘 파스텔이 기본.
  const placementPreview = useSavedControls("놓기 미리보기", {
    okColor: { value: "#a5d5a6", label: "가능색" },
    blockedColor: { value: "#e58277", label: "불가색" },
    ghostVisible: { value: true, label: "유령보이기" },
    ghostOpacity: { value: 0.4, min: 0.05, max: 1, step: 0.05, label: "유령투명도" },
  });
  const highlight = useSavedControls("겨냥 강조", {
    color: { value: "#fffee7", label: "색" },
    strength: { value: 0.45, min: 0, max: 2, step: 0.05, label: "세기" },
    grow: { value: 0.08, min: 0, max: 0.2, step: 0.005, label: "커지기" },
    furnitureGrow: { value: 0.02, min: 0, max: 0.1, step: 0.005, label: "가구커지기" },
  });
  return { showFirstPersonBody: firstPersonBody.showFirstPersonBody, placementPreview, highlight };
}

export type InteractionControls = ReturnType<typeof useInteractionControls>;
export type PlacementPreviewValues = InteractionControls["placementPreview"];
export type HighlightValues = InteractionControls["highlight"];
