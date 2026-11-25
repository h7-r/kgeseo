/**
 * 구독 화면 기획 예시 안내 — 「구독하기」 창 맨 위(휴대폰은 구독 화면 맨 위) 한 곳에서 「실제 결제가 아니다」를 알리는지 본다.
 * 곳곳에 붙던 안내 상자는 한 곳으로 모았다(해랑 11/25).
 * 약관 제12조 ⑦ · 법적 고지 제15조 ③ 은 요금 화면을 「기획 예시」라고 적는다. 화면이 그 말을 빠뜨리면 유료 서비스로 오해한다(11/19 점검).
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const count = (text, pattern) => text.match(pattern)?.length ?? 0;

test("안내 문장이 기획 예시 · 결제 없음 · 바뀔 수 있음을 말한다", () => {
  const notice = read("website/src/data/pricing.ts").match(/exampleNotice:\s*"([^"]+)"/);
  assert.ok(notice, "PRICING.exampleNotice 를 찾지 못했다");
  assert.match(notice[1], /기획 예시안/);
  assert.match(notice[1], /실제 결제는 이루어지지 않/);
  assert.match(notice[1], /추후 변경될 수 있습니다/);
});

test("약관도 요금 화면을 같은 말(0원 · 기획 예시)로 적는다", () => {
  const terms = read("website/src/data/terms.ts");
  assert.match(terms, /이용료는 \*\*0원\*\*/);
  assert.match(terms, /기획 단계의 예시 화면/);
  assert.match(terms, /가격·혜택은 서비스 기획 예시/);
});

test("안내는 「구독하기」 창과 휴대폰 구독 맨 위, 한 곳씩에만 있다", () => {
  const plans = read("website/src/sections/pricing/PricingPlans.tsx");
  assert.equal(count(plans, /PRICING\.exampleNotice/g), 1, "구독하기 창");
  assert.match(plans, /description=\{PRICING\.exampleNotice\}/, "구독하기 창 제목 바로 아래");
  assert.equal(count(read("website/src/mobile/MobilePages.tsx"), /PRICING\.exampleNotice/g), 1, "휴대폰 맨 위");
  for (const file of ["BenefitsBlock", "PlanDetailModal", "PaymentDetailModal", "BlockHeader"]) {
    assert.doesNotMatch(read(`website/src/sections/pricing/${file}.tsx`), /exampleNotice|TrialNotice/, file);
  }
});

test("환불 상자의 청약철회 환급 기한이 약관 제8조 ④(3영업일)와 같다", () => {
  assert.match(read("website/src/data/terms.ts"), /\*\*3영업일 이내\*\*에 결제수단과 동일한 방법으로 환급/);
  assert.match(read("website/src/data/pricing.ts"), /"7일 안 · 혜택 미사용 시 전액 환불 \(3영업일 안\)"/);
});

test("모서리 꺾쇠 토큰(CORNER_BRACKETS)이 되살아나지 않는다", () => {
  assert.doesNotMatch(read("website/src/styles/tokens.ts"), /CORNER_BRACKETS/);
  assert.doesNotMatch(read("website/src/sections/media/MediaHero.tsx"), /CORNER_BRACKETS|cornerMark/);
});
