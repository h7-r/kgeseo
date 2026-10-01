/* ═══════════════════════════════════════════════════════
   그림 미리 데우기 — 스크롤해서 닿기 **전에** 페이지 그림을 받아 풀어 둔다

   [문제] 내릴 때마다 그림이 늦게 떴다.
     loading="lazy" 는 「화면 가까이 와야」 받기 시작하고, 받은 뒤에도 그림을 픽셀로 푸는(decode)
     일이 화면에 처음 그릴 때 일어난다. 빠르게 굴리면 이 둘이 스크롤을 못 따라가 빈칸 → 툭 하고 뜬다.
   [해결] 첫 화면이 다 뜬 뒤 브라우저가 한가할 때(requestIdleCallback),
     ① 남은 lazy 그림을 3장씩 eager 로 바꿔 받기 시작하고
     ② img.decode() 로 미리 풀어 둔다 → 스크롤해서 닿으면 이미 그릴 준비가 끝나 있다.
     3장씩 끊어서 하므로 한 번에 주 스레드를 오래 잡지 않는다(긴 작업 방지).
   첫 화면에 꼭 필요한 것(히어로·글꼴·JS)은 이미 받은 뒤라 서로 다투지 않는다.
   ═══════════════════════════════════════════════════════ */
const 한가할때 = (일) =>
  window.requestIdleCallback ? window.requestIdleCallback(일, { timeout: 1500 }) : window.setTimeout(일, 200);

export function 그림미리데우기() {
  const 목록 = [...document.querySelectorAll('img[loading="lazy"]')];
  let 번호 = 0;
  const 한묶음 = () => {
    for (let 개수 = 0; 개수 < 3 && 번호 < 목록.length; 개수++, 번호++) {
      const 그림 = 목록[번호];
      if (!그림.isConnected) continue;
      그림.loading = "eager";
      그림.decode?.().catch(() => {}); // 못 풀어도(아직 안 옴·깨짐) 조용히 넘어간다 — 화면에 닿으면 원래대로 그린다
    }
    if (번호 < 목록.length) 한가할때(한묶음);
  };
  한가할때(한묶음);
}
