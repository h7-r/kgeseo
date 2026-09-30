// 캐릭터생성연결.jsx — 웹사이트 「게임 시작」 → **캐릭터 생성** → 튜토리얼(/) 을 잇는 자리
//
// [흐름]
//   시작페이지(5175) 「모험 시작하기」·로그인 뒤 「플레이하기」
//     → 이 앱의 /캐릭터생성 (여기)
//     → 완료하면 외형을 로비 아바타 저장소에 적고 / (튜토리얼 — 역·비밀 복도) 로 간다
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

const CC캐릭터생성화면 = lazy(() => import("../naju01/src/캐릭터생성/캐릭터생성화면.jsx"));

// ★ App.jsx 의 로비메시저장키 와 **같은 값**이어야 한다 — 로비 아바타가 여기서 외형을 읽는다.
const 로비메시저장키 = "kgeseo.lobby.meshy.appearance.v1";
const 초안저장키 = "kgeseo.character.draft.v1";
const 캐릭터저장키 = "kgeseo.character.v1";

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
  const 처음값 = useMemo(() => 읽기(초안저장키), []);
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
      //   완료 표시를 잠깐 보여 준 뒤 넘긴다. 두 번 눌려도 한 번만 간다.
      if (!넘어감.current) {
        넘어감.current = true;
        setTimeout(() => 가기("/", { replace: true }), 700);
      }
      return { ok: true };
    },
    [가기],
  );

  // 닫기 — 웹사이트로 돌아간다(주소를 모르면 이전 페이지로)
  const onCancel = useCallback(() => {
    const 사이트 = import.meta.env?.VITE_사이트주소;
    if (사이트) window.location.assign(사이트);
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
