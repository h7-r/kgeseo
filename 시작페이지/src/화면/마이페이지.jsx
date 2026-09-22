import { useState } from "react";
import 무대 from "../무대.jsx";
import 마이페이지구간 from "../구간/마이페이지.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";

/* 마이페이지 — nav(149) + 본문(1300) + 푸터(186) */
const 내비높이 = 149;

export default function 마이페이지화면() {
  const [탭, set탭] = useState("최근 플레이 기록");
  const 푸터위 = 내비높이 + 60 + 1300 + 60;

  return (
    <무대 높이={푸터위 + 186}>
      <마이페이지구간 탭={탭} 위={내비높이 + 60} 탭누르기={set탭} />
      <하위푸터 />
    </무대>
  );
}
