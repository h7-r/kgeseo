// 행동 판단 평가셋 · 지표 검사 (Q 묶음). 평가셋이 온전한지 · 지표 계산이 맞는지만 판정한다.
// 규칙 기준선의 정확도는 **판정하지 않고 측정값으로만** 남긴다(기준선을 평가셋에 맞추지 않게).
import {
  ASSESSMENT_STATES,
  exportBehaviorEvalDataset,
  HELP_ACTIONS,
  runBehaviorEval,
  type BehaviorEvalResult,
} from "../behaviorEval";
import { classificationReport, formatMetric } from "../evalMetrics";
import { createRuleBaselineAssessor } from "../npcAssessment";
import { buildBehaviorEvalCases } from "./behaviorEvalCases";
import type { NpcCheckOutput } from "./npcChecks";

const REQUIRED_CATEGORIES = [
  "정상 탐색",
  "새 구역 · 단서",
  "장시간 정체",
  "반복 방문",
  "퍼즐 근처",
  "장시간 유휴",
  "개입 제한",
  "거절 뒤",
  "수락 뒤",
  "정보 부족 · 경계",
];

/** 객체의 열쇠 경로 모음(중첩 · 배열 원소 포함). zone_visits 는 구역 코드가 열쇠라 안쪽은 보지 않는다. null 은 안쪽 열쇠가 없다 */
function keyPaths(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);
      if (k !== "zone_visits") keyPaths(v, path, out);
    }
  }
  return out;
}

export function runBehaviorEvalChecks(): NpcCheckOutput {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "Q 행동 판단 평가셋 · 지표";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });
  const note = (text: string) => out.notes.push(`[${group}] ${text}`);

  // ── 평가셋 ──
  const cases = buildBehaviorEvalCases();
  const ids = cases.map((c) => c.id);
  check("평가셋 30 사례", cases.length === 30, `${cases.length}`);
  check("평가 ID 중복 없음", new Set(ids).size === ids.length);
  const missingMeta = cases.filter(
    (c) => !c.id || !c.category || !c.description || !c.rationale || !c.input || !c.context,
  );
  check(
    "필수 메타데이터(ID · 분류 · 설명 · 근거 · 입력 · 상황) 있음",
    missingMeta.length === 0,
    missingMeta.map((c) => c.id).join(","),
  );
  const badLabel = cases.filter(
    (c) =>
      (c.expectedState !== null && !ASSESSMENT_STATES.includes(c.expectedState)) ||
      (c.expectedAction !== null && !HELP_ACTIONS.includes(c.expectedAction)) ||
      ((c.expectedState === null || c.expectedAction === null) && !c.labelNote),
  );
  check(
    "기대 레이블이 정해진 값 · 비운 레이블은 이유(labelNote) 있음",
    badLabel.length === 0,
    badLabel.map((c) => c.id).join(","),
  );
  check(
    "레이블은 모두 초안(draft) — 사람 검토 전",
    cases.every((c) => c.labelStatus === "draft"),
  );
  const unjudgeable = cases.filter((c) => !c.runtimeJudgeable);
  check(
    "런타임 판단 불가 사례: 제한 설명 · 평가용 메타(evalOnly) 있음",
    unjudgeable.length > 0 &&
      unjudgeable.every((c) => c.limitations && c.evalOnly && Object.keys(c.evalOnly).length > 0),
    unjudgeable.map((c) => `${c.id}:${Object.keys(c.evalOnly ?? {}).join("/")}`).join(" | "),
  );
  const counts = Object.fromEntries(REQUIRED_CATEGORIES.map((k) => [k, cases.filter((c) => c.category === k).length]));
  check(
    "10 분류 모두 2 사례 이상 · 분류 밖 사례 없음",
    REQUIRED_CATEGORIES.every((k) => counts[k] >= 2) && cases.every((c) => REQUIRED_CATEGORIES.includes(c.category)),
    JSON.stringify(counts),
  );
  // 기준: 진행 · 최근 이벤트가 다 차 있는 사례(A02)의 열쇠 경로. 다른 사례는 그 안에만 있어야 한다(null 인 칸은 안쪽이 없어도 된다)
  const reference = keyPaths(cases.find((c) => c.id === "A02-explore-steady")!.input);
  const odd = cases
    .map((c) => ({ id: c.id, extra: [...keyPaths(c.input)].filter((k) => !reference.has(k)), schema: c.input.schema }))
    .filter((x) => x.extra.length > 0 || x.schema !== "npc_ai_input/0.1");
  const topKeys = (o: object) => Object.keys(o).sort().join();
  const sameTop = cases.every((c) => topKeys(c.input) === topKeys(cases[0].input));
  check(
    "입력은 npc_ai_input/0.1 그대로 — 스키마 밖 열쇠 없음 · 최상위 열쇠 같음 (평가 전용 정보는 evalOnly 에만)",
    odd.length === 0 && sameTop,
    odd.map((x) => `${x.id}: ${x.extra.join("/")}`).join(" | ") || `열쇠 경로 ${reference.size}개`,
  );
  const tampered = { ...cases[0].input, progress: { ...cases[0].input.progress, wrong_attempts: 3 } };
  check(
    "열쇠 검사가 실제로 잡는지: 입력에 없는 필드(progress.wrong_attempts)를 넣으면 걸림",
    [...keyPaths(tampered)].some((k) => !reference.has(k)),
  );
  const json = JSON.stringify(exportBehaviorEvalDataset(cases));
  check(
    "내보내기: JSON 그대로 되읽힘 · 규칙 결과(actual)는 담지 않음",
    JSON.stringify(JSON.parse(json)) === json && !/actual|rule_baseline/.test(json),
    `${(json.length / 1024).toFixed(1)} KB`,
  );
  out.measurements.behaviorEvalDataset = JSON.parse(json);

  // ── 지표 계산 (손으로 계산한 값과 비교) ──
  {
    type L = "A" | "B" | "C";
    const r = classificationReport<L>(
      ["A", "B", "C"],
      [
        { expected: "A", predicted: "A" },
        { expected: "A", predicted: "A" },
        { expected: "A", predicted: "B" },
        { expected: "B", predicted: "B" },
        { expected: "B", predicted: "A" },
      ],
    );
    // A: TP2 · 낸 3 · 기대 3 → P 2/3 R 2/3 F1 2/3 · B: TP1 · 낸 2 · 기대 2 → 0.5 · C: 기대 0 · 낸 0 → N/A
    const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-12;
    check(
      "지표: 혼동행렬 · Precision · Recall · F1 · 일치율이 손 계산과 같음",
      r.confusion.A.A === 2 &&
        r.confusion.A.B === 1 &&
        r.confusion.B.A === 1 &&
        near(r.perClass.A.precision, 2 / 3) &&
        near(r.perClass.A.recall, 2 / 3) &&
        near(r.perClass.A.f1, 2 / 3) &&
        near(r.perClass.B.f1, 0.5) &&
        near(r.accuracy, 3 / 5),
      `A ${formatMetric(r.perClass.A.f1)} · B ${formatMetric(r.perClass.B.f1)} · 일치율 ${formatMetric(r.accuracy)}`,
    );
    check(
      "지표: 표본이 없는 클래스는 0 이 아니라 N/A(null)",
      r.perClass.C.precision === null &&
        r.perClass.C.recall === null &&
        r.perClass.C.f1 === null &&
        formatMetric(null) === "N/A",
    );
    const zero = classificationReport<L>(["A", "B", "C"], [{ expected: "A", predicted: "B" }]);
    check(
      "지표: 맞힌 것 0 이면 P · R = 0 · F1 = 0 (분모가 있으니 N/A 아님) · 낸 적 없는 클래스의 P 는 N/A",
      zero.perClass.A.recall === 0 &&
        zero.perClass.A.precision === null &&
        zero.perClass.B.precision === 0 &&
        zero.perClass.B.recall === null,
    );
    const empty = classificationReport<L>(["A", "B", "C"], []);
    check("지표: 사례 0 이면 일치율 N/A", empty.accuracy === null);
    let threw = false;
    try {
      classificationReport<L>(["A", "B", "C"], [{ expected: "Z" as L, predicted: "A" }]);
    } catch {
      threw = true;
    }
    check("지표: 모르는 레이블은 거부", threw);
  }

  // ── 규칙 기준선 평가 (판정하지 않고 기록) ──
  const assessor = createRuleBaselineAssessor();
  const result = runBehaviorEval(cases, assessor);
  const again = runBehaviorEval(buildBehaviorEvalCases(), createRuleBaselineAssessor());
  check("재현성: 같은 평가셋을 두 번 돌려도 결과가 같음", JSON.stringify(result) === JSON.stringify(again));
  check(
    "제외 처리: 런타임 판단 불가 사례는 지표에서 빠지고 행에는 남음",
    result.excluded.join() === unjudgeable.map((c) => c.id).join() &&
      result.included === cases.length - unjudgeable.length &&
      result.state.total === result.included &&
      result.rows.length === cases.length,
    `포함 ${result.included} · 제외 ${result.excluded.join(",")}`,
  );
  out.measurements.behaviorEvalBaseline = result;
  reportBaseline(result, note);
  return out;
}

function reportBaseline(r: BehaviorEvalResult, note: (t: string) => void) {
  const m = (v: number | null) => formatMetric(v);
  note(
    `규칙 기준선 ${r.assessor} — 합성 평가셋 ${r.total} 사례 중 ${r.included} 사례로 계산(제외 ${r.excluded.length}). 실제 플레이어 예측 정확도가 아니다`,
  );
  note(
    `상태 일치율 ${m(r.state.accuracy)} · 개입 일치율 ${m(r.action.accuracy)} · 상태 · 개입 모두 일치 ${m(r.overallAgreement)}`,
  );
  for (const s of r.state.labels) {
    const c = r.state.perClass[s];
    note(`상태 ${s}: 기대 ${c.support} · 낸 ${c.predicted} · P ${m(c.precision)} · R ${m(c.recall)} · F1 ${m(c.f1)}`);
  }
  note(`상태 혼동행렬(기대 → 낸 값) ${JSON.stringify(r.state.confusion)}`);
  const offer = r.action.perClass.OFFER_HELP;
  note(
    `OFFER_HELP: 기대 ${offer.support} · 낸 ${offer.predicted} · P ${m(offer.precision)} · R ${m(offer.recall)} · F1 ${m(offer.f1)} · 개입 혼동행렬 ${JSON.stringify(r.action.confusion)}`,
  );
  for (const row of r.rows.filter((x) => x.included && x.bothMatch === false)) note(`오분류 ${row.id}: ${row.note}`);
  for (const row of r.rows.filter((x) => !x.included))
    note(
      `제외 ${row.id}: 기대 ${row.expectedState}/${row.expectedAction} · 기준선 ${row.actualState}/${row.actualAction} · ${row.note}`,
    );
}
