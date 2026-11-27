/**
 * 11/20 웹 재점검의 「결정 없이 고칠 것」(11/25) — 되살아나지 않게 본다.
 * - 마이페이지 마지막 저장 시각: 서버의 시간대 없는 UTC 를 UTC 로 읽는다(9시간 이르게 보이던 것)
 * - 검색 결과가 고객센터 · 마이페이지의 그 탭으로 간다
 * - 점검 중에도 고객센터(공지) · 약관은 열린다, 관리자 점검 문구를 점검 화면이 보인다
 * - 문의 제목 100자 · 내용 4000자를 접수 전에 알린다
 * - 휴대폰 고객센터에 문의 양식 · 공지 본문 · 내 문의 답변이 있다
 *
 *   npm run web:test
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../website", import.meta.url));
const server = await createServer({
  root,
  configFile: `${root}/vite.config.ts`,
  server: { middlewareMode: true, hmr: false },
  logLevel: "silent",
});
after(() => server.close());
const read = (path) => readFileSync(new URL(`../../website/src/${path}`, import.meta.url), "utf8");

const { summarizeMyProgress } = await server.ssrLoadModule("/src/lib/myProgress.ts");
const { searchSite } = await server.ssrLoadModule("/src/lib/searchIndex.ts");
const { RULES } = await server.ssrLoadModule("/src/lib/validation.ts");

test("마지막 저장 시각은 서버 UTC 그대로(현지 시각으로 읽지 않는다)", () => {
  const progress = summarizeMyProgress(
    { stage: "tutorial", state: {}, updated_at: "2026-11-20T05:10:00.123456" },
    [],
    null,
  );
  assert.equal(progress.savedAt.toISOString(), "2026-11-20T05:10:00.123Z");
  const broken = summarizeMyProgress({ stage: "tutorial", state: {}, updated_at: "not-a-date" }, [], null);
  assert.equal(broken.savedAt, null);
});

test("검색 결과는 그 탭으로 간다", () => {
  const paths = (query) => searchSite(query).map((result) => String(result.path));
  assert.ok(paths("1:1 문의").some((path) => path.includes("/support") && path.includes("tab=inquiry")));
  assert.ok(paths("자주 묻는 질문").some((path) => path.includes("tab=faq")));
  assert.ok(paths("내 문의").some((path) => path.includes("/mypage") && path.includes("tab=inquiries")));
});

test("점검 중에도 고객센터 · 약관은 열리고, 점검 화면은 관리자 문구를 보인다", () => {
  const status = read("services/siteStatus.ts");
  assert.match(status, /OPEN_DURING_MAINTENANCE[^=]*=\s*\[ROUTES\.maintenance, ROUTES\.support, ROUTES\.terms\]/);
  assert.match(status, /OPEN_DURING_MAINTENANCE\.includes\(pathname\)/);
  const errorPage = read("pages/ErrorPage.tsx");
  assert.match(errorPage, /useMaintenanceMessage\(kind === "503"\)/);
  assert.match(errorPage, /<h1/);
});

test("문의 제목 100자 · 내용 4000자", () => {
  assert.equal(RULES.title("가".repeat(100)), "");
  assert.match(RULES.title("가".repeat(101)), /100자/);
  assert.equal(RULES.content("가".repeat(4000)), "");
  assert.match(RULES.content("가".repeat(4001)), /4000자/);
});

test("휴대폰 고객센터 — 문의 양식 · 공지 본문 · 내 문의 답변", () => {
  const mobile = read("mobile/MobilePages.tsx");
  assert.doesNotMatch(mobile, /1:1 문의 접수 화면을 준비하고 있습니다/);
  assert.match(mobile, /<MobileInquiryForm \/>/);
  assert.match(mobile, /fetchNoticeDetail\(notice\.id\)/);
  assert.match(mobile, /공지 더 보기/);
  assert.match(mobile, /inquiry\.replies/);
  // 휴대폰과 데스크톱이 같은 접수 훅을 쓴다
  assert.match(read("mobile/MobileInquiryForm.tsx"), /useInquiryForm\(\)/);
  assert.match(read("sections/support/InquiryPanel.tsx"), /useInquiryForm\(\)/);
});

test("링크 미리보기 · 검색엔진 파일 · 푸터 약관 링크", () => {
  const html = readFileSync(new URL("../../website/index.html", import.meta.url), "utf8");
  for (const tag of ["og:title", "og:description", "og:image", "og:url", "twitter:card"])
    assert.match(html, new RegExp(tag));
  assert.match(html, /content="https:\/\/www\.k-escape\.com\/og-image\.jpg"/);
  const robots = readFileSync(new URL("../../website/public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Sitemap: https:\/\/www\.k-escape\.com\/sitemap\.xml/);
  const sitemap = readFileSync(new URL("../../website/public/sitemap.xml", import.meta.url), "utf8");
  assert.match(sitemap, /<loc>https:\/\/www\.k-escape\.com\/about<\/loc>/);
  assert.doesNotMatch(sitemap, /mypage|admin/);
  const routes = read("navigation/routes.ts");
  assert.match(
    routes,
    /label: "개인정보처리방침", target: withQuery\(ROUTES\.terms, \{ \[QUERY\.tab\]: "privacy" \}\)/,
  );
});

test("검토 반영 — 홈 푸터는 그대로, 공지 중복 거르기, 접수 끄기 스위치 공유, 점검 문구는 503 에서만", () => {
  assert.match(read("layout/Footer.tsx"), /FOOTER_LINKS\.map/);
  assert.doesNotMatch(read("layout/Footer.tsx"), /PAGE_FOOTER_LINKS/);
  assert.match(read("layout/PageFooter.tsx"), /PAGE_FOOTER_LINKS\.map/);
  assert.match(read("mobile/MobileFooter.tsx"), /PAGE_FOOTER_LINKS\.map/);
  const mobile = read("mobile/MobilePages.tsx");
  assert.match(mobile, /!seen\.has\(notice\.id\)/);
  assert.match(mobile, /IS_INQUIRY_API_READY \?/);
  assert.match(mobile, /body \?\? \(isFailed/);
  assert.doesNotMatch(read("sections/support/InquiryPanel.tsx"), /const IS_INQUIRY_API_READY/);
  assert.match(read("pages/ErrorPage.tsx"), /useMaintenanceMessage\(kind === "503"\)/);
});
