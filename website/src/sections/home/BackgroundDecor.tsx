import type { CSSProperties } from "react";

import ellipseLeft from "@/assets/images/imgEllipse.svg";
import ellipseRight from "@/assets/images/imgEllipse1.svg";
import ellipseCenter from "@/assets/images/imgEllipse5.svg";
import ellipseLarge from "@/assets/images/imgEllipse8.svg";
import { PIN_CLASS } from "@/lib/layout";
import { glowImageStyle, place } from "@/lib/style";

import { CASE_FILE_PIN_LENGTH, SECTION_OFFSET } from "./homeLayout";

// 장식은 보이기만 하는 그림인데 커서 단추 위를 덮는다. 클릭을 먹지 않게 pointerEvents 를 끈다.
// 글로우 그림은 칸보다 커서 사방으로 넘친다. 퍼센트를 px 로 바꾸면 화면 크기에 따라 어긋난다.

interface RotatedGlowProps {
  box: CSSProperties;
  angle: number;
  width: number;
  height: number;
  overflow: CSSProperties;
  src: string;
}

function RotatedGlow({ box, angle, width, height, overflow, src }: RotatedGlowProps) {
  return (
    <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ flex: "none", transform: `rotate(${angle}deg)` }}>
        <div style={{ position: "relative", width: `${width}px`, height: `${height}px` }}>
          <div style={{ position: "absolute", ...overflow }}>
            <img src={src} alt="" style={glowImageStyle} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 번지는 푸른 빛과 큰 원들. 분위기만 만드는 층이다.
 * 큰 빛과 가운데 빛은 디자인에서 한참 뒤에 칠해져 렌즈·글 위를 덮으므로 따로 내보내 HomePage 가 알맞은 순서에 둔다.
 */
export default function BackgroundDecor() {
  return (
    <>
      {/* 고리는 딸린 구간과 같은 만큼 내린다. 앙암바위 뒤 고리는 앙암바위와 같이 멈춘다. */}
      <LayeredRings
        style={place(606, 3949 + CASE_FILE_PIN_LENGTH + SECTION_OFFSET.regionSelect, 960, 960)}
        placement="regions"
      />
      <LayeredRings
        style={place(472, 6244 + CASE_FILE_PIN_LENGTH + SECTION_OFFSET.angam, 960, 960)}
        placement="angam"
        pinGroup="angam-rock"
      />

      <RotatedGlow
        box={place(-269, 1416, 784.758, 592.635)}
        angle={10.37}
        width={711.356}
        height={472.29}
        overflow={{ top: "-42.35%", bottom: "-42.35%", left: "-28.12%", right: "-28.12%" }}
        src={ellipseLeft}
      />

      {/* 사건 파일 뒤에 깔려 있어 사건 파일과 같이 내린다. */}
      <RotatedGlow
        box={place(1310, 2877 + SECTION_OFFSET.caseFile, 538, 401.077)}
        angle={10.37}
        width={488.682}
        height={318.303}
        overflow={{ top: "-62.83%", bottom: "-62.83%", left: "-40.93%", right: "-40.93%" }}
        src={ellipseRight}
      />
    </>
  );
}

/** 지역 선택 구간 한가운데 동그란 빛. 왼쪽 글 위에 얹힌다. */
export function CenterGlow() {
  return (
    <div
      style={{
        position: "absolute",
        left: "946px",
        top: "4646px",
        width: "330px",
        height: "330px",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
      }}
    >
      <div style={{ position: "absolute", inset: "-151.52%" }}>
        <img src={ellipseCenter} alt="" style={glowImageStyle} />
      </div>
    </div>
  );
}

/** 두 번째 화면 오른쪽 가장 큰 빛. 렌즈 위, 가입 폼 아래에 칠한다. */
export function LargeGlow() {
  return (
    <RotatedGlow
      box={place(919, 1686.44, 1120.002, 926.674)}
      angle={-11.84}
      width={989.322}
      height={739.38}
      overflow={{ top: "-40.57%", bottom: "-40.57%", left: "-30.32%", right: "-30.32%" }}
      src={ellipseLarge}
    />
  );
}

interface LayeredRingsProps {
  /** 자리와 크기(place(...) 결과). */
  style: CSSProperties;
  /** 어느 구간 뒤에 깔리는지. 구간마다 고리 기울기가 다르다. */
  placement: "regions" | "angam";
  /** 주면 그 구간과 같이 멈춘다. */
  pinGroup?: string;
}

const perspectiveStyle: CSSProperties = { perspective: "1500px", pointerEvents: "none" };

/**
 * 겹겹의 큰 원. 정원은 돌아도 안 보여서 고리마다 다르게 기울인 타원으로 돌린다 — 서로 앞뒤로 엇갈린다.
 * SVG 두 장(2.5MB)을 받는 대신 CSS 로 그린다.
 */
function LayeredRings({ style, placement, pinGroup }: LayeredRingsProps) {
  return (
    <div
      className={pinGroup ? PIN_CLASS : undefined}
      data-pin-group={pinGroup}
      style={{ ...style, ...perspectiveStyle }}
      aria-hidden="true"
    >
      <div className={`layered-rings layered-rings--${placement}`}>
        {/* 바깥일수록 얇고 많이 누워 있어 멀리 있어 보인다. */}
        <div className="layered-rings__ring layered-rings__ring--outer" />
        <div className="layered-rings__ring layered-rings__ring--middle" />
        <div className="layered-rings__ring layered-rings__ring--inner" />
      </div>
    </div>
  );
}
