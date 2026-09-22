import 에셋 from "../에셋.js";
import { useState } from "react";
import { 글꼴, 막음, 막음안내 } from "../공통.js";
import { 모두검사, 통과했나, 세기 } from "../유효성.js";

/* ═══════════════════════════════════════════════════════
   인증 카드 — 피그마에서 **모드 5개짜리 컴포넌트 하나**다.

     로그인               98:1160  (593 × 800)
     회원가입             98:1159  (593 × 800)
     비밀번호 찾기         100:1193 (593 × 760)
     비밀번호 재설정(인증 중)  101:1247 (593 × 495)
     비밀번호 재설정(인증 완료) 101:1273 (593 × 668)

   원본이 한 컴포넌트이므로 여기서도 한 파일로 둔다. 모드별로 파일을 쪼개면
   바탕·단추·하단 링크가 네 벌로 복사돼 한쪽만 고치는 사고가 난다.

   입력은 **겉모습만**이다(피그마에 있는 그대로). 실제 form 으로 바꿀 때
   안내 글자를 placeholder 로 옮기면 된다.
   ═══════════════════════════════════════════════════════ */

/* 「다음」 은 제출이 통과했을 때 갈 **주소**다.
   단추 글자를 그대로 이동표에서 찾으면 안 된다 — 로그인 화면의 제출 단추와
   하단 링크가 둘 다 「로그인」 이라, 글자로 찾으면 제 페이지로 되돌아온다.
   (실제로 그 버그가 났다.) 그래서 주소를 여기 직접 적는다. */
const 모드표 = {
  로그인: { 높이: 800, 아래여백: 28, 제목: "로그인", 부제: "계정에 로그인하고 탐험을 계속하세요.", 단추: "로그인", 다음: "/" },
  회원가입: { 높이: 800, 아래여백: 32, 제목: "회원가입", 부제: "계정을 만들고 전국의 방탈출 미션에 도전하세요.", 단추: "회원가입 완료", 다음: "/", 그림자밖: true },
  비밀번호찾기: { 높이: 760, 아래여백: 28, 제목: "비밀번호 찾기", 부제: "가입한 이메일을 입력하면 재설정 링크를 보내드립니다.", 단추: "재설정 링크 보내기", 다음: "/비밀번호-재설정" },
  인증중: { 높이: 495, 아래여백: 28, 제목: "비밀번호 재설정", 부제: "가입한 이메일을 입력하고 인증코드를 확인해주세요.", 단추: "인증 완료", 다음: "/비밀번호-재설정/완료" },
  인증완료: { 높이: null, 아래여백: 28, 제목: "비밀번호 재설정", 부제: "인증이 완료되었습니다. 새 비밀번호를 설정해주세요.", 단추: "비밀번호 변경 완료", 다음: "/로그인" },
};

/* 모드마다 검사할 칸이 다르다 */
const 검사할칸 = {
  로그인: ["이메일", "비밀번호"],
  회원가입: ["닉네임", "지역", "이메일", "비밀번호", "비밀번호확인"],
  비밀번호찾기: ["이메일"],
  인증중: ["이메일", "인증코드"],
  인증완료: ["새비밀번호", "비밀번호확인"],
};

export default function 인증폼({ 모드 = "로그인", 이동 = () => {}, 가기 = () => {} }) {
  const ㅁ = 모드표[모드];
  const [값, set값] = useState({});
  const [오류, set오류] = useState({});
  const [동의, set동의] = useState(true); // 원본은 체크된 상태로 그려져 있다
  const [눌렀나, set눌렀나] = useState(false);

  const 적기 = (이름) => (e) => {
    const 새값 = { ...값, [이름]: e.target.value };
    set값(새값);
    if (눌렀나) set오류(모두검사(검사할칸[모드], 새값)); // 한 번 혼난 뒤에는 고치는 즉시 풀어 준다
  };

  const 보내기 = () => {
    set눌렀나(true);
    const 새오류 = 모두검사(검사할칸[모드], 값);
    if (모드 === "회원가입" && !동의) 새오류.동의 = "약관에 동의해주세요.";
    set오류(새오류);
    if (통과했나(새오류)) 가기(ㅁ.다음);
  };

  const 칸속성 = (이름) => ({ 이름, 값: 값[이름] ?? "", 바꾸기: 적기(이름), 오류: 오류[이름] });
  /* 굵기가 링크마다 다르다 — 원본에 그렇게 돼 있다.
     회원가입 화면의 「로그인」만 Regular 이고 나머지는 Bold. */
  const 링크 = (글, 굵게 = true) => (
    <span
      className="링크"
      style={{ ...강조링크, fontWeight: 굵게 ? 700 : 400, cursor: "pointer" }}
      onClick={() => 이동(글)}
    >
      {글}
    </span>
  );

  return (
    <div
      style={{
        ...카드,
        paddingBottom: `${ㅁ.아래여백}px`,
        /* [왜 height 가 아니라 minHeight 인가]
           원본은 모드마다 칸 사이 간격이 조금씩 다른데, 나는 간격을 하나로
           맞춰 놨다. 그 상태에서 높이를 못 박으면 내용이 카드 밖으로
           **잘려 나간다**(회원가입에서 하단 링크가 잘렸다).
           최소 높이로 두면 원본 크기를 지키면서 넘칠 때만 늘어난다. */
        ...(ㅁ.높이 ? { minHeight: `${ㅁ.높이}px` } : {}),
        // 회원가입만 그림자가 카드 **밖으로** 나간다(drop-shadow). 나머지는 box-shadow.
        ...(ㅁ.그림자밖
          ? { filter: "drop-shadow(0px 8px 16px rgba(29,78,216,0.13))" }
          : { overflow: "hidden", boxShadow: "0px 8px 32px 0px rgba(29,78,216,0.13)" }),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingBottom: "16px", width: "100%" }}>
        <div style={제목글}>{ㅁ.제목}</div>
        <div style={부제글}>{ㅁ.부제}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
        {모드 === "회원가입" && (
          <div style={{ display: "flex", gap: "12px", width: "100%" }}>
            <입력칸 라벨="닉네임" 안내="모험가 이름" 늘림 {...칸속성("닉네임")} />
            <입력칸 라벨="지역" 안내="본인 지역 선택" 늘림 {...칸속성("지역")} />
          </div>
        )}

        {/* 이메일 — 인증 완료 화면에서는 이미 지나간 단계라 흐리게 */}
        <입력칸
          라벨="이메일"
          안내="explorer@escape.kr"
          흐림={모드 === "인증완료"}
          안내색={모드 === "인증완료" ? "rgba(200,205,255,0.4)" : undefined}
          {...칸속성("이메일")}
        />

        {모드 === "로그인" && <입력칸 라벨="비밀번호" 안내="비밀번호 입력" 종류="password" {...칸속성("비밀번호")} />}

        {모드 === "회원가입" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
              <div style={라벨글}>비밀번호</div>
              <입력줄 안내="8자 이상" 종류="password" {...칸속성("비밀번호")} />
              {/* 막대 세 칸이 실제 비밀번호 세기를 보여 준다 (원본은 2칸이 켜진 그림) */}
              <div style={{ display: "flex", gap: "4px", width: "100%" }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      flex: "1 0 0",
                      height: "2px",
                      borderRadius: "2px",
                      background: i < 세기(값.비밀번호) ? ["#5293f8", "#4f91f7", "#93c5fd"][i] : "rgba(255,255,255,0.07)",
                      transition: "background .2s ease",
                    }}
                  />
                ))}
              </div>
            </div>
            <입력칸 라벨="비밀번호 확인" 안내="비밀번호 재입력" 종류="password" {...칸속성("비밀번호확인")} />
          </>
        )}

        {모드 === "인증중" && <인증코드빈칸 {...칸속성("인증코드")} />}

        {모드 === "인증완료" && (
          <>
            <인증코드완료 />
            <입력칸 라벨="새 비밀번호" 안내="8자 이상" 종류="password" {...칸속성("새비밀번호")} />
            <입력칸 라벨="새 비밀번호 확인" 안내="비밀번호 재입력" 종류="password" {...칸속성("비밀번호확인")} />
          </>
        )}
      </div>

      {모드 === "회원가입" && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center", width: "100%", position: "relative" }}>
          <div
            style={{ ...체크상자, ...(동의 ? {} : 안동의한상자), cursor: "pointer" }}
            onClick={() => {
              const 새 = !동의;
              set동의(새);
              if (눌렀나) set오류((o) => ({ ...o, 동의: 새 ? "" : "약관에 동의해주세요." }));
            }}
          >
            {동의 && <div style={체크표시} />}
          </div>
          {오류.동의 && <span className="오류글" style={{ left: "26px" }}>{오류.동의}</span>}
          <div style={{ display: "flex", alignItems: "flex-end", fontFamily: 글꼴.모노, fontSize: "16px", whiteSpace: "nowrap" }}>
            <span style={{ color: "#93c5fd", opacity: 0.7 }}>이용약관</span>
            <span style={{ color: "rgba(200,205,255,0.45)" }}>&nbsp;및&nbsp;</span>
            <span style={{ color: "#93c5fd", opacity: 0.7 }}>개인정보처리방침</span>
            <span style={{ color: "rgba(200,205,255,0.45)" }}>에 동의합니다.</span>
          </div>
        </div>
      )}

      <div style={{ paddingTop: "24px", width: "100%" }}>
        <div className="단추" style={큰단추} onClick={보내기}>
          <div style={광택} />
          <span style={{ position: "relative", ...큰단추글 }}>{ㅁ.단추}</span>
        </div>
      </div>

      {(모드 === "로그인" || 모드 === "회원가입") && (
        <>
          <div style={{ padding: "12px 0 4px", width: "100%" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", width: "100%" }}>
              <div style={가는선} />
              <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "rgba(200,205,255,0.3)", whiteSpace: "nowrap" }}>
                {모드 === "로그인" ? "간편 로그인" : "간편 가입"}
              </span>
              <div style={가는선} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "center", width: "100%" }}>
            {[에셋.imgComponent12, 에셋.imgComponent22].map((그림, i) => (
              <div key={i} style={{ ...소셜, ...막음 }} title={막음안내}>
                <img src={그림} alt="" style={{ width: "16px", height: "16px", display: "block" }} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* 하단 안내 — 여기가 화면끼리 이어지는 자리다 */}
      <div style={하단}>
        {모드 === "로그인" && (
          <>
            <span style={흐린글}>아직 모험가가 아닌가요?</span>
            {링크("회원가입")}
            <span style={흐린글}>&nbsp;·&nbsp;</span>
            {링크("비밀번호 찾기")}
          </>
        )}
        {모드 === "회원가입" && (
          <>
            <span style={흐린글}>이미 모험가이신가요?</span>
            {링크("로그인", false)}
            <span style={흐린글}>&nbsp;·&nbsp;</span>
            {링크("비밀번호 찾기")}
          </>
        )}
        {(모드 === "비밀번호찾기" || 모드 === "인증중" || 모드 === "인증완료") && (
          <>
            <span style={흐린글}>로그인으로 돌아가기</span>
            {링크("로그인")}
          </>
        )}
      </div>
    </div>
  );
}

function 입력칸({ 라벨, 안내, 늘림, 흐림, 안내색, 종류, 값, 바꾸기, 오류 }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "9px",
        width: "100%",
        ...(늘림 ? { flex: "1 0 0", minWidth: 0 } : {}),
        ...(흐림 ? { opacity: 0.5 } : {}),
      }}
    >
      <div style={라벨글}>{라벨}</div>
      <입력줄 안내={안내} 안내색={안내색} 종류={종류} 값={값} 바꾸기={바꾸기} 오류={오류} />
    </div>
  );
}

function 입력줄({ 안내, 안내색 = "rgba(200,205,255,0.2)", 종류 = "text", 값, 바꾸기, 오류 }) {
  return (
    <div style={{ ...입력, position: "relative" }} className={오류 ? "오류칸" : undefined}>
      <input
        className="입력칸"
        type={종류}
        placeholder={안내}
        value={값 ?? ""}
        onChange={바꾸기}
        style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", "--안내색": 안내색 }}
      />
      {오류 && <span className="오류글">{오류}</span>}
    </div>
  );
}

/* 아직 안 넣은 인증코드 — 여섯 칸 모두 가운데 짧은 줄만 있다 (101:1256) */
function 인증코드빈칸({ 값, 바꾸기, 오류 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
      <div style={라벨글}>인증코드</div>
      <div style={{ display: "flex", gap: "8px", width: "100%", position: "relative" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ ...빈코드칸, ...(오류 ? { borderColor: "rgba(248,113,113,0.55)" } : {}) }}>
            {(값 ?? "")[i] ? (
              <span style={{ fontFamily: 글꼴.모노, fontWeight: 600, fontSize: "24px", color: "#c8cdff" }}>{값[i]}</span>
            ) : (
              <div style={{ width: "24px", height: "2px", borderRadius: "1px", background: "rgba(96,165,250,0.3)" }} />
            )}
          </div>
        ))}
        {/* 칸 여섯 개 위에 투명한 입력칸을 덮어 한 번에 받는다 */}
        <input
          className="입력칸"
          inputMode="numeric"
          maxLength={6}
          value={값 ?? ""}
          onChange={(e) => 바꾸기({ target: { value: e.target.value.replace(/\D/g, "").slice(0, 6) } })}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "text" }}
          aria-label="인증코드"
        />
        {오류 && <span className="오류글">{오류}</span>}
      </div>
    </div>
  );
}

/* 인증이 끝난 코드 — 초록 테두리에 숫자가 박혀 있고 전체가 흐리다 (103:1255) */
function 인증코드완료() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%", opacity: 0.6, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: "8px", width: "100%", fontSize: "16px" }}>
        <span style={{ flex: "1 0 0", fontFamily: 글꼴.모노, color: "rgba(181,189,255,0.85)" }}>인증코드</span>
        <span style={{ flex: "1 0 0", fontFamily: 글꼴.모노, fontWeight: 700, color: "#33d98c" }}>✓ 인증완료</span>
      </div>
      <div style={{ display: "flex", gap: "10px", width: "100%" }}>
        {["4", "8", "2", "7", "1", "5"].map((숫자, i) => (
          <div key={i} style={찬코드칸}>
            <span style={{ fontFamily: 글꼴.모노, fontWeight: 600, fontSize: "24px", color: "#c8cdff" }}>{숫자}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const 카드 = {
  width: "593px",
  padding: "48px 24px 0",
  borderRadius: "16px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  alignItems: "flex-start",
  boxSizing: "border-box",
};

const 제목글 = { fontFamily: 글꼴.넓게, fontWeight: 700, fontSize: "36px", color: "#eeeeff", width: "100%" };
const 부제글 = { fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", color: "rgba(181,188,255,0.85)", width: "100%" };
const 라벨글 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  fontSize: "16px",
  color: "rgba(181,188,255,0.85)",
  textTransform: "uppercase",
  width: "100%",
};

const 입력 = {
  borderBottom: "1px solid rgba(96,165,250,0.18)",
  padding: "10px 32px 10px 0",
  display: "flex",
  alignItems: "flex-start",
  overflow: "hidden",
  width: "100%",
  boxSizing: "border-box",
};

const 코드칸바탕 = {
  flex: "1 0 0",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "10px",
  boxSizing: "border-box",
};
const 빈코드칸 = { ...코드칸바탕, height: "64px", background: "#060d1a", border: "1px solid rgba(96,165,250,0.18)" };
const 찬코드칸 = { ...코드칸바탕, padding: "16px 0", background: "#0a1426", border: "1px solid rgba(51,166,115,0.4)" };

const 체크상자 = {
  width: "16px",
  height: "16px",
  borderRadius: "4px",
  border: "1px solid rgba(147,197,253,0.6)",
  backgroundImage: "linear-gradient(135deg, rgb(59,130,246) 0%, rgb(99,102,241) 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  flexShrink: 0,
};
const 안동의한상자 = { backgroundImage: "none", background: "transparent", borderColor: "rgba(147,197,253,0.45)" };

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
  backgroundImage: "linear-gradient(166.833deg, rgb(59,130,246) 0%, rgb(99,102,241) 45%, rgb(56,130,255) 100%)",
  boxShadow: "0px 0px 48px 8px rgba(96,165,250,0.25), 0px 4px 20px 0px rgba(59,130,246,0.45)",
  cursor: "pointer",
};
const 광택 = {
  position: "absolute",
  inset: 0,
  borderRadius: "100px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 55%)",
};
const 큰단추글 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "16px",
  color: "#ffffff",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const 가는선 = { flex: "1 0 0", height: "1px", background: "rgba(255,255,255,0.07)" };

const 소셜 = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  background: "rgba(167,139,250,0.05)",
  border: "1px solid rgba(96,165,250,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 하단 = {
  display: "flex",
  gap: "4px",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  fontSize: "16px",
  whiteSpace: "nowrap",
};
const 흐린글 = { fontFamily: 글꼴.모노, fontWeight: 400, color: "rgba(200,205,255,0.45)" };
const 강조링크 = { fontFamily: 글꼴.모노, color: "#5092f8" };
