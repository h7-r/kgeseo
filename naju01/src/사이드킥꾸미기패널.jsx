// Sidekick 캐릭터 꾸미기 패널 — naju01 게임 공간과 로비 테스트(?avatar=sidekick)가 함께 쓴다.
// 외형 값·저장 키·위치만 바깥에서 받고, 저장값은 외형설정보정으로 항상 현재 형식에 맞춘다.
import { useState } from "react";
import {
  사이드킥모션목록,
  외형항목이름,
  외형선택지,
  성별목록,
  성별의상선택지,
  성별적용,
  외형설정보정,
  체형슬라이더,
  색상항목,
  사이드킥외형읽기,
} from "./사이드킥옵션.js";

// 패널 안에서 누른 키·마우스는 게임(이동·T 시작·V 시점·좌클릭 펀치)으로 새지 않게 막는다.
// 게임 입력은 window 리스너라서 React 루트에서 전파를 끊으면 도달하지 않는다.
const 입력차단 = (e) => e.stopPropagation();

export default function SidekickCustomizerPanel({ 설정, set설정, 저장키, 이전저장키 = null, 위치 = "right", 위여백 = 52 }) {
  const [저장안내, set저장안내] = useState("");
  const [패널열림, set패널열림] = useState(true);
  const 자리 = { ...아바타패널, top: 위여백, [위치 === "left" ? "left" : "right"]: 14 };
  return (
    <div style={자리} onKeyDown={입력차단} onKeyUp={입력차단} onMouseDown={입력차단}>
      <button type="button" style={아바타버튼} onClick={() => set패널열림((v) => !v)}>
        {패널열림 ? "▾" : "▸"} 캐릭터 꾸미기 · Sidekick
      </button>
      {패널열림 && (
      <div style={커스텀패널}>
        <label style={한줄라벨}>
          <span>동작</span>
          <select
            style={선택상자}
            value={설정.motion}
            onChange={(e) =>
              set설정((old) => ({ ...old, motion: e.target.value }))
            }
          >
            {사이드킥모션목록.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div style={동작선택줄}>
          <button
            type="button"
            style={작은버튼}
            onClick={() => {
              const values = 사이드킥모션목록.map(([value]) => value);
              const index = Math.max(1, values.indexOf(설정.motion));
              set설정((old) => ({ ...old, motion: values[index <= 1 ? values.length - 1 : index - 1] }));
            }}
          >이전</button>
          <button type="button" style={작은버튼} onClick={() => set설정((old) => ({ ...old, motion: "자동" }))}>자동</button>
          <button
            type="button"
            style={작은버튼}
            onClick={() => {
              const values = 사이드킥모션목록.map(([value]) => value);
              const index = Math.max(0, values.indexOf(설정.motion));
              set설정((old) => ({ ...old, motion: values[index >= values.length - 1 ? 1 : index + 1] }));
            }}
          >다음</button>
        </div>
        <div style={동작안내}>
          <b>총 {사이드킥모션목록.length - 1}개 동작</b> · 위 목록 또는 이전/다음으로 전부 미리보기
          <br />
          <b>자동</b>: WASD 걷기 · Shift 달리기 · C 앉기 · Space 점프 · 좌클릭 펀치
          <br />
          다른 동작을 고르면 이동 상태를 무시하고 그 모션을 제자리에서
          미리보기합니다. 테스트 후에는 자동으로 돌려놓으세요.
        </div>
        <label style={한줄라벨}>
          <span>걷기 자세</span>
          <select style={선택상자} value={설정.walkMotion} onChange={(e) => set설정((old) => ({ ...old, walkMotion: e.target.value }))}>
            <option value="Walk_Loop">기본 걷기</option>
            <option value="Walk_Formal_Loop">정중한 걷기</option>
          </select>
        </label>
        <label style={한줄라벨}>
          <span>달리기 자세</span>
          <select style={선택상자} value={설정.runMotion} onChange={(e) => set설정((old) => ({ ...old, runMotion: e.target.value }))}>
            <option value="Jog_Fwd_Loop">조깅 · 안정적</option>
            <option value="Sprint_Loop">전력 질주</option>
          </select>
        </label>
        <div style={선택줄}>
          {성별목록.map(([gender, label]) => (
            <button
              key={gender}
              type="button"
              aria-pressed={설정.gender === gender}
              style={설정.gender === gender ? 선택된버튼 : 작은버튼}
              onClick={() => set설정((old) => 성별적용(old, gender))}
            >{label} 체형</button>
          ))}
        </div>
        {["top", "bottom"].map((key) => (
          <label key={key} style={한줄라벨}>
            <span>{외형항목이름[key]}</span>
            <select
              style={선택상자}
              value={설정[key]}
              onChange={(e) =>
                set설정((old) => ({ ...old, [key]: Number(e.target.value) }))
              }
            >
              {성별의상선택지[설정.gender][key].map(([value, label]) => (
                <option key={`${key}-${value}`} value={value}>{label}</option>
              ))}
            </select>
          </label>
        ))}
        {Object.entries(외형선택지).map(([key, options]) => (
          <label key={key} style={한줄라벨}>
            <span>{외형항목이름[key]}</span>
            <select
              style={선택상자}
              value={설정[key]}
              onChange={(e) =>
                set설정((old) => ({ ...old, [key]: Number(e.target.value) }))
              }
            >
              {options.map(([value, label]) => (
                <option key={`${key}-${value}`} value={value}>{label}</option>
              ))}
            </select>
          </label>
        ))}
        {체형슬라이더.map(([key, label, min, max, step]) => (
          <label key={key} style={슬라이더줄}>
            <span>{label}</span>
            <input
              type="range"
              style={슬라이더}
              min={min}
              max={max}
              step={step}
              value={설정[key]}
              onChange={(e) =>
                set설정((old) => ({ ...old, [key]: Number(e.target.value) }))
              }
            />
            <output style={슬라이더값}>{Number(설정[key]).toFixed(2)}</output>
          </label>
        ))}
        <div style={색상줄}>
          {색상항목.map(([key, label]) => (
            <label key={key} title={label} style={색상칸}>
              <span>{label}</span>
              <input
                type="color"
                style={색상입력}
                value={설정[key]}
                onChange={(e) =>
                  set설정((old) => ({ ...old, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <div style={저장줄}>
          <button
            type="button"
            style={작은버튼}
            onClick={() => {
              try {
                localStorage.setItem(저장키, JSON.stringify(외형설정보정(설정)));
                set저장안내("현재 외형 저장됨");
              } catch {
                set저장안내("저장 실패 · 브라우저 저장소를 쓸 수 없음");
              }
            }}
          >외형 저장</button>
          <button type="button" style={작은버튼} onClick={() => { set설정(사이드킥외형읽기(저장키, 이전저장키)); set저장안내("저장 외형 불러옴"); }}>불러오기</button>
          <button type="button" style={작은버튼} onClick={() => { set설정(외형설정보정(null)); set저장안내("기본값 복원"); }}>초기화</button>
        </div>
        {저장안내 && <div style={저장메시지}>{저장안내}</div>}
      </div>
      )}
    </div>
  );
}

const 시점버튼 = {
  position: "absolute",
  right: 14,
  top: 14,
  zIndex: 20,
  border: "1px solid rgba(170,190,220,.35)",
  borderRadius: 7,
  padding: "6px 9px",
  background: "rgba(14,18,26,.72)",
  color: "#E8EFFA",
  font: '12px/1.2 ui-monospace, Menlo, monospace',
  cursor: "pointer",
};

const 아바타패널 = { position: "absolute", zIndex: 60, width: "min(360px, calc(100vw - 28px))", minWidth: 0, maxWidth: "calc(100vw - 28px)", boxSizing: "border-box", display: "grid", gap: 5 };
const 아바타버튼 = { ...시점버튼, position: "static", width: "100%", boxSizing: "border-box", textAlign: "left" };
const 선택줄 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", minWidth: 0, gap: 4 };
const 동작선택줄 = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", minWidth: 0, gap: 4 };
const 작은버튼 = { minWidth: 0, border: "1px solid rgba(170,190,220,.25)", borderRadius: 5, padding: "4px 6px", background: "rgba(14,18,26,.68)", color: "#DDE7F6", font: '11px/1.2 ui-monospace, Menlo, monospace', cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const 선택된버튼 = { ...작은버튼, background: "rgba(92,140,196,.45)", borderColor: "rgba(170,210,255,.7)", color: "#FFFFFF" };
const 커스텀패널 = { width: "100%", minWidth: 0, boxSizing: "border-box", maxHeight: "calc(100dvh - 120px)", overflowY: "auto", overflowX: "hidden", display: "grid", gap: 5, padding: 8, borderRadius: 7, background: "rgba(14,18,26,.84)", border: "1px solid rgba(170,190,220,.25)", color: "#DDE7F6", font: '11px/1.3 ui-monospace, Menlo, "Malgun Gothic", monospace' };
const 한줄라벨 = { display: "grid", gridTemplateColumns: "minmax(52px, 28%) minmax(0, 1fr)", minWidth: 0, alignItems: "center", gap: 5 };
const 선택상자 = { width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid rgba(170,190,220,.3)", borderRadius: 4, padding: "3px 4px", background: "#202632", color: "#E8EFFA", font: "inherit" };
const 동작안내 = { padding: "6px 7px", borderRadius: 5, background: "rgba(85,110,145,.18)", color: "#BECBE0", lineHeight: 1.45 };
const 슬라이더줄 = { display: "grid", gridTemplateColumns: "minmax(44px, 22%) minmax(0, 1fr) 34px", minWidth: 0, alignItems: "center", gap: 5 };
const 슬라이더 = { width: "100%", minWidth: 0, margin: 0 };
const 슬라이더값 = { textAlign: "right", color: "#AFC0D8", fontSize: 10 };
const 색상줄 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(52px, 1fr))", minWidth: 0, gap: 5 };
const 색상칸 = { minWidth: 0, display: "grid", gap: 2, textAlign: "center", fontSize: 9 };
const 색상입력 = { width: "100%", minWidth: 0, height: 26, padding: 1, boxSizing: "border-box" };
const 저장줄 = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", minWidth: 0, gap: 4, marginTop: 2 };
const 저장메시지 = { color: "#9ED6AF", textAlign: "center", fontSize: 10 };
