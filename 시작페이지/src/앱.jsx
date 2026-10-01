import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { 인증, 게임소개, 약관화면, 고객센터화면, 요금제화면, 마이페이지화면, 영상캐릭터, 찾기화면, 모두미리받기 } from "./화면목록.js";
import { use화면밖쉼 } from "./쉼.js";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import 내비층 from "./내비층.jsx";
import { use읽은만큼, use스크롤중 } from "./움직임.js";
import { 배경시작점 } from "./공통.js";
import 시작화면 from "./시작화면.jsx";
import 에러 from "./화면/에러.jsx";
import 영상모달 from "./구간/영상모달.jsx";
import 게임전환, { 입장영상 } from "./구간/게임전환.jsx";
import { use히어로덮음 } from "./가림.js";
import { 그림미리데우기 } from "./그림미리.js";

/* ★ 성능: 화면마다 코드를 떼어(lazy) 첫 JS 를 줄인다. 쪽을 옮길 때 기다리지
   않도록, 첫 화면이 다 뜬 뒤 한가할 때 나머지 화면 코드를 미리 받아 둔다.
   (목록과 「받아 둔 화면은 멈추지 않고 바로 그리기」는 화면목록.js 로 옮겼다 —
    머리띠도 메뉴에 마우스를 올릴 때 같은 목록으로 미리 받는다) */
if (typeof window !== "undefined") {
  const 시작 = () => (window.requestIdleCallback ? requestIdleCallback(모두미리받기, { timeout: 4000 }) : setTimeout(모두미리받기, 2000));
  if (document.readyState === "complete") 시작(); else window.addEventListener("load", 시작, { once: true });

  /* 그림 미리 데우기(그림미리.js) — 첫 화면이 다 뜬 뒤, 그리고 쪽을 옮길 때마다(새 쪽의 그림이 붙은 뒤) */
  const 데우기 = () => window.setTimeout(그림미리데우기, 800);
  if (document.readyState === "complete") 데우기(); else window.addEventListener("load", 데우기, { once: true });
  window.addEventListener("쪽바뀜", 데우기);

  /* 게임 전환 영상(구간/게임전환.jsx)을 한가할 때 미리 받아 둔다 — **로그인한 사람만**.
     게임 단추를 눌렀을 때 영상이 곧바로 흘러야 한다(안 받아 두면 첫 장면에서 잠깐 멈춘다).
     로그인 안 한 사람은 단추를 눌러도 로그인 화면으로 가니 받을 이유가 없다(2.4MB 아끼기). */
  let 받음 = false;
  const 전환영상받기 = () => {
    if (받음 || !지금로그인()) return;
    받음 = true;
    const 링크 = document.createElement("link");
    링크.rel = "prefetch";
    링크.href = 입장영상.주소;
    document.head.appendChild(링크);
  };
  const 한가할때 = () => (window.requestIdleCallback ? requestIdleCallback(전환영상받기, { timeout: 6000 }) : setTimeout(전환영상받기, 3000));
  if (document.readyState === "complete") 한가할때(); else window.addEventListener("load", 한가할때, { once: true });
  window.addEventListener("쪽바뀜", 한가할때); // 방금 로그인하고 돌아온 경우
}
import { use로그인, 지금로그인 } from "./로그인상태.js";
import { 게임시작 } from "./이동표.js";
import 입체칸 from "./입체/입체칸.jsx";

/* 화면 목록 — 피그마 프로토타입의 전환을 주소로 옮긴 것 */
export default function 앱() {
  return (
    <>
      {/* ═══ 페이지 뒤에 깔리는 입체 공간 ═══
          스크롤하면 카메라가 이 공간 안으로 날아간다(입체/깊은우주.jsx).
          쪽전환 **바깥**에 둬야 화면을 옮겨도 다시 만들어지지 않는다.
          transform 이 걸린 무대 밖이라 fixed 가 창 기준으로 제대로 잡힌다. */}
      <배경공간 />

      <진행막대 />
      <내비층 />
      {/* 경주 원·시나리오 카드를 누르면 뜨는 큰 영상 — 화면마다 따로 두지 않고 여기 한 번만(영상창상태.js) */}
      <영상모달 />
      {/* 「게임 시작」 을 누르면 뜨는 전환 영상 — 역시 한 번만(구간/게임전환.jsx) */}
      <게임전환 />
      <쪽전환>
        <Routes>
        <Route path="/" element={<시작화면 />} />
        <Route path="/로그인" element={<인증 모드="로그인" />} />
        <Route path="/회원가입" element={<인증 모드="회원가입" />} />
        <Route path="/비밀번호-찾기" element={<인증 모드="비밀번호찾기" />} />
        <Route path="/비밀번호-재설정" element={<인증 모드="인증중" />} />
        <Route path="/비밀번호-재설정/완료" element={<인증 모드="인증완료" />} />
        <Route path="/게임소개" element={<게임소개 />} />
        <Route path="/약관" element={<약관화면 />} />
        <Route path="/고객센터" element={<고객센터화면 />} />
        <Route path="/요금제" element={<요금제화면 />} />
        {/* 마이페이지는 로그인한 사람만 */}
        <Route path="/마이페이지" element={<문지기><마이페이지화면 /></문지기>} />
        <Route path="/영상캐릭터" element={<영상캐릭터 />} />
        <Route path="/찾기" element={<찾기화면 />} />
        {/* 게임으로 이어 주는 자리 — 주소(/게임시작)로 바로 들어온 사람용. 사이트 단추들은 이 길을 안 거친다 */}
        <Route path="/게임시작" element={<게임으로 />} />

        {/* 막힌 길들 — 404 말고도 미리 만들어 둔다.
            서버가 붙으면 그쪽에서 이 주소로 보내면 된다. */}
        <Route path="/오류/403" element={<에러 종류="403" />} />
        <Route path="/오류/500" element={<에러 종류="500" />} />
        <Route path="/점검중" element={<에러 종류="503" />} />
        <Route path="/오프라인" element={<에러 종류="오프라인" />} />

        {/* 없는 주소는 404 화면으로 */}
        <Route path="*" element={<에러 종류="404" />} />
        </Routes>
      </쪽전환>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   쪽 전환 — 주소가 바뀔 때마다 살짝 떠오르며 나타난다

   [왜 key 를 붙이나]
   key 가 바뀌면 칸이 새로 만들어지고, 그래야 CSS 애니메이션이 **다시**
   돈다. key 없이 클래스만 두면 첫 화면에서 한 번만 돌고 끝난다.

   [transform 을 왜 애니메이션으로만 쓰나]
   끝난 뒤에도 transform 이 남아 있으면(fill-mode: forwards) 이 칸이
   position: fixed 의 기준이 돼서 안쪽 배치가 틀어진다. 그래서 끝나면
   transform 이 없는 상태로 돌아가게 둔다.

   주소가 바뀌면 맨 위로 올린다 — 긴 페이지에서 옮겨 가면 스크롤이
   그대로 남아 엉뚱한 중간이 먼저 보인다.
   ═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   문지기 — 로그인해야 들어갈 수 있는 화면을 감싼다

   [왜 다른 곳으로 보내지 않고 403 화면을 보여 주나]
   로그인 화면으로 곧장 튕기면 **왜 튕겼는지**를 모른다. 주소창만 바뀌고
   끝이라 "내가 뭘 잘못 눌렀나" 싶어진다.
   한 번 멈춰서 「여기는 조사관만 들어갈 수 있다」고 알려 주고, 로그인으로
   가는 단추를 주는 쪽이 친절하다.

   ★ 이건 흐름을 위한 자물쇠지 보안이 아니다 — 로그인상태.js 참고.
   ═══════════════════════════════════════════════════════ */
/* /게임시작 — 로그인했으면 전환 영상과 함께 게임(캐릭터 생성)으로, 아니면 로그인부터.
   ★ 로그인 뒤에는 **홈으로** 돌아온다(?다음= 을 안 붙인다). 로그인하자마자 게임으로 튕기지 않게 —
     사용자 지시 「로그인하면 그대로 웹사이트에 있고」. 게임은 게임 단추를 눌러야 시작된다.
   (replace — 뒤로가기를 눌렀을 때 이 중간 자리로 다시 돌아와 또 튕겨 나가지 않게) */
function 게임으로() {
  const 가기 = useNavigate();
  useEffect(() => {
    if (지금로그인()) 게임시작((길) => 가기(길, { replace: true }));
    else 가기("/로그인", { replace: true });
  }, [가기]);
  return <p style={{ padding: "160px 24px", textAlign: "center", color: "#8fa0c4" }}>게임으로 이동하는 중…</p>;
}

function 문지기({ children }) {
  const 사람 = use로그인();
  if (!사람) return <에러 종류="403" />;
  return children;
}

/* ═══════════════════════════════════════════════════════
   뒤에 깔리는 입체 공간 — **스크롤하는 동안에만** 보인다

   멈추면 0.7초에 걸쳐 사라진다. 읽는 동안 글자 뒤로 격자와 조각이
   지나가면 글이 잘 안 읽힌다. 넘길 때만 공간이 살아나면 둘 다 얻는다.

   사라진 뒤에는 렌더도 멈춘다(깨움=false) — 안 보이는 걸 계속 그릴
   이유가 없다. 마지막 그림은 캔버스에 남아 있으니 CSS 로만 흐려진다.

   [왜 한가운데가 아닌가]
   터널이 모이는 점(소실점)은 곧 **퍼져 나가는 시작점**이다. 그게 화면
   정중앙에 있으면 글을 읽는 자리와 정확히 겹쳐서, 줄이 사방으로 뻗을
   때마다 글 위를 지나간다 — 답답하다는 말이 나온 이유다.
   시작점을 오른쪽 아래(공통.js 의 배경시작점)로 옮기면, 뻗는 줄은
   왼쪽 위 바깥으로 빠져나가고 본문이 앉는 가운데·왼쪽은 잔잔해진다.

   [어떻게 옮기나]
   캔버스째 밀면 반대쪽에 캔버스가 안 닿는 띠가 생긴다. 그래서 캔버스는
   화면 크기 그대로 두고, **카메라 투영을 어긋나게** 해서 소실점만 옮긴다
   (입체/깊은우주.jsx 의 소실점옮기기). 픽셀이 한 장도 안 늘고 덜 닿는 곳도
   없다. 여기서는 같은 자리에 맞춘 덮개만 씌운다.

   [덮개가 하는 일]
   시작점에서 멀어질수록 서서히 비운다 — 본문이 앉는 왼쪽·가운데가 잔잔해지고,
   아래쪽도 눌러 준다. 푸터는 제 배경(#060b1c)이 불투명해서 원래도 이 효과가
   비치지 않지만, 푸터에 닿기 전에 이미 옅어진다.
   ═══════════════════════════════════════════════════════ */

function 배경공간() {
  const 스크롤중 = use스크롤중(900);
  const 히어로덮음 = use히어로덮음();
  useEffect(() => { document.documentElement.classList.toggle("스크롤중", 스크롤중); }, [스크롤중]);

  const 가로 = Math.round(배경시작점.가로 * 100);
  const 세로 = Math.round(배경시작점.세로 * 100);
  /* 시작점이 오른쪽 끝에 가까우니 가로 반지름을 넉넉히 준다 —
     좁게 잡으면 화면 왼쪽 절반이 통째로 비어 보인다. */
  /* mask 의 불투명도 m 을 바탕색 덮개의 (1−m) 로 뒤집었다 */
  const 덮개 =
    `radial-gradient(150% 112% at ${가로}% ${세로}%,` +
    " rgba(1,4,10,0) 0%, rgba(1,4,10,0.05) 34%, rgba(1,4,10,0.6) 70%, rgba(1,4,10,1) 100%)";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: 스크롤중 ? 1 : 0,
        /* 나타날 땐 빠르게(넘기자마자 보여야 한다), 사라질 땐 천천히 */
        transition: 스크롤중 ? "opacity .22s ease-out" : "opacity .7s ease-in",
      }}
    >
      {/* 히어로가 창을 다 덮는 동안엔 재운다 — 안 보이는 걸 그리지 않는다 */}
      <입체칸 장면="깊은우주" 늦게 깨움={스크롤중 && !히어로덮음} />
      {/* ★ 성능: mask-image 대신 **바탕색 덮개**를 위에 얹는다.
          뒤가 늘 단색(body #01040a)이라 결과 픽셀은 mask 와 같다
          (canvas·m + 바탕·(1−m)). mask 는 WebGL 층마다 별도 렌더 패스를
          만들어 매 프레임 가려 칠하지만, 덮개는 변하지 않는 그라디언트 한 장이다. */}
      <div style={{ position: "absolute", inset: 0, background: 덮개 }} />
    </div>
  );
}

/* 화면 맨 위에서 읽은 만큼 차오르는 막대 */
function 진행막대() {
  const 막대 = use읽은만큼();
  return <div ref={막대} className="진행막대" aria-hidden="true" style={{ transform: "scaleX(0)" }} />;
}

function 쪽전환({ children }) {
  const 길 = useLocation().pathname;
  const 틀 = useRef(null);
  use화면밖쉼(틀, 길);

  /* ★ 성능·깜빡임: useEffect → useLayoutEffect.
     useEffect 는 **화면을 한 번 그린 뒤에** 돈다. 그래서 긴 페이지 중간에서 옮기면
     새 페이지가 옛 스크롤 자리(엉뚱한 중간)로 한 장 그려졌다가 맨 위로 튀었다.
     useLayoutEffect 는 그리기 **전에** 돌아서, 첫 장부터 맨 위로 그려진다. */
  useLayoutEffect(() => {
    /* ★ 이 scrollTo 는 사람이 굴린 게 아니다 — 입체 배경을 깨우지 않게 표시해 두고
       (use스크롤중 이 한 번 건너뛴다), 카메라가 관성으로 되감기지 않게 알린다. */
    if (window.scrollY !== 0) window.__프로그램스크롤 = true;
    window.scrollTo({ top: 0, behavior: "auto" });
    window.dispatchEvent(new Event("쪽바뀜"));
  }, [길]);

  return (
    <>
      <div key={길} ref={틀} className="쪽전환">
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </>
  );
}
