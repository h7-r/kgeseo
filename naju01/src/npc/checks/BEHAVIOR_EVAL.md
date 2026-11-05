# 행동 판단 평가셋 (npc_behavior_eval/0.1)

「플레이어가 막혔나 · 지금 도움을 제안해야 하나」를 판단하는 기능(상태 추정기 + 개입 정책)을 같은 사례로 재는 평가셋이다.
한국어 대사 품질 평가와는 별개의 과제다.

> ⚠ **합성 시나리오**이고 기대 레이블은 **사람 검토 전 초안**(`labelStatus: "draft"`)이다. 결과를 실제 플레이어에 대한 예측 정확도로 말하지 않는다.

## 파일

| 파일                           | 내용                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `checks/behaviorEvalCases.ts`  | 평가 사례 30개(대본 → 실제 추적기 · AI 입력 생성기로 입력 스냅숏을 만든다)                        |
| `../behaviorEval.ts`           | 실행기 `runBehaviorEval(cases, assessor, policyConfig)` · 내보내기 `exportBehaviorEvalDataset`    |
| `../evalMetrics.ts`            | 혼동행렬 · Precision · Recall · F1 · 일치율 (분모 0 은 `null` = N/A)                              |
| `checks/behaviorEvalChecks.ts` | Q 묶음 검사 — 평가셋 온전함 · 지표 계산 · 재현성 · 제외 처리 (기준선 정확도는 판정하지 않고 기록) |

## 사례 한 개

| 필드                               | 뜻                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` · `category` · `description`  | 고유 ID · 분류(10 가지) · 상황 설명                                                                                                                      |
| `input`                            | 판단기에 그대로 넣는 `npc_ai_input/0.1` (새 필드 없음)                                                                                                   |
| `context`                          | 평가 시점의 상호작용 상황(`HelpContext`: 씬 active · 잠금 · 컷 · 대화 · 말 걸 수 있음)                                                                   |
| `history`                          | 평가 전 정책 이력 — `offer` · `decline` · `accept` 를 몇 초 전에(놀이 시간)                                                                              |
| `expectedState` · `expectedAction` | 기대 상태(`EXPLORING` · `POSSIBLY_STUCK` · `INSUFFICIENT_DATA`) · 기대 개입(`WAIT` · `OFFER_HELP`). 기존 레이블로 표현하기 어려우면 `null` + `labelNote` |
| `rationale`                        | 기대값의 근거 — 플레이어 경험 · 게임 진행 관점                                                                                                           |
| `limitations` · `runtimeJudgeable` | 입력의 한계 · 런타임 입력으로 기대값을 판단할 수 있는지(아니면 지표에서 제외)                                                                            |
| `evalOnly`                         | `npc_ai_input` 에 없는 평가용 정보(퍼즐 오답 수 · 퍼즐 근처 여부 등). 런타임에는 없다                                                                    |

## 레이블 원칙

- 기대값은 규칙 계산 결과에서 만들지 않는다. 각 사례의 `rationale` 로 따로 정한다.
- 기준선(규칙) 임계값을 평가 결과에 맞춰 고치지 않는다 — 모델 비교의 기준점이다.
- 기대값이 런타임에 없는 정보에 달리면 `runtimeJudgeable: false` 로 지표에서 빼고 따로 보고한다.

## 실행

```powershell
npx.cmd vite naju01 --port 5184
node naju01/src/npc/checks/run-npc-checks.mjs http://localhost:5184/ --json out.json
```

결과는 `[Q 행동 판단 평가셋 · 지표]` 묶음과 `[참고]`(기준선 지표 · 오분류 · 제외 사례)에 찍히고,
`out.json` 의 `measurements.behaviorEvalBaseline`(사례별 결과 · 지표) · `measurements.behaviorEvalDataset`(다른 도구로 넘길 평가셋)에 남는다.

## 늘리기

1. `behaviorEvalCases.ts` 의 `SPECS` 에 사례를 더한다(대본 `ScriptStep[]` · 상황 · 이력 · 기대값 · 근거).
2. 런타임 입력에 없는 정보에 기대가 달리면 `evalOnly` 에 적고 `runtimeJudgeable: false`.
3. 사람이 검토한 사례는 `labelStatus` 를 `"reviewed"` 로 바꾼다(지금은 모두 draft). 검사의 「30 사례」 개수 확인도 함께 바꾼다.

## 다른 판단기와 비교할 때

- **같은 계약**: 판단기는 `PlayerStateAssessor`(`assess(npc_ai_input) → npc_assessment/0.1`)로 들어온다. 정책은 그대로 두고 판단기만 바꿔 같은 사례를 돌린다.
- **LightGBM 등**: `behaviorEvalDataset` 의 `input` 을 특성으로 펴서 학습 · 추론한다. 이 30 사례를 학습에 쓰면 평가가 아니다 — 평가 전용으로 남긴다.
  합성 사례라 실제 플레이 기록 없이 학습한 모델의 일반화는 이 평가셋으로 보장되지 않는다.
- **LLM(GPT API · Qwen)**: `input` · `context` 를 프롬프트로 넣고 `npc_assessment/0.1` JSON 으로 받는다. 같은 판단을 여러 번 물어 흔들림(재현성)도 잰다.
  `expected_*` · `rationale` 은 프롬프트에 넣지 않는다.
- **개입 정책**: 정책은 수락을 기록하지 않는다(제안 · 거절만). 「수락 뒤」 사례의 결과는 제안 쿨다운으로만 정해진다.
- 대사 품질(자연스러움 · 캐릭터 일관성)은 이 평가셋으로 재지 않는다 — 별도 과제.
