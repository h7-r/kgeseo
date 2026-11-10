/**
 * 하위 페이지 모바일판 — 약관 · 소개 · 컬렉션 · 구독 · 고객센터 · 마이페이지 · 검색.
 * 데스크톱판은 1920 무대 좌표로 짜여 있어 그대로 줄이면 글자가 3~7px 가 된다. 같은 데이터(data/*)를 한 단으로 다시 엮는다.
 * 탭은 주소(?tab=)에 두는 데스크톱과 같은 훅(useQueryTab)을 쓴다 — 링크 · 뒤로 가기가 그대로 맞는다.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { ABOUT_CONTENT, ABOUT_TABS } from "@/data/about";
import { MY_PAGE_CONTENT, MY_PAGE_TABS } from "@/data/myPage";
import type { MyProgress } from "@/lib/myProgress";
import { useMyProgress } from "@/sections/myPage/useMyProgress";
import type { InquiryRecord } from "@/services/account/db";
import { readAccountData } from "@/services/account/manageAccount";
import { PRICING } from "@/data/pricing";
import { useActiveTabInView } from "@/components/useActiveTabInView";
import { FAQ_ITEMS, NOTICES, SUPPORT_TABS } from "@/data/support";
import { TERMS_TABS } from "@/data/terms";
import { GAMEPLAY_VIDEOS, VIDEOS, type Video } from "@/data/videos";
import { useQueryTab } from "@/hooks/useQueryTab";
import { searchSite } from "@/lib/searchIndex";
import { FONT } from "@/lib/style";
import { QUERY, ROUTES, START_GAME, useSiteNavigate } from "@/navigation/routes";
import TermsTabs from "@/sections/terms/TermsTabs";
import { signOut, useSessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

import MobilePage from "./MobilePage";
import {
  bodyTextStyle,
  cardStyle,
  eyebrowStyle,
  headingStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionStyle,
} from "./mobileStyles";

// ── 공용 조각 ──

function PageHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ paddingTop: 24 }}>
      <p style={eyebrowStyle}>{eyebrow}</p>
      <h1 style={headingStyle}>{title}</h1>
    </div>
  );
}

/** 옆으로 밀리는 탭 줄 — 누르는 곳 44px */
function Tabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: readonly { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useActiveTabInView(listRef, active);
  return (
    <div ref={listRef} role="tablist" style={tabRowStyle}>
      {items.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={id === active}
          style={{ ...tabStyle, ...(id === active ? activeTabStyle : null) }}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** 눌렀을 때만 받는 기본 플레이어 — 기기 전체 화면 · 소리 조절이 그대로 된다 */
function InlineVideo({ video, caption }: { video: Video; caption?: string }) {
  return (
    <figure style={{ margin: "16px 0 0" }}>
      <video src={video.src} poster={video.poster} controls playsInline preload="none" style={videoStyle} />
      <figcaption style={captionStyle}>{caption ?? video.title}</figcaption>
    </figure>
  );
}

function Rows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl style={{ margin: "16px 0 0", display: "grid", gap: 10 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ ...cardStyle, padding: "12px 14px" }}>
          <dt style={{ fontFamily: FONT.mono, fontSize: "12px", color: COLOR.accent }}>{label}</dt>
          <dd
            style={{
              margin: "4px 0 0",
              fontFamily: FONT.body,
              fontSize: "15px",
              lineHeight: 1.55,
              color: COLOR.textBright,
            }}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <MobilePage>
      <div style={sectionStyle}>{children}</div>
    </MobilePage>
  );
}

// ── 약관 ──

export function MobileTermsPage() {
  const [tab, setTab] = useQueryTab(TERMS_TABS, "terms");
  return (
    <Shell>
      <PageHeading eyebrow="Brand · Policy" title="약관 및 정책" />
      <div style={{ marginTop: 16 }}>
        <TermsTabs tab={tab} top={0} onTabChange={setTab} isFlow />
      </div>
    </Shell>
  );
}

// ── 게임 소개 ──

/** 휴대폰 조작 — 데스크톱 「조작법」 탭의 키보드 줄 대신 */
const TOUCH_CONTROL_ROWS = [
  ["시작", "「화면을 눌러 시작」 — 휴대폰을 가로로 돌려 플레이합니다"],
  ["이동", "화면 왼쪽을 엄지로 밀기 — 끝까지 밀면 달리기"],
  ["시점", "화면 오른쪽을 끌어 둘러보기 · 「시점」 단추로 1인칭 ↔ 3인칭(복도 · 본부실)"],
  ["점프 · 앉기", "오른쪽 아래 「점프」 · 「앉기」 단추"],
  ["상호작용", "✋ — 조사하기 · 집기 · 내려놓기 · 퍼즐 조작(길게 누르기도 됨)"],
  ["창", "🎒 소지품 · 💡 힌트 · ⚙ 설정 · Ⅱ 멈춤"],
] as const;

export function MobileAboutPage() {
  const [tab, setTab] = useQueryTab(ABOUT_TABS, "overview");
  const content = ABOUT_CONTENT[tab];
  return (
    <Shell>
      <PageHeading eyebrow="About" title="게임 소개" />
      <Tabs items={ABOUT_TABS} active={tab} onSelect={setTab} />
      {tab === "controls" && (
        <>
          <h2 style={subheadingStyle}>휴대폰</h2>
          <Rows rows={TOUCH_CONTROL_ROWS} />
          <h2 style={subheadingStyle}>PC</h2>
        </>
      )}
      <Rows rows={content.rows} />
      <InlineVideo video={content.video} caption={content.videoCaption} />
      {content.paragraphs.map((paragraph) => (
        <p key={paragraph} style={bodyTextStyle}>
          {paragraph}
        </p>
      ))}
    </Shell>
  );
}

// ── 컬렉션(게임 영상) ──

export function MobileMediaPage() {
  return (
    <Shell>
      <PageHeading eyebrow="Collection" title="게임 영상" />
      <h2 style={subheadingStyle}>나주 · 앙암바위 플레이</h2>
      {Object.values(GAMEPLAY_VIDEOS).map((video) => (
        <InlineVideo key={video.src} video={video} />
      ))}
      <h2 style={subheadingStyle}>다음 지역</h2>
      {Object.values(VIDEOS).map((video) => (
        <InlineVideo key={video.src} video={video} />
      ))}
    </Shell>
  );
}

// ── 구독 ──

export function MobilePricingPage() {
  return (
    <Shell>
      <PageHeading eyebrow="Subscribe" title="구독" />
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {PRICING.plans.map((plan) => (
          <article key={plan.name} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ margin: 0, fontFamily: FONT.display, fontSize: "26px", color: COLOR.textBright }}>
                {plan.name}
              </h2>
              <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: "18px", color: "#7f97d6" }}>
                {plan.price}
              </span>
            </div>
            <p style={{ ...bodyTextStyle, marginTop: 6 }}>{plan.summary}</p>
            <ul style={plainListStyle}>
              {plan.features.map((feature) => (
                <li key={feature}>{feature.replace(/^•\s*/, "")}</li>
              ))}
            </ul>
            {plan.extras.length > 0 && (
              <p style={{ ...bodyTextStyle, fontSize: "13px", color: COLOR.accent }}>{plan.extras.join(" · ")}</p>
            )}
          </article>
        ))}
      </div>
      <h2 style={subheadingStyle}>결제 안내</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {PRICING.paymentBoxes.map((box) => (
          <details key={box.id} style={{ ...cardStyle, padding: "14px 16px" }}>
            <summary style={summaryStyle}>{box.title}</summary>
            <p style={{ ...bodyTextStyle, fontSize: "14px" }}>{box.summary}</p>
            <ul style={plainListStyle}>
              {box.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <h2 style={subheadingStyle}>{PRICING.benefitsTitle}</h2>
      <p style={bodyTextStyle}>{PRICING.benefitsIntro}</p>
      <ul style={plainListStyle}>
        {PRICING.benefitPoints.map((point) => (
          <li key={point.text}>
            {point.text} <span style={{ color: COLOR.textDim }}>{point.note}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

// ── 고객센터 ──

export function MobileSupportPage() {
  const [tab, setTab] = useQueryTab(SUPPORT_TABS, "notices");
  return (
    <Shell>
      <PageHeading eyebrow="Support" title="고객센터" />
      <Tabs items={SUPPORT_TABS} active={tab} onSelect={setTab} />
      {tab === "notices" && (
        <ul style={{ ...plainListStyle, paddingLeft: 0, listStyle: "none", gap: 10 }}>
          {NOTICES.map((notice) => (
            <li key={notice.title} style={{ ...cardStyle, padding: "12px 14px" }}>
              <span style={badgeStyle}>{notice.category}</span>
              <div
                style={{
                  fontFamily: FONT.body,
                  fontSize: "15px",
                  lineHeight: 1.5,
                  color: COLOR.textBright,
                  marginTop: 6,
                }}
              >
                {notice.title}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: "12px", color: COLOR.textDim, marginTop: 4 }}>
                {notice.date}
              </div>
            </li>
          ))}
        </ul>
      )}
      {tab === "faq" && (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} style={{ ...cardStyle, padding: "14px 16px" }}>
              <summary style={summaryStyle}>
                <span style={{ ...badgeStyle, marginRight: 8 }}>{item.category}</span>
                {item.question}
              </summary>
              <p style={{ ...bodyTextStyle, fontSize: "14px" }}>{item.answer ?? "답변을 준비하고 있습니다."}</p>
            </details>
          ))}
        </div>
      )}
      {tab === "inquiry" && (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <p style={{ ...bodyTextStyle, marginTop: 0 }}>
            1:1 문의 기능을 준비하고 있습니다. 급한 문의는 공지사항의 안내를 확인해 주세요.
          </p>
        </div>
      )}
    </Shell>
  );
}

// ── 마이페이지 ──

export function MobileMyPage() {
  const [tab, setTab] = useQueryTab(MY_PAGE_TABS, "history");
  const user = useSessionUser();
  const navigate = useSiteNavigate();
  const content = MY_PAGE_CONTENT;
  // 내 진행 · 업적 · 아이템은 서버의 내 저장본에서(데스크톱과 같은 값)
  const { state: progressState } = useMyProgress(user?.id);
  // 내 문의 — 이 기기에서 이 계정으로 접수한 것(문의 API 전)
  const [inquiries, setInquiries] = useState<InquiryRecord[]>([]);
  useEffect(() => {
    if (!user?.email) return;
    let isActive = true;
    void readAccountData(user.email).then((data) => {
      if (isActive) setInquiries(data?.inquiries ?? []);
    });
    return () => {
      isActive = false;
    };
  }, [user?.email]);
  return (
    <Shell>
      <PageHeading eyebrow="My page" title={user ? `${user.name} 님` : "마이페이지"} />
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" style={primaryButtonStyle} onClick={() => navigate(START_GAME)}>
          이어 하기
        </button>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => {
            signOut();
            navigate(ROUTES.home);
          }}
        >
          로그아웃
        </button>
      </div>
      <Tabs items={MY_PAGE_TABS} active={tab} onSelect={setTab} />
      {(tab === "history" || tab === "achievements" || tab === "items") && (
        <div style={{ marginTop: 16 }}>
          {progressState.status !== "ready" ? (
            <p style={{ ...bodyTextStyle, fontSize: "14px", color: COLOR.textMuted }}>
              {progressState.status === "loading"
                ? "내 기록을 불러오는 중입니다…"
                : progressState.status === "signedOut"
                  ? "로그인이 끝났습니다. 다시 로그인하면 내 기록이 보입니다."
                  : "기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요."}
            </p>
          ) : (
            <MobileProgressRows tab={tab} progress={progressState.progress} />
          )}
        </div>
      )}
      {tab === "inquiries" &&
        (inquiries.length ? (
          <Rows
            rows={inquiries.map(
              (inquiry) =>
                [
                  `${inquiry.type} · ${new Date(inquiry.receivedAt).toLocaleDateString("ko-KR")}`,
                  inquiry.title,
                ] as const,
            )}
          />
        ) : (
          <p style={{ ...bodyTextStyle, fontSize: "14px", color: COLOR.textMuted, marginTop: 16 }}>
            이 기기에서 접수한 문의가 없습니다. 1:1 문의는 PC 고객센터에서 접수할 수 있습니다.
          </p>
        ))}
      {tab === "account" &&
        content.account.groups.map((group) => (
          <section key={group.title}>
            <h2 style={subheadingStyle}>{group.title}</h2>
            {/* 단추 글(변경하기 · ON …)은 동작 · 저장값이 없어 쓸 수 있는 기능처럼 보이지 않게 「준비 중」으로 */}
            <Rows rows={group.items.map((item) => [item.label, "준비 중"] as const)} />
          </section>
        ))}
      {tab === "subscription" && <Rows rows={content.subscription.plan} />}
      <p style={{ ...bodyTextStyle, fontSize: "13px", color: COLOR.textDim }}>
        계정 설정(비밀번호 변경 · 로그인 기록 · 탈퇴 등)은 준비 중입니다.
      </p>
    </Shell>
  );
}

/** 모바일 내 진행 · 업적 · 아이템 — 데스크톱 탭과 같은 요약을 줄로 */
function MobileProgressRows({ tab, progress }: { tab: string; progress: MyProgress }) {
  if (tab === "achievements") {
    return (
      <Rows rows={progress.badges.map((badge) => [badge.name, badge.isEarned ? "획득" : badge.condition] as const)} />
    );
  }
  if (tab === "items") {
    const rows = [
      ...progress.caseItems.map((item) => ["사건 소지품", `${item.name} × ${item.count}`] as const),
      ...progress.ownedItems.map((item) => ["계정 아이템", `${item.name} × ${item.quantity}`] as const),
    ];
    return rows.length ? (
      <Rows rows={rows} />
    ) : (
      <p style={{ ...bodyTextStyle, fontSize: "14px", color: COLOR.textMuted }}>아직 가진 물건이 없습니다.</p>
    );
  }
  const naju = progress.naju;
  return (
    <>
      <Rows
        rows={[
          ["지금 위치", progress.journey.find((step) => step.state === "current")?.name ?? "출발 전"],
          [
            "나주 앙암바위",
            naju ? `${naju.percent}% · ${naju.isCleared ? "해결" : `지금 ${naju.stageName}`}` : "출동 전",
          ],
          ["마지막 저장", progress.savedAt ? progress.savedAt.toLocaleString("ko-KR") : "없음"],
        ]}
      />
      {naju && (
        <>
          <h2 style={subheadingStyle}>스테이지</h2>
          <Rows
            rows={naju.stages.map(
              (stage) => [stage.name, stage.done >= stage.total ? "✓ 완료" : `${stage.done} / ${stage.total}`] as const,
            )}
          />
        </>
      )}
    </>
  );
}

// ── 검색 ──

const POPULAR_QUERIES = ["앙암바위", "나주", "구독", "환불", "비밀번호", "조작법", "개인정보"];

export function MobileSearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useSiteNavigate();
  const query = params.get(QUERY.search) ?? "";
  const [draft, setDraft] = useState(query);
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    setDraft(query);
  }
  const results = useMemo(() => searchSite(query), [query]);
  const run = (next: string) => {
    const trimmed = next.trim();
    if (trimmed) setParams({ [QUERY.search]: trimmed });
  };
  return (
    <Shell>
      <PageHeading eyebrow="Search" title="찾기" />
      <form
        style={{ display: "flex", gap: 8, marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          run(draft);
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="무엇을 찾으세요?"
          aria-label="검색어"
          enterKeyHint="search"
          style={inputStyle}
        />
        <button type="submit" style={primaryButtonStyle}>
          찾기
        </button>
      </form>
      {query && (
        <p style={{ ...bodyTextStyle, fontSize: "14px" }}>
          「{query}」 검색 결과 {results.length}건
        </p>
      )}
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {results.map((result) => (
          <button
            key={`${result.section}-${result.title}`}
            type="button"
            style={{ ...cardStyle, textAlign: "left", cursor: "pointer" }}
            onClick={() => navigate(result.path)}
          >
            <span style={badgeStyle}>{result.section}</span>
            <div
              style={{
                fontFamily: FONT.body,
                fontWeight: 700,
                fontSize: "16px",
                color: COLOR.textBright,
                marginTop: 6,
              }}
            >
              {result.title}
            </div>
            <div
              style={{
                fontFamily: FONT.body,
                fontSize: "14px",
                lineHeight: 1.55,
                color: COLOR.textMuted,
                marginTop: 4,
              }}
            >
              {result.snippet}
            </div>
          </button>
        ))}
      </div>
      {(!query || results.length === 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
          {POPULAR_QUERIES.map((word) => (
            <button
              key={word}
              type="button"
              style={{ ...secondaryButtonStyle, minHeight: 44 }}
              onClick={() => {
                setDraft(word);
                run(word);
              }}
            >
              {word}
            </button>
          ))}
        </div>
      )}
    </Shell>
  );
}

// ── 스타일 ──

const tabRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 18,
  overflowX: "auto",
  paddingBottom: 4,
  WebkitOverflowScrolling: "touch",
};
const tabStyle: CSSProperties = {
  flexShrink: 0,
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 999,
  border: `1px solid ${COLOR.border}`,
  background: COLOR.surface,
  color: COLOR.textMuted,
  fontFamily: FONT.body,
  fontSize: "14px",
  whiteSpace: "nowrap",
  cursor: "pointer",
};
const activeTabStyle: CSSProperties = { background: COLOR.navy, color: COLOR.white, borderColor: COLOR.navy };
const subheadingStyle: CSSProperties = {
  margin: "28px 0 0",
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "18px",
  color: COLOR.textBright,
};
const videoStyle: CSSProperties = { width: "100%", aspectRatio: "16 / 9", borderRadius: 14, background: COLOR.black };
const captionStyle: CSSProperties = { marginTop: 6, fontFamily: FONT.mono, fontSize: "12px", color: COLOR.textSubtle };
const plainListStyle: CSSProperties = {
  margin: "10px 0 0",
  paddingLeft: 18,
  display: "grid",
  gap: 6,
  fontFamily: FONT.body,
  fontSize: "14px",
  lineHeight: 1.55,
  color: COLOR.textMuted,
};
const summaryStyle: CSSProperties = {
  minHeight: 28,
  fontFamily: FONT.body,
  fontWeight: 600,
  fontSize: "15px",
  lineHeight: 1.5,
  color: COLOR.textBright,
  cursor: "pointer",
};
const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  border: `1px solid ${COLOR.border}`,
  fontFamily: FONT.mono,
  fontSize: "12px",
  color: COLOR.textMuted,
};
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 48,
  padding: "0 14px",
  boxSizing: "border-box",
  borderRadius: 12,
  border: `1px solid ${COLOR.border}`,
  background: COLOR.surface,
  color: COLOR.textBright,
  fontFamily: FONT.body,
  fontSize: "16px",
};
