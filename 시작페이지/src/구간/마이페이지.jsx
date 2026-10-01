import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { 나가기, use로그인 } from "../로그인상태.js";
import { 게임시작 } from "../이동표.js";
import { 탈퇴, 계정데이터, 계정데이터저장, 비밀번호확인후바꾸기, 내데이터 } from "../계정저장소.js";
import { 규칙, 같은가 } from "../유효성.js";
import { 글꼴 } from "../공통.js";
import 모달 from "./모달.jsx";
import { 마이탭목록, 마이내용 } from "../데이터/마이페이지.js";

/* ═══════════════════════════════════════════════════════
   마이페이지 — 피그마 154:1325 · 1339 · 1353 · 1367 · 1381 (1577 × 1300)

   다섯 탭이 같은 껍데기를 쓰고 내용만 바뀐다.
   이 구간만 바탕이 #11121a 계열로, 다른 화면(#060d1a)과 다르다 — 원본 그대로.
   ═══════════════════════════════════════════════════════ */

/* 계정 설정에서 **실제로 동작하는** 항목 — 누르면 모달이 뜨거나 바로 처리된다.
   나머지(2단계 인증·계정 연동 등)는 서버가 있어야 하는 기능이라 「준비 중」으로 표시한다. */
const 되는항목 = new Set(["비밀번호 변경", "로그인 기록", "이메일 수신", "데이터 관리", "로그아웃", "회원 탈퇴"]);

export default function 마이페이지({ 탭 = "최근 플레이 기록", 위 = 0, 탭누르기 = () => {} }) {
  const 가기 = useNavigate();
  const 사람 = use로그인(); // 이 화면은 로그인한 사람만 들어온다(앱.jsx 문지기)
  const 시작하기 = () => 게임시작(가기); // 「모험 시작하기」·「다시 도전」 → 게임(이동표.js)
  /* 내 정보 카드에 보여 줄 숫자 — 플레이 기록에서 센다 */
  const 기록들 = 마이내용["최근 플레이 기록"].기록;
  const 통계 = {
    해결: 기록들.filter((ㄱ) => ㄱ.결과 === "성공").length,
    최고: 기록들.map((ㄱ) => ㄱ.기록시간).sort()[0] ?? "—", // "18:42" 처럼 같은 꼴이라 글자 정렬 = 시간 정렬
  };

  /* 지금 열린 모달 — "비번" | "기록" | "탈퇴" | null */
  const [열린모달, set열린모달] = useState(null);
  const 닫기 = () => set열린모달(null);
  /* 계정별 데이터(설정·로그인 기록) — 저장소에서 읽어 온다 */
  const [데이터, set데이터] = useState(null);
  useEffect(() => {
    let 살아있음 = true;
    if (사람?.이메일) 계정데이터(사람.이메일).then((d) => { if (살아있음) set데이터(d ?? {}); });
    return () => { 살아있음 = false; };
  }, [사람?.이메일]);
  const 메일수신 = 데이터?.설정?.메일수신 ?? true;

  const 계정누르기 = async (라벨) => {
    if (라벨 === "로그아웃") {
      나가기();
      가기("/");
    } else if (라벨 === "비밀번호 변경") set열린모달("비번");
    else if (라벨 === "로그인 기록") set열린모달("기록");
    else if (라벨 === "회원 탈퇴") set열린모달("탈퇴");
    else if (라벨 === "이메일 수신") {
      /* 켜고 끄기 — 계정별 설정에 바로 저장한다 */
      const 새것 = await 계정데이터저장(사람.이메일, { 설정: { ...(데이터?.설정 ?? {}), 메일수신: !메일수신 } });
      set데이터(새것);
    } else if (라벨 === "데이터 관리") {
      /* 내 데이터를 JSON 파일로 내려받는다 — 비밀번호 해시는 빼고 */
      const 내것 = await 내데이터(사람.이메일);
      if (!내것) return;
      const 주소 = URL.createObjectURL(new Blob([JSON.stringify(내것, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: 주소, download: `escape-legend-내데이터-${new Date().toISOString().slice(0, 10)}.json` });
      /* 문서에 붙였다 떼야 download 속성(파일 이름)이 먹는 브라우저가 있다 */
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(주소), 1000); // 받기가 시작된 뒤 메모리를 돌려준다
    }
  };

  /* 탈퇴 — 계정과 그 계정의 데이터까지 실제로 지운다(계정저장소.js). 동의기록은 「철회」로 남는다 */
  const 탈퇴하기 = async () => {
    if (사람?.이메일) await 탈퇴(사람.이메일);
    나가기();
    가기("/");
  };

  const ㄴ = 마이내용[탭];

  return (
    <section style={{ ...바깥, top: `${위}px` }} data-node-id="154:1325">
      {/* 맨 위 — 누구의 마이페이지인지 (실제 로그인 정보) */}
      {사람 && <내정보 사람={사람} 통계={통계} 시작={시작하기} 나가기={() => 계정누르기("로그아웃")} />}
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        {마이탭목록.map((이름) => (
          <div key={이름} className={`탭 ${이름 === 탭 ? "켜짐" : ""}`} style={이름 === 탭 ? 켜진탭 : 꺼진탭} onClick={() => 탭누르기(이름)}>
            {이름}
          </div>
        ))}
      </div>
      <div style={{ height: "1px", width: "100%", background: "#262933" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
        {/* ── 최근 플레이 기록 ── 사건 카드 한 장 = 한 번의 플레이
            [그림] 지역 번호 · 지역      [성공]
                   사건 이름              1시간 전
                   난이도 · 클리어 시간 · 날짜      [다시 도전 →] */}
        {탭 === "최근 플레이 기록" && (
          <>
            {ㄴ.기록.map((ㄱ, i) => {
              const 성공 = ㄱ.결과 === "성공";
              return (
                <div key={i} className="줄" style={기록카드}>
                  <div style={{ display: "flex", alignItems: "center", gap: "20px", minWidth: 0 }}>
                    {/* 사건 그림 — 메인 앙암바위 원 안의 필름 첫 장면과 같은 그림 */}
                    <div style={{ ...기록그림, backgroundImage: `url(${ㄱ.그림})` }} aria-hidden="true" />
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "13px", letterSpacing: "1.6px", color: "#6f86bf" }}>
                        {ㄱ.번호} · {ㄱ.지역}
                      </span>
                      <span style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "22px", color: "#f1f1fc" }}>{ㄱ.제목}</span>
                      <span style={{ display: "flex", gap: "14px", fontFamily: 글꼴.모노, fontSize: "14px", color: "#96a3b6" }}>
                        <span>난이도 <b style={{ color: "#c9d2e6", fontWeight: 600 }}>{ㄱ.난이도}</b></span>
                        <span aria-hidden="true">·</span>
                        <span>클리어 <b style={{ color: "#c9d2e6", fontWeight: 600 }}>{ㄱ.기록시간}</b></span>
                        <span aria-hidden="true">·</span>
                        <span>{ㄱ.날짜}</span>
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                      <span style={{ ...결과칩, ...(성공 ? 성공칩 : 실패칩) }}>{성공 ? "✓ " : ""}{ㄱ.결과}</span>
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "13px", color: "#6f7a8c" }}>{ㄱ.언제}</span>
                    </div>
                    <button type="button" className="단추 흐름단추" style={다시도전} onClick={시작하기}>
                      <span className="단추글">다시 도전 →</span>
                    </button>
                  </div>
                </div>
              );
            })}
            {/* 아직 없는 지역 자리 — 목록이 한 장뿐이라 「이게 끝인가?」 싶지 않게 */}
            <div style={준비중}>
              <span style={{ fontFamily: 글꼴.모노, fontSize: "13px", letterSpacing: "1.4px", color: "#6f86bf" }}>COMING SOON</span>
              <span style={{ fontFamily: 글꼴.본문, fontSize: "16px", color: "#6f7a8c" }}>다음 지역의 사건을 준비하고 있어요. 새 전설이 열리면 여기에 기록이 쌓입니다.</span>
            </div>
          </>
        )}

        {탭 === "계정 설정" &&
          ㄴ.묶음.map((ㅁ) => (
            <div key={ㅁ.제목} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
              <span style={소제목}>{ㅁ.제목}</span>
              {ㅁ.항목.map(([라벨, 값]) => {
                const 됨 = 되는항목.has(라벨);
                const 위험 = 라벨 === "회원 탈퇴";
                const 스위치 = 라벨 === "이메일 수신";
                return (
                  <div
                    key={라벨}
                    className={됨 ? "줄" : undefined}
                    role={됨 ? (스위치 ? "switch" : "button") : undefined}
                    aria-checked={스위치 ? 메일수신 : undefined}
                    tabIndex={됨 ? 0 : undefined}
                    onClick={됨 ? () => 계정누르기(라벨) : undefined}
                    onKeyDown={됨 ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); 계정누르기(라벨); } } : undefined}
                    style={{ ...줄, height: "56px", padding: "16px 20px", ...(됨 ? { cursor: "pointer" } : { opacity: 0.72 }) }}
                  >
                    <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: 위험 ? "#f87171" : "#f1f1fc" }}>{라벨}</span>
                    {스위치 ? (
                      /* 이메일 수신 — 스위치로 켜고 끈다(줄 전체가 눌림 판이라 스위치는 그림만) */
                      <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontFamily: 글꼴.모노, fontSize: "15px", color: 메일수신 ? "#9aabd8" : "#6f7a8c" }}>{메일수신 ? "ON" : "OFF"}</span>
                        <span className="스위치" aria-hidden="true" aria-checked={메일수신} style={{ display: "inline-block" }} />
                      </span>
                    ) : 됨 ? (
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: 위험 ? "#f87171" : "#9aabd8" }}>{값} →</span>
                    ) : (
                      /* 서버가 있어야 하는 기능 — 누를 수 없다는 걸 글로 알려 준다 */
                      <span style={준비중칩}>준비 중</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

        {탭 === "구독 현황" && (
          <>
            <div style={{ ...상자, height: "200px", gap: "16px" }}>
              {ㄴ.플랜.map(([라벨, 값]) => (
                <div key={라벨} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "24px" }}>
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#96a3b6" }}>{라벨}</span>
                  <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#f1f1fc" }}>{값}</span>
                </div>
              ))}
            </div>
            <span style={소제목}>결제 내역</span>
            {ㄴ.결제.map(([날짜, 플랜, 금액], i) => (
              <div key={i} style={{ ...줄, height: "46px", padding: "14px 20px", borderRadius: "8px" }}>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#96a3b6" }}>{날짜}</span>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#f1f1fc" }}>{플랜}</span>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#f1f1fc" }}>{금액}</span>
              </div>
            ))}
          </>
        )}

        {(탭 === "업적 & 배지" || 탭 === "보유 아이템") && (
          <>
            <div style={{ ...상자, flexDirection: "row", gap: "24px", height: "80px", padding: "20px 24px" }}>
              {ㄴ.통계.map(([라벨, 값]) => (
                <div key={라벨} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#96a3b6" }}>{라벨}</span>
                  <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#f1f1fc" }}>{값}</span>
                </div>
              ))}
            </div>

            {탭 === "업적 & 배지" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                {ㄴ.배지.map(([이름, 설명, 상태], i) => (
                  <div key={i} style={{ ...상자, flexDirection: "row", alignItems: "center", gap: "16px", height: "90px", width: "calc(50% - 8px)", padding: "16px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "20px", background: "#1b2135", flexShrink: 0 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0" }}>
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#f1f1fc" }}>{이름}</span>
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#96a3b6" }}>{설명}</span>
                    </div>
                    <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#96a3b6" }}>{상태}</span>
                  </div>
                ))}
              </div>
            )}

            {탭 === "보유 아이템" &&
              ㄴ.아이템.map((ㅇ, i) => (
                <div key={i} style={{ ...줄, height: "52px", padding: "14px 16px", borderRadius: "8px", gap: "12px", justifyContent: "flex-start" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "#1b2135", flexShrink: 0 }} />
                  <span style={{ flex: "1 0 0", fontFamily: 글꼴.모노, fontSize: "16px", color: "#f1f1fc" }}>{ㅇ.이름}</span>
                  <span style={{ ...딱지, background: ㅇ.색, padding: "3px 8px", color: "#96a3b6" }}>{ㅇ.등급}</span>
                </div>
              ))}
          </>
        )}
      </div>

      {/* ── 모달들 ── */}
      <비번모달 열림={열린모달 === "비번"} 닫기={닫기} 사람={사람} />
      <모달 열림={열린모달 === "기록"} 닫기={닫기} 제목="로그인 기록" 설명="최근 10번의 로그인입니다. 모르는 기록이 있으면 비밀번호를 바꿔 주세요.">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {(데이터?.로그인들 ?? []).length === 0 && <span style={{ fontFamily: 글꼴.본문, color: "#6f7a8c" }}>아직 남은 기록이 없습니다.</span>}
          {(데이터?.로그인들 ?? []).map((ㄹ, i) => (
            <div key={ㄹ.때} style={{ ...줄, padding: "12px 16px", background: "#0b1224" }}>
              <span style={{ fontFamily: 글꼴.모노, fontSize: "15px", color: "#f1f1fc" }}>
                {new Date(ㄹ.때).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#96a3b6" }}>
                {ㄹ.기기}{i === 0 && <b style={{ marginLeft: "10px", color: "#4ade80", fontWeight: 600 }}>지금</b>}
              </span>
            </div>
          ))}
        </div>
      </모달>
      <모달 열림={열린모달 === "탈퇴"} 닫기={닫기} 위험 제목="정말 탈퇴할까요?" 설명="탈퇴하면 플레이 기록과 보유 재화가 모두 사라지며 되돌릴 수 없습니다. (관계 법령에 따라 보관 의무가 있는 기록은 정해진 기간 동안 분리 보관됩니다.)">
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button type="button" className="단추" style={모달보조} onClick={닫기}><span className="단추글">취소</span></button>
          <button type="button" className="단추" style={{ ...모달주요, backgroundImage: "none", background: "#7f1d1d", borderColor: "#b91c1c" }} onClick={탈퇴하기}>
            <span className="단추글">탈퇴하기</span>
          </button>
        </div>
      </모달>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   비밀번호 변경 모달
   · 지금 비밀번호를 먼저 확인한다(자리 비운 사이 남이 못 바꾸게)
   · 새 비밀번호는 가입과 **같은 규칙**(유효성.js)으로 칠 때마다 검사
   · 테스트 계정은 저장소가 거절한다(팀이 같이 쓰는 계정이라)
   ═══════════════════════════════════════════════════════ */
function 비번모달({ 열림, 닫기, 사람 }) {
  const [값, set값] = useState({ 지금: "", 새: "", 확인: "" });
  const [만짐, set만짐] = useState({});
  const [경고, set경고] = useState("");
  const [하는중, set하는중] = useState(false);
  const [됨, set됨] = useState(false);

  /* 닫았다 다시 열면 처음부터 */
  useEffect(() => {
    if (!열림) { set값({ 지금: "", 새: "", 확인: "" }); set만짐({}); set경고(""); set됨(false); }
  }, [열림]);

  const 오류 = {
    지금: !값.지금 ? "지금 비밀번호를 입력해주세요." : "",
    새: 규칙.비밀번호(값.새, { 이메일: 사람?.이메일, 닉네임: 사람?.이름 }),
    확인: 같은가(값.새, 값.확인),
  };
  const 보임 = (k) => (만짐[k] ? 오류[k] : "");
  const 적기 = (k) => (e) => set값((v) => ({ ...v, [k]: e.target.value }));

  const 보내기 = async (e) => {
    e.preventDefault();
    set만짐({ 지금: true, 새: true, 확인: true });
    if (오류.지금 || 오류.새 || 오류.확인 || 하는중) return;
    set하는중(true);
    set경고("");
    const 답 = await 비밀번호확인후바꾸기(사람.이메일, 값.지금, 값.새);
    set하는중(false);
    if (!답.좋음) { set경고(답.까닭); return; }
    set됨(true);
  };

  const 칸 = (k, 라벨, 자동) => (
    <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontFamily: 글꼴.모노, fontSize: "14px", color: "#96a3b6" }}>
        {라벨}
        {보임(k) && <span style={{ color: "#f87171" }}>{보임(k)}</span>}
      </span>
      <input
        type="password"
        className={`모달칸${보임(k) ? " 오류" : 만짐[k] && 값[k] ? " 맞음" : ""}`}
        value={값[k]}
        onChange={적기(k)}
        onBlur={() => 값[k] && set만짐((m) => ({ ...m, [k]: true }))}
        autoComplete={자동}
        maxLength={64}
      />
    </label>
  );

  return (
    <모달 열림={열림} 닫기={닫기} 제목="비밀번호 변경" 설명="지금 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.">
      {됨 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <p style={{ margin: 0, fontFamily: 글꼴.본문, fontSize: "16px", color: "#4ade80" }}>✓ 비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.</p>
          <button type="button" className="단추 흐름단추" style={모달주요} onClick={닫기}><span className="단추글">확인</span></button>
        </div>
      ) : (
        <form onSubmit={보내기} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* 비밀번호 관리자가 어느 계정인지 알도록 숨은 아이디 칸을 둔다 */}
          <input type="text" name="username" autoComplete="username" value={사람?.이메일 ?? ""} readOnly hidden />
          {칸("지금", "지금 비밀번호", "current-password")}
          {칸("새", "새 비밀번호 (8자 이상 · 대문자 · 소문자 · 숫자)", "new-password")}
          {칸("확인", "새 비밀번호 확인", "new-password")}
          {경고 && <div role="alert" style={{ fontFamily: 글꼴.본문, fontSize: "15px", color: "#f87171" }}>{경고}</div>}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" className="단추" style={모달보조} onClick={닫기}><span className="단추글">취소</span></button>
            <button type="submit" className="단추 흐름단추" style={{ ...모달주요, ...(하는중 ? { opacity: 0.65 } : {}) }} aria-busy={하는중}>
              <span className="단추글">{하는중 ? "확인하는 중…" : "바꾸기"}</span>
            </button>
          </div>
        </form>
      )}
    </모달>
  );
}

/* ═══════════════════════════════════════════════════════
   내 정보 카드 — 마이페이지 맨 위

   원본(피그마)엔 탭부터 시작해서 **누구의 페이지인지**가 안 보였다.
   헤더 알약(「TEST 님」)을 누르고 들어온 사람이 「내 페이지 맞구나」 알 수 있게
   계정 정보를 맨 위에 둔다. 값은 전부 실제 로그인 정보(로그인상태.js)다.

     [머리글자 원]  TEST 님            (닉네임과 님은 같은 글꼴·같은 크기, 님만 옅게)
                    test123@naver.com
                    [전남] [합류 2026.09.01] [테스트 계정]        [모험 시작하기] [로그아웃]
   ═══════════════════════════════════════════════════════ */
function 내정보({ 사람, 통계, 시작, 나가기 }) {
  const 합류 = 사람.가입때
    ? new Date(사람.가입때).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\s/g, "").replace(/\.$/, "")
    : "—";
  /* 머리글자 — 닉네임 첫 글자(영문이면 대문자) */
  const 머리글자 = (사람.이름 || "?").slice(0, 1).toUpperCase();

  return (
    <div style={정보판}>
      <div style={{ display: "flex", alignItems: "center", gap: "26px", minWidth: 0 }}>
        {/* 머리글자 원 — 바깥에 얇은 고리를 한 겹 둘러 「프로필」로 읽히게 */}
        <div style={머리고리} aria-hidden="true">
          <div style={머리원}>{머리글자}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
          <span style={{ fontFamily: 글꼴.모노, fontSize: "13px", letterSpacing: "1.8px", color: "#6f86bf" }}>INVESTIGATOR PROFILE</span>
          {/* 닉네임 · 님 — 님은 0.8배. 한글은 같은 px 에서도 영문 대문자보다 글자 몸이 커서,
              같은 크기로 두면 님이 더 커 보인다. 0.8배면 두 글자의 키(윗선)가 거의 맞는다. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={정보이름}>{사람.이름}</span>
            <span style={정보님}>님</span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: 글꼴.모노, fontSize: "15px", color: "#96a3b6", marginRight: "6px" }}>{사람.이메일}</span>
            <span style={정보칩}>지역 · {사람.지역 || "미정"}</span>
            <span style={정보칩}>합류 {합류}</span>
            {사람.테스트 && <span style={{ ...정보칩, color: "#fbbf24", borderColor: "rgba(251,191,36,0.4)" }}>테스트 계정</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "32px", flexShrink: 0 }}>
        {/* 숫자 두 개 — 무엇을 해 왔는지 한눈에 */}
        <div style={{ display: "flex", gap: "28px" }}>
          {[["해결한 사건", `${통계.해결}건`], ["최고 기록", 통계.최고]].map(([라벨, 값]) => (
            <div key={라벨} style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
              <span style={{ fontFamily: 글꼴.모노, fontSize: "13px", color: "#6f7a8c" }}>{라벨}</span>
              <span style={{ fontFamily: 글꼴.제목, fontSize: "34px", lineHeight: 1, color: "#f1f1fc", letterSpacing: "0.5px" }}>{값}</span>
            </div>
          ))}
        </div>
        <div style={{ width: "1px", height: "56px", background: "#262d40" }} aria-hidden="true" />
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button type="button" className="단추 흐름단추" style={정보시작} onClick={시작}>
            <span className="단추글">모험 시작하기</span>
          </button>
          <button type="button" className="단추" style={정보나가기} onClick={나가기}>
            <span className="단추글">로그아웃</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const 준비중칩 = { padding: "4px 10px", borderRadius: "999px", border: "1px dashed #3a4258", fontFamily: 글꼴.모노, fontSize: "13px", color: "#6f7a8c" };
const 모달주요 = {
  padding: "12px 26px",
  borderRadius: "100px",
  border: "1px solid rgba(59,94,162,0.5)",
  backgroundImage: "linear-gradient(166deg, rgb(46,72,137) 0%, rgb(54,64,143) 45%, rgb(43,71,143) 100%)",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "15px",
  color: "#ffffff",
  cursor: "pointer",
};
const 모달보조 = { ...모달주요, backgroundImage: "none", background: "transparent", border: "1px solid #3a4258", color: "#96a3b6", fontWeight: 400 };

const 정보판 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "24px",
  width: "100%",
  padding: "28px 32px",
  borderRadius: "16px",
  /* 마이페이지 판(#121219) 위에 남색 빛을 왼쪽에서 살짝 — 사이트 강조색과 잇는다 */
  background: "linear-gradient(100deg, rgba(46,72,137,0.28) 0%, rgba(18,18,25,1) 45%)",
  border: "1px solid #1f2a45",
  boxSizing: "border-box",
  marginBottom: "12px",
};
const 머리고리 = {
  padding: "5px",
  borderRadius: "50%",
  border: "1px solid rgba(111,134,191,0.35)",
  flexShrink: 0,
};
const 머리원 = {
  width: "80px",
  height: "80px",
  borderRadius: "50%",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: 글꼴.넓게,
  fontSize: "40px",
  color: "#ffffff",
  backgroundImage: "linear-gradient(135deg, rgb(46,72,137) 0%, rgb(54,64,143) 100%)",
  border: "1px solid rgba(111,134,191,0.55)",
  boxShadow: "0 0 24px rgba(50,82,150,0.4)",
};
/* 닉네임·님 은 본문 글꼴 하나로 — 글꼴이 섞이면 같은 크기여도 키가 달라 보인다 */
const 정보이름 = { fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "40px", lineHeight: 1.1, color: "#f1f1fc", whiteSpace: "nowrap" };
const 정보님 = { fontFamily: 글꼴.본문, fontWeight: 500, fontSize: "32px", lineHeight: 1.1, color: "#96a3b6" }; // 40 × 0.8
const 정보칩 = {
  padding: "4px 10px",
  borderRadius: "999px",
  border: "1px solid #262d40",
  fontFamily: 글꼴.모노,
  fontSize: "14px",
  color: "#c9d2e6",
  whiteSpace: "nowrap",
};
/* 플레이 기록 카드 */
const 기록카드 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "24px",
  width: "100%",
  padding: "20px 24px",
  borderRadius: "14px",
  background: "#121219",
  border: "1px solid #1f2433",
  boxSizing: "border-box",
};
const 기록그림 = {
  width: "72px",
  height: "72px",
  borderRadius: "50%",
  flexShrink: 0,
  backgroundSize: "cover",
  backgroundPosition: "center",
  border: "2px solid rgba(47,74,142,0.8)", /* 메인 앙암바위 원의 남색 테두리와 같은 결 */
  boxShadow: "0 0 18px rgba(50,82,150,0.35)",
};
const 결과칩 = { padding: "5px 12px", borderRadius: "999px", fontFamily: 글꼴.모노, fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap" };
const 성공칩 = { color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.35)" };
const 실패칩 = { color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.35)" };
const 준비중 = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  padding: "18px 24px",
  borderRadius: "14px",
  border: "1px dashed #262d40",
  boxSizing: "border-box",
};

const 정보시작 = {
  padding: "14px 28px",
  borderRadius: "100px",
  border: "1px solid rgba(59,94,162,0.5)",
  backgroundImage: "linear-gradient(166deg, rgb(46,72,137) 0%, rgb(54,64,143) 45%, rgb(43,71,143) 100%)",
  boxShadow: "0 0 24px rgba(50,82,150,0.3)",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "16px",
  color: "#ffffff",
  whiteSpace: "nowrap",
  cursor: "pointer",
};
const 다시도전 = { ...정보시작, padding: "11px 20px", fontSize: "14px" }; // 기록 카드 안 작은 단추 — 모험 시작하기와 같은 모양, 크기만 작게
const 정보나가기 = { ...정보시작, backgroundImage: "none", background: "transparent", border: "1px solid #3a4258", boxShadow: "none", color: "#96a3b6", fontWeight: 400 };

const 바깥 = {
  position: "absolute",
  left: "172px",
  width: "1577px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  boxSizing: "border-box",
};

const 탭바탕 = { display: "flex", alignItems: "center", padding: "12px 20px", borderRadius: "999px", fontFamily: 글꼴.모노, fontSize: "16px", whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box" };
const 켜진탭 = { ...탭바탕, background: "#2e4889", color: "#ffffff", fontWeight: 700 };
const 꺼진탭 = { ...탭바탕, background: "#1a1c26", color: "#96a3b6" };

const 줄 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 20px",
  borderRadius: "10px",
  background: "#121219",
  width: "100%",
  boxSizing: "border-box",
};

const 상자 = { display: "flex", flexDirection: "column", padding: "24px", borderRadius: "12px", background: "#121219", width: "100%", boxSizing: "border-box" };

const 딱지 = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: "4px",
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  color: "#f1f1fc",
  whiteSpace: "nowrap",
};

const 소제목 = { fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#6f86bf" };
