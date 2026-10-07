import type { RefObject } from "react";
import { button, useControls } from "leva";

import { clearSavedControls } from "@/engine/leva/savedControls";

import type { DeskValues } from "./deskControls";

/** 출력 버튼이 읽는 지금 값. leva 버튼은 처음 만들 때 값을 붙잡아 두므로 ref 로 최신 값을 건넨다. */
export interface DebugPrintValues {
  view: unknown;
  lighting: unknown;
  deskCommon: unknown;
  computer: unknown;
  monitors: unknown;
  keyboard: unknown;
  mouse: unknown;
  laptop: unknown;
  laptops: unknown;
  papers: unknown;
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
        const v = live.current;
        if (!v) return;
        const section = (title: string, value: unknown) => `\n=== ${title} ===\n` + JSON.stringify(value, null, 2);
        console.log(
          "===== K게서 현재 Leva 전체값 =====" +
            section("시점(눈높이)", v.view) +
            section("폐역 조명", v.lighting) +
            section("책상(공통)", v.deskCommon) +
            section("컴퓨터(공통·색)", v.computer) +
            section("컴퓨터1/3", v.monitors) +
            section("키보드(공통)", v.keyboard) +
            section("마우스(공통)", v.mouse) +
            section("노트북(공통·색)", v.laptop) +
            section("노트북1/2/3", v.laptops) +
            section("서류 더미", v.papers) +
            "\n\n=== DESK_SPOTS (그대로 코드에 붙이기) ===\n" +
            deskSpotsCode(v.desks, (r) => r),
        );
      }),
      label: "콘솔에전부출력",
    },
  });
}
