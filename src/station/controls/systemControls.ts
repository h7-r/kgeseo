import type { RefObject } from "react";
import { button, useControls } from "leva";

import { clearSavedControls, useSavedControls } from "@/engine/leva/savedControls";
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from "@/engine/movement/constants";

import type { DeskCommonValues, DeskValues } from "./furnitureControls";
import type {
  ComputerControlValues,
  KeyboardValues,
  LaptopControlValues,
  MouseValues,
} from "./headquartersPropControls";
import type { PaperControlValues } from "./paperControls";
import type { LightingValues } from "./headquartersControls";

// 장소에 매이지 않는 폴더 — 시점·충돌·성능·조작 표시와 개발용 출력 버튼.

/** 「시점(눈높이)」 — usePlayer 보다 먼저 불러야 값을 넘길 수 있다. */
export function useViewControls() {
  return useSavedControls("시점(눈높이)", {
    eyeHeight: { value: EYE_HEIGHT, min: 2, max: 10, step: 0.05, label: "눈높이" },
    crouchEyeHeight: { value: CROUCH_EYE_HEIGHT, min: 0.8, max: 6, step: 0.05, label: "앉은높이" },
  });
}

/**
 * 「사물 충돌」·「성능」.
 * 카메라가 물체 안에 들어가면 외곽선 껍데기가 화면을 덮어 프레임이 몇 초로 늘고 드라이버가 리셋된다 — 그래서 큰 물건은 막는다.
 */
export function useSystemControls() {
  const collision = useSavedControls("사물 충돌", {
    enabled: { value: true, label: "켜기" },
    margin: { value: 0.9, min: 0.5, max: 1.2, step: 0.05, label: "여유" },
    showBoxes: { value: false, label: "보기" },
    boxHeight: { value: 4, min: 0.5, max: 12, step: 0.5, label: "보기높이" },
  });
  // 그림자를 한 번 다시 그리는 데 1.4~2.3ms 가 든다. 간격 2 면 든 물건·문 그림자가 33ms 늦게 따라온다.
  const performance = useSavedControls("성능", {
    meter: { value: true, label: "계기판" },
    zoneCulling: { value: true, label: "구역최적화" },
    saveShadows: { value: true, label: "그림자아끼기" },
    shadowInterval: { value: 2, min: 1, max: 10, step: 1, label: "그림자간격" },
    shadowSafetyInterval: { value: 240, min: 20, max: 600, step: 20, label: "그림자안전망" },
    shaderWarmup: { value: true, label: "셰이더예열" },
  });
  return { collision, performance };
}

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

/** 출력 버튼이 읽는 지금 값. leva 버튼은 처음 만들 때 값을 붙잡아 두므로 ref 로 최신 값을 건넨다. */
export interface DebugPrintValues {
  view: ViewValues;
  lighting: LightingValues;
  deskCommon: DeskCommonValues;
  computer: ComputerControlValues["common"];
  monitors: ComputerControlValues["monitors"];
  keyboard: KeyboardValues;
  mouse: MouseValues;
  laptop: LaptopControlValues["common"];
  laptops: LaptopControlValues["laptops"];
  papers: PaperControlValues["papers"];
  desks: readonly DeskValues[];
}

const deskSpotsCode = (desks: readonly DeskValues[], formatRotation: (r: number) => string | number) =>
  "const DESK_SPOTS = [\n" +
  desks
    .map((d) => `  [${d.x}, ${d.z}, ${formatRotation(d.rotation)}, ${d.width}, ${d.depth}, ${d.height}],`)
    .join("\n") +
  "\n];";

/** 「★ 책상값 출력」·「★ 전체값 출력」 — 저장하지 않는 개발용 버튼. 콘솔에 지금 값을 뽑는다. */
export function useDebugPrintControls(live: RefObject<DebugPrintValues | null>) {
  useControls("★ 책상값 출력", {
    printDesks: {
      ...button(() => {
        if (!live.current) return;
        console.log(
          "=== DESK_SPOTS (복사해서 코드에 붙이기) ===\n" + deskSpotsCode(live.current.desks, (r) => r.toFixed(3)),
        );
      }),
      label: "콘솔에출력",
    },
  });

  useControls("★ 전체값 출력", {
    resetSaved: {
      ...button(() => {
        if (window.confirm("브라우저에 저장된 Leva 값을 모두 지우고 코드 기본값으로 되돌립니다. 계속할까요?")) {
          clearSavedControls();
          window.location.reload();
        }
      }),
      label: "저장값초기화",
    },
    printAll: {
      ...button(() => {
        const values = live.current;
        if (!values) return;
        const section = (title: string, value: unknown) => `\n=== ${title} ===\n` + JSON.stringify(value, null, 2);
        console.log(
          "===== K게서 현재 Leva 전체값 =====" +
            section("시점(눈높이)", values.view) +
            section("폐역 조명", values.lighting) +
            section("책상(공통)", values.deskCommon) +
            section("컴퓨터(공통·색)", values.computer) +
            section("컴퓨터1/3", values.monitors) +
            section("키보드(공통)", values.keyboard) +
            section("마우스(공통)", values.mouse) +
            section("노트북(공통·색)", values.laptop) +
            section("노트북1/2/3", values.laptops) +
            section("서류 더미", values.papers) +
            "\n\n=== DESK_SPOTS (그대로 코드에 붙이기) ===\n" +
            deskSpotsCode(values.desks, (r) => r),
        );
      }),
      label: "콘솔에전부출력",
    },
  });
}

type ViewValues = ReturnType<typeof useViewControls>;
export type CollisionValues = ReturnType<typeof useSystemControls>["collision"];
type InteractionControlValues = ReturnType<typeof useInteractionControls>;
export type PlacementPreviewValues = InteractionControlValues["placementPreview"];
export type HighlightValues = InteractionControlValues["highlight"];
