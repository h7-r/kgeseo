// 나주진입연출.jsx — 텔레포트(홀로그램 E) → 나주 맵 사이의 '시네마틱 전환'.
//
// [무엇을 하나]
//   ① 홀로그램에서 이동 신호(window "kgeseo:나주진입" 이벤트)를 받는다.
//   ② 나주 진입 영상으로 화면을 덮는다(naju01/src/전환/로딩영상.jsx 의 「나주」 묶음).
//      영상 아래로 「텔레포트 승인 → 좌표 고정 → 왜곡영역 진입」 안내가 한 줄씩 흐른다.
//   ③ 0.9초 뒤 나주(/naju01/index.html)로 페이지째 넘어간다. 넘어가기 직전에 「지금 몇 초 · 몇 번째 문장」을
//      적어 두므로(로딩영상이어서이동) 나주 페이지가 **같은 장면부터** 이어 튼다.
//      나주 진입 영상이 끝나면 목포 → 순천 → 목포 … 로 반복하며, 나주 맵이 다 뜨면 걷힌다.
//
// [2026-10-01 바꾼 점] (사용자 지시 「나주 맵 진입 렌더링 영상 처음은 지금 보낸 영상으로」)
//   전에는 검은 막 + 안내 세 줄(약 4초)을 **이 페이지에서** 다 보여 주고 나서야 넘어갔다.
//   정작 오래 걸리는 건 넘어간 **뒤**(나주 맵 모델·지형 읽기)인데, 그동안은 빈 화면이었다.
//   → 안내 세 줄은 로딩 영상의 흐르는 문장 맨 앞으로 옮기고, 여기서는 덮자마자 넘긴다.
//     나주가 읽히는 시간 전체를 영상이 가린다(컴퓨터마다 달라 준비될 때까지 반복).
//   「아무 키나 눌러 건너뛰기」 · 「첫 회만 풀재생」 은 뺐다 — 기다릴 연출 자체가 0.9초뿐이다.
//
// [핵심 주의 — 리스너를 마운트 때 한 번만 건다]
//   이벤트 리스너 useEffect 가 상태에 의존하면, 상태가 바뀌는 순간 cleanup 이 돌아
//   방금 건 타이머를 취소해 버린다. 그래서 리스너는 마운트 시 한 번만 걸고, 진행 여부는 ref 로 본다.
import { useEffect, useRef } from "react";
import { 로딩영상켜기, 로딩영상이어서이동 } from "../../naju01/src/전환/로딩영상.jsx";

const 덮고넘기기 = 900; // ms — 영상이 화면을 덮고(0.7초 페이드) 첫 장면이 흐른 뒤 넘어간다

export default function 나주진입연출() {
  const 진행 = useRef(false); // 두 번 시작 방지(E 를 연타하거나 길게 눌러도 한 번만)
  const 타이머 = useRef(null);

  useEffect(() => {
    const 시작 = (e) => {
      if (진행.current) return;
      진행.current = true;
      const 쿼리 = e && e.detail && e.detail.쿼리 ? e.detail.쿼리 : "";
      // 목적지 URL — 허브에서 출발했다는 표시(from=hub)를 붙인다. 문자열로 이어 붙이면 쿼리
      //   유무에 따라 ??from=hub 가 되기 쉬워, URL 로 만들어 안전하게 얹는다.
      const 목적 = new URL("/naju01/index.html" + 쿼리, window.location.origin);
      목적.searchParams.set("from", "hub"); // 이미 있으면 덮고, 없으면 붙인다
      // 이 페이지에서는 **안 걷는다**(걷지않음) — 준비를 기다릴 대상은 다음 페이지(나주 맵)다
      로딩영상켜기("나주", { 걷지않음: true });
      타이머.current = setTimeout(() => 로딩영상이어서이동(목적.toString()), 덮고넘기기);
    };
    window.addEventListener("kgeseo:나주진입", 시작);
    // 나주에서 「뒤로」 로 돌아오면(bfcache) 다시 탈 수 있게 잠금을 푼다
    const 돌아옴 = (e) => { if (e.persisted) 진행.current = false; };
    window.addEventListener("pageshow", 돌아옴);
    return () => {
      window.removeEventListener("pageshow", 돌아옴);
      window.removeEventListener("kgeseo:나주진입", 시작);
      clearTimeout(타이머.current);
    };
  }, []);

  // 화면에 그리는 건 로딩영상판(main.jsx)이 한다 — 여기는 신호만 받아 넘긴다
  return null;
}
