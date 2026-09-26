import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import 내비층 from "./내비층.jsx";
import { use읽은만큼 } from "./움직임.js";
import 시작화면 from "./시작화면.jsx";
import 인증 from "./화면/인증.jsx";
import 게임소개 from "./화면/게임소개.jsx";
import 약관화면 from "./화면/약관.jsx";
import 고객센터화면 from "./화면/고객센터.jsx";
import 요금제화면 from "./화면/요금제.jsx";
import 마이페이지화면 from "./화면/마이페이지.jsx";
import 영상캐릭터 from "./화면/영상캐릭터.jsx";
import 에러 from "./화면/에러.jsx";

/* 화면 목록 — 피그마 프로토타입의 전환을 주소로 옮긴 것 */
export default function 앱() {
  return (
    <>
      <진행막대 />
      <내비층 />
      <쪽전환>
        <Routes>
        <Route path="/" element={<시작화면 />} />
        <Route path="/로그인" element={<인증 모드="로그인" />} />
        <Route path="/회원가입" element={<인증 모드="회원가입" />} />
        <Route path="/비밀번호-찾기" element={<인증 모드="비밀번호찾기" />} />
        <Route path="/비밀번호-재설정" element={<인증 모드="인증중" />} />
        <Route path="/비밀번호-재설정/완료" element={<인증 모드="인증완료" />} />
        <Route path="/게임소개" element={<게임소개 />} />
        <Route path="/약관" element={<약관화면 />} />
        <Route path="/고객센터" element={<고객센터화면 />} />
        <Route path="/요금제" element={<요금제화면 />} />
        <Route path="/마이페이지" element={<마이페이지화면 />} />
        <Route path="/영상캐릭터" element={<영상캐릭터 />} />
        {/* 없는 주소는 404 화면으로 */}
        <Route path="*" element={<에러 />} />
        </Routes>
      </쪽전환>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   쪽 전환 — 주소가 바뀔 때마다 살짝 떠오르며 나타난다

   [왜 key 를 붙이나]
   key 가 바뀌면 칸이 새로 만들어지고, 그래야 CSS 애니메이션이 **다시**
   돈다. key 없이 클래스만 두면 첫 화면에서 한 번만 돌고 끝난다.

   [transform 을 왜 애니메이션으로만 쓰나]
   끝난 뒤에도 transform 이 남아 있으면(fill-mode: forwards) 이 칸이
   position: fixed 의 기준이 돼서 안쪽 배치가 틀어진다. 그래서 끝나면
   transform 이 없는 상태로 돌아가게 둔다.

   주소가 바뀌면 맨 위로 올린다 — 긴 페이지에서 옮겨 가면 스크롤이
   그대로 남아 엉뚱한 중간이 먼저 보인다.
   ═══════════════════════════════════════════════════════ */
/* 화면 맨 위에서 읽은 만큼 차오르는 막대 */
function 진행막대() {
  const 막대 = use읽은만큼();
  return <div ref={막대} className="진행막대" aria-hidden="true" style={{ transform: "scaleX(0)" }} />;
}

function 쪽전환({ children }) {
  const 길 = useLocation().pathname;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [길]);

  return (
    <>
      {/* 주소가 바뀔 때마다 새로 만들어져 한 번 걷힌다 */}
      <div key={`막${길}`} className="전환막" aria-hidden="true" />
      <div key={길} className="쪽전환">
        {children}
      </div>
    </>
  );
}
