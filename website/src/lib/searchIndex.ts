import { ABOUT_CONTENT, ABOUT_TABS } from "@/data/about";
import { MY_PAGE_CONTENT, MY_PAGE_TABS } from "@/data/myPage";
import { PRICING } from "@/data/pricing";
import { FAQ_ITEMS, NOTICES } from "@/data/support";
import { TERMS_CONTENT, TERMS_TABS } from "@/data/terms";
import { QUERY, ROUTES, withQuery, type NavTarget } from "@/navigation/routes";

/**
 * 사이트 검색 색인. 검색용으로 글을 따로 베껴 두면 언젠가 본문과 어긋나므로
 * 화면이 쓰는 데이터 파일을 그대로 읽어 만든다. 글이 수천 줄뿐이라 브라우저에서 훑어도 충분히 빠르다.
 */
export interface SearchResult {
  title: string;
  /** 결과 옆에 붙는 구역 이름(소개 · 약관 …) */
  section: string;
  path: NavTarget;
  /** 맞은 자리 앞뒤를 자른 본문 */
  snippet: string;
  score: number;
}

interface IndexEntry {
  title: string;
  section: string;
  path: NavTarget;
  body: string;
  lowerTitle: string;
  lowerBody: string;
}

// 글이 아닌 칸. kind 는 약관 조각의 종류 표시, icon 은 그림 주소라 검색 본문에 넣지 않는다.
const NON_TEXT_KEYS = new Set(["kind", "icon"]);

/** 글 묶음을 한 줄 문자열로 편다. */
function flatten(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !NON_TEXT_KEYS.has(key))
      .map(([, v]) => flatten(v))
      .join(" ");
  }
  return "";
}

function entry(title: string, section: string, path: NavTarget, content: unknown): IndexEntry {
  const body = flatten(content).replace(/\s+/g, " ").trim();
  return { title, section, path, body, lowerTitle: title.toLowerCase(), lowerBody: body.toLowerCase() };
}

let cachedIndex: IndexEntry[] | null = null;

function buildIndex(): IndexEntry[] {
  if (cachedIndex) return cachedIndex;

  const entries = [
    entry("홈", "홈", ROUTES.home, [
      "ESCAPE THE LEGEND 지역 전설 방탈출 어드벤처",
      "각 지역의 역사와 설화를 바탕으로 만들어진 몰입형 방탈출 게임",
      "전국 방탈출 맵 역사 설화 퀘스트 숨겨진 보상",
      "지역을 선택하세요 경주 나주 목포 여수 순천 앙암바위 갓바위 거북선 이순신 순천만",
      "SECRET OF ANGAM 앙암바위의 비밀 미션 시작하기",
    ]),
    entry("회원가입", "인증", ROUTES.signup, "회원가입 닉네임 지역 이메일 비밀번호 약관 동의 만 14세"),
    entry("로그인", "인증", ROUTES.login, "로그인 이메일 비밀번호 간편 로그인 구글 네이버"),
    entry("비밀번호 찾기", "인증", ROUTES.forgotPassword, "비밀번호 찾기 재설정 링크 인증코드"),
    entry("영상 · 캐릭터", "컬렉션", ROUTES.media, [
      "게임 영상 챌린지 탈출의 시작 암호 해독 챌린지 최후의 대결 지워진 기록 복원 멈춘 시계 탈출",
      "캐릭터 소개 한서진 프로파일러 강민혁 보안 전문가 윤하은 암호 해독가",
      "몰입감 넘치는 게임 경험 실시간 3D 탐험",
    ]),
  ];

  for (const tab of ABOUT_TABS) {
    entries.push(entry(`게임 소개 · ${tab.label}`, "소개", ROUTES.about, ABOUT_CONTENT[tab.id]));
  }

  for (const tab of TERMS_TABS) {
    entries.push(
      entry(`약관 · ${tab.label}`, "약관", withQuery(ROUTES.terms, { [QUERY.tab]: tab.id }), TERMS_CONTENT[tab.id]),
    );
  }

  entries.push(
    entry("고객센터 · 공지사항", "고객센터", ROUTES.support, NOTICES),
    entry("고객센터 · 자주 묻는 질문", "고객센터", ROUTES.support, FAQ_ITEMS),
    entry(
      "고객센터 · 1:1 문의",
      "고객센터",
      ROUTES.support,
      "1:1 문의하기 문의 유형 제목 내용 첨부파일 운영 시간 평일 10:00 18:00",
    ),
  );

  entries.push(
    entry("구독 · 플랜 비교", "구독", ROUTES.pricing, PRICING.plans),
    entry("구독 · 결제 정보", "구독", ROUTES.pricing, PRICING.paymentBoxes),
    entry("구독 · 혜택 안내", "구독", ROUTES.pricing, [
      PRICING.benefitsTitle,
      PRICING.benefitsIntro,
      PRICING.benefitPoints,
      PRICING.rotatingBenefits,
    ]),
  );

  for (const tab of MY_PAGE_TABS) {
    entries.push(entry(`마이페이지 · ${tab.label}`, "마이페이지", ROUTES.myPage, MY_PAGE_CONTENT[tab.id]));
  }

  cachedIndex = entries;
  return entries;
}

/** 맞은 자리 앞뒤를 잘라 온다. 어디가 맞았는지 보여야 고를 수 있다. */
function makeSnippet(body: string, lowerBody: string, query: string, length = 84): string {
  const at = lowerBody.indexOf(query);
  if (at < 0) return body.slice(0, length) + (body.length > length ? "…" : "");
  const start = Math.max(0, at - Math.floor(length / 3));
  const end = Math.min(body.length, start + length);
  return (start > 0 ? "…" : "") + body.slice(start, end).trim() + (end < body.length ? "…" : "");
}

/**
 * 대소문자·앞뒤 공백을 무시하고 찾는다. 점수 높은 순.
 * 제목에서 맞으면 그 화면 자체를 찾는 경우가 많아 위로 올리고, 본문은 다섯 번까지 맞은 횟수를 센다.
 */
export function search(query: string | null | undefined, limit = 20): SearchResult[] {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (needle.length < 1) return [];

  const results: SearchResult[] = [];
  for (const item of buildIndex()) {
    const titleMatched = item.lowerTitle.includes(needle);
    const bodyMatched = item.lowerBody.includes(needle);
    if (!titleMatched && !bodyMatched) continue;

    const count = bodyMatched ? Math.min(5, item.lowerBody.split(needle).length - 1) : 0;
    results.push({
      title: item.title,
      section: item.section,
      path: item.path,
      snippet: makeSnippet(item.body, item.lowerBody, needle),
      score: (titleMatched ? 100 : 0) + count * 6,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
