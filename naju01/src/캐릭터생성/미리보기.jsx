// 캐릭터 생성 화면 **개발용 미리보기** (naju01/캐릭터생성.html).
//
// 회원가입·서버·오프닝이 없어도 생성 화면만 열어 볼 수 있게 한다. 이름 확인과 완료는
// 여기서 만든 **가짜 함수**로 대신하고, 어떤 답을 돌려줄지 골라 모든 상태를 재현한다.
//   ※ 이 조작 도구는 미리보기 진입점에만 있다. 생성 화면 안에는 '무조건 사용 가능' 같은
//     기본값이 들어 있지 않다 — 확인 함수가 없으면 완료가 막힌다.
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import CC캐릭터생성화면 from "./캐릭터생성화면.jsx";
import { 색, 글꼴, 단추, 고른단추, 작은글, 소제목, 포커스CSS } from "./스타일.js";

const 이름답목록 = [
  ["available", "사용 가능"],
  ["taken", "이미 사용 중"],
  ["invalid", "허용되지 않는 이름"],
  ["reject", "확인 실패(통신 오류)"],
];

const 완료답목록 = [
  ["ok", "성공"],
  ["name_taken", "이름 충돌"],
  ["failed", "저장 실패"],
  ["reject", "예외(통신 오류)"],
];

// 이미 쓰이고 있다고 칠 이름들 — '사용 가능' 을 골라도 이 이름은 중복으로 답한다.
const 쓰는이름 = new Set(["조사관", "홍길동", "테스트"]);

function CC미리보기() {
  const [이름답, set이름답] = useState("available");
  const [완료답, set완료답] = useState("ok");
  const [느리게, set느리게] = useState(false);
  const [확인붙임, set확인붙임] = useState(true);
  const [기록, set기록] = useState([]);
  const [보낸것, set보낸것] = useState(null);
  const [초안, set초안] = useState(null);
  const [초기값, set초기값] = useState(null);
  const [열쇠, set열쇠] = useState(0);
  const [판보임, set판보임] = useState(true);
  const 적기 = (줄) => set기록((이전) => [`${new Date().toLocaleTimeString("ko-KR")} ${줄}`, ...이전].slice(0, 12));

  const checkName = useCallback(async (이름, { signal } = {}) => {
    적기(`checkName("${이름}")`);
    await new Promise((성공, 실패) => {
      const 지연 = 느리게 ? 2600 : 320;
      const 표 = setTimeout(성공, 지연);
      signal?.addEventListener("abort", () => { clearTimeout(표); 실패(new Error("abort")); });
    });
    if (이름답 === "reject") throw new Error("네트워크 오류(가짜)");
    if (이름답 === "available") {
      return 쓰는이름.has(이름) ? { status: "taken" } : { status: "available" };
    }
    if (이름답 === "taken") return { status: "taken" };
    return { status: "invalid", message: "쓸 수 없는 이름입니다(가짜 금칙어)." };
  }, [이름답, 느리게]);

  const onComplete = useCallback(async (payload) => {
    적기(`onComplete(${payload.displayName})`);
    set보낸것(payload);
    await new Promise((r) => setTimeout(r, 느리게 ? 1600 : 350));
    if (완료답 === "reject") throw new Error("네트워크 오류(가짜)");
    if (완료답 === "ok") return { ok: true };
    if (완료답 === "name_taken") return { ok: false, reason: "name_taken", message: "그 사이 누군가 쓴 이름입니다." };
    return { ok: false, reason: "failed", message: "저장에 실패했습니다(가짜)." };
  }, [완료답, 느리게]);

  const onDraftChange = useCallback((값) => set초안(값), []);

  const 다시열기 = () => {
    // 9번 검증용 — 받은 초안을 그대로 initialValue 로 넣고 컴포넌트를 다시 마운트한다.
    set초기값(초안);
    set열쇠((n) => n + 1);
    적기("초안을 initialValue 로 넣고 다시 마운트");
  };

  const 도구 = useMemo(() => ({ 이름답, set이름답, 완료답, set완료답, 느리게, set느리게, 확인붙임, set확인붙임 }), [이름답, 완료답, 느리게, 확인붙임]);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: 색.바탕, color: 색.글, fontFamily: 글꼴.본문 }}>
      <style>{포커스CSS}</style>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <CC캐릭터생성화면
          key={열쇠}
          initialValue={초기값}
          checkName={확인붙임 ? checkName : null}
          onComplete={onComplete}
          onDraftChange={onDraftChange}
          onCancel={() => 적기("onCancel() — 부모가 화면을 닫을 차례")}
        />
      </div>

      {판보임 ? null : (
        <button type="button" style={{ ...단추, position: "fixed", right: 10, bottom: 10, zIndex: 5 }} onClick={() => set판보임(true)}>
          개발 도구 열기
        </button>
      )}
      <aside style={{ ...개발판, display: 판보임 ? "grid" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...소제목, color: 색.경고 }}>개발 미리보기 · 실제 화면 아님</div>
          <button type="button" style={{ ...단추, marginLeft: "auto", padding: "2px 8px" }} onClick={() => set판보임(false)}>접기</button>
        </div>
        <p style={작은글}>아래는 생성 화면이 아니라 **가짜 서버**를 조종하는 도구입니다.</p>

        <div style={{ display: "grid", gap: 6 }}>
          <span style={소제목}>checkName 이 돌려줄 답</span>
          {이름답목록.map(([값, 글]) => (
            <button key={값} type="button" style={도구.이름답 === 값 ? 고른단추 : 단추} onClick={() => set이름답(값)}>{글}</button>
          ))}
          <span style={작은글}>‘사용 가능’ 이어도 조사관·홍길동·테스트는 중복으로 답합니다.</span>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <span style={소제목}>onComplete 가 돌려줄 답</span>
          {완료답목록.map(([값, 글]) => (
            <button key={값} type="button" style={도구.완료답 === 값 ? 고른단추 : 단추} onClick={() => set완료답(값)}>{글}</button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <button type="button" style={느리게 ? 고른단추 : 단추} onClick={() => set느리게((v) => !v)}>
            {느리게 ? "느린 응답 켬(2.6초)" : "느린 응답 끔"}
          </button>
          <button type="button" style={확인붙임 ? 고른단추 : 단추} onClick={() => set확인붙임((v) => !v)}>
            {확인붙임 ? "checkName 연결됨" : "checkName 없음(미연결 상태 보기)"}
          </button>
          <button type="button" style={단추} onClick={다시열기}>초안을 initialValue 로 다시 열기</button>
        </div>

        <div style={{ display: "grid", gap: 6, minHeight: 0 }}>
          <span style={소제목}>onComplete 로 나간 데이터</span>
          <pre style={코드}>{보낸것 ? JSON.stringify(보낸것, null, 2) : "아직 없음"}</pre>
        </div>

        <div style={{ display: "grid", gap: 6, minHeight: 0 }}>
          <span style={소제목}>onDraftChange 최근 초안</span>
          <pre style={코드}>{초안 ? JSON.stringify(초안, null, 2) : "아직 없음"}</pre>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <span style={소제목}>기록</span>
          {기록.map((줄) => (<span key={줄} style={작은글}>{줄}</span>))}
        </div>
      </aside>
    </div>
  );
}

const 개발판 = {
  width: 320,
  flex: "0 0 auto",
  display: "grid",
  gap: 14,
  alignContent: "start",
  overflowY: "auto",
  padding: 14,
  borderLeft: `1px solid ${색.선}`,
  background: "rgba(255,194,102,0.05)",
};

const 코드 = {
  margin: 0,
  maxHeight: 220,
  overflow: "auto",
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${색.선}`,
  background: "#04070f",
  font: `400 11px/1.5 ${글꼴.모노}`,
  color: 색.흐린글,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

createRoot(document.getElementById("root")).render(<CC미리보기 />);
