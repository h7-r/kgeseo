import { useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 막음, 막음안내, 중심놓기, 소개폼중심 } from "../공통.js";
import { 모두검사, 통과했나, 세기 } from "../유효성.js";

/* div.form-inner — 피그마 21:1309 (560 × 660, 두 번째 화면 오른쪽)
   실제로 입력을 받는 폼이 아니라 **디자인 그대로의 겉모습**이다.
   게임과 붙일 때 input 으로 바꾸면 된다. */

const 검사할칸 = ["닉네임", "지역", "이메일", "비밀번호", "비밀번호확인"];

export default function 가입폼() {
  const [값, set값] = useState({});
  const [오류, set오류] = useState({});
  const [동의, set동의] = useState(true); // 원본은 체크된 상태로 그려져 있다
  const [눌렀나, set눌렀나] = useState(false);
  const [됐나, set됐나] = useState(false);

  const 적기 = (이름) => (e) => {
    const 새값 = { ...값, [이름]: e.target.value };
    set값(새값);
    if (눌렀나) set오류(모두검사(검사할칸, 새값));
  };
  const 보내기 = () => {
    set눌렀나(true);
    const 새오류 = 모두검사(검사할칸, 값);
    if (!동의) 새오류.동의 = "약관에 동의해주세요.";
    set오류(새오류);
    /* 보낼 서버가 없다 — 통과하면 단추 글자로만 알려 준다 */
    set됐나(통과했나(새오류));
  };
  const 속성 = (이름) => ({ 값: 값[이름] ?? "", 바꾸기: 적기(이름), 오류: 오류[이름] });

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
          <입력칸 라벨="닉네임" 안내="모험가 이름" 안내색="rgba(181,188,255,0.5)" 늘림 {...속성("닉네임")} />
          <입력칸 라벨="지역" 안내="본인 지역 선택" 안내색="rgba(181,188,255,0.5)" 늘림 {...속성("지역")} />
        </div>

<입력칸 라벨="이메일" 안내="explorer@escape.kr" 아래여백={11} {...속성("이메일")} />

        {/* 비밀번호 21:1340 — 눈 아이콘과 세기 막대가 붙는다 */}
        <div style={{ position: "relative", height: "65px" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
            <div style={라벨글자}>비밀번호</div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: "20px" }}>
            <입력줄 안내="8자 이상" 종류="password" {...속성("비밀번호")} />
            <눈 />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: "63px", display: "flex", gap: "4px", justifyContent: "center" }}>
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

        {/* 비밀번호 확인 21:1353 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
          <div style={라벨글자}>비밀번호 확인</div>
          <div style={{ position: "relative" }}>
            <입력줄 안내="비밀번호 재입력" 종류="password" {...속성("비밀번호확인")} />
            <눈 />
          </div>
        </div>

        {/* 동의 줄 21:1362 */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", position: "relative" }}>
          <div
            style={{ ...체크상자, ...(동의 ? {} : { backgroundImage: "none", background: "transparent", borderColor: "rgba(147,197,253,0.45)" }), cursor: "pointer" }}
            onClick={() => {
              const 새 = !동의;
              set동의(새);
              if (눌렀나) set오류((o) => ({ ...o, 동의: 새 ? "" : "약관에 동의해주세요." }));
            }}
          >
            {동의 && <div style={체크표시} />}
          </div>
          {오류.동의 && <span className="오류글" style={{ left: "26px" }}>{오류.동의}</span>}
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "1px", fontFamily: 글꼴.모노, fontSize: "16px", whiteSpace: "nowrap" }}>
            <span style={{ color: "#93c5fd", opacity: 0.7, letterSpacing: "0.6px" }}>이용약관</span>
            <span style={{ color: "rgba(200,205,255,0.45)", letterSpacing: "0.44px" }}>&nbsp;및&nbsp;</span>
            <span style={{ color: "#93c5fd", opacity: 0.7, letterSpacing: "0.6px" }}>개인정보처리방침</span>
            <span style={{ color: "rgba(200,205,255,0.45)", letterSpacing: "0.44px" }}>에 동의합니다.</span>
          </div>
        </div>

        {/* 큰 단추 21:1371 */}
        <div style={{ paddingTop: "6px" }}>
          <div className="단추" style={{ ...큰단추, cursor: "pointer" }} onClick={보내기}>
            {/* 위쪽에 얹히는 흰 광택 (원본의 ::before) */}
            <div style={광택} />
            <span style={{ position: "relative", ...큰단추글자 }}>{됐나 ? "가입 완료 ✓" : "모험 시작하기"}</span>
          </div>
        </div>

        {/* 구분선 21:1376 */}
        <div style={{ padding: "4px 0" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={가는선} />
            <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "rgba(200,205,255,0.3)", letterSpacing: "0.9px", whiteSpace: "nowrap" }}>
              간편 가입
            </span>
            <div style={가는선} />
          </div>
        </div>

        {/* 소셜 + 로그인 안내 21:1381 */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "center" }}>
          {[에셋.imgComponent1, 에셋.imgComponent2].map((그림, i) => (
            <div key={i} style={{ ...소셜, ...막음 }} title={막음안내}>
              <img src={그림} alt="" style={{ width: "16px", height: "16px", display: "block" }} />
            </div>
          ))}
          <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "rgba(200,205,255,0.45)", letterSpacing: "0.6px", whiteSpace: "nowrap" }}>
            이미 모험가이신가요?&nbsp;
          </span>
          <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#5092f8", letterSpacing: "0.6px", whiteSpace: "nowrap" }}>로그인</span>
        </div>
      </div>
    </div>
  );
}

function 입력칸({ 라벨, 안내, 안내색, 늘림, 아래여백, 값, 바꾸기, 오류 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", ...(늘림 ? { flex: "1 0 0", minWidth: 0, alignSelf: "stretch" } : {}) }}>
      <div style={라벨글자}>{라벨}</div>
      <입력줄 안내={안내} 안내색={안내색} 아래여백={아래여백} 값={값} 바꾸기={바꾸기} 오류={오류} />
    </div>
  );
}

function 입력줄({ 안내, 안내색 = "rgba(200,205,255,0.2)", 아래여백 = 9, 종류 = "text", 값, 바꾸기, 오류 }) {
  return (
    <div className={오류 ? "오류칸" : undefined} style={{ ...입력, paddingBottom: `${아래여백}px`, position: "relative" }}>
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

function 눈() {
  return (
    <div style={{ position: "absolute", right: 0, top: "27.63%", bottom: "29.13%", display: "flex", alignItems: "center" }}>
      <img src={에셋.imgVariant7} alt="" style={{ width: "16px", height: "16px", display: "block" }} />
    </div>
  );
}

/* 왼쪽 소개 덩이와 같은 중심선에 맞춘다 (공통.js 의 소개폼중심) */
const 바깥 = { ...중심놓기(1175, 소개폼중심, 560), height: "660px" };

const 제목 = {
  fontFamily: 글꼴.넓게,
  fontWeight: 700,
  fontSize: "36px",
  color: "#f0eeff",
  letterSpacing: "1.05px",
  whiteSpace: "nowrap",
};

const 부제 = { fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", color: "rgba(181,188,255,0.85)", whiteSpace: "nowrap" };

const 라벨글자 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  fontSize: "16px",
  color: "rgba(181,188,255,0.85)",
  letterSpacing: "1.19px",
  textTransform: "uppercase",
};

const 입력 = {
  borderBottom: "1px solid rgba(96,165,250,0.18)",
  paddingTop: "10px",
  paddingRight: "32px",
  display: "flex",
  alignItems: "flex-start",
  overflow: "hidden",
};

const 체크상자 = {
  width: "16px",
  height: "16px",
  borderRadius: "4px",
  border: "1px solid rgba(147,197,253,0.6)",
  backgroundImage: "linear-gradient(135deg, rgb(59,130,246) 0%, rgb(99,102,241) 100%)",
  filter: "drop-shadow(0px 0px 5px rgba(56,130,255,0.4))",
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
    "linear-gradient(143.483deg, rgba(56,130,255,0.95) 0%, rgba(99,102,241,0.92) 45%, rgba(56,130,255,0.88) 100%)",
  boxShadow:
    "0px 0px 0px 1px rgba(147,197,253,0.4), 0px 0px 14px 4px rgba(96,165,250,0.4), 0px 0px 36px 12px rgba(99,102,241,0.2), 0px 4px 20px 0px rgba(56,100,240,0.38)",
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
  background: "rgba(167,139,250,0.05)",
  border: "1px solid rgba(167,139,250,0.15)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};
