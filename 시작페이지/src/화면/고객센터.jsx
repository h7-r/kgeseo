import { useState } from "react";
import 무대 from "../무대.jsx";
import 고객센터구간 from "../구간/고객센터.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";

/* 고객센터 페이지 — nav(149) + 머리(230) + 탭(100) + 내용 + 푸터(186)
   내용 높이가 탭마다 달라서 푸터 자리도 함께 움직인다. */
const 내비높이 = 149;
const 내용높이 = { 공지사항: 1100, "자주 묻는 질문 (FAQ)": 979, "1:1 문의하기": 1059 };

export default function 고객센터화면() {
  const [탭, set탭] = useState("공지사항");
  const 푸터위 = 내비높이 + 330 + 내용높이[탭] + 60;

  return (
    <무대 높이={푸터위 + 186}>
      <고객센터구간 탭={탭} 위={내비높이} 탭누르기={set탭} />
      <하위푸터 />
    </무대>
  );
}
