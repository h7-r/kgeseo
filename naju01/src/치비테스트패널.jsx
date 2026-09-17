// Meshy 캐릭터 꾸미기 패널 (로비 ?avatar=meshy / ?avatar=chibi 전용).
// Sidekick 편집창과 같은 구성: 성별 체형, 파츠 선택, 크기 슬라이더, 색상,
// 43개 동작 미리보기, 외형 저장·불러오기·초기화.
import { useState } from "react";
import { 사이드킥모션목록 } from "./사이드킥옵션.js";
import { 메시선택지, 메시항목이름, 메시슬라이더, 메시색상, 메시설정보정, 메시외형읽기 } from "./메시외형옵션.js";

const 입력차단 = (e) => e.stopPropagation();

export default function ChibiTestPanel({ 설정, set설정, 저장키 }) {
  const [열림, set열림] = useState(true);
  const [안내, set안내] = useState("");
  const 바꾸기 = (patch) => set설정((old) => 메시설정보정({ ...old, ...patch, motion: patch.motion ?? old.motion }));
  const 값목록 = 사이드킥모션목록.map(([value]) => value);
  const 이동 = (step) => {
    const index = Math.max(1, 값목록.indexOf(설정.motion));
    const count = 값목록.length - 1;
    set설정((old) => ({ ...old, motion: 값목록[((index - 1 + step + count) % count) + 1] }));
  };
  return (
    <div style={패널} onKeyDown={입력차단} onKeyUp={입력차단} onMouseDown={입력차단}>
      <button type="button" style={제목버튼} onClick={() => set열림((v) => !v)}>
        {열림 ? "▾" : "▸"} 캐릭터 꾸미기
      </button>
      {열림 && (
        <div style={내용}>
          <div style={두칸}>
            {[["masculine", "남성 체형"], ["feminine", "여성 체형"]].map(([gender, label]) => (
              <button key={gender} type="button" style={설정.gender === gender ? 선택버튼 : 버튼} onClick={() => 바꾸기({ gender })}>
                {label}
              </button>
            ))}
          </div>
          <label style={줄}>
            <span>동작</span>
            <select style={선택상자} value={설정.motion} onChange={(e) => set설정((old) => ({ ...old, motion: e.target.value }))}>
              {사이드킥모션목록.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div style={세칸}>
            <button type="button" style={버튼} onClick={() => 이동(-1)}>이전</button>
            <button type="button" style={버튼} onClick={() => set설정((old) => ({ ...old, motion: "자동" }))}>자동</button>
            <button type="button" style={버튼} onClick={() => 이동(1)}>다음</button>
          </div>
          <label style={줄}>
            <span>걷기</span>
            <select style={선택상자} value={설정.walkMotion} onChange={(e) => 바꾸기({ walkMotion: e.target.value })}>
              <option value="Walk_Loop">기본 걷기</option>
              <option value="Walk_Formal_Loop">정중한 걷기</option>
            </select>
          </label>
          <label style={줄}>
            <span>달리기</span>
            <select style={선택상자} value={설정.runMotion} onChange={(e) => 바꾸기({ runMotion: e.target.value })}>
              <option value="Jog_Fwd_Loop">조깅</option>
              <option value="Sprint_Loop">전력 질주</option>
            </select>
          </label>
          {Object.entries(메시선택지).map(([key, per성별]) => (
            <label key={key} style={줄}>
              <span>{메시항목이름[key]}</span>
              <select style={선택상자} value={설정[key]} onChange={(e) => 바꾸기({ [key]: Number(e.target.value) })}>
                {per성별[설정.gender].map(([value, label]) => (
                  <option key={`${key}-${value}`} value={value}>{label}</option>
                ))}
              </select>
            </label>
          ))}
          {메시슬라이더.map(([key, label, min, max, step]) => (
            <label key={key} style={슬라이더줄}>
              <span>{label}</span>
              <input type="range" style={슬라이더} min={min} max={max} step={step} value={설정[key]}
                     onChange={(e) => 바꾸기({ [key]: Number(e.target.value) })} />
              <output style={값}>{Number(설정[key]).toFixed(2)}</output>
            </label>
          ))}
          <div style={색상줄}>
            {메시색상.map(([key, label]) => (
              <label key={key} style={색상칸}>
                <span>{label}</span>
                <input type="color" style={색상입력} value={설정[key]} onChange={(e) => 바꾸기({ [key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div style={세칸}>
            <button
              type="button"
              style={버튼}
              onClick={() => {
                try {
                  localStorage.setItem(저장키, JSON.stringify(메시설정보정(설정)));
                  set안내("현재 외형 저장됨");
                } catch {
                  set안내("저장 실패");
                }
              }}
            >외형 저장</button>
            <button type="button" style={버튼} onClick={() => { set설정(메시외형읽기(저장키)); set안내("저장 외형 불러옴"); }}>불러오기</button>
            <button type="button" style={버튼} onClick={() => { set설정(메시설정보정(null)); set안내("기본값 복원"); }}>초기화</button>
          </div>
          {안내 && <div style={안내글}>{안내}</div>}
          <div style={도움말}>
            색은 원본 질감 위에 곱해진다(흰색 = 원본 그대로).
            <br />V 시점 · T 조작 시작 · ESC 패널 조작 · WASD/Shift/C/Space · 좌클릭 펀치
          </div>
        </div>
      )}
    </div>
  );
}

const 글꼴 = '11px/1.35 ui-monospace, Menlo, "Malgun Gothic", monospace';
const 패널 = { position: "absolute", left: 14, top: 14, zIndex: 60, width: "min(320px, calc(100vw - 28px))", boxSizing: "border-box", display: "grid", gap: 5, color: "#DDE7F6", font: 글꼴 };
const 버튼 = { minWidth: 0, border: "1px solid rgba(170,190,220,.25)", borderRadius: 5, padding: "4px 6px", background: "rgba(14,18,26,.68)", color: "#DDE7F6", font: 글꼴, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const 제목버튼 = { ...버튼, textAlign: "left", padding: "6px 9px", background: "rgba(14,18,26,.84)", fontWeight: 700 };
const 선택버튼 = { ...버튼, background: "rgba(92,140,196,.45)", borderColor: "rgba(170,210,255,.7)", color: "#FFFFFF" };
const 내용 = { display: "grid", gap: 5, padding: 8, borderRadius: 7, background: "rgba(14,18,26,.86)", border: "1px solid rgba(170,190,220,.25)", maxHeight: "calc(100dvh - 90px)", overflowY: "auto", overflowX: "hidden" };
const 두칸 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 };
const 세칸 = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 };
const 줄 = { display: "grid", gridTemplateColumns: "minmax(44px, 26%) minmax(0, 1fr)", alignItems: "center", gap: 6 };
const 슬라이더줄 = { display: "grid", gridTemplateColumns: "minmax(44px, 24%) minmax(0, 1fr) 34px", alignItems: "center", gap: 6 };
const 슬라이더 = { width: "100%", minWidth: 0, margin: 0 };
const 값 = { textAlign: "right", color: "#AFC0D8", fontSize: 10 };
const 선택상자 = { minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid rgba(170,190,220,.3)", borderRadius: 4, padding: "3px 4px", background: "#202632", color: "#E8EFFA", font: 글꼴 };
const 색상줄 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(46px, 1fr))", gap: 5 };
const 색상칸 = { minWidth: 0, display: "grid", gap: 2, textAlign: "center", fontSize: 9 };
const 색상입력 = { width: "100%", minWidth: 0, height: 24, padding: 1, boxSizing: "border-box" };
const 안내글 = { color: "#9ED6AF", textAlign: "center", fontSize: 10 };
const 도움말 = { color: "#AFC0D8", fontSize: 10 };
