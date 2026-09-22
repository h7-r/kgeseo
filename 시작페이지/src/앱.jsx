import { Routes, Route } from "react-router-dom";
import 내비층 from "./내비층.jsx";
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
      <내비층 />
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
    </>
  );
}
