// 캐릭터 생성 화면 — 외형을 정하고 이름을 붙여 바깥으로 넘긴다.
//
// [화면 구조: 무대 하나 + 그 위에 떠 있는 도구]
//   배경층(CSS 그라데이션) → 3D층(투명 캔버스) → 대비층(가장자리 명암) → UI층.
//   UI층은 `pointerEvents: none` 이고 실제 도구에만 다시 켠다. 그래서 글자 없는 빈 자리는
//   전부 캐릭터를 돌려 보는 자리가 된다. 큰 프리뷰 카드·전폭 구분선·3열 상자는 두지 않는다.
//   카메라는 UI 가 덮는 픽셀(안전영역)을 빼고 남는 자리에 캐릭터를 담는다.
//
// [이 화면이 하는 일과 안 하는 일]
//   한다:   외형 편집, 3D 미리보기, 이름 입력·중복확인 UI, 완료 데이터 만들기.
//   안 한다: 회원가입·로그인, 라우팅, 실제 API 호출, 계정 저장, 오프닝·튜토리얼로 넘어가기.
//
// [props 계약]  docs/캐릭터생성-인수인계.md 에 같은 내용이 정리돼 있다.
//   initialValue? / catalog? / nameRules? / checkName / onDraftChange? / onComplete / onCancel?
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import CC캐릭터프리뷰, { 보기목록, 자세목록, 품질목록 } from "./캐릭터프리뷰.jsx";
import { 기본카탈로그, 슬롯이름, 색상슬롯이름, 썸네일고르기 } from "./카탈로그.js";
import {
  기본초안, 초안보정, 성별맞추기, 렌더러설정, 완료데이터, 체형항목, 체형묶음, 비율표시, 기본몸치수, 항목기본,
  슬롯선택지, 성별목록,
} from "./외형데이터.js";
import { 기본이름규칙, 규칙보정, 형식검사, 이름정규화, 글자수 } from "./이름규칙.js";
import {
  색, 글꼴, 글자, 사이, 단추, 고른단추, 주단추, 꺼진주단추, 입력칸, 도구표면, 배경, 대비층, 화면CSS,
} from "./스타일.js";

// ── 아이콘 ───────────────────────────────────────────────────
// 한 가지 선 굵기·둥근 끝으로 맞춘다. 이모지·잡다한 기호를 섞지 않는다.
const 아이콘틀 = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
const 아이콘 = {
  기본: (<svg {...아이콘틀}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.6-3.7 3.3-5.6 6.5-5.6s5.9 1.9 6.5 5.6" /></svg>),
  체형: (<svg {...아이콘틀}><path d="M4 9h16v6H4z" /><path d="M8 9v3M12 9v4M16 9v3" /></svg>),
  헤어: (<svg {...아이콘틀}><path d="M5 13a7 7 0 0 1 14 0" /><path d="M5 13c0 4 1 6 1 6M19 13c0 4-1 6-1 6" /><path d="M9 6.5C10.5 4.8 13.8 4.6 15.5 6.6" /></svg>),
  의상: (<svg {...아이콘틀}><path d="M9 4 6 6 4 9l3 2v9h10v-9l3-2-2-3-3-2" /><path d="M9 4a3 3 0 0 0 6 0" /></svg>),
};

const 카테고리목록 = [["기본", "기본"], ["체형", "체형"], ["헤어", "헤어"], ["의상", "의상"]];

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

// 화면 폭에 따른 배치 수치. 안전영역(카메라가 피해야 할 픽셀)도 여기서 나온다.
function 배치재기(폭, 높이, 단계) {
  const 좁음 = 폭 < 1080;
  const 여백 = 좁음 ? 16 : Math.min(56, Math.max(40, Math.round(폭 * 0.026)));
  const 위여백 = 좁음 ? 14 : 30;
  const 레일 = 좁음 ? 0 : 96;
  const 패널 = 좁음 ? 0 : Math.min(340, Math.max(300, Math.round(폭 * 0.18)));
  const 머리높이 = 좁음 ? 74 : 104;
  const 시트 = 좁음 ? Math.round(Math.min(340, 높이 * 0.42)) : 0;
  const 도크 = 좁음 ? 0 : 64;
  const 갈래띠 = 좁음 && 단계 === "외형" ? 52 : 0;
  return {
    좁음, 여백, 위여백, 레일, 패널, 머리높이, 시트, 도크, 갈래띠,
    안전영역: {
      왼쪽: 좁음 ? 여백 : 여백 + (단계 === "외형" ? 레일 + 16 : 0),
      오른쪽: 좁음 ? 여백 : 여백 + 패널 + 24,
      위: 위여백 + 머리높이 + 갈래띠,
      아래: 좁음 ? 시트 + 16 : 도크 + 위여백 + 28,
    },
  };
}

// ── 작은 조각들 ───────────────────────────────────────────────
function CC칩단추({ 고름, children, onClick, 넓게 = false, ...남은 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={고름}
      style={{ ...(고름 ? 고른단추 : 단추), ...(넓게 ? { flex: 1 } : null), padding: "9px 14px" }}
      {...남은}
    >
      {children}
    </button>
  );
}

function CC슬라이더({ 항목, 값, 성별, 바꾸기, 끌기시작, 끌기끝, 되돌리기 }) {
  const id = useId();
  return (
    <div className="슬라줄" style={{ display: "grid", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 사이.s }}>
        <label htmlFor={id} style={글자.라벨}>{항목.이름}</label>
        <output htmlFor={id} style={{ marginLeft: "auto", ...글자.수치 }}>{비율표시(항목, 값, 성별)}</output>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 사이.s }}>
        <input
          id={id}
          type="range"
          min={항목.min}
          max={항목.max}
          step={항목.step}
          value={값}
          aria-valuetext={비율표시(항목, 값, 성별)}
          onPointerDown={끌기시작}
          onKeyDown={끌기시작}
          onChange={(e) => 바꾸기(Number(e.target.value), false)}
          onPointerUp={끌기끝}
          onKeyUp={끌기끝}
          onBlur={끌기끝}
        />
        {/* 미세 조절·초기화는 늘 있지만 조용하다(가리키거나 포커스가 오면 또렷해진다). */}
        <span className="미세" style={{ display: "flex", gap: 2, flex: "0 0 auto", transition: "opacity 160ms" }}>
          <button type="button" aria-label={`${항목.이름} 줄이기`} style={작은아이콘단추} onClick={() => 바꾸기(값 - 항목.step, true)}>−</button>
          <button type="button" aria-label={`${항목.이름} 늘리기`} style={작은아이콘단추} onClick={() => 바꾸기(값 + 항목.step, true)}>＋</button>
          <button type="button" aria-label={`${항목.이름} 초기화`} style={작은아이콘단추} onClick={되돌리기}>↺</button>
        </span>
      </div>
      {항목.설명 ? <div style={글자.설명}>{항목.설명}</div> : null}
    </div>
  );
}

function CC색고르기({ 갈래, 목록, 값, 바꾸기 }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 사이.s }}>
      <legend style={{ ...글자.라벨, padding: 0 }}>{색상슬롯이름[갈래]} 색</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 사이.s, alignItems: "center" }}>
        {목록.map(([코드, 이름]) => {
          const 고름 = 코드.toLowerCase() === (값 ?? "").toLowerCase();
          return (
            <button
              key={코드}
              type="button"
              onClick={() => 바꾸기(코드)}
              aria-pressed={고름}
              aria-label={이름}
              title={이름}
              style={{
                ...색칩,
                background: 코드,
                boxShadow: 고름 ? `0 0 0 2px ${색.강조}, 0 0 0 4px rgba(0,0,0,0.35)` : "inset 0 0 0 1px rgba(0,0,0,0.35)",
              }}
            >
              {고름 ? <span style={{ color: "#06222C", font: "700 11px/1 sans-serif" }}>✓</span> : null}
            </button>
          );
        })}
        <label style={{ ...색칩, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.08)", cursor: "pointer" }}
               title="직접 고르기">
          <input
            type="color"
            value={값 ?? "#ffffff"}
            onChange={(e) => 바꾸기(e.target.value)}
            aria-label={`${색상슬롯이름[갈래]} 색 직접 고르기`}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={색.흐린글} strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </label>
      </div>
    </fieldset>
  );
}

function CC묶음({ 제목, 열림, 열기, children }) {
  return (
    <section style={{ display: "grid", gap: 사이.m }}>
      <button
        type="button"
        onClick={열기}
        aria-expanded={열림}
        style={{ ...단추, padding: "6px 0", display: "flex", alignItems: "center", gap: 사이.s, color: 색.글 }}
      >
        <span style={{ font: `600 14px/1.3 ${글꼴.본문}` }}>{제목}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" style={{ marginLeft: "auto", transform: `rotate(${열림 ? 180 : 0}deg)`, transition: "transform 200ms" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {열림 ? <div style={{ display: "grid", gap: 사이.l }}>{children}</div> : null}
    </section>
  );
}

function CC아이템카드({ 고름, 이름, 설명, 썸네일, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={고름} style={{ ...단추, padding: 0, display: "grid", gap: 6, justifyItems: "center" }}>
      <span style={{
        width: "100%", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden",
        background: 고름 ? "rgba(154,216,232,0.16)" : "rgba(255,255,255,0.05)",
        boxShadow: 고름 ? `inset 0 0 0 1.5px ${색.강조}` : "none",
        display: "grid", placeItems: "center", transition: "background 160ms",
      }}>
        {썸네일
          ? <img src={썸네일} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <span style={글자.설명}>없음</span>}
      </span>
      <span style={{ font: `500 12px/1.3 ${글꼴.본문}`, color: 고름 ? "#fff" : 색.흐린글, textAlign: "center" }}>
        {고름 ? `✓ ${이름}` : 이름}
      </span>
      {설명 ? <span style={{ ...글자.설명, fontSize: 11 }}>{설명}</span> : null}
    </button>
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
  const [열린묶음, set열린묶음] = useState("필수");
  const [속옷보기, set속옷보기] = useState(false);
  const [안내, set안내] = useState(처음값.알림.length ? 처음값.알림.join(" ") : null);
  const [보기, set보기] = useState("전신");
  const [자세, set자세] = useState("Idle_Loop");
  const [품질, set품질] = useState("보통");
  const [관찰열림, set관찰열림] = useState(false);
  const [읽는중, set읽는중] = useState(false);
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
  const 관찰단추 = useRef(null);
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
      set안내(바뀜.length ? `${다음성별 === "feminine" ? "여성" : "남성"}에 없는 항목을 바꿨습니다 — ${바뀜.join(", ")}` : null);
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
    else if (갈래 === "의상") 외형바꾸기((v) => ({ ...v, equipmentIds: { ...기본.equipmentIds }, colors: { ...v.colors, cloth: "#ffffff" } }));
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
  const 이름메시지 = 이름상태.종류 === "형식" ? 이름상태.메시지 : (이름상태.메시지 ?? 이름상태글[이름상태.종류] ?? "");
  const 완료막힘이유 = !확인됨
    ? (typeof checkName !== "function" ? 이름상태글.미연결 : "이름 중복확인을 마쳐야 완료할 수 있습니다.")
    : null;

  const { 좁음, 여백, 위여백, 레일, 패널, 머리높이, 시트, 갈래띠, 안전영역 } = 배치;
  const 항목설명 = {
    기본: "성별과 피부색을 정합니다.",
    체형: "키와 비율을 조절합니다. 기본값 그대로 넘어가도 됩니다.",
    헤어: "머리 모양과 색을 고릅니다.",
    의상: "지금 준비된 옷과 색입니다.",
  };

  return (
    <div ref={루트} className="캐생" style={루트칸}>
      <style>{화면CSS}</style>

      {/* 배경층 — 화면 끝까지 이어지는 한 덩이 */}
      <div style={배경(좁음 ? 50 : 44)} />

      {/* 3D층 — 투명 캔버스 */}
      <div style={{ position: "absolute", inset: 0, opacity: 들어옴 ? 1 : 0, transition: "opacity 600ms ease-out" }}>
        <CC캐릭터프리뷰
          설정={렌더설정}
          보기={단계 === "이름" ? "상반신" : 보기}
          자세={자세}
          품질={품질}
          안전영역={안전영역}
          조작알림={조작등록}
          읽는중알림={set읽는중}
        />
      </div>

      {/* 대비층 — 글자가 놓이는 가장자리만 살짝 눌러 준다 */}
      <div style={대비층} />

      {/* UI층 — 빈 자리는 캐릭터를 돌려 보는 자리다 */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <header style={{ position: "absolute", left: 여백, top: 위여백, right: 여백, display: "flex", alignItems: "flex-start", gap: 사이.xl, pointerEvents: "none" }}>
          <div style={{ display: "grid", gap: 6, pointerEvents: "auto" }}>
            <h1 style={{ margin: 0, ...글자.제목, fontSize: 좁음 ? 22 : 30 }}>캐릭터 생성</h1>
            <p style={{ margin: 0, ...글자.설명 }}>왜곡을 조사할 당신의 모습을 만들어 주세요.</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 사이.l, pointerEvents: "auto" }}>
            <span style={글자.단계}>
              <span style={{ color: 단계 === "외형" ? 색.강조 : 색.더흐린글 }}>01 외형</span>
              <span style={{ opacity: 0.5 }}>{"  ·  "}</span>
              <span style={{ color: 단계 === "이름" ? 색.강조 : 색.더흐린글 }}>02 이름</span>
            </span>
            {onCancel ? (
              <button type="button" style={{ ...단추, padding: "6px 10px" }} onClick={onCancel}>닫기</button>
            ) : null}
          </div>
        </header>

        {안내 ? (
          <div style={{ ...안내줄, left: 여백, top: 위여백 + 머리높이 - 16, maxWidth: 크기.폭 - 여백 * 2 }} role="status">
            {안내}
            <button type="button" style={{ ...단추, padding: "2px 8px", color: 색.경고 }} onClick={() => set안내(null)}>확인</button>
          </div>
        ) : null}

        {/* 왼쪽 카테고리 — 아이콘 + 짧은 라벨. 바깥 상자는 없다. */}
        {단계 === "외형" ? (
          <nav
            aria-label="편집 항목"
            style={좁음
              ? { position: "absolute", left: 여백, right: 여백, top: 위여백 + 머리높이 - 10, display: "flex", gap: 사이.s, justifyContent: "center", pointerEvents: "auto" }
              : { position: "absolute", left: 여백, top: "50%", transform: "translateY(-50%)", width: 레일, display: "grid", gap: 사이.s, pointerEvents: "auto" }}
          >
            {카테고리목록.map(([값, 글]) => {
              const 고름 = 갈래 === 값;
              return (
                <button
                  key={값}
                  type="button"
                  aria-pressed={고름}
                  onClick={() => 갈래고르기(값)}
                  style={{
                    ...단추,
                    display: "grid", justifyItems: "center", gap: 4, padding: 좁음 ? "8px 14px" : "12px 6px",
                    gridAutoFlow: 좁음 ? "column" : "row",
                    alignItems: "center",
                    color: 고름 ? "#fff" : 색.더흐린글,
                    background: 고름 ? "rgba(154,216,232,0.14)" : "none",
                  }}
                >
                  {아이콘[값]}
                  <span style={{ font: `500 12px/1 ${글꼴.본문}` }}>{글}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {/* 오른쪽 조절부 — 상자가 아니라 글과 컨트롤만 떠 있다 */}
        <aside
          aria-label={단계 === "외형" ? "조절 패널" : "이름 입력"}
          style={좁음
            ? { position: "absolute", left: 0, right: 0, bottom: 0, height: 시트, padding: `${사이.l}px ${여백}px`, boxSizing: "border-box", overflowY: "auto", pointerEvents: "auto", background: "linear-gradient(180deg, rgba(6,12,20,0) 0%, rgba(6,12,20,0.86) 14%, rgba(6,12,20,0.94) 100%)" }
            : { position: "absolute", right: 여백, top: 위여백 + 머리높이, width: 패널, maxHeight: `calc(100% - ${위여백 * 2 + 머리높이 + 80}px)`, overflowY: "auto", pointerEvents: "auto", display: "grid", gap: 사이.l, alignContent: "start" }}
        >
          {단계 === "외형" ? (
            <>
              <div style={{ display: "grid", gap: 2 }}>
                <h2 style={{ margin: 0, ...글자.항목제목 }}>{갈래}</h2>
                <p style={{ margin: 0, ...글자.설명 }}>{항목설명[갈래]}</p>
              </div>

              {갈래 === "기본" ? (
                <div style={{ display: "grid", gap: 사이.l }}>
                  <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 사이.s }}>
                    <legend style={{ ...글자.라벨, padding: 0 }}>성별</legend>
                    <div style={{ display: "flex", gap: 사이.s }}>
                      {성별목록().map(([값, 글]) => (
                        <CC칩단추 key={값} 고름={모습.성별 === 값} 넓게 onClick={() => 성별바꾸기(값)}>
                          {모습.성별 === 값 ? `✓ ${글}` : 글}
                        </CC칩단추>
                      ))}
                    </div>
                  </fieldset>
                  <CC색고르기 갈래="skin" 목록={카탈로그.색상.skin} 값={외형.colors.skin}
                              바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, skin: 코드 } }))} />
                  <label style={{ display: "flex", gap: 사이.s, alignItems: "center", ...글자.라벨, cursor: "pointer" }}>
                    <input type="checkbox" checked={속옷보기} onChange={(e) => set속옷보기(e.target.checked)} />
                    속옷으로 체형 보기
                  </label>
                  <p style={{ margin: 0, ...글자.설명 }}>골라 둔 옷은 그대로 남습니다.</p>
                </div>
              ) : null}

              {갈래 === "체형" ? (
                <div style={{ display: "grid", gap: 사이.l }}>
                  {체형묶음.map(([묶음, 글]) => (
                    <CC묶음 key={묶음} 제목={글} 열림={열린묶음 === 묶음} 열기={() => set열린묶음((v) => (v === 묶음 ? null : 묶음))}>
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
                    </CC묶음>
                  ))}
                </div>
              ) : null}

              {갈래 === "헤어" ? (
                <div style={{ display: "grid", gap: 사이.l }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 사이.s }}>
                    {슬롯선택지(카탈로그, "hair", 모습.성별).map((it) => (
                      <CC아이템카드 key={it.id} 고름={외형.hairId === it.id} 이름={it.이름} 썸네일={썸네일고르기(it, 모습.성별)}
                                    onClick={() => 외형바꾸기((v) => ({ ...v, hairId: it.id }))} />
                    ))}
                  </div>
                  <CC색고르기 갈래="hair" 목록={카탈로그.색상.hair} 값={외형.colors.hair}
                              바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, hair: 코드 } }))} />
                </div>
              ) : null}

              {갈래 === "의상" ? (
                <div style={{ display: "grid", gap: 사이.l }}>
                  {["top", "bottom", "shoes"].map((슬롯) => (
                    <div key={슬롯} style={{ display: "grid", gap: 사이.s }}>
                      <span style={글자.라벨}>{슬롯이름[슬롯]}</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 사이.s }}>
                        {슬롯선택지(카탈로그, 슬롯, 모습.성별).map((it) => (
                          <CC아이템카드 key={it.id} 고름={외형.equipmentIds[슬롯] === it.id} 이름={it.이름}
                                        썸네일={썸네일고르기(it, 모습.성별)}
                                        onClick={() => 외형바꾸기((v) => ({ ...v, equipmentIds: { ...v.equipmentIds, [슬롯]: it.id } }))} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <CC색고르기 갈래="cloth" 목록={카탈로그.색상.cloth} 값={외형.colors.cloth}
                              바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, cloth: 코드 } }))} />
                  <p style={{ margin: 0, ...글자.설명 }}>상의와 하의는 한 가지 색을 함께 씁니다.</p>
                </div>
              ) : null}

              <button type="button" style={{ ...단추, justifySelf: "start", padding: "6px 0" }} onClick={갈래초기화}>
                이 항목 초기화
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 사이.l }}>
              <div style={{ display: "grid", gap: 4 }}>
                <h2 style={{ margin: 0, ...글자.항목제목 }}>당신의 이름을 알려 주세요</h2>
                <p style={{ margin: 0, ...글자.설명 }}>게임에서 사용할 조사관의 이름입니다.</p>
              </div>
              <div style={{ display: "grid", gap: 사이.s }}>
                <div style={{ display: "flex", gap: 사이.s }}>
                  <input
                    id={이름칸ID}
                    value={이름}
                    style={입력칸}
                    maxLength={규칙.최대 * 2}
                    placeholder={`${규칙.최소}~${규칙.최대}자`}
                    aria-describedby={`${이름칸ID}-도움 ${이름칸ID}-결과`}
                    onCompositionStart={() => set조합중(true)}
                    onCompositionEnd={(e) => { set조합중(false); 이름적기(e.target.value); }}
                    onChange={(e) => 이름적기(e.target.value)}
                    onKeyDown={(e) => {
                      // 한글을 조합하는 중의 Enter 는 '입력 확정'이라 제출로 받으면 안 된다.
                      if (e.key === "Enter" && !e.nativeEvent.isComposing && !조합중) {
                        e.preventDefault();
                        중복확인();
                      }
                    }}
                  />
                  <button type="button" style={{ ...단추, padding: "0 16px", background: "rgba(255,255,255,0.08)", color: 색.글 }}
                          onClick={중복확인} disabled={이름상태.종류 === "확인중"}>
                    중복확인
                  </button>
                </div>
                <span id={`${이름칸ID}-도움`} style={글자.설명}>
                  {글자수(이름)} / {규칙.최대}자 · {규칙.허용설명}
                </span>
                {/* 결과 자리를 미리 비워 둔다 — 메시지가 떠도 입력칸·버튼이 위아래로 튀지 않는다. */}
                <div id={`${이름칸ID}-결과`} role="status" aria-live="polite"
                     style={{ minHeight: 40, ...글자.본문, color: 상태색[이름상태.종류] ?? 색.흐린글 }}>
                  {이름상태.종류 === "입력전" && !형식.ok && !형식.비었음 ? 형식.메시지 : 이름메시지}
                </div>
              </div>
              {완료오류 ? <div style={{ ...글자.본문, color: 색.오류 }}>{완료오류}</div> : null}
              {완료됨 ? <div style={{ ...글자.본문, color: 색.성공 }}>캐릭터를 만들었습니다. 다음 화면을 기다리는 중입니다.</div> : null}
            </div>
          )}
        </aside>

        {/* 관찰 도크 — 캐릭터 아래 */}
        {!좁음 ? (
          <div style={{ position: "absolute", left: 안전영역.왼쪽, width: Math.max(220, 크기.폭 - 안전영역.왼쪽 - 안전영역.오른쪽), bottom: 위여백, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ ...도구표면, display: "flex", alignItems: "center", gap: 2, padding: 6, pointerEvents: "auto", position: "relative" }}>
              {보기목록.map(([값, 글]) => (
                <CC칩단추 key={값} 고름={(단계 === "이름" ? "상반신" : 보기) === 값} onClick={() => set보기(값)}>{글}</CC칩단추>
              ))}
              <span style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)", margin: `0 ${사이.xs}px` }} />
              <button ref={관찰단추} type="button" aria-expanded={관찰열림} aria-haspopup="dialog"
                      style={{ ...단추, padding: "9px 12px" }} onClick={() => set관찰열림((v) => !v)}>
                관찰 옵션
              </button>
              {관찰열림 ? (
                <div role="dialog" aria-label="관찰 옵션"
                     style={{ ...도구표면, position: "absolute", right: 0, bottom: "calc(100% + 8px)", width: 236, padding: 사이.m, display: "grid", gap: 사이.m }}
                     onKeyDown={(e) => { if (e.key === "Escape") { set관찰열림(false); 관찰단추.current?.focus(); } }}>
                  <div style={{ display: "grid", gap: 사이.xs }}>
                    <span style={글자.라벨}>자세</span>
                    <div style={{ display: "flex", gap: 사이.xs }}>
                      {자세목록.map(([값, 글]) => (
                        <CC칩단추 key={값} 고름={자세 === 값} 넓게 onClick={() => set자세(값)}>{글}</CC칩단추>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 사이.xs }}>
                    <span style={글자.라벨}>화질</span>
                    <div style={{ display: "flex", gap: 사이.xs }}>
                      {품질목록.map(([값, 글]) => (
                        <CC칩단추 key={값} 고름={품질 === 값} 넓게 onClick={() => set품질(값)}>{글}</CC칩단추>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 사이.xs }}>
                    <CC칩단추 넓게 onClick={() => 카메라손잡이.current?.돌리기(-Math.PI / 6)}>↺ 왼쪽</CC칩단추>
                    <CC칩단추 넓게 onClick={() => 카메라손잡이.current?.돌리기(Math.PI / 6)}>오른쪽 ↻</CC칩단추>
                  </div>
                  <CC칩단추 넓게 onClick={() => 카메라손잡이.current?.초기화()}>
                    보기 초기화
                  </CC칩단추>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {읽는중 ? (
          <div style={{ ...읽는중표시, top: 위여백 + 머리높이 + 갈래띠 + 12 }} role="status" aria-live="polite">
            새 모델을 불러오는 중…
          </div>
        ) : null}

        {/* 왼쪽 아래 — 낮은 강조의 보조 조작 */}
        {단계 === "외형" ? (
          <div style={{ position: "absolute", left: 여백, bottom: 좁음 ? 시트 + 10 : 위여백, display: "flex", gap: 사이.xs, pointerEvents: "auto" }}>
            <button type="button" style={보조단추} onClick={되돌리기} disabled={!이력.과거.length}>되돌리기</button>
            <button type="button" style={보조단추} onClick={다시실행} disabled={!이력.미래.length}>다시 실행</button>
            <button type="button" style={보조단추} onClick={전체초기화}>외형 초기화</button>
          </div>
        ) : (
          <div style={{ position: "absolute", left: 여백, bottom: 좁음 ? 시트 + 10 : 위여백, pointerEvents: "auto" }}>
            <button type="button" style={보조단추} onClick={() => set단계("외형")}>← 외형 수정</button>
          </div>
        )}

        {/* 오른쪽 아래 — 그 화면의 단 하나의 강한 행동 */}
        <div style={{ position: "absolute", right: 여백, bottom: 좁음 ? 시트 + 10 : 위여백, display: "flex", alignItems: "center", gap: 사이.m, pointerEvents: "auto" }}>
          {단계 === "외형" ? (
            <button type="button" className="주단추" style={주단추}
                    onClick={() => { set속옷보기(false); set단계("이름"); set관찰열림(false); }}>
              이름 입력으로
            </button>
          ) : (
            <>
              {완료막힘이유 ? <span style={{ ...글자.설명, maxWidth: 220, textAlign: "right" }}>{완료막힘이유}</span> : null}
              <button type="button" className="주단추" style={확인됨 && !완료중 && !완료됨 ? 주단추 : 꺼진주단추}
                      disabled={!확인됨 || 완료중 || 완료됨} onClick={완료하기}>
                {완료중 ? "처리 중입니다…" : "캐릭터 생성 완료"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────
const 루트칸 = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: 색.가장자리,
};

const 보조단추 = { ...단추, padding: "8px 10px", color: 색.더흐린글, font: `500 12px/1.3 ${글꼴.본문}` };

const 작은아이콘단추 = {
  ...단추,
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: 색.흐린글,
  background: "rgba(255,255,255,0.06)",
  font: `500 13px/1 ${글꼴.본문}`,
};

const 색칩 = {
  position: "relative",
  width: 28,
  height: 28,
  padding: 0,
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  transition: "box-shadow 160ms",
};

const 안내줄 = {
  position: "absolute",
  display: "flex",
  alignItems: "center",
  gap: 사이.s,
  padding: "8px 12px",
  borderRadius: 10,
  background: "rgba(240,194,122,0.12)",
  color: 색.경고,
  font: `500 12px/1.5 ${글꼴.본문}`,
  pointerEvents: "auto",
};

const 읽는중표시 = {
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "6px 14px",
  borderRadius: 999,
  background: "rgba(8,14,22,0.8)",
  font: `500 12px/1 ${글꼴.본문}`,
  color: 색.흐린글,
  pointerEvents: "none",
};
