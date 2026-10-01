// 캐릭터 생성 화면 — 외형을 정하고 이름을 붙여 바깥으로 넘긴다.
//
// [화면 구조 — 2026-10-01 개편: 「게임 캐릭터 생성 창」 문법]
//   배경층   우리 웹사이트 그림(수사 책상) 한 장을 흐리고 어둡게 깐다 — 「어디에 들어왔는가」
//   3D층     투명 캔버스. 카메라는 **패널 왼쪽 무대 칸** 안에만 캐릭터를 담는다(안전영역).
//   패널     가운데 큰 창 하나. 모서리 꺾쇠 · 제목 · 심장박동 선 · 무대 | 설정 · 아래 단추 줄
//
//   [왜 바꿨나 — 사용자 지적]
//     「가독성 떨어지고 여백 없고, 버튼 식으로 각각 잘 나눠져야 하는데 그런 게 없다」.
//     예전엔 도구가 화면 가장자리에 **떠 있기만** 해서, 무엇이 단추고 무엇이 글인지,
//     어디까지가 한 묶음인지가 안 읽혔다. 이제 모든 조작이 **테두리 있는 칸** 안에 있고
//     묶음마다 제목이 붙는다. 순서는 01~05 단계 탭이 말해 준다.
//
//   [단추 두 개의 뜻]
//     ‹ 뒤로        → onCancel  (부모가 웹사이트로 돌려보낸다)
//     확인 · 게임 시작 → 이름 확인이 끝났으면 onComplete(부모가 튜토리얼로 넘긴다),
//                       아직이면 이름 탭으로 데려가 무엇이 남았는지 말해 준다.
//
// [이 화면이 하는 일과 안 하는 일]
//   한다:   외형 편집, 3D 미리보기, 이름 입력·중복확인 UI, 완료 데이터 만들기.
//   안 한다: 회원가입·로그인, 라우팅, 실제 API 호출, 계정 저장, 오프닝·튜토리얼로 넘어가기.
//
// [props 계약]  docs/캐릭터생성-인수인계.md 에 같은 내용이 정리돼 있다.
//   initialValue? / catalog? / nameRules? / checkName / onDraftChange? / onComplete / onCancel?
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import CC캐릭터프리뷰, { 보기목록 /* , 자세목록, 품질목록 — 관찰 옵션 막아 둠 */ } from "./캐릭터프리뷰.jsx";
import CC심장선, { 심장선CSS } from "./심장선.jsx";
import { 기본카탈로그, 슬롯이름, 색상슬롯이름, 썸네일고르기 } from "./카탈로그.js";
import {
  기본초안, 초안보정, 성별맞추기, 렌더러설정, 완료데이터, 체형항목, 체형묶음, 눈금들, 가까운눈금, 기본몸치수, 항목기본,
  슬롯선택지, 성별목록, 착장요약,
} from "./외형데이터.js";
import { 기본이름규칙, 규칙보정, 형식검사, 이름정규화, 글자수 } from "./이름규칙.js";
import { 색 as 원래색, 글꼴, 사이, 모션, 화면CSS } from "./스타일.js";

// ★ 이 화면만의 색 — **검정 · 흰색** 위주(사용자 지적 「너무 청록이다, 가독성 챙겨라」).
//   고른 것 = 흰 테두리 + 옅은 흰 바탕, 주 단추 = 흰 바탕 검은 글. 청록은 쓰지 않는다.
const 색 = {
  ...원래색,
  글: "#F5F6F7",
  흐린글: "rgba(245,246,247,0.72)",
  더흐린글: "rgba(245,246,247,0.46)",
  강조: "#FFFFFF",
  강조진함: "rgba(245,246,247,0.55)",
  선: "rgba(255,255,255,0.10)",
};

// 배경 그림 — 웹사이트 「게임 영상」 카드의 수사 책상(시작페이지/에셋/imgVideoCard2).
//   돋보기 · 홀로그램 · 기록 책이 「조사관」 이야기와 맞고, 청록 빛이 이 화면 강조색과 같다.
//   공용 public 에 두어 본편(5173)·naju01(5174) 어디서 떠도 같은 주소로 읽힌다.
const 배경그림 = "/thumbs/캐릭터생성/bg-investigation.webp";

// ── 아이콘 ───────────────────────────────────────────────────
// 한 가지 선 굵기·둥근 끝으로 맞춘다. 이모지·잡다한 기호를 섞지 않는다.
const 아이콘틀 = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
const 아이콘 = {
  기본: (<svg {...아이콘틀}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.6-3.7 3.3-5.6 6.5-5.6s5.9 1.9 6.5 5.6" /></svg>),
  체형: (<svg {...아이콘틀}><path d="M4 9h16v6H4z" /><path d="M8 9v3M12 9v4M16 9v3" /></svg>),
  헤어: (<svg {...아이콘틀}><path d="M5 13a7 7 0 0 1 14 0" /><path d="M5 13c0 4 1 6 1 6M19 13c0 4-1 6-1 6" /><path d="M9 6.5C10.5 4.8 13.8 4.6 15.5 6.6" /></svg>),
  의상: (<svg {...아이콘틀}><path d="M9 4 6 6 4 9l3 2v9h10v-9l3-2-2-3-3-2" /><path d="M9 4a3 3 0 0 0 6 0" /></svg>),
  이름: (<svg {...아이콘틀}><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M7 10h5M7 14h8" /><circle cx="16.5" cy="10" r="1.2" /></svg>),
  남성: (<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10" cy="14" r="5.5" /><path d="M14 10l6-6M15 4h5v5" /></svg>),
  여성: (<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="9" r="5.5" /><path d="M12 14.5V21M9 18h6" /></svg>),
  되돌리기: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>),
  다시: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>),
  초기화: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>),
  닫기: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>),
  다음: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>),
  이전: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>),
};

// 01~05 — 탭 순서가 곧 만드는 순서다. 마지막(이름)까지 가면 「확인 · 게임 시작」이 열린다.
// 다음 단추에 적는 말 — 군더더기 없이 「어디로 가나」만
const 다음말 = { 체형: "체형 설정", 헤어: "헤어 설정", 의상: "의상 설정", 이름: "조사관 이름" };

const 탭목록 = [
  ["기본", "기본", "성별 · 피부"],
  ["체형", "체형", "키 · 비율 · 체격"],
  ["헤어", "헤어", "머리 모양 · 색"],
  ["의상", "의상", "옷 · 신발 · 색"],
  ["이름", "이름", "조사관 이름"],
];
const 항목설명 = {
  기본: "조사관의 성별과 피부색을 정합니다.",
  체형: "키와 몸의 비율을 조절합니다. 기본값 그대로 넘어가도 됩니다.",
  헤어: "머리 모양과 머리색을 고릅니다.",
  의상: "지금 준비된 옷과 신발입니다. 아래에서 상의 · 하의 · 신발을 하나씩 고르세요.",
  이름: "게임 안에서 불릴 조사관의 이름입니다.",
};

// 의상 칸 → 색 갈래. 상의 = cloth(예전 이름 그대로), 하의 = bottom, 신발 = shoes
const 옷색키 = { top: "cloth", bottom: "bottom", shoes: "shoes" };
const 옷설명 = {
  top: "상의 종류와 상의 컬러를 고릅니다.",
  bottom: "하의 종류와 하의 컬러를 고릅니다.",
  shoes: "신발 종류와 신발 컬러를 고릅니다.",
};

const 이름상태글 = {
  입력전: "이름 중복확인을 진행해 주세요.",
  확인중: "확인하고 있습니다…",
  가능: "사용할 수 있는 이름입니다.",
  중복: "이미 사용 중인 이름입니다. 다른 이름을 입력해 주세요.",
  금지: "사용할 수 없는 이름입니다. 다른 이름을 입력해 주세요.",
  실패: "이름을 확인하지 못했습니다. 다시 시도해 주세요.",
  미연결: "이름 확인 기능이 연결되지 않았습니다.",
};
const 상태색 = { 가능: 색.성공, 중복: 색.오류, 금지: 색.오류, 실패: 색.경고, 미연결: 색.경고 };

// ── 체형 눈금 말 ───────────────────────────────────────────────
// 「아주 작게 · 작게 · 기본」 대신 **실제로 와닿는 말**로 보여 준다(사용자 요청).
//   다섯 칸은 외형데이터 「눈금들」 순서와 같다. 기본이 한쪽 끝인 항목(머리 크기·골격)은
//   첫 칸이 기본이라 말도 거기서부터 늘어난다. 숫자(cm)는 기본 키를 170cm 로 본 **안내값**이다.
const 표시눈금 = {
  heightScale: ["150cm 이하", "160cm", "170cm", "180cm", "190cm 이상"],
  headScale: ["보통", "조금 큼", "큼", "많이 큼", "아주 큼"],
  handScale: ["아주 작은 손", "작은 손", "보통", "큰 손", "아주 큰 손"],
  footScale: ["230mm 이하", "245mm", "260mm", "275mm", "290mm 이상"],
  shoulderWidth: ["좁은 어깨", "조금 좁음", "보통", "조금 넓음", "넓은 어깨"],
  hipWidth: ["좁은 골반", "조금 좁음", "보통", "조금 넓음", "넓은 골반"],
  armLength: ["짧은 팔", "조금 짧음", "보통", "조금 긺", "긴 팔"],
  legLength: ["짧은 다리", "조금 짧음", "보통", "조금 긺", "긴 다리"],
  armThickness: ["아주 가늚", "가늚", "보통", "굵음", "아주 굵음"],
  legThickness: ["아주 가늚", "가늚", "보통", "굵음", "아주 굵음"],
  build: ["마름", "슬림", "보통", "통통", "풍채 있음"],
  buff: ["보통", "조금 탄탄", "탄탄", "근육질", "아주 근육질"],
};

// ── 배치 ─────────────────────────────────────────────────────
// 패널 하나의 자리와, 그 안 「무대 칸」의 자리를 잰다. 안전영역(카메라가 피할 픽셀)은
//   무대 칸 바깥 전부다 — 그래서 캐릭터가 늘 무대 칸 한가운데 선다.
//   [수치] 4/8/16/24/32/48 배수. 패널 안쪽 여백 32 · 머리 104 · 발치 84.
function 배치재기(폭, 높이) {
  const 좁음 = 폭 < 1100 || 높이 < 640;
  const 바깥 = 좁음 ? 8 : Math.max(24, Math.round(Math.min(폭 * 0.035, 높이 * 0.04)));
  const 패널폭 = Math.min(1560, 폭 - 바깥 * 2);
  const 패널높이 = Math.min(960, 높이 - 바깥 * 2);
  const 왼 = Math.round((폭 - 패널폭) / 2);
  const 위 = Math.round((높이 - 패널높이) / 2);
  const 안 = 좁음 ? 16 : 32; // 패널 안쪽 여백
  const 머리 = 좁음 ? 76 : 104; // 제목 + 심장선
  const 발치 = 좁음 ? 72 : 84; // 아래 단추 줄
  const 몸위 = 위 + 머리;
  const 몸높이 = 패널높이 - 머리 - 발치;
  // 넓으면 무대 | 설정 두 칸, 좁으면 무대 위 · 설정 아래
  const 무대 = 좁음
    ? { x: 왼 + 안, y: 몸위, w: 패널폭 - 안 * 2, h: Math.round(몸높이 * 0.42) }
    : { x: 왼 + 안, y: 몸위, w: Math.round((패널폭 - 안 * 2) * 0.43), h: 몸높이 };
  const 설정 = 좁음
    ? { x: 왼 + 안, y: 무대.y + 무대.h + 12, w: 패널폭 - 안 * 2, h: 몸높이 - 무대.h - 12 }
    : { x: 무대.x + 무대.w + 32, y: 몸위, w: 패널폭 - 안 * 2 - 무대.w - 32, h: 몸높이 };
  const 보기띠 = 56; // 무대 칸 아래의 보기 전환 단추 줄
  return {
    좁음, 패널: { x: 왼, y: 위, w: 패널폭, h: 패널높이 }, 안, 머리, 발치, 무대, 설정, 보기띠,
    안전영역: {
      왼쪽: 무대.x + 16,
      오른쪽: 폭 - (무대.x + 무대.w) + 16,
      위: 무대.y + 12,
      아래: 높이 - (무대.y + 무대.h) + 보기띠 + 8,
    },
  };
}

// ── 작은 조각들 ───────────────────────────────────────────────
/** 칸 단추 — 테두리가 있는 하나의 칸. 고르면 강조색 테와 옅은 바탕 */
function CC칸단추({ 고름, children, onClick, style, ...남은 }) {
  return (
    <button type="button" className="칸단추" onClick={onClick} aria-pressed={고름}
            style={{ ...칸단추, ...(고름 ? 고른칸단추 : null), ...style }} {...남은}>
      {children}
    </button>
  );
}

/** 묶음 — 작은 제목(대문자 라벨처럼) + 내용. 묶음끼리는 24px 띄운다 */
function CC묶음({ 제목, 덧, children }) {
  return (
    <section style={{ display: "grid", gap: 사이.m }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 사이.s }}>
        <h3 style={묶음제목}>{제목}</h3>
        {덧 ? <span style={{ marginLeft: "auto", ...작은글 }}>{덧}</span> : null}
      </div>
      {children}
    </section>
  );
}

function CC슬라이더({ 항목, 값, 성별, 바꾸기, 끌기시작, 끌기끝, 되돌리기 }) {
  const id = useId();
  // ── 퍼센트가 아니라 **눈금 다섯 칸**을 고른다(외형데이터 「눈금」) ──────────
  //   슬라이더의 값은 칸 번호(0~4)이고, 바깥으로 나가는 값은 그 칸이 가리키는
  //   실수다. 그래서 초안·완료 데이터·렌더러는 예전과 똑같다.
  const 눈금 = useMemo(() => 눈금들(항목, 성별), [항목, 성별]);
  const 칸 = 가까운눈금(눈금, 값);
  const 말 = (i) => 표시눈금[항목.key]?.[i] ?? 눈금[i]?.이름 ?? "";
  const 칸이름 = 말(칸);
  const 칸으로 = (다음, 이력에) => {
    const i = Math.max(0, Math.min(눈금.length - 1, 다음));
    바꾸기(눈금[i].값, 이력에);
  };
  const 기본칸 = 눈금.findIndex((v) => v.이름 === "기본");
  void 기본칸;
  return (
    <div className="슬라줄" style={슬라이더칸}>
      <div style={{ display: "flex", alignItems: "center", gap: 사이.s }}>
        <label htmlFor={id} style={{ font: `600 14px/1.3 ${글꼴.본문}`, color: 색.글 }}>{항목.이름}</label>
        <output htmlFor={id} style={{ marginLeft: "auto", ...값표 }}>{칸이름}</output>
        <span className="미세" style={{ display: "flex", gap: 4 }}>
          <button type="button" aria-label={`${항목.이름} 한 칸 줄이기`} style={작은칸단추} onClick={() => 칸으로(칸 - 1, true)}>−</button>
          <button type="button" aria-label={`${항목.이름} 한 칸 늘리기`} style={작은칸단추} onClick={() => 칸으로(칸 + 1, true)}>＋</button>
          <button type="button" aria-label={`${항목.이름} 초기화`} style={작은칸단추} onClick={되돌리기}>↺</button>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={눈금.length - 1}
        step={1}
        value={칸}
        /* 읽어 주는 값도 숫자가 아니라 칸 이름이다(화면에 보이는 것과 같아야 한다) */
        aria-valuetext={칸이름}
        list={`${id}-눈금`}
        onPointerDown={끌기시작}
        onKeyDown={끌기시작}
        onChange={(e) => 칸으로(Number(e.target.value), false)}
        onPointerUp={끌기끝}
        onKeyUp={끌기끝}
        onBlur={끌기끝}
      />
      <datalist id={`${id}-눈금`}>
        {눈금.map((v, i) => (<option key={v.이름} value={i} label={v.이름} />))}
      </datalist>
      {/* 양 끝 말 — 「어느 쪽으로 밀면 무엇이 되나」가 손대기 전에 읽힌다 */}
      <div style={{ display: "flex", justifyContent: "space-between", ...작은글 }}>
        <span>{말(0)}</span>
        <span>{말(눈금.length - 1)}</span>
      </div>
    </div>
  );
}

function CC색고르기({ 갈래, 목록, 값, 바꾸기 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: 사이.s }}>
      {목록.map(([코드, 이름]) => {
        const 고름 = 코드.toLowerCase() === (값 ?? "").toLowerCase();
        return (
          <button
            key={코드}
            type="button"
            className="색칸"
            onClick={() => 바꾸기(코드)}
            aria-pressed={고름}
            aria-label={`${색상슬롯이름[갈래]} 색 ${이름}`}
            title={이름}
            style={{ ...색칸, background: 코드, ...(고름 ? 고른색칸 : null) }}
          >
            {고름 ? <span style={{ color: "#0A0B0D", font: "800 12px/1 sans-serif" }}>✓</span> : null}
          </button>
        );
      })}
      <label className="색칸" style={{ ...색칸, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.06)", cursor: "pointer" }}
             title="직접 고르기">
        <input
          type="color"
          value={값 ?? "#ffffff"}
          onChange={(e) => 바꾸기(e.target.value)}
          aria-label={`${색상슬롯이름[갈래]} 색 직접 고르기`}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={색.흐린글} strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </label>
    </div>
  );
}

function CC아이템카드({ 고름, 이름, 설명, 썸네일, onClick }) {
  return (
    <button type="button" className="칸단추" onClick={onClick} aria-pressed={고름}
            style={{ ...칸단추, ...(고름 ? 고른칸단추 : null), padding: 8, display: "grid", gap: 8, justifyItems: "stretch", position: "relative" }}>
      <span style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.25)", display: "grid", placeItems: "center" }}>
        {썸네일
          ? <img src={썸네일} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <span style={작은글}>없음</span>}
      </span>
      <span style={{ font: `600 13px/1.3 ${글꼴.본문}`, color: 고름 ? "#fff" : 색.흐린글, textAlign: "center" }}>{이름}</span>
      {설명 ? <span style={{ ...작은글, textAlign: "center", marginTop: -4 }}>{설명}</span> : null}
      {고름 ? <span style={체크표}>✓</span> : null}
    </button>
  );
}

/**
 * 보기 전환(전신 · 머리 · 손 · 발) — 고른 칸의 반투명 상자가 **누른 단추로 미끄러져 간다.**
 *   [왜] 단추마다 배경을 켰다 껐다 하면 「어디서 어디로 옮겼나」가 안 보인다. 상자 하나가
 *   움직이면 눈이 따라간다. 자리는 단추의 실제 크기를 재서 맞춘다(글자 폭이 달라도 딱 맞게).
 */
function CC보기전환({ 고른것, 바꾸기 }) {
  const 틀 = useRef(null);
  const 단추들 = useRef({});
  const [상자, set상자] = useState(null);
  useLayoutEffect(() => {
    const el = 단추들.current[고른것];
    if (!el) { set상자(null); return; }
    set상자({ x: el.offsetLeft, w: el.offsetWidth });
  }, [고른것]);
  return (
    <div ref={틀} role="group" aria-label="보기" style={{ ...분할틀, position: "relative", pointerEvents: "auto" }}>
      <span aria-hidden="true" style={{
        ...분할상자,
        opacity: 상자 ? 1 : 0,
        transform: `translateX(${상자?.x ?? 0}px)`,
        width: 상자?.w ?? 0,
      }} />
      {보기목록.map(([값, 글]) => {
        const 고름 = 고른것 === 값;
        return (
          <button key={값} ref={(el) => { 단추들.current[값] = el; }} type="button" className="분할단추" aria-pressed={고름}
                  onClick={() => 바꾸기(값)} style={{ ...분할단추, color: 고름 ? "#fff" : 색.흐린글 }}>{글}</button>
        );
      })}
    </div>
  );
}

/** 켜고 끄는 단추 — 체크박스를 그대로 두되 모양만 스위치로 */
function CC스위치({ 켬, 바꾸기, children }) {
  return (
    <label className="칸단추" style={{ ...칸단추, display: "flex", alignItems: "center", gap: 사이.m, cursor: "pointer", padding: "14px 16px" }}>
      <input type="checkbox" checked={켬} onChange={(e) => 바꾸기(e.target.checked)}
             style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
      <span style={{ display: "grid", gap: 2, flex: 1 }}>{children}</span>
      <span aria-hidden="true" style={{ width: 40, height: 22, borderRadius: 999, background: 켬 ? 색.강조 : "rgba(255,255,255,0.14)", position: "relative", transition: `background ${모션.보통}` }}>
        <span style={{ position: "absolute", top: 3, left: 켬 ? 21 : 3, width: 16, height: 16, borderRadius: 999, background: 켬 ? "#0A0B0D" : "#d6dde3", transition: `left ${모션.보통}` }} />
      </span>
    </label>
  );
}

// ── 본체 ─────────────────────────────────────────────────────
export default function CC캐릭터생성화면({
  initialValue = null,
  catalog = null,
  nameRules = null,
  checkName = null,
  onDraftChange = null,
  onComplete = null,
  onCancel = null,
}) {
  const 카탈로그 = useMemo(() => catalog ?? 기본카탈로그, [catalog]);
  const 규칙 = useMemo(() => 규칙보정(nameRules ?? 기본이름규칙), [nameRules]);

  const [처음값] = useState(() => 초안보정(initialValue ?? 기본초안(카탈로그), 카탈로그));
  const [모습, set모습] = useState(() => ({
    성별: 처음값.초안.appearance.gender,
    초안들: {
      masculine: 처음값.초안.appearance.gender === "masculine" ? 처음값.초안.appearance : null,
      feminine: 처음값.초안.appearance.gender === "feminine" ? 처음값.초안.appearance : null,
    },
  }));
  const [이력, set이력] = useState({ 과거: [], 미래: [] });
  const [단계, set단계] = useState("외형");
  const [갈래, set갈래] = useState("기본");
  // (체형 묶음 접기는 걷어냈다 — 개편 화면은 묶음을 전부 펼쳐 두고 칸으로 나눈다)
  const [속옷보기, set속옷보기] = useState(false);
  const [안내, set안내] = useState(처음값.알림.length ? 처음값.알림.join(" ") : null);
  const [보기, set보기] = useState("전신");
  // ★ 자세는 **걷기로 고정**한다. 관찰 옵션(대기/걷기·화질·돌리기)은 UI 개편 중이라
  //   단추째 주석으로 막아 두었다(아래 「관찰 도크」). 되살리려면 setter 들을 다시 꺼내 쓰면 된다.
  const [자세] = useState("Walk_Loop");
  const [품질] = useState("보통");
  // const [관찰열림, set관찰열림] = useState(false);
  // (「불러오는 중」 상태는 더 두지 않는다 — 배지를 걷어냈고, 미리 받아 두기로
  //  기다림 자체를 줄였다. 프리뷰의 `읽는중알림` prop 은 남겨 두었으니 나중에
  //  부모가 쓸 일이 생기면 그때 이어 붙이면 된다.)
  const [크기, set크기] = useState({ 폭: 1280, 높이: 800 });
  const [들어옴, set들어옴] = useState(false);

  const [이름, set이름] = useState(처음값.초안.displayName);
  const [조합중, set조합중] = useState(false);
  const [이름상태, set이름상태] = useState({ 종류: "입력전", 확인한이름: null });
  const [완료중, set완료중] = useState(false);
  const [완료됨, set완료됨] = useState(false);
  const [완료오류, set완료오류] = useState(null);

  const 끌기전 = useRef(null);
  const 검사번호 = useRef(0);
  const 검사중단 = useRef(null);
  const 루트 = useRef(null);
  // const 관찰단추 = useRef(null); — 관찰 옵션 막아 둠
  const 카메라손잡이 = useRef(null);
  const 조작등록 = useCallback((손잡이) => { 카메라손잡이.current = 손잡이; }, []);

  const 배치 = useMemo(() => 배치재기(크기.폭, 크기.높이, 단계), [크기, 단계]);

  const 외형 = useMemo(() => {
    const 있는것 = 모습.초안들[모습.성별];
    return 있는것 ?? 초안보정(기본초안(카탈로그, 모습.성별), 카탈로그).초안.appearance;
  }, [모습, 카탈로그]);

  const 초안 = useMemo(
    () => ({ schemaVersion: 1, displayName: 이름정규화(이름), appearance: 외형 }),
    [이름, 외형],
  );

  useEffect(() => {
    onDraftChange?.(초안);
  }, [초안, onDraftChange]);

  useEffect(() => {
    const 요소 = 루트.current;
    if (!요소 || typeof ResizeObserver === "undefined") return undefined;
    const 눈 = new ResizeObserver(([항목]) => {
      const r = 항목.contentRect;
      set크기({ 폭: Math.round(r.width), 높이: Math.round(r.height) });
    });
    눈.observe(요소);
    return () => 눈.disconnect();
  }, []);

  // 첫 진입 — 밝기만 짧게 정돈한다. 입력은 이 연출을 기다리지 않는다.
  useEffect(() => {
    const t = setTimeout(() => set들어옴(true), 30);
    return () => clearTimeout(t);
  }, []);

  // ── 외형 바꾸기 ─────────────────────────────────────────────
  const 바꾸기 = useCallback((만들기) => {
    set이력((h) => ({ 과거: [...h.과거, 모습].slice(-50), 미래: [] }));
    set모습(만들기);
  }, [모습]);

  const 외형바꾸기 = useCallback((만들기, 이력에 = true) => {
    const 적용 = (이전) => {
      const 지금 = 이전.초안들[이전.성별] ?? 초안보정(기본초안(카탈로그, 이전.성별), 카탈로그).초안.appearance;
      return { ...이전, 초안들: { ...이전.초안들, [이전.성별]: 만들기(지금) } };
    };
    if (이력에) 바꾸기(적용);
    else set모습(적용);
  }, [바꾸기, 카탈로그]);

  const 성별바꾸기 = (다음성별) => {
    if (다음성별 === 모습.성별) return;
    바꾸기((이전) => {
      const 이미 = 이전.초안들[다음성별];
      if (이미) return { ...이전, 성별: 다음성별 };
      const 지금 = 이전.초안들[이전.성별] ?? 초안보정(기본초안(카탈로그, 이전.성별), 카탈로그).초안.appearance;
      const { 외형: 맞춘것, 바뀜 } = 성별맞추기(지금, 다음성별, 카탈로그);
      // (성별을 바꿀 때 「○○에 없는 항목을 바꿨습니다」 알림은 띄우지 않는다 — 사용자 요청.
      //  헤어처럼 성별마다 다른 항목은 그 성별의 기본값으로 조용히 맞춘다.)
      void 바뀜;
      return { ...이전, 성별: 다음성별, 초안들: { ...이전.초안들, [다음성별]: 맞춘것 } };
    });
  };

  const 되돌리기 = () => {
    if (!이력.과거.length) return;
    set모습(이력.과거[이력.과거.length - 1]);
    set이력({ 과거: 이력.과거.slice(0, -1), 미래: [모습, ...이력.미래].slice(0, 50) });
  };
  const 다시실행 = () => {
    if (!이력.미래.length) return;
    set모습(이력.미래[0]);
    set이력({ 과거: [...이력.과거, 모습].slice(-50), 미래: 이력.미래.slice(1) });
  };
  const 전체초기화 = () => {
    바꾸기(() => ({ 성별: 모습.성별, 초안들: { masculine: null, feminine: null } }));
    set안내("외형을 기본값으로 되돌렸습니다. 되돌리기로 복구할 수 있습니다.");
  };
  const 갈래초기화 = () => {
    const 기본 = 초안보정(기본초안(카탈로그, 모습.성별), 카탈로그).초안.appearance;
    if (갈래 === "체형") 외형바꾸기((v) => ({ ...v, bodyParameters: 기본몸치수(모습.성별) }));
    else if (갈래 === "헤어") 외형바꾸기((v) => ({ ...v, hairId: 기본.hairId, colors: { ...v.colors, hair: "#ffffff" } }));
    else if (갈래 === "의상") 외형바꾸기((v) => ({ ...v, equipmentIds: { ...기본.equipmentIds }, colors: { ...v.colors, cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" } }));
    else 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, skin: "#ffffff" } }));
  };

  // 갈래를 고르면 그 부위로 초점을 옮긴다(슬라이더를 움직이는 동안에는 옮기지 않는다).
  const 갈래고르기 = (값) => {
    set갈래(값);
    if (값 === "헤어") set보기("머리");
    else if (값 === "의상") set보기("전신");
    else if (값 === "기본") set보기("전신");
  };

  // ── 이름 ────────────────────────────────────────────────────
  const 형식 = 형식검사(이름, 규칙);
  const 정규이름 = 이름정규화(이름);
  const 확인됨 = 이름상태.종류 === "가능" && 이름상태.확인한이름 === 정규이름 && 정규이름.length > 0;

  const 이름적기 = (값) => {
    set이름(값);
    검사번호.current += 1;
    검사중단.current?.abort();
    검사중단.current = null;
    set이름상태({ 종류: "입력전", 확인한이름: null });
    set완료오류(null);
  };

  const 중복확인 = async () => {
    if (조합중) return;
    const 검사할이름 = 이름정규화(이름);
    const 결과형식 = 형식검사(검사할이름, 규칙);
    if (!결과형식.ok) {
      set이름상태({ 종류: "형식", 메시지: 결과형식.메시지, 확인한이름: null });
      return;
    }
    if (typeof checkName !== "function") {
      set이름상태({ 종류: "미연결", 확인한이름: null });
      return;
    }
    검사중단.current?.abort();
    const 컨트롤러 = typeof AbortController === "function" ? new AbortController() : null;
    검사중단.current = 컨트롤러;
    검사번호.current += 1;
    const 내번호 = 검사번호.current;
    set이름상태({ 종류: "확인중", 확인한이름: null });
    try {
      const 답 = await checkName(검사할이름, { signal: 컨트롤러?.signal });
      if (내번호 !== 검사번호.current) return;
      const 상태 = 답?.status;
      if (상태 === "available") set이름상태({ 종류: "가능", 확인한이름: 검사할이름 });
      else if (상태 === "taken") set이름상태({ 종류: "중복", 메시지: 답?.message, 확인한이름: null });
      else if (상태 === "invalid") set이름상태({ 종류: "금지", 메시지: 답?.message, 확인한이름: null });
      else set이름상태({ 종류: "실패", 확인한이름: null });
    } catch {
      if (내번호 !== 검사번호.current) return;
      set이름상태({ 종류: "실패", 확인한이름: null });
    }
  };

  const 완료하기 = async () => {
    if (완료중 || 완료됨 || !확인됨) return;
    if (typeof onComplete !== "function") {
      set완료오류("완료 처리 함수가 연결되지 않았습니다.");
      return;
    }
    set완료중(true);
    set완료오류(null);
    try {
      const 답 = await onComplete(완료데이터({ ...초안, displayName: 정규이름 }, 카탈로그));
      if (답?.ok) {
        set완료됨(true);
        return;
      }
      if (답?.reason === "name_taken") {
        set이름상태({ 종류: "중복", 메시지: 답?.message, 확인한이름: null });
        set완료오류("이름을 다시 확인해 주세요.");
      } else {
        set완료오류(답?.message ?? "저장하지 못했습니다. 다시 시도해 주세요.");
      }
    } catch {
      set완료오류("저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      set완료중(false);
    }
  };

  // ── 그리기 ──────────────────────────────────────────────────
  const 렌더설정 = useMemo(
    () => 렌더러설정(외형, 카탈로그, { 속옷보기, 모션: 자세 }),
    [외형, 카탈로그, 속옷보기, 자세],
  );

  const 몸값 = 외형.bodyParameters;
  const 슬라이더끌기시작 = () => { if (!끌기전.current) 끌기전.current = 모습; };
  const 슬라이더끌기끝 = () => {
    const 이전 = 끌기전.current;
    끌기전.current = null;
    if (이전 && 이전 !== 모습) set이력((h) => ({ 과거: [...h.과거, 이전].slice(-50), 미래: [] }));
  };
  const 치수바꾸기 = (항목, 값, 이력에) => {
    const 자른값 = Math.min(항목.max, Math.max(항목.min, Number(값.toFixed(4))));
    외형바꾸기((v) => ({ ...v, bodyParameters: { ...v.bodyParameters, [항목.key]: 자른값 } }), 이력에);
  };

  const 이름칸ID = useId();
  const 이름칸 = useRef(null);
  const 이름메시지 = 이름상태.종류 === "형식" ? 이름상태.메시지 : (이름상태.메시지 ?? 이름상태글[이름상태.종류] ?? "");

  const { 좁음, 패널, 안, 머리, 발치, 무대, 설정, 보기띠, 안전영역 } = 배치;
  // 「캐릭터 생성」 제목(34px · 5글자)과 같은 폭 — 제목 아래·위 정렬선이 하나로 맞는다
  const 심장선폭 = 좁음 ? 150 : 200;

  // ── 탭 ── 「이름」은 단계(외형/이름)를 바꾸고, 나머지는 외형 안의 갈래를 바꾼다
  const 탭 = 단계 === "이름" ? "이름" : 갈래;
  const 탭번호 = 탭목록.findIndex(([값]) => 값 === 탭);
  const 다음탭 = 탭목록[탭번호 + 1];
  const 탭고르기 = (값) => {
    if (값 === "이름") {
      set속옷보기(false);
      set단계("이름");
      return;
    }
    set단계("외형");
    갈래고르기(값);
  };
  // 「확인 · 게임 시작」 — 이름 확인이 끝났으면 완료, 아니면 이름 탭으로 데려간다
  const [확인재촉, set확인재촉] = useState(false);
  // 의상 모달 — 어느 칸(top/bottom/shoes)을 고르는 중인가. null 이면 닫힘
  const [옷창, set옷창] = useState(null);
  useEffect(() => {
    if (!옷창) return undefined;
    const 키 = (e) => { if (e.key === "Escape") set옷창(null); };
    window.addEventListener("keydown", 키);
    return () => window.removeEventListener("keydown", 키);
  }, [옷창]);
  const 확인누름 = () => {
    if (확인됨) {
      완료하기();
      return;
    }
    탭고르기("이름");
    set확인재촉(true);
    setTimeout(() => 이름칸.current?.focus(), 60);
  };
  const 확인글 = 완료됨 ? "튜토리얼로 이동 중…" : 완료중 ? "처리 중입니다…" : "확인 · 게임 시작";

  return (
    <div ref={루트} className="캐생" style={루트칸}>
      <style>{화면CSS + 개편CSS + 심장선CSS}</style>

      {/* 배경층 — 우리 그림을 흐리고 어둡게. 「어디에 들어왔나」만 말하고 주인공을 빼앗지 않는다 */}
      <div aria-hidden="true" style={배경그림칸} />
      <div aria-hidden="true" style={배경덮개} />

      {/* 패널 — 창 하나. 테두리 · 꺾쇠 · 비스듬히 잘린 오른쪽 위 모서리 */}
      <div aria-hidden="true" style={{ ...패널판, left: 패널.x, top: 패널.y, width: 패널.w, height: 패널.h }} />

      {/* 무대 칸 — 캐릭터가 서는 자리. 바닥 빛 · 안쪽 꺾쇠 · 빗금 표식 */}
      {/* 무대 칸 — 테두리 없이 캐릭터 뒤에 은은한 빛과 바닥 그림자만 */}
      <div aria-hidden="true" style={{ ...무대판, left: 무대.x, top: 무대.y, width: 무대.w, height: 무대.h }}>
        <div style={무대바닥빛} />
      </div>

      {/* 3D층 — 투명 캔버스. 카메라가 무대 칸 안에만 캐릭터를 담는다.
             ★ 무대 칸 모양으로 **잘라 낸다.** 머리·상반신 보기에서 크게 당기면 캐릭터가
               칸과 패널 밖까지 삐져나왔다. 캔버스는 화면 전체 그대로(돌려 보기 영역) 두고 그림만 자른다. */}
      <div style={{
        position: "absolute", inset: 0, opacity: 들어옴 ? 1 : 0, transition: "opacity 600ms ease-out",
        clipPath: `inset(${무대.y}px ${Math.max(0, 크기.폭 - 무대.x - 무대.w)}px ${Math.max(0, 크기.높이 - 무대.y - 무대.h)}px ${무대.x}px round 4px)`,
      }}>
        <CC캐릭터프리뷰
          설정={렌더설정}
          보기={단계 === "이름" ? "상반신" : 보기}
          자세={자세}
          품질={품질}
          안전영역={안전영역}
          조작알림={조작등록}
        />
      </div>

      {/* UI층 — 빈 자리(무대)는 캐릭터를 돌려 보는 자리다 */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/* ── 머리 — 제목 · 부제 · 심장박동 선 ── */}
        <header style={{ position: "absolute", left: 패널.x + 안, width: 패널.w - 안 * 2, top: 패널.y, height: 머리, display: "grid", alignContent: "center", justifyItems: "center", gap: 6, paddingBottom: 14, boxSizing: "border-box" }}>
          <h1 style={{ margin: 0, ...큰제목, fontSize: 좁음 ? 24 : 34 }}>캐릭터 생성</h1>
          <p style={{ margin: 0, ...작은글, color: 색.흐린글 }}>왜곡을 조사할 당신의 모습을 만들어 주세요</p>
        </header>

        {/* 닫기 — 오른쪽 위. 「뒤로」와 같은 일을 한다 */}
        {onCancel ? (
          <button type="button" className="칸단추" aria-label="닫고 웹사이트로 돌아가기" onClick={onCancel}
                  style={{ ...닫기단추, left: 패널.x + 패널.w - 안 - 40, top: 패널.y + 20, pointerEvents: "auto" }}>
            {아이콘.닫기}
          </button>
        ) : null}

        {/* ── 무대 칸 아래 — 보기 전환 ── */}
        <div style={{ position: "absolute", left: 무대.x, width: 무대.w, top: 무대.y + 무대.h - 보기띠, height: 보기띠, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <CC보기전환 고른것={단계 === "이름" ? "상반신" : 보기} 바꾸기={set보기} />
        </div>
        {/* 무대 왼쪽 위 — 지금 성별 · 이름 */}
        <div style={{ position: "absolute", left: 무대.x + 28, top: 무대.y + 26, display: "grid", gap: 4 }}>
          <span style={머리표}>{모습.성별 === "feminine" ? "FEMALE" : "MALE"} · 조사관</span>
          <span style={{ font: `700 20px/1.2 ${글꼴.본문}`, color: 색.글 }}>{정규이름 || "이름 없음"}</span>
        </div>

        {/* ── 설정 칸 ── */}
        <section aria-label="설정" style={{ position: "absolute", left: 설정.x, top: 설정.y, width: 설정.w, height: 설정.h, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 사이.l, pointerEvents: "auto" }}>
          {/* 단계 탭 01~05 */}
          <nav aria-label="만드는 순서" style={{ display: "grid", gridTemplateColumns: `repeat(${탭목록.length}, 1fr)`, gap: 사이.s }}>
            {탭목록.map(([값, 글, 부], i) => {
              const 고름 = 탭 === 값;
              const 지남 = i < 탭번호;
              return (
                <button key={값} type="button" className="칸단추" aria-pressed={고름} aria-current={고름 ? "step" : undefined}
                        onClick={() => 탭고르기(값)}
                        style={{ ...칸단추, ...(고름 ? 고른탭 : null), padding: 좁음 ? "8px 6px" : "12px 12px 11px", display: "grid", gap: 6, justifyItems: 좁음 ? "center" : "start", textAlign: "left" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span style={{ ...탭번호표, color: 고름 ? 색.강조 : 지남 ? 색.성공 : 색.더흐린글 }}>{지남 ? "✓" : `0${i + 1}`}</span>
                    {!좁음 ? <span style={{ marginLeft: "auto", color: 고름 ? 색.강조 : 색.더흐린글, display: "grid" }}>{아이콘[값]}</span> : null}
                  </span>
                  <span style={{ font: `700 15px/1.2 ${글꼴.본문}`, color: 고름 ? "#fff" : 색.흐린글 }}>{글}</span>
                  {!좁음 ? <span style={{ ...작은글, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{부}</span> : null}
                </button>
              );
            })}
          </nav>

          {/* 내용 카드 */}
          <div style={내용카드}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 사이.m, padding: `${사이.xl}px ${사이.xl}px ${사이.l}px`, borderBottom: `1px solid ${색.선}` }}>
              <div style={{ display: "grid", gap: 4 }}>
                <h2 style={{ margin: 0, font: `700 22px/1.25 ${글꼴.본문}`, color: 색.글, letterSpacing: "-0.01em" }}>{탭}</h2>
                <p style={{ margin: 0, ...작은글, color: 색.흐린글 }}>{항목설명[탭]}</p>
              </div>
              {탭 !== "이름" ? (
                <button type="button" className="글단추" style={{ ...글단추, marginLeft: "auto" }} onClick={갈래초기화}>
                  {아이콘.초기화} 이 항목 초기화
                </button>
              ) : null}
            </div>

            {안내 ? (
              <div style={안내줄} role="status">
                <span style={{ flex: 1 }}>{안내}</span>
                <button type="button" className="글단추" style={{ ...글단추, color: 색.경고 }} onClick={() => set안내(null)}>확인</button>
              </div>
            ) : null}

            <div style={{ overflowY: "auto", padding: 사이.xl, display: "grid", gap: 사이.xl, alignContent: "start", minHeight: 0 }}>
              {탭 === "기본" ? (
                <>
                  <CC묶음 제목="성별">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 사이.m }}>
                      {성별목록().map(([값, 글]) => {
                        const 고름 = 모습.성별 === 값;
                        return (
                          <CC칸단추 key={값} 고름={고름} onClick={() => 성별바꾸기(값)}
                                    style={{ padding: "20px 16px", display: "grid", justifyItems: "center", gap: 10, ...(고름 ? 고른큰칸 : null) }}>
                            <span style={{ color: 고름 ? 색.강조 : 색.흐린글, display: "grid" }}>{아이콘[글]}</span>
                            <span style={{ font: `700 17px/1 ${글꼴.본문}`, color: 고름 ? "#fff" : 색.흐린글 }}>{글}</span>
                          </CC칸단추>
                        );
                      })}
                    </div>
                  </CC묶음>
                  <CC묶음 제목="피부 컬러" 덧="흰색은 원본 그대로입니다">
                    <CC색고르기 갈래="skin" 목록={카탈로그.색상.skin} 값={외형.colors.skin}
                                바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, skin: 코드 } }))} />
                  </CC묶음>
                  <CC묶음 제목="미리보기">
                    <CC스위치 켬={속옷보기} 바꾸기={set속옷보기}>
                      <span style={{ font: `600 14px/1.3 ${글꼴.본문}`, color: 색.글 }}>속옷으로 체형 보기</span>
                      <span style={작은글}>골라 둔 옷은 그대로 남습니다.</span>
                    </CC스위치>
                  </CC묶음>
                </>
              ) : null}

              {탭 === "체형" ? (
                <>
                  {체형묶음.map(([묶음, 글]) => (
                    <CC묶음 key={묶음} 제목={글}>
                      <div style={{ display: "grid", gridTemplateColumns: 설정.w > 560 ? "1fr 1fr" : "1fr", gap: 사이.m }}>
                        {체형항목.filter((항목) => 항목.묶음 === 묶음).map((항목) => (
                          <CC슬라이더
                            key={항목.key}
                            항목={항목}
                            성별={모습.성별}
                            값={몸값[항목.key]}
                            바꾸기={(값, 이력에) => 치수바꾸기(항목, 값, 이력에)}
                            끌기시작={슬라이더끌기시작}
                            끌기끝={슬라이더끌기끝}
                            되돌리기={() => 치수바꾸기(항목, 항목기본(항목, 모습.성별), true)}
                          />
                        ))}
                      </div>
                    </CC묶음>
                  ))}
                </>
              ) : null}

              {탭 === "헤어" ? (
                <>
                  <CC묶음 제목="머리 모양">
                    <div style={카드격자}>
                      {슬롯선택지(카탈로그, "hair", 모습.성별).map((it) => (
                        <CC아이템카드 key={it.id} 고름={외형.hairId === it.id} 이름={it.이름} 썸네일={썸네일고르기(it, 모습.성별)}
                                      onClick={() => 외형바꾸기((v) => ({ ...v, hairId: it.id }))} />
                      ))}
                    </div>
                  </CC묶음>
                  <CC묶음 제목="헤어 컬러" 덧="원본에 색을 입힙니다">
                    <CC색고르기 갈래="hair" 목록={카탈로그.색상.hair} 값={외형.colors.hair}
                                바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, hair: 코드 } }))} />
                  </CC묶음>
                </>
              ) : null}

              {탭 === "의상" ? (
                <CC묶음 제목="의상 항목" 덧="누르면 고르는 창이 열립니다">
                  <div style={{ display: "grid", gridTemplateColumns: 설정.w > 560 ? "repeat(3, 1fr)" : "1fr", gap: 사이.m }}>
                    {["top", "bottom", "shoes"].map((슬롯) => {
                      const 지금것 = 슬롯선택지(카탈로그, 슬롯, 모습.성별).find((it) => it.id === 외형.equipmentIds[슬롯]);
                      const 그림 = 지금것 ? 썸네일고르기(지금것, 모습.성별) : null;
                      const 이색 = 외형.colors[옷색키[슬롯]] ?? "#ffffff";
                      return (
                        <CC칸단추 key={슬롯} onClick={() => set옷창(슬롯)} aria-haspopup="dialog"
                                  style={{ padding: 12, display: "grid", gap: 10, textAlign: "left" }}>
                          <span style={{ width: "100%", aspectRatio: "4 / 3", borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.3)", display: "grid", placeItems: "center" }}>
                            {그림 ? <img src={그림} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={작은글}>없음</span>}
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ font: `700 16px/1.2 ${글꼴.본문}`, color: 색.글 }}>{슬롯이름[슬롯]}</span>
                            <span aria-label={`${슬롯이름[슬롯]} 컬러`} style={{ marginLeft: "auto", width: 18, height: 18, borderRadius: 5, background: 이색, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.25)" }} />
                          </span>
                          <span style={{ ...작은글, color: 색.흐린글 }}>{지금것?.이름 ?? "없음"}</span>
                        </CC칸단추>
                      );
                    })}
                  </div>
                </CC묶음>
              ) : null}

              {탭 === "이름" ? (
                <>
                  <CC묶음 제목="조사관 이름" 덧={`${글자수(이름)} / ${규칙.최대}자`}>
                    <div style={{ display: "flex", gap: 사이.s }}>
                      <input
                        ref={이름칸}
                        id={이름칸ID}
                        value={이름}
                        style={입력칸}
                        maxLength={규칙.최대 * 2}
                        placeholder={`${규칙.최소}~${규칙.최대}자로 입력해 주세요`}
                        aria-label="조사관 이름"
                        aria-describedby={`${이름칸ID}-도움 ${이름칸ID}-결과`}
                        onCompositionStart={() => set조합중(true)}
                        onCompositionEnd={(e) => { set조합중(false); 이름적기(e.target.value); }}
                        onChange={(e) => { 이름적기(e.target.value); set확인재촉(false); }}
                        onKeyDown={(e) => {
                          // 한글을 조합하는 중의 Enter 는 '입력 확정'이라 제출로 받으면 안 된다.
                          if (e.key === "Enter" && !e.nativeEvent.isComposing && !조합중) {
                            e.preventDefault();
                            중복확인();
                          }
                        }}
                      />
                      <button type="button" className="칸단추" style={{ ...칸단추, padding: "0 22px", font: `700 14px/1 ${글꼴.본문}`, color: 색.글 }}
                              onClick={중복확인} disabled={이름상태.종류 === "확인중"}>
                        중복확인
                      </button>
                    </div>
                    <span id={`${이름칸ID}-도움`} style={작은글}>{규칙.허용설명}</span>
                    {/* 결과 자리를 미리 비워 둔다 — 메시지가 떠도 입력칸·버튼이 위아래로 튀지 않는다. */}
                    <div id={`${이름칸ID}-결과`} role="status" aria-live="polite"
                         style={{ minHeight: 22, font: `500 14px/1.5 ${글꼴.본문}`, color: 상태색[이름상태.종류] ?? (확인재촉 ? 색.경고 : 색.흐린글) }}>
                      {이름상태.종류 === "입력전" && !형식.ok && !형식.비었음 ? 형식.메시지 : 이름메시지}
                    </div>
                  </CC묶음>
                  <CC묶음 제목="조사관 정보">
                    <div style={요약표}>
                      {착장요약(외형, 카탈로그).map(([칸, 값]) => (
                        <div key={칸} style={요약줄}>
                          <span style={작은글}>{칸}</span>
                          <span style={{ font: `600 14px/1.3 ${글꼴.본문}`, color: 색.글 }}>{값}</span>
                        </div>
                      ))}
                    </div>
                  </CC묶음>
                  {완료오류 ? <div style={{ font: `500 14px/1.5 ${글꼴.본문}`, color: 색.오류 }}>{완료오류}</div> : null}
                  {완료됨 ? <div style={{ font: `500 14px/1.5 ${글꼴.본문}`, color: 색.성공 }}>캐릭터를 만들었습니다. 튜토리얼로 이동합니다.</div> : null}
                </>
              ) : null}
            </div>
          </div>

          {/* 다음 단계로 — 참고 화면의 「FACE & HAIR ›」 자리 */}
          {다음탭 ? (
            <button type="button" className="칸단추" onClick={() => 탭고르기(다음탭[0])}
                    style={{ ...칸단추, padding: "15px 20px", display: "flex", alignItems: "center", gap: 사이.m }}>
              <span style={{ font: `700 16px/1 ${글꼴.본문}`, color: 색.글 }}>{다음말[다음탭[0]]}</span>
              <span style={{ marginLeft: "auto", color: 색.글, display: "grid" }}>{아이콘.다음}</span>
            </button>
          ) : (
            <div style={{ ...작은글, padding: "15px 4px", textAlign: "right" }}>
              {확인됨 ? "준비가 끝났습니다. 확인을 누르면 튜토리얼이 시작됩니다." : "이름 중복확인을 마치면 게임을 시작할 수 있습니다."}
            </div>
          )}
        </section>

        {/* ── 의상 모달 — 상의 · 하의 · 신발 하나씩 ── */}
        {옷창 ? (
          <div style={모달바탕} onClick={(e) => { if (e.target === e.currentTarget) set옷창(null); }}>
            <div role="dialog" aria-modal="true" aria-label={`${슬롯이름[옷창]} 고르기`} style={모달}>
              <div style={{ display: "flex", alignItems: "center", gap: 사이.m, padding: `${사이.xl}px ${사이.xl}px ${사이.l}px`, borderBottom: `1px solid ${색.선}` }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <h2 style={{ margin: 0, font: `700 22px/1.25 ${글꼴.본문}`, color: 색.글 }}>{슬롯이름[옷창]}</h2>
                  <p style={{ margin: 0, ...작은글, color: 색.흐린글 }}>{옷설명[옷창]}</p>
                </div>
                <button type="button" className="칸단추" aria-label="닫기" onClick={() => set옷창(null)}
                        style={{ ...칸단추, marginLeft: "auto", width: 40, height: 40, padding: 0, display: "grid", placeItems: "center" }}>
                  {아이콘.닫기}
                </button>
              </div>
              <div style={{ padding: 사이.xl, display: "grid", gap: 사이.xl, overflowY: "auto" }}>
                <CC묶음 제목={`${슬롯이름[옷창]} 종류`}>
                  <div style={카드격자}>
                    {슬롯선택지(카탈로그, 옷창, 모습.성별).map((it) => (
                      <CC아이템카드 key={it.id} 고름={외형.equipmentIds[옷창] === it.id} 이름={it.이름} 설명={it.설명}
                                    썸네일={썸네일고르기(it, 모습.성별)}
                                    onClick={() => 외형바꾸기((v) => ({ ...v, equipmentIds: { ...v.equipmentIds, [옷창]: it.id } }))} />
                    ))}
                  </div>
                </CC묶음>
                <CC묶음 제목={`${슬롯이름[옷창]} 컬러`} 덧={옷창 === "bottom" ? "검은 바지라 짙은 색만 또렷이 보입니다" : "원본에 색을 입힙니다"}>
                  <CC색고르기 갈래={옷색키[옷창]} 목록={카탈로그.색상[옷색키[옷창]] ?? 카탈로그.색상.cloth} 값={외형.colors[옷색키[옷창]]}
                              바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, [옷색키[옷창]]: 코드 } }))} />
                </CC묶음>
              </div>
              <div style={{ padding: `${사이.l}px ${사이.xl}px ${사이.xl}px`, display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="확인단추" onClick={() => set옷창(null)} style={{ ...확인단추, height: 46, padding: "0 32px" }}>완료</button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── 발치 — 뒤로 · 되돌리기 줄 · 확인 ── */}
        <footer style={{ position: "absolute", left: 패널.x + 안, width: 패널.w - 안 * 2, top: 패널.y + 패널.h - 발치, height: 발치, display: "flex", alignItems: "center", gap: 사이.l }}>
          {onCancel ? (
            <button type="button" className="뒤로단추" onClick={onCancel} style={{ ...뒤로단추, pointerEvents: "auto" }}>
              {아이콘.이전} 뒤로
            </button>
          ) : null}
          <div style={{ display: "flex", gap: 4, pointerEvents: "auto" }}>
            <button type="button" className="글단추" style={글단추} onClick={되돌리기} disabled={!이력.과거.length}>{아이콘.되돌리기} 되돌리기</button>
            <button type="button" className="글단추" style={글단추} onClick={다시실행} disabled={!이력.미래.length}>{아이콘.다시} 다시 실행</button>
            <button type="button" className="글단추" style={글단추} onClick={전체초기화}>{아이콘.초기화} 외형 초기화</button>
          </div>
          {/* 가운데 비움 — 심장선은 아래에서 **패널 정중앙**에 따로 놓는다 */}
          <div style={{ flex: 1 }} />
          <span aria-label={`${탭목록.length}단계 중 ${탭번호 + 1}단계`} style={{ ...탭번호표, color: 색.글 }}>{`0${탭번호 + 1}`}<span style={{ color: 색.더흐린글 }}>{` / 0${탭목록.length}`}</span></span>
          <button type="button" className="확인단추" onClick={확인누름} disabled={완료중 || 완료됨}
                  aria-describedby={!확인됨 ? `${이름칸ID}-결과` : undefined}
                  style={{ ...확인단추, ...(확인됨 ? null : 덜된확인단추), pointerEvents: "auto" }}>
            {확인글} {아이콘.다음}
          </button>
        </footer>
        {/* 발치 심장선 — 위 「캐릭터 생성」 제목과 **같은 가운데 · 같은 폭** (사용자 지정 자리) */}
        <div aria-hidden="true" style={{ position: "absolute", left: 패널.x + 패널.w / 2 - 심장선폭 / 2, width: 심장선폭, top: 패널.y + 패널.h - 발치 / 2 - 6, height: 12 }}>
          <CC심장선 모양="카드맥작" 높이={12} 색="#FFFFFF" 빛="#FFFFFF" 진하기={0.28} 주기={2.8} style={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────
// [색] 바탕은 짙은 남청, 강조는 **청록 하나**(색.강조). 성공 초록은 「지나온 단계 ✓」에만.
// [선] 칸 테두리는 1px 옅은 청록. 고른 칸만 진하게 — 테두리 굵기로 구분하지 않는다.
const 루트칸 = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: "#05080D",
};

/* 배경 그림 — 크게 흐리고(10px) 어둡게(밝기 0.38). 가장자리가 흐림에 씻겨 하얗게 뜨지 않게 조금 키운다 */
const 배경그림칸 = {
  position: "absolute",
  inset: -24,
  background: `url("${배경그림}") center / cover no-repeat`,
  filter: "blur(7px) brightness(0.62) saturate(0.95)",
  transform: "scale(1.04)",
};
/* 배경 위 덮개 — 패널 둘레를 더 어둡게 눌러 창이 떠 보이게 */
const 배경덮개 = {
  position: "absolute",
  inset: 0,
  background: [
    "radial-gradient(80% 70% at 50% 50%, rgba(5,9,15,0) 0%, rgba(5,9,15,0.55) 100%)",
    "linear-gradient(180deg, rgba(5,9,15,0.4) 0%, rgba(5,9,15,0) 22%, rgba(5,9,15,0) 78%, rgba(5,9,15,0.45) 100%)",
  ].join(","),
};

/* 패널 — 반투명 남청 + 흐림. 오른쪽 위 모서리만 비스듬히 잘라 「장비 창」 실루엣을 만든다 */
const 패널판 = {
  position: "absolute",
  background: "linear-gradient(180deg, rgba(16,18,21,0.84) 0%, rgba(10,11,13,0.9) 100%)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 6,
  boxShadow: "0 40px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
};

/* 무대 칸 — 안쪽이 조금 더 밝은 남청. 캐릭터 뒤에 빛이 고이게 */
const 무대판 = {
  position: "absolute",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "radial-gradient(70% 60% at 50% 42%, rgba(70,76,84,0.38) 0%, rgba(24,27,31,0.18) 70%, rgba(8,14,22,0) 100%)",
  overflow: "hidden",
};
const 무대바닥빛 = {
  position: "absolute",
  left: "18%",
  right: "18%",
  bottom: 70,
  height: 46,
  borderRadius: "50%",
  background: "radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 100%)",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.12)",
};

const 머리표 = { font: `600 11px/1 ${글꼴.모노}`, letterSpacing: "0.22em", color: 색.강조진함 };
const 큰제목 = { font: `800 34px/1.1 ${글꼴.본문}`, letterSpacing: "-0.02em", color: 색.글, textShadow: "0 2px 18px rgba(0,0,0,0.5)" };
const 작은글 = { font: `400 12.5px/1.5 ${글꼴.본문}`, color: 색.더흐린글 };
const 묶음제목 = { margin: 0, font: `700 13px/1 ${글꼴.본문}`, letterSpacing: "0.04em", color: 색.흐린글 };
const 탭번호표 = { font: `600 12px/1 ${글꼴.모노}`, letterSpacing: "0.1em" };

/* 칸 단추 — 모든 고르기 단추의 공통 칸. 1px 테두리 + 아주 옅은 바탕 */
const 칸단추 = {
  appearance: "none",
  position: "relative",
  boxSizing: "border-box",
  // ★ 축약형 border 를 쓰지 않는다 — 고른 칸이 borderColor 만 바꿀 때 React 가 경고하고 테가 지워진다
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  color: 색.흐린글,
  font: `500 14px/1.3 ${글꼴.본문}`,
  cursor: "pointer",
  transition: `border-color ${모션.빠름}, background ${모션.빠름}, color ${모션.빠름}, transform ${모션.빠름}`,
};
const 고른칸단추 = {
  borderColor: 색.강조,
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset",
};
const 고른큰칸 = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.06) 100%)",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.35) inset, 0 10px 30px rgba(255,255,255,0.18)",
};
const 고른탭 = {
  borderColor: 색.강조,
  background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 100%)",
  boxShadow: `inset 0 -2px 0 ${색.강조}`,
};
const 작은칸단추 = {
  ...칸단추,
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 6,
  display: "grid",
  placeItems: "center",
  font: `500 13px/1 ${글꼴.본문}`,
};
const 체크표 = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 20,
  height: 20,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: "#FFFFFF",
  color: "#0A0B0D",
  font: "800 11px/1 sans-serif",
};
const 카드격자 = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))", gap: 사이.m };

const 색칸 = {
  position: "relative",
  aspectRatio: "1 / 1",
  padding: 0,
  border: "1px solid rgba(0,0,0,0.35)",
  borderRadius: 8,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  transition: `box-shadow ${모션.빠름}, transform ${모션.빠름}`,
};
const 고른색칸 = { boxShadow: `0 0 0 2px #0A121C, 0 0 0 4px ${색.강조}` };

const 슬라이더칸 = {
  display: "grid",
  gap: 10,
  padding: "14px 16px 12px",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.025)",
};
const 값표 = {
  padding: "4px 8px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.10)",
  color: "#FFFFFF",
  font: `600 12.5px/1 ${글꼴.본문}`,
};

/* 내용 카드 — 탭 아래 큰 칸. 머리(제목) · 알림 · 스크롤되는 몸 */
const 내용카드 = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto 1fr",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(8,9,11,0.45)",
  overflow: "hidden",
};

const 분할틀 = {
  display: "flex",
  gap: 2,
  padding: 4,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(8,9,11,0.7)",
  backdropFilter: "blur(10px)",
};
const 분할단추 = {
  appearance: "none",
  position: "relative", // 미끄러지는 상자 위로 글자가 오게
  zIndex: 1,
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  background: "none",
  color: 색.흐린글,
  font: `600 13px/1 ${글꼴.본문}`,
  cursor: "pointer",
  transition: `background ${모션.빠름}, color ${모션.빠름}`,
};
/* 미끄러지는 상자 — 왼쪽 끝(0)에서 단추 자리만큼 옮긴다. 폭도 같이 바뀐다 */
const 분할상자 = {
  position: "absolute",
  left: 0,
  top: 4,
  bottom: 4,
  borderRadius: 6,
  background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.12) 100%)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
  transition: "transform 280ms cubic-bezier(.2,.8,.2,1), width 280ms cubic-bezier(.2,.8,.2,1), opacity 160ms",
  pointerEvents: "none",
};

const 글단추 = {
  appearance: "none",
  border: "none",
  background: "none",
  padding: "8px 10px",
  borderRadius: 6,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: 색.흐린글,
  font: `500 13px/1 ${글꼴.본문}`,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: `color ${모션.빠름}, background ${모션.빠름}`,
};
const 닫기단추 = {
  ...칸단추,
  position: "absolute",
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  padding: 0,
};

/* 뒤로 · 확인 — 깔끔한 둥근 사각형. 호버하면 위에서 아래로 빛이 번지는 그라데이션이 얹힌다(개편CSS ::before) */
const 뒤로단추 = {
  appearance: "none",
  position: "relative",
  overflow: "hidden",
  isolation: "isolate",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.16)",
  borderRadius: 10,
  padding: "0 26px",
  height: 50,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "linear-gradient(180deg, rgba(52,56,62,0.95) 0%, rgba(30,33,37,0.98) 100%)",
  color: 색.글,
  font: `700 15px/1 ${글꼴.본문}`,
  letterSpacing: "0.04em",
  cursor: "pointer",
  transition: `border-color ${모션.보통}, box-shadow ${모션.보통}, transform ${모션.빠름}`,
};
const 확인단추 = {
  ...뒤로단추,
  borderColor: "rgba(255,255,255,0.6)",
  padding: "0 32px",
  height: 52,
  background: "linear-gradient(180deg, #FFFFFF 0%, #E4E6E9 100%)",
  color: "#0A0B0D",
  font: `800 16px/1 ${글꼴.본문}`,
  boxShadow: "0 8px 28px rgba(255,255,255,0.18)",
};
/* 아직 이름이 안 됐으면 — 누를 수는 있다(이름 탭으로 데려간다). 빛만 줄인다 */
const 덜된확인단추 = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.38) 100%)",
  color: "rgba(10,11,13,0.82)",
};

const 입력칸 = {
  flex: "1 1 auto",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "15px 18px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.28)",
  background: "rgba(6,7,9,0.8)",
  color: 색.글,
  font: `600 18px/1.3 ${글꼴.본문}`,
  transition: `border-color ${모션.빠름}, box-shadow ${모션.빠름}`,
};
const 요약표 = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 1,
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  overflow: "hidden",
  background: "rgba(255,255,255,0.14)",
};
const 요약줄 = { display: "grid", gap: 4, padding: "12px 14px", background: "rgba(12,13,15,0.95)" };

/* 의상 모달 — 화면 전체를 어둡게 누르고 가운데 창 하나 */
const 모달바탕 = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  pointerEvents: "auto",
};
const 모달 = {
  width: "min(720px, calc(100% - 48px))",
  maxHeight: "min(760px, calc(100% - 48px))",
  display: "grid",
  gridTemplateRows: "auto 1fr auto",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "linear-gradient(180deg, #16181C 0%, #0F1013 100%)",
  boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
  overflow: "hidden",
};

const 안내줄 = {
  display: "flex",
  alignItems: "center",
  gap: 사이.s,
  margin: `${사이.m}px ${사이.xl}px 0`,
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid rgba(240,194,122,0.3)",
  background: "rgba(240,194,122,0.08)",
  color: 색.경고,
  font: `500 13px/1.5 ${글꼴.본문}`,
};

// 개편 화면 전용 — 마우스를 올렸을 때의 미세한 반응. 인라인 스타일로는 :hover 를 못 건다.
const 개편CSS = `
.캐생 .칸단추:hover:not(:disabled):not([aria-pressed="true"]) { border-color: rgba(255,255,255,0.38); background: rgba(255,255,255,0.06); color: #fff; }
.캐생 .칸단추:active:not(:disabled) { transform: translateY(1px); }
.캐생 .칸단추:disabled { opacity: 0.5; cursor: progress; }
.캐생 .색칸:hover { transform: translateY(-1px); }
.캐생 .분할단추:hover:not([aria-pressed="true"]) { color: #fff; }
.캐생 .글단추:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.06); }
.캐생 .글단추:disabled { opacity: 0.35; cursor: default; }
/* 호버 그라데이션 — 가상 요소를 깔고 투명도만 바꾼다(그라데이션 자체는 부드럽게 안 넘어간다) */
.캐생 .뒤로단추::before, .캐생 .확인단추::before, .캐생 .칸단추::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1;
  opacity: 0; transition: opacity 220ms ease; pointer-events: none;
}
.캐생 .뒤로단추::before { background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0) 100%); }
.캐생 .확인단추::before { background: linear-gradient(135deg, #FFFFFF 0%, #CDD3DA 100%); }
.캐생 .칸단추::before { background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%); }
.캐생 .뒤로단추:hover::before, .캐생 .확인단추:hover:not(:disabled)::before, .캐생 .칸단추:hover:not(:disabled)::before { opacity: 1; }
.캐생 .뒤로단추:hover { border-color: rgba(255,255,255,0.4); }
.캐생 .확인단추:hover:not(:disabled) { box-shadow: 0 10px 34px rgba(255,255,255,0.28); }
.캐생 .뒤로단추:active, .캐생 .확인단추:active:not(:disabled) { transform: translateY(1px); }
.캐생 .칸단추 { isolation: isolate; overflow: hidden; }
.캐생 .확인단추:disabled { cursor: progress; filter: saturate(0.6); }
.캐생 input[type="text"]:focus, .캐생 input:not([type]):focus { border-color: ${색.강조}; box-shadow: 0 0 0 3px rgba(255,255,255,0.14); outline: none; }
.캐생 .슬라줄 .미세 { opacity: 0.45; transition: opacity 160ms; }
.캐생 *:focus-visible { outline-color: #FFFFFF; }
.캐생 input[type="range"]::-webkit-slider-thumb { background: #FFFFFF; box-shadow: 0 0 0 4px rgba(255,255,255,0.14); }
.캐생 input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(255,255,255,0.16); }
.캐생 input[type="range"]::-moz-range-thumb { background: #FFFFFF; }
.캐생 .슬라줄:hover .미세, .캐생 .슬라줄:focus-within .미세 { opacity: 1; }
`;
