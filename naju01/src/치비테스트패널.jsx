// 치비 몸체 시제품 확인용 패널 (로비 ?avatar=chibi 전용).
// 1단계 검토 범위만 다룬다: 체형 전환, 43개 모션 미리보기, 키·머리 크기, 피부색.
import { 사이드킥모션목록 } from "./사이드킥옵션.js";

const 입력차단 = (e) => e.stopPropagation();

export default function ChibiTestPanel({ 설정, set설정 }) {
  const 바꾸기 = (patch) => set설정((old) => ({ ...old, ...patch }));
  const 값목록 = 사이드킥모션목록.map(([value]) => value);
  const 이동 = (step) => {
    const index = Math.max(0, 값목록.indexOf(설정.motion));
    const next = (index - 1 + step + (값목록.length - 1)) % (값목록.length - 1);
    바꾸기({ motion: 값목록[next + 1] });
  };
  return (
    <div style={패널} onKeyDown={입력차단} onKeyUp={입력차단} onMouseDown={입력차단}>
      <div style={제목}>치비 몸체 시제품 · 1단계</div>
      <div style={두칸}>
        {[["masculine", "남성"], ["feminine", "여성"]].map(([gender, label]) => (
          <button
            key={gender}
            type="button"
            style={설정.gender === gender ? 선택버튼 : 버튼}
            onClick={() => 바꾸기({ gender })}
          >{label}</button>
        ))}
      </div>
      <label style={줄}>
        <span>동작</span>
        <select style={선택상자} value={설정.motion} onChange={(e) => 바꾸기({ motion: e.target.value })}>
          {사이드킥모션목록.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <div style={세칸}>
        <button type="button" style={버튼} onClick={() => 이동(-1)}>이전</button>
        <button type="button" style={버튼} onClick={() => 바꾸기({ motion: "자동" })}>자동</button>
        <button type="button" style={버튼} onClick={() => 이동(1)}>다음</button>
      </div>
      {[["heightScale", "키", 0.7, 1.3], ["headScale", "머리", 0.8, 1.3]].map(([key, label, min, max]) => (
        <label key={key} style={슬라이더줄}>
          <span>{label}</span>
          <input type="range" min={min} max={max} step={0.01} value={설정[key]} onChange={(e) => 바꾸기({ [key]: Number(e.target.value) })} />
          <output>{Number(설정[key]).toFixed(2)}</output>
        </label>
      ))}
      <label style={줄}>
        <span>피부</span>
        <input type="color" value={설정.skinColor} onChange={(e) => 바꾸기({ skinColor: e.target.value })} />
      </label>
      <div style={안내}>
        V 시점 전환 · T 조작 시작 · WASD/Shift/C/Space · 좌클릭 펀치
        <br />얼굴 질감·헤어·의상은 다음 단계에서 붙인다.
      </div>
    </div>
  );
}

const 글꼴 = '11px/1.35 ui-monospace, Menlo, "Malgun Gothic", monospace';
const 패널 = { position: "absolute", left: 14, top: 14, zIndex: 60, width: "min(300px, calc(100vw - 28px))", boxSizing: "border-box", display: "grid", gap: 6, padding: 10, borderRadius: 8, background: "rgba(14,18,26,.86)", border: "1px solid rgba(170,190,220,.25)", color: "#DDE7F6", font: 글꼴 };
const 제목 = { fontWeight: 700, color: "#FFFFFF" };
const 버튼 = { minWidth: 0, border: "1px solid rgba(170,190,220,.25)", borderRadius: 5, padding: "4px 6px", background: "rgba(14,18,26,.68)", color: "#DDE7F6", font: 글꼴, cursor: "pointer" };
const 선택버튼 = { ...버튼, background: "rgba(92,140,196,.45)", borderColor: "rgba(170,210,255,.7)", color: "#FFFFFF" };
const 두칸 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 };
const 세칸 = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 };
const 줄 = { display: "grid", gridTemplateColumns: "44px minmax(0, 1fr)", alignItems: "center", gap: 6 };
const 슬라이더줄 = { display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 34px", alignItems: "center", gap: 6 };
const 선택상자 = { minWidth: 0, width: "100%", border: "1px solid rgba(170,190,220,.3)", borderRadius: 4, padding: "3px 4px", background: "#202632", color: "#E8EFFA", font: 글꼴 };
const 안내 = { color: "#AFC0D8", fontSize: 10 };
