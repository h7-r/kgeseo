import { useNavigate } from "react-router-dom";
import { 눌러이동 } from "./이동표.js";
import 무대 from "./무대.jsx";
import 히어로 from "./구간/히어로.jsx";
import 소개 from "./구간/소개.jsx";
import 영상 from "./구간/영상.jsx";
import 가입폼 from "./구간/가입폼.jsx";
import 배경장식, { 가운데빛, 큰빛 } from "./구간/배경장식.jsx";
import 지역선택 from "./구간/지역선택.jsx";
import 지역카드 from "./구간/지역카드.jsx";
import 앙암바위 from "./구간/앙암바위.jsx";
import 마무리 from "./구간/마무리.jsx";
import 마키 from "./구간/마키.jsx";
import 푸터 from "./구간/푸터.jsx";

/* 메인 랜딩 — 피그마 3:3 「메인 (Main)」 (1920 × 9020) */
export default function 시작화면() {
  const 가기 = useNavigate();
  const 누름 = 눌러이동(가기);

  return (
    <무대 높이={9020}>
      {/* ── 칠하는 순서 = 피그마 레이어 순서 ──────────────────
           위에서 아래로 갈수록 화면 **앞쪽**에 온다.
           특히 큰빛과 가입폼은 반드시 맨 뒤여야 한다 —
           앞으로 옮기면 렌즈가 빛 위로 떠올라 검은 덩어리가 된다. */}
      <배경장식 />
      {/* 헤더를 149px 로 통일해서, 히어로도 그 바로 아래(149)에서 시작한다.
          원본 좌표는 173 인데, 그대로 두면 헤더 아래 24px 짜리 어두운 틈이 남아
          헤더가 실제보다 두꺼워 보인다. */}
      <히어로 누름={누름} 위={149} />
      <소개 누름={누름} />
      <영상 />
      <지역카드 />
      <지역선택 누름={누름} />
      <앙암바위 누름={누름} />
      <가운데빛 />
      <마무리 누름={누름} />
      <마키 누름={누름} />
      <푸터 />
      <큰빛 />
      <가입폼 />
    </무대>
  );
}
