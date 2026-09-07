// S1동의.jsx — 약관 · 개인정보 동의 (USR-003 · S1-006)
//
// 하는 일
//   ① 생년(연도)을 받아 만 14세 미만인지 가른다
//   ② 항목별로 개별 동의를 받는다 (전체 동의는 '한꺼번에 켜는 버튼'일 뿐, 값은 항목별로 남는다)
//   ③ 필수 항목이 하나라도 빠지면 진행을 막는다
//   ④ 동의 시각과 약관 버전을 함께 이력으로 남긴다 (갱신 아님, append)
//
// [왜 '전체 동의'를 값으로 저장하지 않나]
//   나중에 "이 사람이 마케팅에 동의했었나?"를 따질 때 필요한 건 항목별 결과다.
//   전체 동의는 입력 편의를 위한 버튼이지 동의의 단위가 아니다.

import { useMemo, useState } from "react";
import {
  동의항목,
  약관버전,
  나이제한걸림,
  나이안내,
  만나이,
} from "../데이터/약관.js";
import { 서버 } from "../서버/api.js";
import { 세션 } from "./세션정의.js";
import { 세션이동, 진행다시읽기, 목적지판정 } from "../상태/게임상태.js";

const 올해 = new Date().getFullYear();

export default function S1동의() {
  const [생년, set생년] = useState("");
  const [체크, set체크] = useState(() =>
    Object.fromEntries(동의항목.map((a) => [a.키, false])),
  );
  const [펼침, set펼침] = useState(null); // 본문을 열어 둔 항목 키
  const [보냄, set보냄] = useState(false);
  const [오류, set오류] = useState(null);

  const 나이걸림 = 나이제한걸림(생년);
  const 생년유효 =
    /^\d{4}$/.test(생년) && Number(생년) >= 1900 && Number(생년) <= 올해;

  const 필수미동의 = useMemo(
    () => 동의항목.filter((a) => a.필수 && !체크[a.키]),
    [체크],
  );
  const 전체동의 = 동의항목.every((a) => 체크[a.키]);
  const 진행가능 = 생년유효 && !나이걸림 && 필수미동의.length === 0 && !보냄;

  const 토글 = (키) => set체크((p) => ({ ...p, [키]: !p[키] }));
  const 전체토글 = () => {
    const 켬 = !전체동의;
    set체크(Object.fromEntries(동의항목.map((a) => [a.키, 켬])));
  };

  async function 제출() {
    if (!진행가능) return;
    set보냄(true);
    set오류(null);
    try {
      await 서버.동의저장({
        약관버전,
        // ★ 동의 시각은 클라이언트가 아니라 서버 시각이 맞다.
        //   지금은 모의 서버라 여기서 찍지만, 실제 서버에서는 서버가 덮어써야 한다.
        동의시각: new Date().toISOString(),
        생년: Number(생년),
        항목: 동의항목.map((a) => ({
          키: a.키,
          이름: a.이름,
          필수: a.필수,
          동의: !!체크[a.키],
        })),
      });
      const 진행 = await 진행다시읽기();
      세션이동(목적지판정(진행)); // 보통은 S2 캐릭터 생성으로 간다
    } catch (e) {
      set오류(e.message || "동의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      set보냄(false);
    }
  }

  return (
    <div className="stage" style={S.판}>
      <div style={S.속}>
        <div style={S.머리}>
          <div style={S.분류}>합동수사본부 · 조사관 등록</div>
          <h1 style={S.제목}>시작하기 전에 확인해 주세요</h1>
        </div>

        {/* ── 생년 (만 14세 미만 분기) ─────────────────── */}
        <section style={S.칸}>
          <label style={S.라벨} htmlFor="생년">
            출생 연도
          </label>
          <input
            id="생년"
            style={S.입력}
            inputMode="numeric"
            maxLength={4}
            placeholder="예: 2001"
            value={생년}
            onChange={(e) => set생년(e.target.value.replace(/\D/g, ""))}
          />
          <p style={S.도움}>
            나이 구간 확인에만 씁니다. 생년월일은 받지 않습니다.
            {생년유효 && !나이걸림 && (
              <span style={S.확인}> · 만 {만나이(생년)}세</span>
            )}
          </p>
          {생년.length === 4 && !생년유효 && (
            <p style={S.경고}>연도를 다시 확인해 주세요.</p>
          )}
          {나이걸림 && <p style={S.경고}>{나이안내}</p>}
        </section>

        {/* ── 항목별 동의 ──────────────────────────────── */}
        <section style={S.칸}>
          <button style={S.전체} onClick={전체토글} type="button">
            <span style={{ ...S.네모, ...(전체동의 ? S.네모켬 : null) }}>
              {전체동의 ? "✓" : ""}
            </span>
            전체 동의
          </button>

          <div style={S.줄} />

          {동의항목.map((a) => (
            <div key={a.키} style={S.항목}>
              <button
                style={S.항목줄}
                onClick={() => 토글(a.키)}
                type="button"
                aria-pressed={!!체크[a.키]}
              >
                <span
                  style={{ ...S.네모, ...(체크[a.키] ? S.네모켬 : null) }}
                >
                  {체크[a.키] ? "✓" : ""}
                </span>
                <span style={S.항목이름}>
                  <b style={a.필수 ? S.필수 : S.선택}>
                    [{a.필수 ? "필수" : "선택"}]
                  </b>{" "}
                  {a.이름}
                </span>
              </button>
              <button
                style={S.보기}
                type="button"
                onClick={() => set펼침(펼침 === a.키 ? null : a.키)}
              >
                {펼침 === a.키 ? "접기" : "보기"}
              </button>
              <p style={S.요약}>{a.요약}</p>
              {펼침 === a.키 && <pre style={S.본문}>{a.본문}</pre>}
            </div>
          ))}
        </section>

        {/* ── 진행 ────────────────────────────────────── */}
        {필수미동의.length > 0 && (
          <p style={S.차단}>
            필수 항목에 동의해야 시작할 수 있습니다 —{" "}
            {필수미동의.map((a) => a.이름).join(" · ")}
          </p>
        )}
        {오류 && <p style={S.경고}>{오류}</p>}

        <button
          style={{ ...S.시작, ...(진행가능 ? null : S.시작끔) }}
          disabled={!진행가능}
          onClick={제출}
          type="button"
        >
          {보냄 ? "저장하는 중…" : "동의하고 시작"}
        </button>

        <p style={S.버전}>약관 버전 {약관버전}</p>
      </div>
    </div>
  );
}

const 잉크 = "#cfe3ff";
const S = {
  판: {
    overflowY: "auto",
    background: "#14171c",
    color: 잉크,
    font: "14px/1.7 sans-serif",
  },
  속: { maxWidth: 560, margin: "0 auto", padding: "40px 28px 56px" },
  머리: { marginBottom: 26 },
  분류: {
    font: "12px ui-monospace,Menlo,monospace",
    letterSpacing: 1,
    color: "#7f93ad",
  },
  제목: { font: "600 24px sans-serif", margin: "8px 0 0" },
  칸: {
    marginBottom: 22,
    padding: 18,
    borderRadius: 10,
    background: "#1a1f27",
    border: "1px solid #262f3c",
  },
  라벨: { display: "block", font: "600 14px sans-serif", marginBottom: 8 },
  입력: {
    width: 140,
    padding: "9px 12px",
    borderRadius: 6,
    border: "1px solid #38445a",
    background: "#12161c",
    color: 잉크,
    font: "15px ui-monospace,Menlo,monospace",
    letterSpacing: 2,
  },
  도움: { margin: "8px 0 0", color: "#7f93ad", fontSize: 13 },
  확인: { color: "#7fc4a0" },
  경고: { margin: "10px 0 0", color: "#e8a09a", fontSize: 13 },
  전체: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "6px 0",
    border: 0,
    background: "none",
    color: 잉크,
    font: "600 15px sans-serif",
    cursor: "pointer",
    textAlign: "left",
  },
  줄: { height: 1, background: "#262f3c", margin: "12px 0 4px" },
  항목: { padding: "12px 0 4px", position: "relative" },
  항목줄: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: 0,
    border: 0,
    background: "none",
    color: 잉크,
    font: "14px sans-serif",
    cursor: "pointer",
    textAlign: "left",
  },
  항목이름: { flex: 1 },
  필수: { color: "#e0a94e" },
  선택: { color: "#7f93ad" },
  네모: {
    display: "inline-grid",
    placeItems: "center",
    width: 20,
    height: 20,
    flex: "0 0 20px",
    borderRadius: 5,
    border: "1px solid #45536b",
    background: "#12161c",
    color: "#14171c",
    fontSize: 13,
  },
  네모켬: { background: "#4a8fd6", borderColor: "#4a8fd6", color: "#0f1318" },
  보기: {
    position: "absolute",
    right: 0,
    top: 12,
    padding: "2px 8px",
    borderRadius: 5,
    border: "1px solid #333e50",
    background: "#12161c",
    color: "#8fa3bd",
    font: "12px sans-serif",
    cursor: "pointer",
  },
  요약: { margin: "6px 0 0 30px", color: "#7f93ad", fontSize: 13 },
  본문: {
    margin: "10px 0 0 30px",
    padding: 14,
    maxHeight: 220,
    overflowY: "auto",
    borderRadius: 8,
    background: "#12161c",
    border: "1px solid #262f3c",
    color: "#a9b7c9",
    font: "12px/1.8 sans-serif",
    whiteSpace: "pre-wrap",
  },
  차단: { color: "#e0a94e", fontSize: 13, margin: "0 0 12px" },
  시작: {
    width: "100%",
    padding: "13px 0",
    borderRadius: 8,
    border: "1px solid #4a7cb0",
    background: "#2f5a86",
    color: "#eaf3ff",
    font: "600 15px sans-serif",
    cursor: "pointer",
  },
  시작끔: {
    background: "#1e242d",
    borderColor: "#2c3648",
    color: "#5b6b80",
    cursor: "not-allowed",
  },
  버전: {
    margin: "14px 0 0",
    textAlign: "center",
    color: "#5b6b80",
    font: "12px ui-monospace,Menlo,monospace",
  },
};
