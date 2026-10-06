import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Naver콜백으로로그인 } from "../naver-auth.js";
import { 들어가기 } from "../로그인상태.js";
import { 글꼴 } from "../공통.js";

export default function SocialCallback() {
  const [검색] = useSearchParams();
  const 가기 = useNavigate();
  const [말, set말] = useState("Naver 로그인 확인 중…");

  useEffect(() => {
    let 살아있음 = true;
    Naver콜백으로로그인(검색)
      .then((사람) => {
        if (!살아있음) return;
        들어가기(사람);
        가기("/", { replace: true });
      })
      .catch((오류) => {
        if (!살아있음) return;
        set말(오류.message || "Naver 로그인에 실패했습니다.");
      });
    return () => {
      살아있음 = false;
    };
  }, [검색, 가기]);

  return (
    <main style={틀}>
      <section style={상자}>
        <h1 style={제목}>로그인</h1>
        <p style={본문}>{말}</p>
        {말 !== "Naver 로그인 확인 중…" && (
          <button type="button" style={단추} onClick={() => 가기("/로그인", { replace: true })}>
            로그인으로 돌아가기
          </button>
        )}
      </section>
    </main>
  );
}

const 틀 = {
  minHeight: "70vh",
  display: "grid",
  placeItems: "center",
  padding: "140px 24px 80px",
  boxSizing: "border-box",
};

const 상자 = {
  width: "min(460px, 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "18px",
  textAlign: "center",
};

const 제목 = {
  margin: 0,
  fontFamily: 글꼴.넓게,
  fontSize: "34px",
  color: "#f1f1fc",
};

const 본문 = {
  margin: 0,
  fontFamily: 글꼴.본문,
  fontSize: "18px",
  lineHeight: 1.6,
  color: "#96a3b6",
};

const 단추 = {
  border: "1px solid rgba(111,134,191,0.55)",
  borderRadius: "999px",
  padding: "12px 20px",
  background: "rgba(50,82,150,0.14)",
  color: "#f1f1fc",
  fontFamily: 글꼴.모노,
  fontSize: "15px",
  cursor: "pointer",
};
