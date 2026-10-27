// 분류 평가 지표 — 혼동행렬 · 클래스별 Precision · Recall · F1 · 일치율. 순수 함수(행동 판단 평가 · 이후 모델 비교에서 같이 쓴다).
// 분모가 0 인 지표는 0 으로 메우지 않고 null(보고서에는 N/A)로 둔다.

export type ConfusionMatrix<L extends string> = Record<L, Record<L, number>>;

export interface ClassMetrics {
  /** 이 클래스로 기대한 수 */
  support: number;
  /** 이 클래스로 낸 수 */
  predicted: number;
  truePositive: number;
  /** null = 분모 0 (N/A) */
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ClassificationReport<L extends string> {
  labels: readonly L[];
  total: number;
  correct: number;
  /** null = 사례 0 */
  accuracy: number | null;
  /** 기대(행) × 낸 값(열) */
  confusion: ConfusionMatrix<L>;
  perClass: Record<L, ClassMetrics>;
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export function classificationReport<L extends string>(
  labels: readonly L[],
  pairs: readonly { expected: L; predicted: L }[],
): ClassificationReport<L> {
  const confusion = Object.fromEntries(
    labels.map((e) => [e, Object.fromEntries(labels.map((p) => [p, 0]))]),
  ) as ConfusionMatrix<L>;
  let correct = 0;
  for (const { expected, predicted } of pairs) {
    if (!labels.includes(expected) || !labels.includes(predicted))
      throw new Error(`알 수 없는 레이블: ${expected} → ${predicted}`);
    confusion[expected][predicted]++;
    if (expected === predicted) correct++;
  }
  const perClass = {} as Record<L, ClassMetrics>;
  for (const label of labels) {
    const tp = confusion[label][label];
    const support = labels.reduce((sum, p) => sum + confusion[label][p], 0);
    const predicted = labels.reduce((sum, e) => sum + confusion[e][label], 0);
    const precision = ratio(tp, predicted);
    const recall = ratio(tp, support);
    const f1 =
      precision === null || recall === null
        ? null
        : precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall);
    perClass[label] = { support, predicted, truePositive: tp, precision, recall, f1 };
  }
  return { labels, total: pairs.length, correct, accuracy: ratio(correct, pairs.length), confusion, perClass };
}

/** 보고용: 숫자는 소수 셋째 자리, null 은 N/A */
export const formatMetric = (v: number | null) => (v === null ? "N/A" : v.toFixed(3));
