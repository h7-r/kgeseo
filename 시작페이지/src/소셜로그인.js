/* ═══════════════════════════════════════════════════════
   간편 로그인 — 구글 · 네이버

   [어디까지 여기서 하나]
   OAuth 2.0 은 「인가 코드 받기」까지가 앞단 몫이다. 코드를 토큰으로
   바꾸는 건 **서버에서** 해야 한다 (client_secret 이 필요한데, 그걸
   브라우저에 두면 그대로 새어 나간다). 그래서 여기서는
   인가 화면으로 보내는 것까지만 한다.

   [키는 어디서 오나]
   .env 에 넣고 Vite 가 넣어 준다 — VITE_구글_아이디 / VITE_네이버_아이디.
   키가 없으면 창을 띄우지 않고 **무엇이 없는지** 알려 준다.
   가짜로 성공한 척하는 것보다 낫다.

   .env 예시
     VITE_구글_아이디=xxxxxxxx.apps.googleusercontent.com
     VITE_네이버_아이디=xxxxxxxxxxxxxxxxxxxx
   ═══════════════════════════════════════════════════════ */

const 돌아올곳 = () => `${window.location.origin}/로그인/콜백`;

/* CSRF 를 막는 한 번 쓰는 값 — 돌아왔을 때 같은 값인지 확인한다 */
function 상태값만들기(어디) {
  const 값 = `${어디}.${crypto.randomUUID()}`;
  try {
    sessionStorage.setItem("소셜상태", 값);
  } catch {
    /* 사생활 보호 모드 등에서 막힐 수 있다 — 그래도 로그인은 시도하게 둔다 */
  }
  return 값;
}

export const 소셜 = {
  구글: {
    이름: "Google",
    색: "#ffffff",
    바탕: "#ffffff",
    키이름: "VITE_구글_아이디",
    주소(키) {
      const q = new URLSearchParams({
        client_id: 키,
        redirect_uri: 돌아올곳(),
        response_type: "code",
        scope: "openid email profile",
        state: 상태값만들기("구글"),
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
  },
  네이버: {
    이름: "Naver",
    색: "#ffffff",
    바탕: "#03c75a",
    키이름: "VITE_네이버_아이디",
    주소(키) {
      const q = new URLSearchParams({
        client_id: 키,
        redirect_uri: 돌아올곳(),
        response_type: "code",
        state: 상태값만들기("네이버"),
      });
      return `https://nid.naver.com/oauth2.0/authorize?${q}`;
    },
  },
};

/** 키가 꽂혀 있으면 인가 화면으로 보낸다. 없으면 왜 못 가는지 돌려준다. */
export function 소셜로가기(어디) {
  const ㅅ = 소셜[어디];
  if (!ㅅ) return `${어디} 는 아직 연결하지 않았습니다.`;
  const 키 = import.meta.env[ㅅ.키이름];
  if (!키) return `${어디} 로그인 키(${ㅅ.키이름})가 아직 없습니다.`;
  window.location.href = ㅅ.주소(키);
  return "";
}
