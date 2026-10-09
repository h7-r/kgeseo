import { useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import Stage from "@/components/Stage";
import { submitOnEnter } from "@/hooks/useForm";
import PageFooter from "@/layout/PageFooter";
import { searchSite } from "@/lib/searchIndex";
import { FONT, gradientText, type CSSVars } from "@/lib/style";
import { QUERY, useSiteNavigate } from "@/navigation/routes";
import { COLOR, GRADIENT } from "@/styles/tokens";

const POPULAR_QUERIES = ["앙암바위", "나주", "구독", "환불", "비밀번호", "조작법", "개인정보"];

/**
 * 찾기 결과. 검색어를 주소(?q=)에 담아 결과를 공유하고 뒤로 가기로 이전 검색에 돌아올 수 있게 한다.
 * 결과가 없어도 막다른 길이 되지 않게 다시 찾기와 자주 찾는 말을 함께 준다.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useSiteNavigate();
  const query = params.get(QUERY.search) ?? "";
  const [draft, setDraft] = useState(query);
  // 머리띠에서 다시 찾거나 뒤로 가서 주소의 검색어가 바뀌면 입력 줄도 따라간다.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    setDraft(query);
  }

  const results = useMemo(() => searchSite(query), [query]);

  const runSearch = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setParams({ [QUERY.search]: trimmed });
    setDraft(trimmed);
  };

  return (
    <Stage height={1000}>
      <section style={rootStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <span style={eyebrowStyle}>SEARCH</span>
          <div style={titleStyle}>찾기</div>
        </div>

        <div style={searchRowStyle}>
          <input
            className="text-input"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={submitOnEnter(() => runSearch(draft))}
            placeholder="무엇을 찾으세요?"
            aria-label="다시 찾기"
            style={searchInputStyle}
          />
          <button type="button" className="button" style={searchButtonStyle} onClick={() => runSearch(draft)}>
            <span className="button__label">찾기</span>
          </button>
        </div>

        {query && (
          <div style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textMuted }}>
            <b style={{ color: COLOR.accent }}>{query}</b> 에 대한 결과 {results.length}건
          </div>
        )}

        {query && results.length === 0 && (
          <div style={emptyStyle}>
            <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "20px", color: COLOR.textBright }}>
              찾는 내용이 없습니다
            </div>
            <div style={{ fontFamily: FONT.reading, fontSize: "16px", lineHeight: 1.7, color: COLOR.textMuted }}>
              맞춤법을 확인하거나 더 짧은 말로 찾아 보세요. 아직 만들지 않은 화면일 수도 있습니다.
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {results.map((result, i) => (
              <button
                key={`${result.path}-${i}`}
                type="button"
                className="interactive-row"
                style={resultRowStyle}
                onClick={() => navigate(result.path)}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
                  <span style={sectionTagStyle}>{result.section}</span>
                  <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "18px", color: COLOR.textBright }}>
                    {result.title}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: FONT.reading,
                    fontSize: "16px",
                    lineHeight: 1.65,
                    color: COLOR.textMuted,
                    textAlign: "left",
                  }}
                >
                  {result.snippet}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", paddingTop: "8px" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textSubtle }}>자주 찾는 말</span>
          {POPULAR_QUERIES.map((word) => (
            <button
              key={word}
              type="button"
              className="tab-button"
              style={popularButtonStyle}
              onClick={() => runSearch(word)}
            >
              {word}
            </button>
          ))}
        </div>
      </section>
      <PageFooter />
    </Stage>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "253px",
  transform: "translateX(-50%)",
  width: "1200px",
  display: "flex",
  flexDirection: "column",
  gap: "26px",
};

const eyebrowStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.accent,
  letterSpacing: "2.5px",
};

const titleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "56px",
  lineHeight: 1.15,
  ...gradientText(GRADIENT.titleFrost),
};

const searchRowStyle: CSSProperties = {
  display: "flex",
  gap: "14px",
  alignItems: "center",
  borderBottom: "1px solid rgba(50,82,150,0.28)",
  paddingBottom: "12px",
};

const searchInputStyle: CSSVars = {
  fontFamily: FONT.mono,
  fontSize: "18px",
  "--placeholder-color": COLOR.textDim,
};

const searchButtonStyle: CSSProperties = {
  flexShrink: 0,
  padding: "10px 24px",
  borderRadius: "999px",
  backgroundImage: "linear-gradient(140deg, rgb(47,66,123) 0%, rgb(47,62,112) 100%)",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.white,
  cursor: "pointer",
};

const resultRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  width: "100%",
  padding: "18px 22px",
  borderRadius: "12px",
  background: "#090f20",
  border: `1px solid ${COLOR.border}`,
  cursor: "pointer",
  textAlign: "left",
};

const sectionTagStyle: CSSProperties = {
  flexShrink: 0,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "15px",
  color: COLOR.accent,
  padding: "3px 9px",
  borderRadius: "999px",
  border: "1px solid rgba(50,82,150,0.35)",
  whiteSpace: "nowrap",
};

const emptyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "34px",
  borderRadius: "16px",
  background: "rgba(5,11,26,0.6)",
  border: `1px solid ${COLOR.border}`,
};

const popularButtonStyle: CSSProperties = {
  padding: "7px 15px",
  borderRadius: "999px",
  background: "#090f20",
  border: `1px solid ${COLOR.border}`,
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.textMuted,
  cursor: "pointer",
};
