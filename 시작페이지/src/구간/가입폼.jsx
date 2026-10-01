import { useEffect, useRef, useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 중심놓기, 소개폼중심, 가입폼왼쪽, 가입폼폭 } from "../공통.js";
import { 소셜로가기 } from "../소셜로그인.js";
import { 들어가기, 나가기, use로그인 } from "../로그인상태.js";
import { 가입, 이미있나, 닉네임있나 } from "../계정저장소.js";
import { 세기, 한글있나, 영문만안내, 영문칸, 메일오타 } from "../유효성.js";
import 지역고르기 from "./지역고르기.jsx";
import { use폼, use대문자잠금, 엔터로 } from "../폼검사.js";

/* div.form-inner — 피그마 21:1309 (560 × 660, 두 번째 화면 오른쪽)
   실제로 입력을 받는 폼이 아니라 **디자인 그대로의 겉모습**이다.
   게임과 붙일 때 input 으로 바꾸면 된다. */

const 검사할칸 = ["닉네임", "지역", "이메일", "비밀번호", "비밀번호확인"];

/* 저장소에 「이미 있나」를 물어보는 칸 — 칸을 떠나면(또는 고치다 멈추면) 확인한다 */
const 중복검사 = {
  이메일: async (v) => ((await 이미있나(v)) ? "이미 가입된 이메일입니다." : ""),
  닉네임: async (v) => ((await 닉네임있나(v)) ? "이미 사용 중인 닉네임입니다." : ""),
};

/* 누름(글) — 시작화면이 넘겨주는 이동 함수(이동표.js 의 단추이동). 「로그인」을 누르면 /로그인 */
export default function 가입폼({ 누름 = () => {} }) {
  /* 로그인했으면 가입폼 대신 환영 판을 보여 준다(아래 return 직전에서 갈린다).
     ★ 훅은 조건 없이 **항상 같은 순서로** 불려야 해서, 갈림은 모든 훅을 부른 뒤에 한다. */
  const 사람 = use로그인();
  /* 값·오류·맞음 표시는 use폼 이 관리한다 — 로그인·회원가입 카드(인증폼)와 같은 규칙 */
  const 폼 = use폼({ 칸들: 검사할칸, 비동기: 중복검사 });
  const 값 = 폼.값;
  const [동의오류, set동의오류] = useState("");
  const [꿀단지, set꿀단지] = useState(""); // 봇 막기 — 사람 눈엔 안 보이는 칸(인증폼 주석 참고)
  const 뜬때 = useRef(Date.now());
  /* ═══ 동의는 갈라서 받는다 ═══
     원본은 「이용약관 및 개인정보처리방침에 동의합니다」 한 줄이었다. 두 가지가 걸린다.
     ① 처리방침은 **공개하는 문서**지 동의를 받는 대상이 아니다. 동의를 받아야 하는 건
        「개인정보 수집·이용」이다.
     ② 만 14세 미만은 법정대리인 동의 없이 가입할 수 없다(개인정보 보호법 제22조의2).
        그래서 나이 확인을 따로 받는다.
     셋 다 필수라 하나라도 빠지면 막는다. */
  /* ★ 처음엔 **꺼 둔다.** 전엔 셋 다 켜진 채로 시작했는데, 개인정보 보호법은 동의를
     본인이 직접 표시하게 한다 — 미리 켜 두면 누른 적 없는 동의가 된다(인증폼과 같게 맞춤). */
  const [동의들, set동의들] = useState({ 약관: false, 수집: false, 나이: false });
  /* 약관 = 「전체」 줄. 아래 두 항목이 다 켜지면 저절로 켜진다(아래 한꺼번에바꾸기·하나바꾸기) */
  const 동의 = 동의들.수집 && 동의들.나이;
  /* 한 번 혼난 뒤에는 다 켜는 순간 빨간 글을 바로 풀어 준다 */
  const 동의확인 = (새) => { if (눌렀나) set동의오류(새.수집 && 새.나이 ? "" : "필수 항목에 모두 동의해주세요."); };
  const 한꺼번에바꾸기 = (v) => { const 새 = { 약관: v, 수집: v, 나이: v }; set동의들(새); 동의확인(새); };
  const 하나바꾸기 = (무엇, v) => { const 새 = { ...동의들, [무엇]: v }; 새.약관 = 새.수집 && 새.나이; set동의들(새); 동의확인(새); };
  const [눌렀나, set눌렀나] = useState(false);
  const [소셜말, set소셜말] = useState("");
  const [하는중, set하는중] = useState(false);
  const [경고, set경고] = useState(""); // 간편 가입 키가 없을 때 보여 줄 말
  const [됐나, set됐나] = useState(false);
  const [비번보임, set비번보임] = useState(false);
  const [확인보임, set확인보임] = useState(false);

  const 보내기 = async () => {
    if (하는중) return; // 두 번 눌러도 한 번만
    set눌렀나(true);
    set하는중(true);
    set경고("");
    try {
      const 칸통과 = await 폼.전부검사(); // 모든 칸 + 이메일·닉네임 중복까지
      set동의오류(동의 ? "" : "필수 항목에 모두 동의해주세요.");
      if (!칸통과 || !동의) return;
      if (꿀단지 || Date.now() - 뜬때.current < 1500) { set경고("잠시 후 다시 시도해 주세요."); return; }

      const 답 = await 가입({
        이메일: 값.이메일,
        비밀번호: 값.비밀번호,
        닉네임: 값.닉네임,
        지역: 값.지역,
        동의: { 이용약관: 동의들.약관, 개인정보수집: 동의들.수집, 만14세이상: 동의들.나이 },
      });
      if (!답.좋음) { set경고(답.까닭); return; }
      폼.비우기(["비밀번호", "비밀번호확인"]); // 비밀번호는 화면 상태에 남기지 않는다
      들어가기(답.사람);
      set됐나(true);
    } finally {
      set하는중(false);
    }
  };
  const 속성 = (이름) => ({ ...폼.속성(이름), 엔터: 엔터로(보내기) });
  const 오타 = 메일오타(값.이메일);

  /* ── 로그인한 사람 → 환영 판 ──
     가입을 막 끝낸 사람도 들어가기() 로 로그인되므로, 「가입 완료」 뒤 바로 이 판으로 바뀐다. */
  if (사람) return <환영판 사람={사람} 누름={누름} />;

  return (
    <div style={바깥} data-node-id="21:1309">
      <div style={{ position: "absolute", left: 0, right: 0, top: "64px", padding: "5px 0 3px" }}>
        <div style={제목} data-node-id="21:1317">탈출을 시작하세요.</div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: "115px", padding: "1px 0 2px" }}>
        <div style={부제} data-node-id="21:1319">계정을 만들고 전국의 방탈출 미션에 도전하세요.</div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: "161px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* 닉네임 · 지역 — 한 줄에 둘 21:1321 */}
        <div style={{ display: "flex", gap: "12px", height: "73px", alignItems: "flex-start" }}>
          <입력칸 라벨="닉네임" 안내="모험가 이름" 안내색="#6f7a8c" 늘림 자동완성="nickname" {...속성("닉네임")} />
          {/* 지역 — 직접 만든 선택 상자(구간/지역고르기.jsx). 브라우저 기본 목록은 껐다 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "9px", flex: "1 0 0", minWidth: 0, alignSelf: "stretch" }}>
            <라벨줄 라벨="지역" 스타일={라벨글자} {...속성("지역")} />
            <지역고르기
              값={값.지역}
              고르기={(곳) => 폼.넣기("지역", 곳)}
              떠나기={폼.속성("지역").떠나기}
              오류={폼.속성("지역").오류}
              맞음={폼.속성("지역").맞음}
              칸스타일={{ ...입력, paddingRight: 0, paddingBottom: "9px" }}
            />
          </div>
        </div>

        <입력칸
          라벨="이메일"
          안내="explorer@escape.kr"
          아래여백={11}
          자동완성="email"
          입력방식="email"
          오타={오타}
          오타고치기={() => 폼.넣기("이메일", 오타.replace(/^혹시 | 인가요\?$/g, ""))}
          {...속성("이메일")}
        />

        {/* 비밀번호 21:1340 — 눈 아이콘과 세기 막대가 붙는다 */}
        <div style={{ position: "relative", height: "65px" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
            <라벨줄 라벨="비밀번호" 스타일={라벨글자} {...속성("비밀번호")} />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: "20px" }}>
            <입력줄 안내="8자 이상" 종류={비번보임 ? "text" : "password"} 비번칸 자동완성="new-password" {...속성("비밀번호")} />
            <눈 보임={비번보임} 누르기={() => set비번보임((v) => !v)} />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: "63px", display: "flex", gap: "4px", justifyContent: "center" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  flex: "1 0 0",
                  height: "2px",
                  borderRadius: "2px",
                  background: i < 세기(값.비밀번호) ? ["#304d91", "#314d8f", "#3b5ea2"][i] : "rgba(255,255,255,0.07)",
                  transition: "background .2s ease",
                }}
              />
            ))}
          </div>
        </div>

        {/* 비밀번호 확인 21:1353 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
          <라벨줄 라벨="비밀번호 확인" 스타일={라벨글자} {...속성("비밀번호확인")} />
          <div style={{ position: "relative" }}>
            <입력줄 안내="비밀번호 재입력" 종류={확인보임 ? "text" : "password"} 비번칸 자동완성="new-password" {...속성("비밀번호확인")} />
            <눈 보임={확인보임} 누르기={() => set확인보임((v) => !v)} />
          </div>
        </div>

        {/* 동의 줄 21:1362 — 원본은 한 줄이었지만 항목을 나눴다(위 주석 참고) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "9px", position: "relative" }}>
          {/* ═══ [전체] 동의 ═══
             맨 윗줄은 「전체」 단추다 — 누르면 아래 필수 항목이 **한꺼번에** 켜지고,
             풀면 한꺼번에 풀린다. 반대로 아래 항목을 하나씩 다 켜면 전체도 저절로 켜진다.
             → 전체의 체크 여부는 따로 저장하지 않고 「아래가 다 켜졌나」로 **계산**한다.
               (따로 저장하면 둘이 어긋날 수 있다 — 하나의 사실은 한 곳에만 둔다) */}
          <동의줄 켜짐={동의} 바꾸기={한꺼번에바꾸기} 이름="이용약관 전체 동의">
            <span style={필수}>[전체]</span>
            <약관링크 탭="이용약관">이용약관</약관링크>
            <span style={흐린글}>에 동의합니다.</span>
          </동의줄>

          {/* 아래 필수 항목은 한 칸 안쪽으로 — 「전체」에 딸린 항목이라는 게 보이게 */}
          <div style={딸린줄}>
            <동의줄 켜짐={동의들.수집} 바꾸기={(v) => 하나바꾸기("수집", v)} 이름="개인정보 수집·이용 동의">
              <span style={필수}>[필수]</span>
              <약관링크 탭="개인정보처리방침">개인정보 수집·이용</약관링크>
              <span style={흐린글}>에 동의합니다.</span>
            </동의줄>

            <동의줄 켜짐={동의들.나이} 바꾸기={(v) => 하나바꾸기("나이", v)} 이름="만 14세 이상 확인">
              <span style={필수}>[필수]</span>
              <span style={흐린글}>만 14세 이상입니다.</span>
            </동의줄>
          </div>

          {동의오류 && <span className="오류글" style={{ left: "26px", top: "100%" }}>{동의오류}</span>}
        </div>

        {/* 꿀단지 칸 — 화면 밖. 사람은 못 보고, 폼을 통째로 채우는 봇만 채운다 */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={꿀단지}
          onChange={(e) => set꿀단지(e.target.value)}
          style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", opacity: 0 }} />

        {경고 && (
          <div role="alert" style={{ fontFamily: 글꼴.모노, fontSize: "15px", lineHeight: 1.5, color: "#f87171" }}>
            {경고}
          </div>
        )}

        {/* 큰 단추 21:1371 */}
        <div style={{ paddingTop: "6px" }}>
          <div
            className="단추"
            role="button"
            tabIndex={0}
            aria-busy={하는중}
            style={{ ...큰단추, cursor: 하는중 ? "progress" : "pointer", ...(하는중 ? { opacity: 0.65 } : {}) }}
            onClick={보내기}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); 보내기(); } }}
          >
            {/* 위쪽에 얹히는 흰 광택 (원본의 ::before) */}
            <div style={광택} />
            <span style={{ position: "relative", ...큰단추글자 }}>{하는중 ? "가입하는 중…" : 됐나 ? "가입 완료 ✓" : "모험 시작하기"}</span>
          </div>
        </div>

        {/* 구분선 21:1376 */}
        <div style={{ padding: "4px 0" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={가는선} />
            <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#8b93a3", letterSpacing: "0.9px", whiteSpace: "nowrap" }}>
              간편 가입
            </span>
            <div style={가는선} />
          </div>
        </div>

        {/* 소셜 + 로그인 안내 21:1381 */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "center" }}>
          {/* 깃허브 대신 네이버 — 로그인 카드와 같은 짝이다 */}
          <button type="button" className="단추" style={{ ...소셜, background: "#ffffff" }} onClick={() => set소셜말(소셜로가기("구글"))} title="Google 로 가입">
            <img loading="lazy" decoding="async" src={에셋.imgComponent1} alt="Google" style={{ width: "17px", height: "17px", display: "block" }} />
          </button>
          <button type="button" className="단추" style={{ ...소셜, background: "#03c75a", borderColor: "#03c75a" }} onClick={() => set소셜말(소셜로가기("네이버"))} title="네이버로 가입">
            <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 800, fontSize: "18px", lineHeight: 1, color: "#fff", letterSpacing: "-0.5px" }}>N</span>
          </button>
          <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#8b93a3", letterSpacing: "0.6px", whiteSpace: "nowrap" }}>
            이미 모험가이신가요?&nbsp;
          </span>
          {/* 로그인 페이지로 */}
          <button type="button" className="링크" onClick={() => 누름("로그인")}
            style={{ padding: 0, border: 0, background: "none", fontFamily: 글꼴.모노, fontSize: "16px", color: "#6f86bf", letterSpacing: "0.6px", whiteSpace: "nowrap", cursor: "pointer" }}>
            로그인
          </button>
        </div>
        {소셜말 && (
          <div style={{ fontFamily: 글꼴.모노, fontSize: "15px", color: "#96a3b6", textAlign: "center" }}>{소셜말}</div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   환영 판 — 로그인한 뒤 가입폼 자리에 뜨는 판

   [구성] 위에서 아래로
     ① 작은 머리글  WELCOME BACK · 접속 중(초록 점)
     ② 환영합니다, / {닉네임} 님   — 닉네임과 「님」은 **같은 글꼴·같은 크기**, 님만 옅게
     ③ 한 줄 소개 (다음에 할 일을 알려 준다)
     ④ 정보 카드 — 나의 지역 · 첫 번째 사건 · 합류한 날 (실제 계정 값)
     ⑤ 큰 단추 「모험 시작하기」 → 게임(이동표.js 게임시작)
     ⑥ 마이페이지 · 로그아웃 링크

   [사락 연출] 판이 뜨면 ①→⑥ 이 0.16초 간격으로 차례로 떠오른다
   (index.css 의 .사락판 / .사락-1~3 — 마무리 구간과 같은 결).
   켜짐을 **한 프레임 뒤에** 붙여야 처음 상태(투명)가 한 번 그려지고 전환이 일어난다.
   ═══════════════════════════════════════════════════════ */
function 환영판({ 사람, 누름 }) {
  const [켜짐, set켜짐] = useState(false);
  useEffect(() => {
    const 틀 = requestAnimationFrame(() => set켜짐(true));
    return () => cancelAnimationFrame(틀);
  }, []);

  /* 가입때(밀리초) → 2026.09.30 */
  const 합류 = 사람.가입때
    ? new Date(사람.가입때).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\s/g, "").replace(/\.$/, "")
    : "—";

  return (
    <div style={{ ...바깥, display: "flex", flexDirection: "column", justifyContent: "center", gap: "24px" }} className={`사락판${켜짐 ? " 켜짐" : ""}`} data-node-id="21:1309">
      {/* ① 머리글 */}
      {/* ★ 영문(WELCOME BACK)만 모노+자간, 한글(접속 중)은 본문 글꼴·자간 0.
          모노 글꼴의 넓은 자간이 한글에 걸리면 「접 속 중」처럼 글자가 흩어져 보였다. */}
      <div className="사락" style={환영머리}>
        <span style={접속점} aria-hidden="true" />
        <span style={{ fontFamily: 글꼴.모노, letterSpacing: "2px" }}>WELCOME BACK</span>
        <span style={머리가름} aria-hidden="true" />
        <span style={{ fontFamily: 글꼴.본문, letterSpacing: 0, color: "#8fa0c4" }}>접속 중</span>
        {사람.테스트 && <span style={테스트딱지}>테스트 계정</span>}
      </div>

      {/* ② 인사 */}
      {/* ★ 인사 두 줄을 **한 글꼴(본문)** 로 — 전엔 「환영합니다,」(Paperlogy) · 닉네임(Plex) 이 서로 다른 글꼴이라
          따로 노는 두 덩이로 보였다. 윗줄은 작고 밝게(도입), 아랫줄 닉네임이 주인공 */}
      <div className="사락 사락-1" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={환영인사}>환영합니다,</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", minWidth: 0 }}>
          <span style={환영이름} title={사람.이름}>{사람.이름}</span>
          <span style={환영님}>님</span>
        </div>
      </div>

      {/* ③ 한 줄 소개 */}
      {/* 글자를 키우니(21px) 한 줄이 판 폭(560)을 넘어 어중간한 곳에서 꺾였다 →
          뜻이 끊기는 자리에서 직접 줄을 나누고(br), 줄 안에서는 꺾이지 않게(nowrap) */}
      <p className="사락 사락-1" style={{ ...환영글, whiteSpace: "nowrap" }}>
        전설 속에 봉인된 첫 번째 사건이 조사관님을
        <br />
        기다리고 있습니다. 지역의 단서를 모아 봉인을 풀고,
        <br />
        잊혀진 이야기를 되찾아 주세요.
      </p>

      {/* ④ 정보 카드 — 세 칸을 세로 줄로 나눈다 */}
      <div className="사락 사락-2" style={정보카드}>
        {[
          ["나의 지역", 사람.지역 || "미정"],
          ["첫 번째 사건", "나주 · 앙암바위"],
          ["합류한 날", 합류],
        ].map(([라벨, 값], i) => (
          <div key={라벨} style={{ ...정보칸, ...(i ? { borderLeft: "1px solid rgba(50,82,150,0.22)" } : {}) }}>
            <span style={정보라벨}>{라벨}</span>
            <span style={정보값}>{값}</span>
          </div>
        ))}
      </div>

      {/* ⑤ 큰 단추 — 가입폼의 큰 단추와 같은 모양 */}
      <div className="사락 사락-3">
        {/* 흐름단추 — 누르거나 올리면 밝은 빛줄기가 빠르게 훑고 지나간다(index.css .흐름단추) */}
        <div
          className="단추 흐름단추"
          role="button"
          tabIndex={0}
          style={{ ...큰단추, cursor: "pointer" }}
          onClick={() => 누름("모험 시작하기")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); 누름("모험 시작하기"); } }}
        >
          <div style={광택} />
          <span className="단추글" style={{ position: "relative", ...큰단추글자 }}>모험 시작하기</span>
        </div>

        {/* ⑥ 링크 */}
        {/* ★ 모노 → 본문 글꼴: 모노는 한글 띄어쓰기가 한 칸씩 넓어 「기록  보기」처럼 벌어져 보였다 */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "14px", marginTop: "20px", fontFamily: 글꼴.본문, fontSize: "15px", color: "#6f7a8c" }}>
          <button type="button" className="링크" style={글링크} onClick={() => 누름("마이페이지")}>마이페이지에서 기록 보기 →</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="링크" style={{ ...글링크, color: "#8b93a3" }} onClick={나가기}>로그아웃</button>
        </div>
      </div>
    </div>
  );
}

const 환영머리 = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "14px",
  color: "#6f86bf",
};
/* WELCOME BACK │ 접속 중 — 가운데 점 대신 가는 세로선으로 나눈다(모노 · 가 한 칸을 크게 먹었다) */
const 머리가름 = { width: "1px", height: "12px", background: "rgba(111,134,191,0.45)" };
/* 접속 중 표시 — 초록 점 + 은은한 번짐 */
const 접속점 = { width: "8px", height: "8px", borderRadius: "50%", background: "#34d399", boxShadow: "0 0 10px rgba(52,211,153,0.7)" };
const 테스트딱지 = {
  marginLeft: "4px",
  padding: "3px 8px",
  borderRadius: "6px",
  border: "1px solid rgba(251,191,36,0.45)",
  color: "#fbbf24",
  fontSize: "12px",
  letterSpacing: "0.4px",
};
const 환영인사 = { fontFamily: 글꼴.본문, fontWeight: 500, fontSize: "30px", lineHeight: 1.3, color: "#c9d2ee", letterSpacing: "-0.3px" };
/* 닉네임 — 히어로 THE LEGEND 와 같은 남색 결의 그라디언트 글자 */
/* ★ 닉네임·님 은 본문 글꼴(IBM Plex Sans KR) 하나로 — 「넓게」(Bebas Neue)는 영문 전용이라
     영문 닉네임은 Bebas, 「님」은 한글 대체 글꼴로 따로 그려져 키·굵기가 달라 보인다(헤더 알약과 같은 문제). */
const 환영이름 = {
  fontFamily: 글꼴.본문,
  fontWeight: 700,
  fontSize: "64px",
  lineHeight: 1.05,
  letterSpacing: "-0.5px",
  backgroundImage: "linear-gradient(115deg, #f1f1fc 0%, #c9d2ee 35%, #7f95cf 70%, #4f6cb0 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};
/* 님 — 닉네임과 같은 글꼴·같은 크기, 색만 옅게 (크기가 다르면 따로 노는 두 글자로 보인다) */
/* 님 — 닉네임의 0.8배(64 → 51). 한글은 같은 px 에서도 영문 대문자보다 글자 몸이 커서
   같은 크기로 두면 「님」이 더 커 보였다. 0.8배면 두 글자의 윗선이 거의 맞는다. 색만 옅게. */
const 환영님 = { fontFamily: 글꼴.본문, fontWeight: 600, fontSize: "44px", lineHeight: 1.05, color: "#8fa0c4", flexShrink: 0 };
/* 본문 — 19px · 행간 1.75. 3줄로 끊어(뜻 단위) 긴 줄이 판 폭(560)에서 어중간하게 꺾이지 않게 한다 */
const 환영글 = { margin: 0, fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "19px", lineHeight: 1.75, color: "#aab4c6", letterSpacing: "-0.2px" };
const 정보카드 = {
  display: "flex",
  borderRadius: "14px",
  border: "1px solid #1a305f",
  background: "rgba(5,11,26,0.72)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};
const 정보칸 = { flex: "1 0 0", display: "flex", flexDirection: "column", gap: "6px", padding: "16px 20px", minWidth: 0 };
/* 라벨도 본문 글꼴로 — 모노 자간이 한글에 걸려 「나 의  지 역」처럼 흩어졌다 */
const 정보라벨 = { fontFamily: 글꼴.본문, fontWeight: 500, fontSize: "13px", color: "#7b879b" };
const 정보값 = { fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "19px", lineHeight: 1.3, color: "#f1f1fc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const 글링크 = { padding: 0, border: 0, background: "none", font: "inherit", color: "#9fb2ea", cursor: "pointer" };

/* ═══════════════════════════════════════════════════════
   라벨줄 — 「라벨 ········ 오류 한 줄」

   [왜 칸 아래가 아니라 라벨 옆인가]
   칸 아래(top: 100%)에 띄우면 칸 사이 틈(14px)이 좁아서 **다음 칸의 라벨을 덮었다.**
   그렇다고 흐름 안에 넣으면 오류가 뜰 때마다 아래 칸들이 밀려 화면이 출렁인다.
   라벨 줄의 오른쪽은 원래 비어 있는 자리라, 여기에 두면 겹치지도 밀리지도 않는다.
   · 오류가 있으면 빨간 글(.칸오류) — role="alert" 라 스크린리더가 바로 읽어 준다
   · 오류가 없고 이메일 오타가 의심되면 「혹시 … 인가요? 고치기」(.오타제안)
   ═══════════════════════════════════════════════════════ */
function 라벨줄({ 라벨, 스타일, 이름, 오류, 오타, 오타고치기 }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", width: "100%", minWidth: 0 }}>
      <div style={{ ...스타일, width: "auto", flexShrink: 0 }}>{라벨}</div>
      {오류 ? (
        <span id={`오류-${이름}`} className="칸오류" role="alert" title={오류}>{오류}</span>
      ) : 오타 ? (
        <button type="button" className="오타제안" onMouseDown={(e) => e.preventDefault()} onClick={오타고치기} style={{ fontFamily: 글꼴.모노 }}>
          {오타} <u>고치기</u>
        </button>
      ) : null}
    </div>
  );
}

function 입력칸({ 라벨, 늘림, ...나머지 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", ...(늘림 ? { flex: "1 0 0", minWidth: 0, alignSelf: "stretch" } : {}) }}>
      <라벨줄 라벨={라벨} 스타일={라벨글자} {...나머지} />
      <입력줄 {...나머지} />
    </div>
  );
}

/* 칸 하나 — 상태별 모양은 인증폼의 입력줄과 같다(오류 빨강 · 맞음 초록 ✓ · 확인 중 · 한글 · Caps Lock).
   눈 단추가 칸 바깥(오른쪽 0)에 붙어 있어서, 비밀번호 칸(비번칸)은 오른쪽 안내를 그만큼 비켜 둔다. */
function 입력줄({ 이름, 안내, 안내색 = "#6f7a8c", 아래여백 = 9, 종류 = "text", 비번칸, 값, 바꾸기, 떠나기, 오류, 맞음, 확인중, 최대, 엔터, 자동완성, 입력방식, 목록, 오타, 오타고치기 }) {
  const [들어옴, set들어옴] = useState(false);
  const 대문자 = use대문자잠금();
  const 한글경고 = 영문칸.has(이름) && 한글있나(값);
  const 오류아이디 = `오류-${이름}`; // 라벨줄의 오류 글 id 와 같다
  const 오른쪽말 = 한글경고 ? { 글: 영문만안내, 종류: "" } : 비번칸 && 대문자.켜짐 && 들어옴 ? { 글: "Caps Lock 켜짐", 종류: "주의" } : 확인중 ? { 글: "확인 중…", 종류: "확인중" } : null;
  const 상태 = 오류 || 한글경고 ? "오류칸" : 맞음 ? "맞음칸" : "";
  const 오른쪽 = 비번칸 ? "28px" : "0";
  return (
    <div className={`밑줄칸 ${상태}`} style={{ ...입력, paddingBottom: `${아래여백}px`, position: "relative" }}>
      <input
        className="입력칸"
        type={종류}
        name={이름}
        placeholder={안내}
        value={값 ?? ""}
        maxLength={최대}
        onChange={바꾸기}
        onFocus={() => set들어옴(true)}
        onBlur={() => { set들어옴(false); 대문자.끄기(); 떠나기?.(); }}
        onKeyDown={(e) => { 대문자.살피기(e); 엔터?.(e); }}
        onKeyUp={대문자.살피기}
        autoComplete={자동완성}
        inputMode={입력방식}
        list={목록}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={Boolean(오류 || 한글경고)}
        aria-describedby={오류 ? 오류아이디 : undefined}
        style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", "--안내색": 안내색 }}
      />
      {오른쪽말 && <span className={`칸안내 ${오른쪽말.종류}`} style={{ right: 오른쪽 }}>{오른쪽말.글}</span>}
      {!오른쪽말 && 맞음 && <span className="맞음표" aria-hidden="true" style={{ right: 비번칸 ? "30px" : "6px" }}>✓</span>}
      {/* 오류 글·오타 제안은 라벨줄 오른쪽에 뜬다 */}
    </div>
  );
}

/* 비밀번호 보기/숨기기 — 인증 카드와 같은 방식.
   감은 상태는 눈 위에 사선 한 줄. */
function 눈({ 보임, 누르기 }) {
  return (
    <button type="button" onClick={누르기} title={보임 ? "비밀번호 숨기기" : "비밀번호 보기"} style={눈단추}>
      <img loading="lazy" decoding="async" src={에셋.imgEyeIcon} alt="" style={{ width: "18px", height: "18px", display: "block", filter: 보임 ? "brightness(1.9)" : "brightness(1.35)" }} />
      {!보임 && <span style={사선} />}
    </button>
  );
}

/* 왼쪽 소개 덩이와 같은 중심선에 맞춘다 (공통.js 의 소개폼중심) */
const 바깥 = { ...중심놓기(가입폼왼쪽, 소개폼중심, 가입폼폭), height: "660px" };

const 제목 = {
  fontFamily: 글꼴.넓게,
  fontWeight: 700,
  fontSize: "36px",
  color: "#f2f1fc",
  letterSpacing: "1.05px",
  whiteSpace: "nowrap",
};

const 부제 = { fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", color: "#96a3b6", whiteSpace: "nowrap" };

const 라벨글자 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  fontSize: "16px",
  color: "#96a3b6",
  letterSpacing: "0.4px", /* 한글 라벨 — 1.19px 는 글자가 흩어져 보였다 */
  textTransform: "uppercase",
};

const 입력 = {
  borderBottom: "1px solid rgba(50,82,150,0.18)",
  paddingTop: "10px",
  paddingRight: "32px",
  display: "flex",
  alignItems: "flex-start",
  /* ★ hidden → visible. 칸 **아래로** 띄우는 오류 한 줄·오타 제안이 이 칸 밖(top: 100%)에
     그려지는데, hidden 이면 잘려서 **빨간 글씨가 아예 안 보였다.** 긴 글은 input 이 알아서 넘긴다. */
  overflow: "visible",
};

/* 「전체」 아래 딸린 항목 — 체크 네모(16) + 사이(10) 만큼 들여 글 시작선을 맞춘다 */
const 딸린줄 = { display: "flex", flexDirection: "column", gap: "9px", paddingLeft: "26px" };

/* ═══ 약관 링크 ═══
   메인 페이지에서 약관 페이지로 **옮겨 가면** 적던 가입 내용이 날아간다.
   그래서 새 탭으로 연다(noopener — 새 탭이 이 페이지를 조종하지 못하게 끊는다).
   동의 줄이 <label> 이라 누름이 체크로 번지지 않게 막는다(인증폼과 같은 이유). */
function 약관링크({ 탭, children }) {
  return (
    <button
      type="button"
      className="약관링크"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`/약관?탭=${encodeURIComponent(탭)}`, "_blank", "noopener");
      }}
      title={`${탭} 새 탭에서 보기`}
    >
      {children}
    </button>
  );
}

/* ═══ 동의 한 줄 ═══
   [왜 진짜 <input> 인가]
   원본은 div 에 onClick 이라 **탭으로 갈 수도, 스페이스로 켤 수도 없었다.**
   보이는 네모는 그대로 두되(원본 모양), 실제 체크박스를 그 위에 투명하게
   겹쳐 둔다. 그러면 키보드·스크린리더는 표준 체크박스로 다루고
   눈에는 원본 디자인이 보인다. */
function 동의줄({ 켜짐, 바꾸기, 이름, children }) {
  return (
    <label style={{ display: "flex", gap: "10px", alignItems: "center", position: "relative", cursor: "pointer" }}>
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={켜짐}
          onChange={(e) => 바꾸기(e.target.checked)}
          aria-label={이름}
          style={숨은체크}
        />
        <span
          aria-hidden="true"
          /* 그림일 뿐이라 클릭을 받지 않는다 — 받으면 밑의 진짜 체크박스를
             가로막는다. 클릭은 바깥 <label> 이 받아서 처리한다. */
          style={{ ...체크상자, pointerEvents: "none", ...(켜짐 ? {} : { backgroundImage: "none", background: "transparent", borderColor: "rgba(59,94,162,0.45)" }) }}
        >
          {켜짐 && <span style={체크표시} />}
        </span>
      </span>
      <span style={{ display: "flex", gap: "5px", alignItems: "flex-end", paddingBottom: "1px", fontFamily: 글꼴.모노, fontSize: "16px", whiteSpace: "nowrap" }}>
        {children}
      </span>
    </label>
  );
}

/* 눈에는 안 보이지만 키보드와 스크린리더에는 있는 체크박스.
   display:none 으로 숨기면 아예 초점을 못 받으므로 투명하게만 덮는다. */
const 숨은체크 = {
  position: "absolute",
  inset: 0,
  width: "16px",
  height: "16px",
  margin: 0,
  opacity: 0,
  cursor: "pointer",
};

const 필수 = { color: "#6f86bf", fontWeight: 700, letterSpacing: "0.4px" };
const 흐린글 = { color: "#8b93a3", letterSpacing: "0.4px" };

const 체크상자 = {
  width: "16px",
  height: "16px",
  borderRadius: "4px",
  border: "1px solid rgba(59,94,162,0.6)",
  backgroundImage: "linear-gradient(135deg, rgb(46,72,137) 0%, rgb(54,64,143) 100%)",
  filter: "drop-shadow(0px 0px 5px rgba(43,71,143,0.4))",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  flexShrink: 0,
};

/* 체크 표시 — 원본도 네모를 45도 돌려 두 변만 남긴 모양이다 */
const 체크표시 = {
  width: "4px",
  height: "8px",
  borderRight: "2px solid #ffffff",
  borderBottom: "2px solid #ffffff",
  transform: "rotate(45deg)",
  marginTop: "-2px",
};

const 큰단추 = {
  position: "relative",
  width: "100%",
  padding: "15px 24px",
  borderRadius: "100px",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  backgroundImage:
    "linear-gradient(143.483deg, rgba(43,71,143,0.95) 0%, rgba(54,64,143,0.92) 45%, rgba(43,71,143,0.88) 100%)",
  boxShadow:
    "0px 0px 0px 1px rgba(59,94,162,0.4), 0px 0px 14px 4px rgba(50,82,150,0.4), 0px 0px 36px 12px rgba(54,64,143,0.2), 0px 4px 20px 0px rgba(48,66,131,0.38)",
};

const 광택 = {
  position: "absolute",
  inset: 0,
  borderRadius: "100px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 55%)",
};

const 큰단추글자 = {
  fontFamily: 글꼴.넓게,
  fontWeight: 400,
  fontSize: "18px",
  color: "#ffffff",
  letterSpacing: "1.575px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const 가는선 = { flex: "1 0 0", height: "1px", background: "rgba(255,255,255,0.07)" };

const 소셜 = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  background: "rgba(46,72,137,0.08)", /* 보라 → 남색 */
  border: "1px solid rgba(79,108,176,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 눈단추 = {
  position: "absolute",
  right: 0,
  top: "50%",
  transform: "translateY(-50%)",
  width: "24px",
  height: "24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "pointer",
};

const 사선 = {
  position: "absolute",
  left: "2px",
  right: "2px",
  top: "50%",
  height: "1.5px",
  borderRadius: "1px",
  background: "rgba(241,241,252,0.8)",
  transform: "rotate(-45deg)",
};
