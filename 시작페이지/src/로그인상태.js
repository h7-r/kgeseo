import { useEffect, useState } from "react";

/* ═══════════════════════════════════════════════════════
   로그인 상태

   [지금 무엇인가]
   인증 서버가 아직 없다. 그래서 이건 **화면 흐름을 위한 임시 자물쇠**다.
   브라우저 안(sessionStorage)에만 기록하고, 탭을 닫으면 사라진다.

   ★ 보안 장치가 아니다. 누구나 개발자 도구로 값을 넣을 수 있다.
     진짜 보호는 서버가 토큰을 확인해야 이뤄진다. 여기서 막는 이유는
     「로그인 안 했는데 마이페이지가 그냥 열린다」는 **흐름의 구멍**을
     메우기 위해서다. 게임 쪽 로그인이 붙으면 이 파일만 갈아 끼우면 된다.

   [왜 localStorage 가 아니라 sessionStorage 인가]
   공용 컴퓨터에서 탭만 닫고 자리를 뜨는 일이 흔하다. 탭이 닫히면 같이
   사라지는 쪽이 안전하다.

   [왜 이벤트를 따로 쏘나]
   같은 탭 안에서는 storage 이벤트가 안 온다(다른 탭에서 바뀔 때만 온다).
   그래서 바뀔 때마다 직접 알린다 — 그래야 헤더와 화면이 같이 바뀐다.
   ═══════════════════════════════════════════════════════ */

const 열쇠 = "모험가";
const 알림이름 = "로그인바뀜";

/** 지금 로그인한 사람. 없으면 null */
export function 지금로그인() {
  try {
    const 값 = sessionStorage.getItem(열쇠);
    return 값 ? JSON.parse(값) : null;
  } catch {
    /* 사생활 보호 모드 등에서 막힐 수 있다 — 그땐 로그인 안 한 것으로 본다 */
    return null;
  }
}

/** 로그인 처리 */
export function 들어가기(사람) {
  try {
    sessionStorage.setItem(열쇠, JSON.stringify(사람));
  } catch {
    /* 저장이 막혀도 화면은 계속 돌아야 한다 */
  }
  window.dispatchEvent(new Event(알림이름));
}

/** 로그아웃 처리 */
export function 나가기() {
  try {
    sessionStorage.removeItem(열쇠);
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(알림이름));
}

/** 화면에서 로그인 상태를 구독한다 */
export function use로그인() {
  const [사람, set사람] = useState(() => 지금로그인());

  useEffect(() => {
    const 갱신 = () => set사람(지금로그인());
    window.addEventListener(알림이름, 갱신);
    /* 다른 탭에서 로그아웃하면 이쪽도 따라 내려간다 */
    window.addEventListener("storage", 갱신);
    return () => {
      window.removeEventListener(알림이름, 갱신);
      window.removeEventListener("storage", 갱신);
    };
  }, []);

  return 사람;
}
