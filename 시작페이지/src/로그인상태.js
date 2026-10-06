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

/* ── 로그인 유지 시간 ──
   로그인하고 2시간이 지나면 저절로 로그아웃된다. 탭을 안 닫고 자리를 오래 비운
   공용 컴퓨터에서 남이 이어 쓰는 걸 줄인다. (서버가 붙으면 토큰 만료 시간을 따른다) */
const 유지시간 = 2 * 60 * 60 * 1000;

/* 세션에 넣어도 되는 칸만 골라 담는다 — 비밀번호·해시 같은 건 실수로라도 안 들어가게 */
const 담을칸 = ["아이디", "이메일", "이름", "지역", "가입때", "테스트", "제공자", "사진"];

/** 지금 로그인한 사람. 없거나 만료됐으면 null */
export function 지금로그인() {
  try {
    const 값 = sessionStorage.getItem(열쇠);
    if (!값) return null;
    const 사람 = JSON.parse(값);
    /* 만료됐으면 지우고 로그아웃 상태로 */
    if (!사람?.들어온때 || Date.now() - 사람.들어온때 > 유지시간) {
      sessionStorage.removeItem(열쇠);
      return null;
    }
    return 사람;
  } catch {
    /* 사생활 보호 모드 등에서 막힐 수 있다 — 그땐 로그인 안 한 것으로 본다 */
    return null;
  }
}

/** 로그인 처리 */
export function 들어가기(사람) {
  try {
    const 담을것 = Object.fromEntries(담을칸.filter((k) => 사람?.[k] !== undefined).map((k) => [k, 사람[k]]));
    sessionStorage.setItem(열쇠, JSON.stringify({ ...담을것, 들어온때: Date.now() }));
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
    /* 같은 사람·같은 로그인이면 이전 객체를 그대로 둔다 — 1분마다 화면이 다시 그려지지 않게 */
    const 갱신 = () =>
      set사람((전) => {
        const 새 = 지금로그인();
        return 전?.이메일 === 새?.이메일 && 전?.들어온때 === 새?.들어온때 ? 전 : 새;
      });
    window.addEventListener(알림이름, 갱신);
    /* 만료 시각이 되면 화면도 로그아웃 상태로 바꾼다 — 1분마다 확인 */
    const 시계 = setInterval(갱신, 60 * 1000);
    /* 다른 탭에서 로그아웃하면 이쪽도 따라 내려간다 */
    window.addEventListener("storage", 갱신);
    return () => {
      clearInterval(시계);
      window.removeEventListener(알림이름, 갱신);
      window.removeEventListener("storage", 갱신);
    };
  }, []);

  return 사람;
}
