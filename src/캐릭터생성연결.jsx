// 캐릭터생성연결.jsx — 웹사이트 「게임 시작」 → **캐릭터 생성** → 튜토리얼(/) 을 잇는 자리
//
// [흐름]
//   시작페이지(5175) 로그인 뒤 「게임 시작하기」「플레이하기」 …
//     → (웹사이트가 오프닝 시네마틱을 2.6초 틀고) 이 앱의 /캐릭터생성?전환=2.61 (여기)
//        · 오프닝은 naju01/src/전환/로딩영상.jsx 가 그 초부터 이어 튼다(소리 포함). 캐릭터 3D 가 다 뜨면
//          오른쪽 아래에 SKIP 이 뜨고, 끝까지 보거나 SKIP 을 누르면 생성 화면이 나온다
//     → 「확인 · 게임 시작」(완료) — 외형을 로비 아바타 저장소에 적는다
//     → 곧바로 로딩 영상(경주 → 여수 반복 + 안내 문장)으로 덮고, 그 뒤에서 / (튜토리얼 — 비밀 복도
//        끝 비상계단 앞) 가 뜬다. 역 씬이 다 뜨면 영상이 걷힌다.
//
// [왜 App 밖에 두나]
//   App 은 역 씬 전체(캔버스·조명·소품)를 띄운다. 생성 화면 뒤에서 그걸 같이 돌리면
//   GPU 를 두 벌 쓴다. main.jsx 가 이 주소에서는 App 을 아예 안 그린다.
//   그래서 / 로 넘어갈 때 App 이 **처음 마운트되며** 저장소의 새 외형을 읽는다
//   (App 의 치비설정은 마운트할 때 한 번만 저장소를 읽는다).
//
// [서버가 아직 없다]
//   이름 확인·저장은 원래 서버 몫이다(docs/캐릭터생성-인수인계.md 5장). 지금은
//   이 브라우저 안에서만 확인하고 저장한다. 서버가 생기면 checkName · onComplete
//   두 함수의 속만 바꾸면 된다 — 화면 쪽은 한 줄도 안 바뀐다.

import { lazy, Suspense, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 기본카탈로그 } from "../naju01/src/캐릭터생성/카탈로그.js";
import { 렌더러설정 } from "../naju01/src/캐릭터생성/외형데이터.js";
import { 형식검사 } from "../naju01/src/캐릭터생성/이름규칙.js";
import { 기본메시설정, 메시설정보정 } from "../naju01/src/메시외형옵션.js";
import { 로딩영상켜기 } from "../naju01/src/전환/로딩영상.jsx";

const CC캐릭터생성화면 = lazy(() => import("../naju01/src/캐릭터생성/캐릭터생성화면.jsx"));

// ★ App.jsx 의 로비메시저장키 와 **같은 값**이어야 한다 — 로비 아바타가 여기서 외형을 읽는다.
const 로비메시저장키 = "kgeseo.lobby.meshy.appearance.v1";
const 초안저장키 = "kgeseo.character.draft.v1";
const 캐릭터저장키 = "kgeseo.character.v1";

/* 웹사이트 주소 — 「뒤로」(onCancel)가 돌아갈 곳.
   ★ 이름은 **영문만**. 전엔 VITE_사이트주소 였는데, Vite 가 .env 를 읽을 때(dotenv) 이름에
     영문·숫자·_ 만 알아봐서 한글 이름 줄은 통째로 무시됐다 → 늘 비어 「뒤로 가기」 로만 돌았다.
   개발 서버에서는 안 적어도 시작페이지 개발 서버(5175)로 간다. */
const 사이트주소 = import.meta.env?.VITE_SITE_URL || (import.meta.env?.DEV ? "http://localhost:5175" : "");

const 읽기 = (키) => {
  try {
    const raw = localStorage.getItem(키);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const 쓰기 = (키, 값) => {
  try {
    localStorage.setItem(키, JSON.stringify(값));
    return true;
  } catch {
    return false;
  }
};

/** 완료 데이터(appearance) → 로비 아바타 설정(메시외형옵션 형식) */
function 로비설정으로(appearance) {
  // 렌더러설정 은 초안 모양(colors)을 받는다 — 완료 데이터는 supportedColorValues 로 나간다
  const 렌더 = 렌더러설정(
    { ...appearance, colors: appearance.supportedColorValues ?? appearance.colors },
    기본카탈로그,
  );
  // 걷기·달리기·주먹 쥠 같은 **게임 쪽 값**은 기본을 그대로 쓰고, 외형만 덮는다
  return 메시설정보정({
    ...기본메시설정,
    ...렌더,
    motion: "자동",
    walkMotion: 기본메시설정.walkMotion,
    runMotion: 기본메시설정.runMotion,
    fistHands: 기본메시설정.fistHands,
  });
}

export default function 캐릭터생성연결() {
  const 가기 = useNavigate();
  // 지난번 초안이 있으면 그 모습에서 이어서 만든다(이름은 다시 확인해야 한다 — 화면 규칙)
  // ★ 단, **긴 머리는 처음 값으로 잡지 않는다** — 단발로 돌려 연다(긴 머리 모델은 귀 문제가 있다).
  //   긴 머리는 화면에서 직접 고를 때만 된다.
  const 처음값 = useMemo(() => {
    const 초안 = 읽기(초안저장키);
    if (!초안?.appearance) return 초안;
    const 머리 = 초안.appearance.hairId;
    if (typeof 머리 === "string" && 머리.endsWith(".long"))
      return { ...초안, appearance: { ...초안.appearance, hairId: 초안.appearance.gender === "feminine" ? "hair.f.bob" : "hair.m.crop" } };
    return 초안;
  }, []);
  const 넘어감 = useRef(false);

  // 이름 확인 — 지금은 형식만 본다(서버가 생기면 여기서 중복을 묻는다)
  const checkName = useCallback(async (이름) => {
    const 결과 = 형식검사(이름);
    if (!결과.ok) return { status: "invalid", message: 결과.메시지 };
    return { status: "available" };
  }, []);

  const onDraftChange = useCallback((초안) => {
    쓰기(초안저장키, 초안);
  }, []);

  const onComplete = useCallback(
    async (payload) => {
      const 됨 = 쓰기(로비메시저장키, 로비설정으로(payload.appearance)) && 쓰기(캐릭터저장키, payload);
      if (!됨) return { ok: false, reason: "failed", message: "이 브라우저에 저장할 수 없습니다." };
      // 화면은 스스로 안 넘어간다(완료 상태로 멈춰 있다) — 여기서 튜토리얼로 보낸다.
      //   ① 로딩 영상으로 먼저 덮고(경주 → 여수 반복 · 안내 문장)
      //   ② 덮인 뒤(0.35초) 주소를 / 로 바꾼다. 영상 막은 main.jsx 에 있어 주소가 바뀌어도 살아 있고,
      //      역 씬이 다 뜨면 스스로 걷힌다 — 컴퓨터마다 걸리는 시간이 달라 준비될 때까지 반복한다.
      //   두 번 눌려도 한 번만 간다.
      if (!넘어감.current) {
        넘어감.current = true;
        로딩영상켜기("튜토리얼");
        setTimeout(() => 가기("/", { replace: true }), 350);
      }
      return { ok: true };
    },
    [가기],
  );

  // 닫기 — 웹사이트로 돌아간다(주소를 모르면 이전 페이지로)
  const onCancel = useCallback(() => {
    if (사이트주소) window.location.assign(사이트주소);
    else window.history.back();
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#02040a" }}>
      <Suspense fallback={null}>
        <CC캐릭터생성화면
          initialValue={처음값}
          checkName={checkName}
          onDraftChange={onDraftChange}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      </Suspense>
    </div>
  );
}
