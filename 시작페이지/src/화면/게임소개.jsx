import { useState } from "react";
import 무대 from "../무대.jsx";
import 게임소개구간 from "../구간/게임소개.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";

/* 게임 소개 페이지 — nav(149) + 소개 구간(630) + 푸터(186) = 965 */
const 내비높이 = 149;
const 구간높이 = 630;

export default function 게임소개() {
  const [탭, set탭] = useState("게임 소개");

  return (
    <무대 높이={내비높이 + 구간높이 + 186}>
      <게임소개구간 탭={탭} 위={내비높이} 탭누르기={set탭} />
      <하위푸터 />
    </무대>
  );
}
