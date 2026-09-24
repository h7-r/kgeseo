// 캐릭터 생성 화면 — 외형을 정하고 이름을 붙여 바깥으로 넘긴다.
//
// [이 화면이 하는 일과 안 하는 일]
//   한다:   외형 편집, 3D 미리보기, 이름 입력·중복확인 UI, 완료 데이터 만들기.
//   안 한다: 회원가입·로그인, 라우팅, 실제 API 호출, 계정 저장, 오프닝·튜토리얼로 넘어가기.
//            이름 확인과 완료는 **바깥에서 받은 함수**로만 부탁하고, 결과를 화면에 비춘다.
//
// [props 계약]  docs/캐릭터생성-인수인계.md 에 같은 내용이 정리돼 있다.
//   initialValue?  처음 보여 줄 초안(외형·이름). **마운트할 때 한 번만** 읽는다.
//   catalog?       선택지 목록. 없으면 저장소의 실제 에셋 목록(기본카탈로그)을 쓴다.
//   nameRules?     이름 형식 규칙(길이·허용 문자).
//   checkName(name, { signal })  이름 확인 함수. 없으면 완료를 막고 그 사실을 표시한다.
//   onDraftChange?(draft)        초안이 바뀔 때마다 알린다(임시 저장은 부모 몫).
//   onComplete(payload)          완료 요청. { ok:true } | { ok:false, reason } 를 기다린다.
//   onCancel?()                  닫기 요청.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import CC캐릭터프리뷰 from "./캐릭터프리뷰.jsx";
import { 기본카탈로그, 슬롯이름, 색상슬롯이름, 썸네일고르기 } from "./카탈로그.js";
import {
  기본초안, 초안보정, 성별맞추기, 렌더러설정, 완료데이터, 체형항목, 체형묶음, 비율표시, 기본몸치수, 항목기본, 슬롯선택지, 착장요약, 성별목록,
} from "./외형데이터.js";
import { 기본이름규칙, 규칙보정, 형식검사, 이름정규화, 글자수 } from "./이름규칙.js";
import { 색, 글꼴, 화면, 단추, 고른단추, 큰단추, 꺼진단추, 입력칸, 작은글, 라벨, 소제목, 포커스CSS } from "./스타일.js";

const 카테고리목록 = [
  ["기본", "기본"],
  ["체형", "체형"],
  ["헤어", "헤어"],
  ["의상", "의상"],
];

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

// ── 작은 조각들 ───────────────────────────────────────────────
function CC카드단추({ 고름, 이름, 설명, 썸네일, 색표시, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={고름} style={{ ...카드, ...(고름 ? 고른카드 : null) }}>
      <span style={{ ...카드그림, ...(색표시 ? { background: 색표시 } : null) }}>
        {썸네일 ? <img src={썸네일} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : null}
      </span>
      <span style={{ display: "grid", gap: 2, textAlign: "left", minWidth: 0 }}>
        <span style={{ font: `600 13px/1.3 ${글꼴.본문}` }}>{이름}</span>
        {설명 ? <span style={작은글}>{설명}</span> : null}
      </span>
      {/* 색만으로 고른 것을 알리지 않는다 — 체크 표시와 글자를 함께 둔다. */}
      <span style={{ marginLeft: "auto", font: `700 12px/1 ${글꼴.모노}`, color: 고름 ?색.강조 : "transparent" }}>✓ 선택</span>
    </button>
  );
}

function CC슬라이더({ 항목, 값, 성별, 바꾸기, 끌기시작, 끌기끝, 되돌리기 }) {
  const id = useId();
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <label htmlFor={id} style={라벨}>{항목.이름}</label>
        <output htmlFor={id} style={{ marginLeft: "auto", font: `500 12px/1 ${글꼴.모노}`, color: 색.흐린글 }}>
          {비율표시(항목, 값, 성별)}
        </output>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 28px auto", alignItems: "center", gap: 6 }}>
        <button type="button" style={미세단추} aria-label={`${항목.이름} 줄이기`} onClick={() => 바꾸기(값 - 항목.step, true)}>−</button>
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
        <button type="button" style={미세단추} aria-label={`${항목.이름} 늘리기`} onClick={() => 바꾸기(값 + 항목.step, true)}>＋</button>
        {/* 화면에는 '초기화' 만 보이지만, 같은 글자 단추가 여럿이라 읽어 주는 이름은 항목마다 다르게 둔다. */}
        <button type="button" aria-label={`${항목.이름} 초기화`} style={{ ...미세단추, width: 52, padding: 0, fontSize: 11 }} onClick={되돌리기}>초기화</button>
      </div>
      {항목.설명 ? <div style={작은글}>{항목.설명}</div> : null}
    </div>
  );
}

function CC색고르기({ 갈래, 목록, 값, 바꾸기 }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
      <legend style={소제목}>{색상슬롯이름[갈래]} 색</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "stretch" }}>
        <label style={{ ...단추, display: "grid", gap: 4, justifyItems: "center", padding: "6px 8px", cursor: "pointer" }}>
          <input
            type="color"
            value={값 ?? "#ffffff"}
            onChange={(e) => 바꾸기(e.target.value)}
            aria-label={`${색상슬롯이름[갈래]} 색 직접 고르기`}
            style={{ width: 26, height: 18, padding: 0, border: 0, background: "none", cursor: "pointer" }}
          />
          <span style={{ font: `500 11px/1 ${글꼴.본문}` }}>직접</span>
        </label>
        {목록.map(([코드, 이름]) => {
          const 고름 = 코드.toLowerCase() === (값 ?? "").toLowerCase();
          return (
            <button
              key={코드}
              type="button"
              onClick={() => 바꾸기(코드)}
              aria-pressed={고름}
              title={이름}
              style={{
                ...단추,
                display: "grid",
                gap: 4,
                justifyItems: "center",
                padding: "6px 8px",
                ...(고름 ? { borderColor: 색.선강조, background: "rgba(59,130,246,0.22)" } : null),
              }}
            >
              <span style={{ width: 26, height: 18, borderRadius: 4, background: 코드, border: "1px solid rgba(0,0,0,0.35)" }} />
              <span style={{ font: `500 11px/1 ${글꼴.본문}` }}>{고름 ? `✓ ${이름}` : 이름}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
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

  // initialValue 는 마운트할 때 한 번만 읽는다. 다른 캐릭터를 열려면 부모가 key 를 바꿔 다시 마운트한다.
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
  const [속옷보기, set속옷보기] = useState(false);
  const [안내, set안내] = useState(처음값.알림.length ? 처음값.알림.join(" ") : null);
  const [좁음, set좁음] = useState(false);
  const [보기, set보기] = useState("전신");
  const [자세, set자세] = useState("Idle_Loop");
  const [품질, set품질] = useState("보통");

  const [이름, set이름] = useState(처음값.초안.displayName);
  const [조합중, set조합중] = useState(false);
  const [이름상태, set이름상태] = useState({ 종류: "입력전", 확인한이름: null });
  const [완료중, set완료중] = useState(false);
  const [완료됨, set완료됨] = useState(false);
  const [완료오류, set완료오류] = useState(null);

  const 끌기전 = useRef(null);
  const 검사번호 = useRef(0);
  const 검사중단 = useRef(null);
  const 감쌈 = useRef(null);

  // 지금 성별의 외형. 아직 만든 적 없으면 그 자리에서 기본값을 만든다.
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

  // 좁은 화면에서는 왼쪽 목록을 가로 탭으로, 오른쪽 패널을 아래로 내린다.
  useEffect(() => {
    const 요소 = 감쌈.current;
    if (!요소 || typeof ResizeObserver === "undefined") return undefined;
    const 눈 = new ResizeObserver(([항목]) => set좁음(항목.contentRect.width < 1120));
    눈.observe(요소);
    return () => 눈.disconnect();
  }, []);

  // ── 외형 바꾸기 ─────────────────────────────────────────────
  const 찍기 = useCallback(() => {
    set이력((h) => ({ 과거: [...h.과거, 모습].slice(-50), 미래: [] }));
  }, [모습]);

  // 이력에 남기며 바꾼다(단추·카드처럼 한 번에 끝나는 조작).
  const 바꾸기 = useCallback((만들기) => {
    찍기();
    set모습(만들기);
  }, [찍기]);

  // 이력에 남기지 않고 바꾼다(슬라이더를 끄는 동안). 놓을 때 한 번만 이력에 남는다.
  const 살짝바꾸기 = useCallback((만들기) => set모습(만들기), []);

  const 외형바꾸기 = useCallback((만들기, 이력에 = true) => {
    const 적용 = (이전) => {
      const 지금 = 이전.초안들[이전.성별] ?? 초안보정(기본초안(카탈로그, 이전.성별), 카탈로그).초안.appearance;
      return { ...이전, 초안들: { ...이전.초안들, [이전.성별]: 만들기(지금) } };
    };
    if (이력에) 바꾸기(적용);
    else 살짝바꾸기(적용);
  }, [바꾸기, 살짝바꾸기, 카탈로그]);

  const 성별바꾸기 = (다음성별) => {
    if (다음성별 === 모습.성별) return;
    바꾸기((이전) => {
      const 이미 = 이전.초안들[다음성별];
      if (이미) return { ...이전, 성별: 다음성별 };
      // 그 성별 초안이 없으면 지금 몸 치수·색을 가져가되, 못 쓰는 옷·헤어는 기본값으로 바꾼다.
      const 지금 = 이전.초안들[이전.성별] ?? 초안보정(기본초안(카탈로그, 이전.성별), 카탈로그).초안.appearance;
      const { 외형: 맞춘것, 바뀜 } = 성별맞추기(지금, 다음성별, 카탈로그);
      if (바뀜.length) set안내(`${다음성별 === "feminine" ? "여성" : "남성"}에 없는 항목을 바꿨습니다 — ${바뀜.join(", ")}`);
      else set안내(null);
      return { ...이전, 성별: 다음성별, 초안들: { ...이전.초안들, [다음성별]: 맞춘것 } };
    });
  };

  // 되돌리기·다시 실행 — 슬라이더 한 번 끌기가 한 단계다(끄는 동안은 이력에 안 쌓는다).
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

  // ── 이름 ────────────────────────────────────────────────────
  const 형식 = 형식검사(이름, 규칙);
  const 정규이름 = 이름정규화(이름);
  const 확인됨 = 이름상태.종류 === "가능" && 이름상태.확인한이름 === 정규이름 && 정규이름.length > 0;

  const 이름적기 = (값) => {
    set이름(값);
    // 이름이 바뀌면 앞서 받은 '사용 가능' 은 더 이상 유효하지 않다. 진행 중인 확인도 버린다 —
    // 안 버리면 늦게 도착한 옛 답이 새 이름에 '사용할 수 있다' 고 말한다.
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
      if (내번호 !== 검사번호.current) return; // 늦게 온 답은 버린다
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
        // 화면을 직접 넘기지 않는다 — 다음 화면으로 보내는 것은 부모의 몫이다.
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
  const 이름메시지 = 이름상태.종류 === "형식"
    ? 이름상태.메시지
    : (이름상태.메시지 ?? 이름상태글[이름상태.종류] ?? "");
  const 완료막힘이유 = !확인됨
    ? (typeof checkName !== "function" ? 이름상태글.미연결 : "이름 중복확인을 마쳐야 완료할 수 있습니다.")
    : null;

  return (
    <div ref={감쌈} className="캐생" style={화면}>
      <style>{포커스CSS}</style>

      <header style={머리}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: `700 13px/1 ${글꼴.모노}`, letterSpacing: "0.22em", color: 색.강조 }}>왜곡</span>
          <h1 style={{ margin: 0, font: `700 22px/1.2 ${글꼴.본문}` }}>캐릭터 생성</h1>
          <p style={{ margin: 0, ...작은글 }}>왜곡을 조사할 당신의 모습을 만들어 주세요.</p>
        </div>
        <ol style={단계줄}>
          {[["외형", "① 외형 설정"], ["이름", "② 이름·최종 확인"]].map(([값, 글]) => (
            <li key={값} style={{ ...단계칸, ...(단계 === 값 ? 단계켬 : null) }} aria-current={단계 === 값 ? "step" : undefined}>
              {글}
            </li>
          ))}
        </ol>
        {onCancel ? (
          <button type="button" style={{ ...단추, marginLeft: "auto" }} onClick={onCancel}>닫기</button>
        ) : null}
      </header>

      {안내 ? (
        <div style={안내줄} role="status">
          {안내}
          <button type="button" style={{ ...단추, padding: "2px 8px", marginLeft: 8 }} onClick={() => set안내(null)}>확인</button>
        </div>
      ) : null}

      <div
        style={{
          ...본문,
          // 좁은 화면에서는 세로로 쌓는다. 미리보기가 눌려 없어지지 않도록 최소 높이를 준다.
          // 이름 단계에는 왼쪽 갈래 목록이 없다 — 열 수를 맞춰야 미리보기가 좁은 칸에 끼지 않는다.
          gridTemplateColumns: 좁음 ? "1fr" : (단계 === "외형" ? "200px minmax(0,1fr) 360px" : "minmax(0,1fr) 420px"),
          gridTemplateRows: 좁음 ? (단계 === "외형" ? "auto minmax(240px,1fr) minmax(180px,42%)" : "minmax(240px,1fr) minmax(180px,42%)") : "minmax(0,1fr)",
        }}
      >
        {단계 === "외형" ? (
          <nav style={{ ...갈래칸, ...(좁음 ? 갈래가로 : null) }} aria-label="편집 항목">
            {카테고리목록.map(([값, 글]) => (
              <button key={값} type="button" style={갈래 === 값 ? 고른단추 : 단추} aria-pressed={갈래 === 값} onClick={() => set갈래(값)}>
                {글}
              </button>
            ))}
          </nav>
        ) : null}

        <div style={{ display: "flex", minWidth: 0, minHeight: 0 }}>
          <CC캐릭터프리뷰
            설정={렌더설정}
            보기={보기}
            set보기={set보기}
            자세={자세}
            set자세={set자세}
            품질={품질}
            set품질={set품질}
          />
        </div>

        <aside style={패널} aria-label={단계 === "외형" ? "조절 패널" : "이름 입력"}>
          {단계 === "외형" ? (
            <>
              {갈래 === "기본" ? (
                <section style={칸}>
                  <h2 style={소제목}>성별</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    {성별목록().map(([값, 글]) => (
                      <button
                        key={값}
                        type="button"
                        style={{ ...(모습.성별 === 값 ? 고른단추 : 단추), flex: 1 }}
                        aria-pressed={모습.성별 === 값}
                        onClick={() => 성별바꾸기(값)}
                      >
                        {모습.성별 === 값 ? `✓ ${글}` : 글}
                      </button>
                    ))}
                  </div>
                  <p style={작은글}>캐릭터 외형의 성별입니다. 계정 정보와는 별개이며, 바꿔도 이전 설정은 그대로 남습니다.</p>
                  <CC색고르기
                    갈래="skin"
                    목록={카탈로그.색상.skin}
                    값={외형.colors.skin}
                    바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, skin: 코드 } }))}
                  />
                  <label style={{ display: "flex", gap: 8, alignItems: "center", ...라벨 }}>
                    <input type="checkbox" checked={속옷보기} onChange={(e) => set속옷보기(e.target.checked)} />
                    속옷으로 체형 보기
                  </label>
                  <p style={작은글}>잠깐 옷을 벗겨 체형만 봅니다. 골라 둔 옷은 그대로 남고, 끄거나 이름 단계로 가면 돌아옵니다.</p>
                </section>
              ) : null}

              {갈래 === "체형" ? (
                <section style={칸}>
                  {체형묶음.map(([묶음, 글]) => (
                    <div key={묶음} style={{ display: "grid", gap: 12 }}>
                      <h2 style={소제목}>{글}</h2>
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
                  ))}
                  <p style={작은글}>숫자는 기본 대비 비율입니다. 기본값만으로도 다음 단계로 넘어갈 수 있습니다.</p>
                </section>
              ) : null}

              {갈래 === "헤어" ? (
                <section style={칸}>
                  <h2 style={소제목}>{슬롯이름.hair}</h2>
                  <div style={{ display: "grid", gap: 6 }}>
                    {슬롯선택지(카탈로그, "hair", 모습.성별).map((it) => (
                      <CC카드단추
                        key={it.id}
                        고름={외형.hairId === it.id}
                        이름={it.이름}
                        설명={it.설명}
                        썸네일={썸네일고르기(it, 모습.성별)}
                        onClick={() => 외형바꾸기((v) => ({ ...v, hairId: it.id }))}
                      />
                    ))}
                  </div>
                  <CC색고르기
                    갈래="hair"
                    목록={카탈로그.색상.hair}
                    값={외형.colors.hair}
                    바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, hair: 코드 } }))}
                  />
                </section>
              ) : null}

              {갈래 === "의상" ? (
                <section style={칸}>
                  {["top", "bottom", "shoes"].map((슬롯) => (
                    <div key={슬롯} style={{ display: "grid", gap: 6 }}>
                      <h2 style={소제목}>{슬롯이름[슬롯]}</h2>
                      {슬롯선택지(카탈로그, 슬롯, 모습.성별).map((it) => (
                        <CC카드단추
                          key={it.id}
                          고름={외형.equipmentIds[슬롯] === it.id}
                          이름={it.이름}
                          설명={it.설명}
                          썸네일={썸네일고르기(it, 모습.성별)}
                          onClick={() => 외형바꾸기((v) => ({ ...v, equipmentIds: { ...v.equipmentIds, [슬롯]: it.id } }))}
                        />
                      ))}
                    </div>
                  ))}
                  <CC색고르기
                    갈래="cloth"
                    목록={카탈로그.색상.cloth}
                    값={외형.colors.cloth}
                    바꾸기={(코드) => 외형바꾸기((v) => ({ ...v, colors: { ...v.colors, cloth: 코드 } }))}
                  />
                  <p style={작은글}>지금 의상은 상·하의가 한 가지 색을 함께 씁니다. 따로 칠하는 것은 아직 지원하지 않습니다.</p>
                </section>
              ) : null}

              <button type="button" style={{ ...단추, justifySelf: "start" }} onClick={갈래초기화}>
                현재 항목 초기화
              </button>
            </>
          ) : (
            <section style={칸}>
              <h2 style={소제목}>캐릭터명</h2>
              <p style={작은글}>게임에서 사용할 조사관의 이름을 입력해 주세요.</p>
              <div style={{ display: "flex", gap: 8 }}>
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
                <button type="button" style={단추} onClick={중복확인} disabled={이름상태.종류 === "확인중"}>
                  중복확인
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span id={`${이름칸ID}-도움`} style={작은글}>
                  {글자수(이름)} / {규칙.최대}자 · {규칙.허용설명}
                </span>
              </div>
              <div
                id={`${이름칸ID}-결과`}
                role="status"
                aria-live="polite"
                style={{ ...작은글, color: 상태색[이름상태.종류] ?? 색.흐린글, minHeight: 18 }}
              >
                {이름상태.종류 === "입력전" && !형식.ok && !형식.비었음 ? 형식.메시지 : 이름메시지}
              </div>

              <h2 style={{ ...소제목, marginTop: 8 }}>선택한 모습</h2>
              <dl style={요약}>
                {착장요약(외형, 카탈로그).map(([이름표, 값]) => (
                  <div key={이름표} style={{ display: "contents" }}>
                    <dt style={{ ...작은글, color: 색.더흐린글 }}>{이름표}</dt>
                    <dd style={{ margin: 0, font: `500 13px/1.4 ${글꼴.본문}` }}>{값}</dd>
                  </div>
                ))}
              </dl>

              {완료오류 ? <div style={{ ...작은글, color: 색.오류 }}>{완료오류}</div> : null}
              {완료됨 ? <div style={{ ...작은글, color: 색.성공 }}>캐릭터를 만들었습니다. 다음 화면을 기다리는 중입니다.</div> : null}
            </section>
          )}
        </aside>
      </div>

      <footer style={바닥}>
        {단계 === "외형" ? (
          <>
            <button type="button" style={단추} onClick={되돌리기} disabled={!이력.과거.length}>되돌리기</button>
            <button type="button" style={단추} onClick={다시실행} disabled={!이력.미래.length}>다시 실행</button>
            <button type="button" style={단추} onClick={전체초기화}>외형 초기화</button>
            <button
              type="button"
              style={{ ...큰단추, marginLeft: "auto" }}
              onClick={() => { set속옷보기(false); set단계("이름"); }}
            >
              이름 입력으로 →
            </button>
          </>
        ) : (
          <>
            <button type="button" style={단추} onClick={() => set단계("외형")}>← 외형 수정</button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
              {완료막힘이유 ? <span style={작은글}>{완료막힘이유}</span> : null}
              <button
                type="button"
                style={확인됨 && !완료중 && !완료됨 ? 큰단추 : 꺼진단추}
                disabled={!확인됨 || 완료중 || 완료됨}
                onClick={완료하기}
              >
                {완료중 ? "처리 중입니다…" : "캐릭터 생성 완료"}
              </button>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────
const 머리 = {
  display: "flex",
  alignItems: "flex-start",
  gap: 24,
  padding: "16px 20px 12px",
  borderBottom: `1px solid ${색.선}`,
};
const 단계줄 = { display: "flex", gap: 8, listStyle: "none", margin: "6px 0 0", padding: 0 };
const 단계칸 = {
  padding: "6px 12px",
  borderRadius: 100,
  // 고른 단계에서 borderColor 만 덮으므로 축약(border)을 쓰지 않는다.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: 색.선,
  font: `500 12px/1 ${글꼴.모노}`,
  color: 색.더흐린글,
};
const 단계켬 = { borderColor: 색.선강조, background: "rgba(59,130,246,0.18)", color: "#fff" };
const 안내줄 = {
  margin: "10px 20px 0",
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid rgba(255,194,102,0.35)`,
  background: "rgba(255,194,102,0.10)",
  font: `500 12px/1.5 ${글꼴.본문}`,
  color: 색.경고,
};
const 본문 = {
  flex: "1 1 auto",
  display: "grid",
  gap: 14,
  minHeight: 0,
  padding: "14px 20px",
  alignItems: "stretch",
};
const 갈래칸 = { display: "grid", gap: 8, alignContent: "start" };
const 갈래가로 = { gridAutoFlow: "column", gridAutoColumns: "1fr", alignContent: "center" };
const 패널 = {
  display: "grid",
  gap: 14,
  alignContent: "start",
  minHeight: 0,
  overflowY: "auto",
  padding: 14,
  borderRadius: 14,
  border: `1px solid ${색.선}`,
  background: 색.판,
};
const 칸 = { display: "grid", gap: 12 };
const 카드 = {
  ...단추,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 8,
  width: "100%",
  textAlign: "left",
};
const 고른카드 = { borderColor: 색.선강조, background: "rgba(59,130,246,0.18)" };
const 카드그림 = {
  width: 44,
  height: 44,
  flex: "0 0 auto",
  borderRadius: 8,
  overflow: "hidden",
  background: "rgba(255,255,255,0.06)",
  border: `1px solid ${색.선}`,
};
const 미세단추 = { ...단추, width: 28, padding: 0, height: 26, lineHeight: "24px", textAlign: "center", whiteSpace: "nowrap" };
const 요약 = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 };
const 바닥 = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "12px 20px",
  borderTop: `1px solid ${색.선}`,
  background: "rgba(2,4,10,0.6)",
};
