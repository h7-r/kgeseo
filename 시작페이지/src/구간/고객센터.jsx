import { useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 막음, 막음안내 } from "../공통.js";
import { 모두검사, 통과했나 } from "../유효성.js";
import { 고객센터탭, 공지목록, 자주묻는질문, 배지글자색 } from "../데이터/고객센터.js";

/* ═══════════════════════════════════════════════════════
   고객센터 — 피그마 112:1277(머리) · 112:1284(탭) · 112:1293 외(내용)

   탭 세 개가 같은 껍데기를 쓰고 내용만 바뀐다.
   탭 노드가 112:* / 113:1224* / 113:1348* 세 벌로 나뉘어 있지만
   **같은 페이지의 탭 상태 3개**다 — 페이지를 세 개 만들지 않는다.
   ═══════════════════════════════════════════════════════ */

const 켜진탭배경 = "linear-gradient(133.605deg, rgb(59,130,246) 0%, rgb(99,102,241) 45%, rgb(56,130,255) 100%)";
const 거름 = { 공지사항: ["전체", "점검", "이벤트", "업데이트", "안내"], "자주 묻는 질문 (FAQ)": ["전체", "계정", "게임플레이", "결제", "기술지원"] };

export default function 고객센터({ 탭 = "공지사항", 위 = 0, 탭누르기 = () => {} }) {
  return (
    <>
      {/* 머리 112:1277 */}
      <div style={{ ...머리, top: `${위}px` }} data-node-id="112:1277">
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
          <div style={{ fontFamily: 글꼴.제목, fontSize: "76px", lineHeight: "72px", color: "#eeeeff", whiteSpace: "nowrap" }}>고객센터</div>
          <div style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "18px", lineHeight: "28px", color: "#64748b", width: "100%" }}>
            공지사항, 자주 묻는 질문, 그리고 합동수사본부 1:1 문의 채널을 통해 해결되지 않은 미션을 제보하세요.
          </div>
        </div>
      </div>

      {/* 탭 112:1284 */}
      <div style={{ ...탭칸, top: `${위 + 230}px` }} data-node-id="112:1284">
        <div style={{ display: "flex", gap: "20px" }}>
          {고객센터탭.map((이름) => (
            <div key={이름} className={`탭 ${이름 === 탭 ? "켜짐" : ""}`} style={이름 === 탭 ? 켜진탭 : 꺼진탭} onClick={() => 탭누르기(이름)}>
              {이름}
            </div>
          ))}
        </div>
        <div style={{ height: "1px", width: "100%", background: "#1e3a5f" }} />
      </div>

      {/* 내용 */}
      <div style={{ ...내용칸, top: `${위 + 330}px` }}>
        {탭 === "공지사항" && <공지판 />}
        {탭 === "자주 묻는 질문 (FAQ)" && <문답판 />}
        {탭 === "1:1 문의하기" && <문의판 />}
      </div>
    </>
  );
}

function 머리글({ 제목, 설명 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      <div style={{ fontFamily: 글꼴.제목, fontSize: "40px", color: "#eeeeff", whiteSpace: "nowrap" }}>{제목}</div>
      <div style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "18px", color: "#64748b" }}>{설명}</div>
    </div>
  );
}

function 거르개({ 목록, 고른값, 바꾸기 }) {
  return (
    <div style={{ display: "flex", gap: "20px" }}>
      {목록.map((이름) => (
        <div key={이름} className={`탭 ${이름 === 고른값 ? "켜짐" : ""}`} style={이름 === 고른값 ? 켜진거름 : 꺼진거름} onClick={() => 바꾸기(이름)}>
          {이름}
        </div>
      ))}
    </div>
  );
}

function 배지({ 분류, 색 }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", padding: "6px 14px", borderRadius: "6px", background: 색, fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: 배지글자색[분류] || "#94a3b8", whiteSpace: "nowrap" }}>
      {분류}
    </div>
  );
}

/* 한 쪽에 보여 줄 줄 수.
   ※ 원본 쪽번호는 1~5 와 …10 까지 그려져 있지만 **자료는 8건뿐**이다.
     없는 쪽을 누르면 빈 화면이 나오므로, 실제 있는 쪽만 그린다.
     10쪽짜리 겉모습이 필요하면 아래 한 줄만 되돌리면 된다. */
const 쪽당 = 6;

function 공지판() {
  const [분류, set분류] = useState("전체");
  const [쪽, set쪽] = useState(1);

  const 걸러진 = 분류 === "전체" ? 공지목록 : 공지목록.filter((ㄱ) => ㄱ.분류 === 분류);
  const 총쪽 = Math.max(1, Math.ceil(걸러진.length / 쪽당));
  const 지금쪽 = Math.min(쪽, 총쪽);
  const 보일것 = 걸러진.slice((지금쪽 - 1) * 쪽당, 지금쪽 * 쪽당);
  const 쪽바꾸기 = (n) => set쪽(Math.min(총쪽, Math.max(1, n)));

  return (
    <>
      <머리글 제목="공지사항" 설명="게임 관련 최신 패치 노트, 정기 점검, 이벤트 공지 및 중요 안내를 신속하게 확인하세요." />
      <div style={판}>
        <div style={{ padding: "0 32px" }}>
          <거르개
            목록={거름.공지사항}
            고른값={분류}
            바꾸기={(v) => {
              set분류(v);
              set쪽(1); // 거르면 첫 쪽으로 — 안 그러면 3쪽에 있다가 빈 화면을 본다
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 32px" }}>
          {보일것.length === 0 && <div style={빈안내}>해당 분류의 공지가 없습니다.</div>}
          {보일것.map((ㄱ, i) => (
            <div key={i} className="줄" style={줄카드}>
              <div style={{ width: "100px", flexShrink: 0 }}>
                <배지 분류={ㄱ.분류} 색={ㄱ.배지색} />
              </div>
              <div style={{ flex: "1 0 0", minWidth: 0, fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{ㄱ.제목}</div>
              <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#64748b", whiteSpace: "nowrap" }}>{ㄱ.날짜}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 쪽번호는 판 밖에 있다 (원본에서 형제 노드) */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "center", width: "100%", paddingTop: "32px", paddingBottom: "16px" }}>
        <div style={{ ...동근단추, cursor: 지금쪽 > 1 ? "pointer" : "default", opacity: 지금쪽 > 1 ? 1 : 0.4 }} onClick={() => 쪽바꾸기(지금쪽 - 1)}>
          <img src={에셋.imgChevronLeft} alt="" style={{ width: "14px", height: "14px", display: "block" }} />
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {Array.from({ length: 총쪽 }, (_, i) => i + 1).map((n) => (
            <div key={n} className={`탭 ${n === 지금쪽 ? "켜짐" : ""}`} style={{ ...(n === 지금쪽 ? 켜진쪽 : 꺼진쪽), cursor: "pointer" }} onClick={() => 쪽바꾸기(n)}>
              {n}
            </div>
          ))}
        </div>
        <div style={{ ...동근단추, cursor: 지금쪽 < 총쪽 ? "pointer" : "default", opacity: 지금쪽 < 총쪽 ? 1 : 0.4 }} onClick={() => 쪽바꾸기(지금쪽 + 1)}>
          <img src={에셋.imgChevronRight} alt="" style={{ width: "14px", height: "14px", display: "block" }} />
        </div>
      </div>
    </>
  );
}

function 문답판() {
  const [분류, set분류] = useState("전체");
  /* 원본은 첫 항목만 펼쳐져 있다 — 그 상태에서 시작한다 */
  const [펼친것, set펼친것] = useState(0);

  const 걸러진 = 분류 === "전체" ? 자주묻는질문 : 자주묻는질문.filter((ㅁ) => ㅁ.분류 === 분류);

  return (
    <>
      <머리글 제목="자주 묻는 질문" 설명="궁금한 점을 빠르게 찾아보세요" />
      <거르개
        목록={거름["자주 묻는 질문 (FAQ)"]}
        고른값={분류}
        바꾸기={(v) => {
          set분류(v);
          set펼친것(0);
        }}
      />
      <div style={판}>
        <div style={{ display: "flex", gap: "24px", padding: "16px 32px", background: "#0a1220", fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#60a5fa" }}>
          <span style={{ width: "100px" }}>분류</span>
          <span style={{ flex: "1 0 0" }}>질문</span>
          <span>상태</span>
        </div>
        {걸러진.length === 0 && <div style={{ ...빈안내, padding: "24px 32px" }}>해당 분류의 질문이 없습니다.</div>}
        {걸러진.map((ㅁ, i) => {
          const 펼침 = i === 펼친것;
          return (
            <div
              key={i}
              className="줄"
              style={{ ...줄카드, flexDirection: "column", alignItems: "stretch", gap: "12px", padding: "20px 32px", cursor: "pointer" }}
              onClick={() => set펼친것(펼침 ? -1 : i)}
            >
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <div style={{ width: "100px", flexShrink: 0 }}>
                  <배지 분류={ㅁ.분류} 색={ㅁ.배지색} />
                </div>
                <div style={{ flex: "1 0 0", minWidth: 0, fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{ㅁ.질문}</div>
                {/* 펼치면 아래쪽 화살표, 접으면 오른쪽 화살표 (원본과 같은 두 그림) */}
                <img src={펼침 ? 에셋.imgChevronDown : 에셋.imgChevronRight2} alt="" style={{ width: "16px", height: "16px", display: "block" }} />
              </div>
              {펼침 && (
                <>
                  <div style={{ height: "1px", background: "#1e3a5f" }} />
                  <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.7, color: "#94a3b8" }}>
                    {ㅁ.답 || "준비 중인 답변입니다."}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* 문의 유형 고르개에 넣을 항목 — 원본엔 목록이 없어 공지/FAQ 분류에서 가져왔다 */
const 문의유형 = ["계정", "게임플레이", "결제", "기술지원", "기타"];

function 문의판() {
  const [값, set값] = useState({});
  const [오류, set오류] = useState({});
  const [눌렀나, set눌렀나] = useState(false);
  const [보냈나, set보냈나] = useState(false);

  const 적기 = (이름) => (v) => {
    const 새값 = { ...값, [이름]: v };
    set값(새값);
    if (눌렀나) set오류(모두검사(["문의유형", "제목", "내용", "이메일"], 새값));
  };
  const 보내기 = () => {
    set눌렀나(true);
    const 새오류 = 모두검사(["문의유형", "제목", "내용", "이메일"], 값);
    set오류(새오류);
    if (통과했나(새오류)) set보냈나(true); // 보낼 서버가 없다 — 접수됐다는 표시만 남긴다
  };
  const 속성 = (이름) => ({ 값: 값[이름] ?? "", 바꾸기: 적기(이름), 오류: 오류[이름] });

  return (
    <>
      <머리글 제목="1:1 문의하기" 설명="궁금한 점이나 불편사항을 남겨주시면 빠르게 답변드리겠습니다." />
      <div style={{ display: "flex", gap: "40px", width: "1623px" }}>
        <div style={{ ...상자, width: "1057px", gap: "24px" }}>
          <입력칸 라벨="문의 유형" 안내="문의 유형을 선택해주세요" 화살표 {...속성("문의유형")} />
          <입력칸 라벨="제목" 안내="문의 제목을 입력해주세요" {...속성("제목")} />
          <입력칸 라벨="내용" 안내="문의 내용을 자세히 작성해주세요" 높이={200} {...속성("내용")} />
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            <div style={라벨글}>첨부파일</div>
            <label style={{ ...올리기, cursor: "pointer" }}>
              <img src={에셋.imgUploadCloud} alt="" style={{ width: "24px", height: "24px", display: "block" }} />
              <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#64748b" }}>
                {값.파일 || "파일을 드래그하거나 클릭하여 첨부 (최대 10MB)"}
              </span>
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => 적기("파일")(e.target.files?.[0]?.name ?? "")}
              />
            </label>
          </div>
          <입력칸 라벨="이메일" 안내="답변 받으실 이메일 주소" {...속성("이메일")} />
          <div className="단추" style={보내기단추} onClick={보내기}>
            {보냈나 ? "접수되었습니다 ✓" : "문의 접수하기"}
          </div>
        </div>

        <div style={{ ...상자, width: "358px", gap: "20px" }}>
          <div style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "18px", color: "#eeeeff" }}>운영 시간</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontFamily: 글꼴.모노, fontSize: "16px", color: "#94a3b8" }}>
            <span>평일 10:00 - 18:00</span>
            <span>주말/공휴일 휴무</span>
          </div>
          <div style={{ height: "1px", background: "#1e3a5f" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontFamily: 글꼴.모노, fontSize: "16px", color: "#94a3b8" }}>
            <span>긴급 문의: support@escapethelegend.kr</span>
            <span>평균 답변 시간: 1-2 영업일</span>
          </div>
        </div>
      </div>
    </>
  );
}

function 입력칸({ 라벨, 안내, 높이, 화살표, 값, 바꾸기, 오류 }) {
  const 글자 = { fontFamily: 글꼴.본문, fontSize: "16px", "--안내색": "rgba(200,205,255,0.35)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
      <div style={라벨글}>{라벨}</div>
      <div
        className={오류 ? "오류칸" : undefined}
        style={{
          position: "relative",
          border: "1px solid rgba(96,165,250,0.18)",
          borderRadius: "8px",
          padding: 높이 ? "16px" : "10px 16px",
          ...(높이 ? { height: `${높이}px` } : {}),
          display: "flex",
          alignItems: 높이 ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: "12px",
          boxSizing: "border-box",
        }}
      >
        {화살표 ? (
          <고르개 안내={안내} 글자={글자} 값={값} 바꾸기={바꾸기} />
        ) : 높이 ? (
          <textarea
            className="입력칸"
            placeholder={안내}
            value={값}
            onChange={(e) => 바꾸기(e.target.value)}
            style={{ ...글자, height: "100%" }}
          />
        ) : (
          <input className="입력칸" placeholder={안내} value={값} onChange={(e) => 바꾸기(e.target.value)} style={글자} />
        )}
        {화살표 && <img src={에셋.imgChevronDown} alt="" style={{ width: "16px", height: "16px", display: "block", flexShrink: 0 }} />}
        {오류 && <span className="오류글">{오류}</span>}
      </div>
    </div>
  );
}

function 고르개({ 안내, 글자, 값, 바꾸기 }) {
  return (
    <select
      className="입력칸"
      value={값 ?? ""}
      onChange={(e) => 바꾸기(e.target.value)}
      style={{ ...글자, appearance: "none", cursor: "pointer", color: 값 ? "var(--색-흰색)" : "rgba(200,205,255,0.35)" }}
    >
      <option value="">{안내}</option>
      {문의유형.map((ㅇ) => (
        <option key={ㅇ} value={ㅇ} style={{ color: "#000" }}>
          {ㅇ}
        </option>
      ))}
    </select>
  );
}

const 머리 = { position: "absolute", left: 0, width: "1920px", padding: "80px 120px 40px", boxSizing: "border-box" };
const 탭칸 = { position: "absolute", left: 0, width: "1920px", padding: "20px 120px 10px", display: "flex", flexDirection: "column", gap: "24px", boxSizing: "border-box" };
const 내용칸 = { position: "absolute", left: 0, width: "1920px", padding: "0 120px", display: "flex", flexDirection: "column", gap: "32px", boxSizing: "border-box" };

const 탭바탕 = { display: "flex", alignItems: "center", padding: "12px 24px", borderRadius: "999px", fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box" };
const 켜진탭 = { ...탭바탕, backgroundImage: 켜진탭배경, color: "#ffffff", filter: "drop-shadow(0px 8px 24px rgba(59,130,246,0.2)) drop-shadow(0px 4px 12px rgba(59,130,246,0.35))" };
const 꺼진탭 = { ...탭바탕, background: "#0a1220", border: "1px solid #1e3a5f", color: "#94a3b8" };

const 거름바탕 = { display: "flex", alignItems: "center", padding: "10px 18px", borderRadius: "999px", fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box" };
const 켜진거름 = { ...거름바탕, backgroundImage: 켜진탭배경, color: "#ffffff" };
const 꺼진거름 = { ...거름바탕, background: "#0a1220", border: "1px solid #1e3a5f", color: "#94a3b8" };

const 판 = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  padding: "32px 0",
  borderRadius: "16px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0px 8px 32px 0px rgba(29,78,216,0.06)",
  width: "100%",
  overflow: "hidden",
  boxSizing: "border-box",
};
const 줄카드 = { display: "flex", gap: "20px", alignItems: "center", padding: "20px", borderRadius: "12px", background: "#0a1220", border: "1px solid #1e3a5f", boxSizing: "border-box" };

const 동근단추 = { display: "flex", alignItems: "center", justifyContent: "center", padding: "10px", borderRadius: "999px", background: "#0a1220", border: "1px solid #1e3a5f" };
const 쪽바탕 = { display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px", borderRadius: "999px", fontFamily: 글꼴.모노, fontSize: "16px", boxSizing: "border-box" };
const 켜진쪽 = { ...쪽바탕, background: "#3b82f6", color: "#ffffff", fontWeight: 700 };
const 꺼진쪽 = { ...쪽바탕, background: "#0a1220", border: "1px solid #1e3a5f", color: "#94a3b8" };

const 상자 = { display: "flex", flexDirection: "column", padding: "32px", borderRadius: "16px", background: "#060d1a", border: "1px solid #1e3a5f", boxShadow: "0px 8px 16px 0px rgba(29,78,216,0.06)", boxSizing: "border-box" };
const 라벨글 = { fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "16px", color: "rgba(181,188,255,0.85)", textTransform: "uppercase" };
const 올리기 = { display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", padding: "24px", borderRadius: "12px", border: "1px dashed #60a5fa", boxSizing: "border-box" };
const 보내기단추 = {
  display: "flex", alignItems: "center", justifyContent: "center", padding: "15px 24px", borderRadius: "100px",
  backgroundImage: 켜진탭배경, color: "#ffffff", fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px",
  textTransform: "uppercase", cursor: "pointer",
  boxShadow: "0px 0px 48px 8px rgba(96,165,250,0.25), 0px 4px 20px 0px rgba(59,130,246,0.45)",
};

const 빈안내 = { fontFamily: 글꼴.모노, fontSize: "16px", color: "#64748b", padding: "12px 0" };
