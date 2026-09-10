# 계약서 (Contract) — 백엔드 ↔ 프론트 데이터 규격

**v0.3.1이 현재 유효한 계약이며 FE 착수 승인 상태다(2026-09-09 확정).**
v0.1 / v0.2 / v0.3 논의는 전부 이 버전으로 대체됐다. 단 **Zone Contract만 v0.2 그대로** 유지한다.

| 파일 | 내용 |
|---|---|
| `00_Contract_Baseline_v0.3.1.md` | 전체 기준선 — 인터랙션 5종 · 퍼즐 7종 · 힌트 모델 · 공통 원칙 |
| `01_Zone_Contract_v0.2.md` | 구역(Zone) 정보 + `objects[]` + 출구 |
| `02_Interaction_Contract_v0.3.1.md` | 상호작용 요청/응답 + `state_changes` 12종 |
| `03_Puzzle_Contract_v0.3.1.md` | 퍼즐 정의 · 판정 · 힌트 API |
| `04_Session_Contract_v0.3.1.md` | Play Session 상태 · `hint_levels` 복구 |

## 한 줄 요약

1. **`transform`은 프론트가 갖는다.** 서버는 3D 좌표를 안 내려준다.
   드로우콜 때문에 메시를 병합해 둬서, 서버가 위치를 내려주면 그 최적화가 깨진다.
2. **인터랙션 5종** — `inspect` / `navigate` / `input` / `select` / `combine_clues`.
   `combine_clues`는 조사수첩에서 **획득한 단서 중 정확히 2개**를 자유 선택하는 방식이라 `puzzle_id`가 없다.
3. **힌트는 `hint_level` 0/1/2 하나로 통일.** `hint_unlocked`는 폐기.
   오답 횟수 기반 자동 해금은 없고, level 2는 level 1 이후에만 열린다.
4. **판정 Source of Truth는 서버.** 정답은 FE에 절대 안 내려온다.
   오답과 규칙 없는 단서 조합은 에러가 아니라 정상 게임 결과다.
5. **`GET /play-sessions/{id}`로 복구한다.** GPU 컨텍스트 손실로 강제 새로고침이 실제로
   일어나는 게임이라, "지금 어디였는지"를 돌려주는 API가 없으면 복귀가 안 된다.

## 용어 충돌 주의

| 우리 코드 | 계약서 | |
|---|---|---|
| 세션 (S0~S9) | — | 화면 단계 (로그인 / 캐릭터생성 / 로비 / 인게임…) |
| — | Zone (ZONE_003) | 게임 안 공간 (기차 내부 / 복도…) |

v0.1의 `Scene`을 **구역(Zone)** 으로 바꾸자는 FE 제안이 v0.2에서 수용됐다.

## 아이템은 없다

계약에 아이템 개념이 아예 없다(`item_acquired`/`item_consumed`도 v1 제외).
PRD v2.0에 남아 있는 인벤토리·아이템 조합은 **단서(Clue) + 조사수첩**으로 대체한다.
데모에서 PRD와 계약이 부딪히면 **계약이 이긴다.**
