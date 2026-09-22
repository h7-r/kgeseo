import 무대 from "../무대.jsx";
import 요금제구간 from "../구간/요금제.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";

/* 요금제 페이지 — nav(149) + 본문(2322) + 푸터(186) */
const 내비높이 = 149;
const 본문높이 = 2322;

export default function 요금제화면() {
  return (
    <무대 높이={내비높이 + 본문높이 + 60 + 186}>
      <요금제구간 위={내비높이 + 60} />
      <하위푸터 />
    </무대>
  );
}
