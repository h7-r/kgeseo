/**
 * 구독 화면 시험운영 안내 — 요금표 · 결제 정보 · 혜택 머리, 구독 · 자세히 보기 창, 휴대폰 화면이 「결제가 없다」를 늘 알리는지 본다.
 * 약관 제12조 ⑦ · 법적 고지 제15조 ③ 은 요금 화면을 「기획 예시」라고 적는다. 화면이 그 말을 빠뜨리면 유료 서비스로 오해한다(11/19 점검).
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const count = (text, pattern) => text.match(pattern)?.length ?? 0;

test("안내 글이 0원 · 결제 없음 · 기획 예시를 모두 말한다", () => {
  const notice = read("website/src/data/pricing.ts").match(/trialNotice: \{\s*label: "([^"]+)",\s*detail: "([^"]+)"/);
  assert.ok(notice, "PRICING.trialNotice 를 찾지 못했다");
  const [, label, detail] = notice;
  assert.match(label, /시험운영/);
  assert.match(label, /0원/);
  assert.match(detail, /결제·구독을 받지 않습니다/);
  assert.match(detail, /기획 예시/);
});

test("약관도 요금 화면을 같은 말(0원 · 기획 예시)로 적는다", () => {
  const terms = read("website/src/data/terms.ts");
  assert.match(terms, /이용료는 \*\*0원\*\*/);
  assert.match(terms, /기획 단계의 예시 화면/);
  assert.match(terms, /가격·혜택은 서비스 기획 예시/);
});

test("데스크톱 세 덩이 머리 · 구독 창 · 두 자세히 보기 창 · 휴대폰에 안내가 붙는다", () => {
  const plans = read("website/src/sections/pricing/PricingPlans.tsx");
  assert.equal(count(plans, /aside=\{<TrialNotice /g), 2, "요금표 · 결제 정보 머리");
  assert.equal(count(plans, /<TrialNotice \/>/g), 1, "구독하기 창");
  assert.equal(count(read("website/src/sections/pricing/BenefitsBlock.tsx"), /aside=\{<TrialNotice /g), 1, "혜택 머리");
  for (const modal of ["PlanDetailModal", "PaymentDetailModal"]) {
    assert.equal(count(read(`website/src/sections/pricing/${modal}.tsx`), /<TrialNotice \/>/g), 1, modal);
  }
  assert.equal(count(read("website/src/mobile/MobilePages.tsx"), /<TrialNotice /g), 2, "휴대폰 맨 위 · 혜택");
});

test("환불 상자의 청약철회 환급 기한이 약관 제8조 ④(3영업일)와 같다", () => {
  assert.match(read("website/src/data/terms.ts"), /\*\*3영업일 이내\*\*에 결제수단과 동일한 방법으로 환급/);
  assert.match(read("website/src/data/pricing.ts"), /"7일 안 · 혜택 미사용 시 전액 환불 \(3영업일 안\)"/);
});

test("모서리 꺾쇠 토큰(CORNER_BRACKETS)이 되살아나지 않는다", () => {
  assert.doesNotMatch(read("website/src/styles/tokens.ts"), /CORNER_BRACKETS/);
  assert.doesNotMatch(read("website/src/sections/media/MediaHero.tsx"), /CORNER_BRACKETS|cornerMark/);
});
