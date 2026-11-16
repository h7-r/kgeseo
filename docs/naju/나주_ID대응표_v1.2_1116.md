# 나주(앙암바위) ID 대응표 v1.2 — 2026-11-16

> v1.2(11/16): 4 · 5스테이지 베타 기록 ID 추가(9절). 1~8절은 `나주_ID대응표_v1_1108.md`(v1.1) 그대로 — 이 문서는 덧붙임만 적는다.
> 🟢 PM 확정(미르 11/16). 정답 값은 이 문서에 없다.

## 9. 4 · 5스테이지 목표 ID (베타 기록) 🟢

4 · 5스테이지는 목표표(`dialogue/objectives.ts`) 밖이라 서버 판정 · 진행 저장에는 쓰지 않고 **베타 기록(`objective_state` · `puzzle_attempt` 의 `objective_id`)에만** 쓴다.
이름 규칙은 v1.1 그대로 — 퍼즐은 P 번호(4 · 5스테이지 설계 1106 의 제안 번호를 확정), 판정 없는 걸음은 `S<스테이지>_<이름>`.
읽는 곳: `naju01/src/beta/lateObjectives.ts`(바위 위 cliff · 굿판 gut 의 단계 이름으로 끝났는지만 읽는다).

| ID | 스테이지 | 종류 | 이름 | 끝났다고 보는 단계 |
|---|---|---|---|---|
| `P14` | 4 바위 위 | 퍼즐(화면 판정) | 정화수 세 그릇(사발 셋) | cliff ≥ vision |
| `P15` | 4 바위 위 | 퍼즐(화면 판정) | 끊긴 발자국 | cliff ≥ traced |
| `S4_POUCH` | 4 바위 위 | 걸음 | 아랑사의 주머니(편지를 다 읽음) | cliff ≥ done |
| `S4_SERPENT` | 4 바위 위 | 걸음 · **스테이지 끝** | 구렁이상을 세워 틈을 지남(5스테이지 시작) | cliff ≥ crossed |
| `S5_RINGS` | 5 굿판 | 걸음 | 소반에 가락지(굿 열기) | gut ≠ waiting(불 붙이기 전 도로 집으면 풀린다) |
| `P16` | 5 굿판 | 퍼즐(화면 판정) · **스테이지 끝** | 다섯 횃불 | gut released · dawn |

- 기록 모양: 완료 `objective_state complete` · 처음 지금 목표 `available` · 지금 목표 `focus`(1~3스테이지와 같다). 다섯 횃불은 하나 켤 때마다 `objective_state progress`(`data.lit`), 차례가 어긋나 꺼지면 `puzzle_attempt fail`(`data.how = "blow_out"`).
- **사건 완주**는 목표가 아니라 `run_state released · dawn` 으로 센다.
- 잎 · 오리 · 물고기는 날이 갠 뒤 저절로 나오는 연출이라 목표가 아니다.
- 11/11 부터 남긴 굵은 표식 `CLIFF`(progress · complete) · `GUT`(rite · complete)는 그대로 남는다 — 서버 집계(#168)는 당분간 이것으로 4 · 5 진입만 세고(`entry_only_stages`), 새 ID 기록이 들어오면 `STAGE_OBJECTIVES` 4 = P14 · P15 · S4_POUCH · S4_SERPENT(끝 S4_SERPENT), 5 = S5_RINGS · P16(끝 P16)으로 옮긴다.
- 런타임 Object ID(`OBJ_*`)는 두지 않는다 — 서버 판정 연결이 없고 `focus_object_id` 도 쓰지 않아서. 연결하는 판에 2절 규칙대로 추가한다.
