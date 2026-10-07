import type { ReactNode } from "react";

import DividerArc from "@/components/DividerArc";
import Stage from "@/components/Stage";
import Footer from "@/layout/Footer";
import { SHIFT_BOX_ATTR, useStageScale } from "@/lib/stage";
import AngamRock from "@/sections/home/AngamRock";
import BackgroundDecor, { CenterGlow, LargeGlow } from "@/sections/home/BackgroundDecor";
import CaseFile from "@/sections/home/CaseFile";
import Closing from "@/sections/home/Closing";
import HeroPin, { HERO_BOTTOM } from "@/sections/home/HeroPin";
import Intro from "@/sections/home/Intro";
import Marquee from "@/sections/home/Marquee";
import QuickSignup from "@/sections/home/QuickSignup";
import RegionSelect from "@/sections/home/RegionSelect";
import ScenarioCards from "@/sections/home/ScenarioCards";

import {
  ANGAM_PIN_LENGTH,
  CASE_FILE_PIN_LENGTH,
  INTRO_CENTER_Y,
  INTRO_TEXT_END,
  SECTION_OFFSET,
  SIGNUP_FORM_LEFT,
} from "./homeLayout";

/** 메인 랜딩(1920 × 9020 설계). */
export default function HomePage() {
  const scale = useStageScale();

  return (
    <>
      {/* 무대 밖이어야 sticky 가 잡힌다. */}
      <HeroPin />
      {/* 무대를 히어로 높이만큼 끌어올려 핀이 풀리는 순간 소개가 바로 이어지게 한다. */}
      <div style={{ marginTop: `-${Math.round(HERO_BOTTOM * scale)}px` }}>
        <Stage height={9297} bottomGap={0}>
          {/* 칠하는 순서 = 디자인 레이어 순서(아래로 갈수록 앞).
              큰 빛과 가입 폼은 반드시 맨 뒤 — 앞으로 옮기면 렌즈가 빛 위로 떠올라 검은 덩어리가 된다. */}
          <BackgroundDecor />
          <Intro />
          <ShiftBox y={SECTION_OFFSET.caseFile}>
            <CaseFile />
          </ShiftBox>
          <ShiftBox y={CASE_FILE_PIN_LENGTH + SECTION_OFFSET.scenarioCards}>
            <ScenarioCards />
          </ShiftBox>
          <ShiftBox y={CASE_FILE_PIN_LENGTH + SECTION_OFFSET.regionSelect}>
            <RegionSelect />
          </ShiftBox>
          <ShiftBox y={CASE_FILE_PIN_LENGTH + SECTION_OFFSET.angam}>
            <AngamRock />
          </ShiftBox>
          <ShiftBox y={CASE_FILE_PIN_LENGTH + SECTION_OFFSET.regionSelect}>
            <CenterGlow />
          </ShiftBox>
          <ShiftBox y={CASE_FILE_PIN_LENGTH + ANGAM_PIN_LENGTH + SECTION_OFFSET.closing}>
            <Closing />
          </ShiftBox>
          <ShiftBox y={CASE_FILE_PIN_LENGTH + ANGAM_PIN_LENGTH + SECTION_OFFSET.marquee}>
            <Marquee />
          </ShiftBox>
          <Footer />
          <LargeGlow />
          {/* 상자 끝(970)이 아니라 눈에 보이는 글 끝에 맞춰야 호가 가운데로 보인다. */}
          <DividerArc centerX={(INTRO_TEXT_END + SIGNUP_FORM_LEFT) / 2} top={INTRO_CENTER_Y - 420} height={840} />
          <QuickSignup />
        </Stage>
      </div>
    </>
  );
}

interface ShiftBoxProps {
  /** 내릴 거리(무대 px). 핀이 멈춰 있는 스크롤 거리 + 구간 틈 고침값. */
  y: number;
  children: ReactNode;
}

/**
 * 안의 구간을 y 만큼 통째로 내리는 높이 0 상자. 구간 안 좌표는 디자인 그대로 두고 이 top 만 바꾼다.
 * 스스로 자리를 차지하지 않아 Stage 가 data-shift 를 보고 속까지 들여다봐 높이를 잰다.
 */
function ShiftBox({ y, children }: ShiftBoxProps) {
  return (
    <div {...SHIFT_BOX_ATTR} style={{ position: "absolute", left: 0, top: `${y}px`, width: "100%", height: 0 }}>
      {children}
    </div>
  );
}
