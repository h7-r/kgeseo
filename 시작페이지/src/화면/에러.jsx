import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import 무대 from "../무대.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";
import { 글꼴, 글자그라디언트 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   막힌 길 화면 — 404 를 비롯한 여러 상황을 한 틀로 그린다

   원본(피그마 14:2502)은 404 하나뿐이었다. 그런데 실제로 막히는 길은
   404 말고도 여럿이다 — 로그인이 필요해서, 서버가 답을 못 해서,
   점검 중이라서, 인터넷이 끊겨서.
   전부 **같은 틀**로 그린다. 상황마다 다른 화면을 만들면 말투와 돌아가는
   길이 제각각이 되고, 정작 필요한 「여기서 무엇을 하면 되는지」가 흐려진다.

   [무엇을 담나]
   · 무슨 일인지 — 숫자와 한 줄
   · 왜 그런지 — 사람 말로
   · **다음에 뭘 하면 되는지** — 이게 없으면 막다른 길이다

   [말투]
   이 게임은 조사관이 되어 탐험하는 이야기다. 오류 화면도 그 말투를 지킨다
   ("경로를 찾을 수 없습니다" 가 "Not Found" 보다 이 화면에 맞는다).
   다만 **무슨 일이 일어났는지는 분명히** 말한다 — 분위기 때문에 상황을
   흐리면 안 된다.
   ═══════════════════════════════════════════════════════ */

export const 막힌길 = {
  404: {
    숫자: "404",
    제목: "미션 경로를 찾을 수 없습니다",
    설명: "이 구역은 잠겨 있거나 존재하지 않는 경로입니다. 주소를 다시 확인해 주세요.",
    단추: { 글: "본부로 복귀하기", 길: "/" },
  },
  403: {
    숫자: "403",
    제목: "조사관 인증이 필요합니다",
    설명: "이 구역은 등록된 조사관만 들어갈 수 있습니다. 로그인한 뒤 다시 시도해 주세요.",
    단추: { 글: "로그인하러 가기", 길: "/로그인" },
    곁들임: { 글: "아직 계정이 없다면 회원가입", 길: "/회원가입" },
  },
  500: {
    숫자: "500",
    제목: "본부와 연결이 끊겼습니다",
    설명: "서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요. 계속된다면 고객센터로 알려 주세요.",
    단추: { 글: "다시 시도하기", 되돌리기: true },
    곁들임: { 글: "고객센터에 알리기", 길: "/고객센터" },
  },
  503: {
    숫자: "503",
    제목: "점검 중입니다",
    설명: "더 나은 탐험을 위해 잠시 문을 닫았습니다. 점검이 끝나면 바로 열립니다.",
    단추: { 글: "공지 확인하기", 길: "/고객센터" },
  },
  오프라인: {
    숫자: "﹖",
    제목: "인터넷에 연결되어 있지 않습니다",
    설명: "네트워크 연결을 확인한 뒤 다시 시도해 주세요. 연결되면 이 화면이 저절로 사라집니다.",
    단추: { 글: "다시 시도하기", 되돌리기: true },
  },
};

export default function 에러({ 종류 = "404" }) {
  const 가기 = useNavigate();
  const ㅁ = 막힌길[종류] ?? 막힌길[404];

  /* 인터넷이 돌아오면 「오프라인」 화면은 스스로 물러난다.
     사람이 새로고침을 떠올리지 않아도 되게. */
  const [온라인, set온라인] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    if (종류 !== "오프라인") return undefined;
    const 켜짐 = () => set온라인(true);
    window.addEventListener("online", 켜짐);
    return () => window.removeEventListener("online", 켜짐);
  }, [종류]);

  const 누르기 = () => {
    if (ㅁ.단추.되돌리기) window.location.reload();
    /* 403(로그인 필요) → 로그인한 뒤 **지금 이 화면으로** 돌아오게 주소를 실어 보낸다 */
    else if (종류 === "403") 가기(`${ㅁ.단추.길}?다음=${encodeURIComponent(decodeURIComponent(window.location.pathname))}`);
    else 가기(ㅁ.단추.길);
  };

  return (
    <무대 높이={900}>
      <div style={가운데} data-node-id="14:2502">
        <div style={숫자}>{ㅁ.숫자}</div>
        <div style={{ fontFamily: 글꼴.제목, fontSize: "48px", color: "#f1f1fc", whiteSpace: "nowrap" }}>{ㅁ.제목}</div>
        <div style={{ fontFamily: 글꼴.읽기, fontWeight: 400, fontSize: "18px", lineHeight: 1.75, color: "#96a3b6", textAlign: "center", maxWidth: "620px" }}>
          {ㅁ.설명}
        </div>

        {종류 === "오프라인" && 온라인 && (
          <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#4ade80" }}>연결이 돌아왔습니다. 다시 시도해 주세요.</div>
        )}

        <div>
          <button type="button" className="단추" style={복귀단추} onClick={누르기}>
            <span className="단추글">{ㅁ.단추.글}</span>
          </button>
        </div>

        <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
          <button type="button" className="링크" style={곁단추} onClick={() => window.history.back()}>
            이전 구역으로 돌아가기
          </button>
          {ㅁ.곁들임 && (
            <>
              <span style={{ color: "#6f86bf" }}>·</span>
              <button type="button" className="링크" style={곁단추} onClick={() => 가기(ㅁ.곁들임.길)}>
                {ㅁ.곁들임.글}
              </button>
            </>
          )}
        </div>
      </div>
      <하위푸터 />
    </무대>
  );
}

/* [왜 top 을 50% 로 안 쓰나]
   무대가 내용 높이에 맞춰 줄어드는데, 50% 는 그 높이를 기준으로 하니
   서로 물려서 조금씩 위로 말려 올라간다. 고정 좌표로 못 박는다. */
const 가운데 = {
  position: "absolute",
  left: "50%",
  top: "240px",
  transform: "translateX(-50%)",
  width: "760px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  alignItems: "center",
};

const 숫자 = {
  fontFamily: 글꼴.제목,
  fontSize: "160px",
  lineHeight: 1,
  letterSpacing: "4px",
  ...글자그라디언트("linear-gradient(90deg, #3b5ea2 0%, #2e4889 50%, #2f3e70 100%)"),
};

const 복귀단추 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 36px",
  borderRadius: "100px",
  border: "none",
  backgroundImage: "linear-gradient(140deg, rgb(47,66,123) 0%, rgb(47,62,112) 50%, rgb(44,56,99) 100%)",
  boxShadow: "0px 0px 48px 0px rgba(50,82,150,0.25), 0px 4px 20px 0px rgba(46,72,137,0.45)",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "18px",
  color: "#ffffff",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const 곁단추 = {
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  color: "#8b93a3",
  cursor: "pointer",
};
