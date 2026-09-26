import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import 무대 from "../무대.jsx";
import 약관구간 from "../구간/약관.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";
import { 약관높이, 약관탭목록 } from "../데이터/약관탭.js";

/* 약관 페이지 — nav(149) + 여백 64 + 약관 카드(탭마다 높이 다름) + 여백 64 + 푸터(186) */
const 내비높이 = 149;
const 위여백 = 64;
const 아래여백 = 64;
const 가장긴약관 = Math.max(...Object.values(약관높이));

export default function 약관화면() {
  /* 푸터의 「개인정보처리방침」 처럼 **특정 탭을 바로 열어야 하는** 링크가 있다.
     주소에 ?탭=... 로 실어 보내면 그 탭으로 열린다. 없으면 첫 탭. */
  const [질의] = useSearchParams();
  const 첫탭 = 약관탭목록.includes(질의.get("탭")) ? 질의.get("탭") : "이용약관";
  const [탭, set탭] = useState(첫탭);
  const 카드위 = 내비높이 + 위여백;
  /* [왜 가장 긴 탭 기준으로 고정하나]
     탭마다 카드 길이가 1029~1705 로 제각각이라, 탭을 누를 때마다 푸터가
     위아래로 껑충 뛴다. 가장 긴 탭(법적 고지)에 맞춰 못 박아 두면 푸터가
     제자리에 있고, 짧은 탭에서는 그 아래가 **바탕색 그대로 비어 있게** 된다. */
  const 푸터위 = 카드위 + 가장긴약관 + 아래여백;

  return (
    <무대 높이={푸터위 + 186}>
      <약관구간 탭={탭} 위={카드위} 탭누르기={set탭} />
      {/* [왜 빈 칸을 두나]
          푸터는 무대 바닥에 붙는다. 그런데 약관 카드 길이가 탭마다
          1029~1705 로 달라서, 그대로 두면 탭을 누를 때마다 푸터가 껑충 뛴다.
          가장 긴 탭만큼 자리를 잡아 두면 푸터가 제자리에 있고,
          짧은 탭에서는 그 아래가 **바탕색 그대로** 비어 있게 된다. */}
      <div style={{ position: "absolute", left: 0, top: `${카드위}px`, width: "1px", height: `${가장긴약관 + 아래여백}px`, pointerEvents: "none" }} />
      <하위푸터 />
    </무대>
  );
}
