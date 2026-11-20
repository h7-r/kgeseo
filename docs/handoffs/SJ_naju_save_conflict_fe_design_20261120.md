# 나주 · 본편 저장 충돌(409 재시도) — FE 수정 설계 · 재현 절차 (2026-11-20, 세진 → 해랑)

- 상태: **설계 제안 · 제품 코드 미수정.** PM 부재 중 작성 — §6 결정 전에는 구현하지 않는다.
- 기준: main `a9640803`(#189 포함). 관련 보고: `SJ_naju_save_restore_report_20261120.md` §5-2.
- 백엔드 짝(§5-1 계정 바뀜): `PUT /api/v1/me/game-save` 선택 필드 `account_id` — 별도 Draft PR(`fix/SJ-game-save-account-guard-1120`).

## 1. 문제

같은 계정으로 본편과 나주를 **두 탭에서 동시에** 열고 둘 다 저장하면, 409 뒤 재시도가 **이 탭이 처음 불러온 저장본**에 자기 칸만
덮어 보낸다(`src/save/gameSave.ts` `sendState` → `collectState`). 그사이 다른 탭이 저장한 자기 칸이 **처음 불러온 옛 값으로 되돌아간다.**

- 재현(시뮬레이션, 실제 `gameSave.ts` 묶음 + me.py 규칙의 가짜 서버): 본편 탭이 `main.tutorial` 을 바꿔 저장 → 409 → 같은 계정이라 재시도 →
  나주 탭이 방금 저장한 `naju.jars: NEW` 가 `old` 로 되돌아감, `stage` 도 본편 값.
- 한 탭에서 기차 → 나주로 넘어가는 보통 흐름에서는 생기지 않는다(본편 페이지가 내려간다).

## 2. 저장 구조(코드 기준)

| 구역 | 등록하는 페이지 | 칸 |
|---|---|---|
| 본편 | `src/save/mainGameSave.ts` · `MainGameSaveBridge.tsx` | `main.tutorial` · `main.inventory` · `main.stationPose` · `main.trainPose` |
| 나주 | `naju01/src/save/najuSaveData.ts` · `puzzleMemory.ts` · `NajuSaveBridge.tsx` | `naju.player` · `naju.fishTrap` · `naju.clam` · `naju.jars` · `naju.makgeolli` · `naju.ritual` · `naju.ridge` · `naju.ridgeQuest` · `naju.ridgeCarry` · `naju.playTime` · `naju.helpLog` · `naju.inventory` · `naju.puzzleMemory` · `najuMeta.attempt` |
| 공통 | 둘 다 | 맨 위 `stage`(본편: tutorial · headquarters · train / 나주: naju) |

- **두 페이지가 함께 등록하는 칸은 없다**(겹치지 않음). 인벤토리도 `main.inventory` · `naju.inventory` 로 나뉘어 있다.
- **자기 것이 아닌 칸을 일부러 바꾸는 곳**:
  - 기차 목적지 「처음부터 다시」(`naju01/src/progress/resetCase.ts` `reset`, 본편 페이지에서 실행): `naju.*` 를 지우고(`removeSavedSections`)
    `najuMeta.attempt` 를 +1(`writeSavedSection`).
  - 다시 접속해 튜토리얼 처음부터(`src/save/resumeStart.ts`): 튜토리얼 칸 삭제.
  - 나주 멈춤 메뉴 「처음부터 다시」: 자기 칸을 떼어 내고(`detachSaveSections`) 저장.
- 서버에서 다시 읽는 함수는 처음 한 번(`initGameSave` → `loadGameSave`)뿐이다. 409 때 다시 읽지 않는다.

## 3. 안 A — 409 때 최신 저장을 다시 읽어 칸 단위로 합친다(권장, 조건부)

409(같은 계정 확인 뒤) →
1. `GET /me/game-save` 로 최신 저장(서버 `revision` · `stage` · `sections`)을 읽는다.
2. 합치기:
   - **기본 = 서버 최신 칸**.
   - **이 페이지가 등록한 칸** → 지금 값(`section.read()`)으로 덮는다(칸이 겹치지 않으므로 다른 탭의 진행을 잃지 않는다).
   - **이 페이지가 일부러 바꾼 남의 칸**(위 「처음부터 다시」 등) → 그 변경을 다시 적용한다. 이를 위해 `removeSavedSections` ·
     `writeSavedSection` · `detachSaveSections` 가 **「이 페이지가 바꾼 칸」 목록(지움 표시 포함)** 을 따로 기억해야 한다(지금은 `storedSections`
     를 바로 고쳐 버려 「옛 값」과 「일부러 바꾼 값」을 구분하지 못한다).
3. 합친 값으로 서버 `revision` 에 PUT. 또 409 면 1번부터 한 번 더, 그래도 409 면 안 B 로.
4. 성공하면 `storedSections` 를 합친 값으로 바꾼다(다음 저장부터 옛 값을 들고 있지 않게).

남는 판단(§6): `stage` 는 칸이 아니라 하나뿐이다 — 「마지막에 쓴 탭」이 이긴다(지금과 같음). 나주 탭이 앞서 있는데 본편 탭이 `headquarters` 로
쓰면 다음 접속이 본부실에서 시작한다(나주 진행 칸은 남으므로 기차로 다시 들어가면 이어짐).

`najuMeta.attempt`(처음부터 다시 횟수)는 두 탭이 동시에 올리면 한 번이 사라질 수 있다 — 통계용이라 영향이 작다.

## 4. 안 B — 자동 덮어쓰기를 멈춘다(합치기를 못 믿을 때의 안전안)

409(같은 계정) → 다시 쓰지 않고 상태를 새 값 `conflict` 로 올리고 안내: 「다른 창에서 진행이 저장됐어요 — 새로고침하면 최신 진행으로 이어집니다」.
- 서버 최신 진행은 지켜진다. 대신 **이 탭에서 마지막 저장 뒤 한 진행은 새로고침하면 사라진다**(보통 몇 초 ~ 10초 분량).
- 구현이 작다(`saveStatus` 에 값 하나 · 안내 문구 · `sendState` 에서 재시도 대신 멈춤). 안 A 를 준비하는 동안의 임시안으로도 쓸 수 있다.

## 5. 재현 · 시험 계획

**자동(FE, `naju01/tests` 또는 `tools`)** — `gameSave.ts` 는 `@/` 별칭 · `import.meta.env` 를 써서 `node --test` 가 바로 못 읽는다. rolldown 으로
베타 기록 · 주소 설정만 바꿔 묶은 뒤 가짜 서버(me.py 규칙: 계정마다 한 칸, revision 다르면 409 + 서버 번호, 첫 저장 0 → 1)로 돌린다. 시나리오:
1. 두 탭이 서로 다른 칸을 바꿔 저장 → 409 → 재시도 뒤 **두 탭의 칸이 모두 최신**(지금은 실패 — 재현 시험)
2. 409 뒤 다른 탭이 만든 칸 · 진행 보존
3. 「처음부터 다시」(남의 칸 지움)를 한 탭과 그 칸을 저장하는 탭이 겹칠 때 — 결정한 규칙대로(지움이 이기는지)
4. `stage` 가 두 탭에서 다를 때 — 결정한 규칙대로
5. 409 가 두 번 연속 → 안 B 로 멈춤(무한 재시도 없음)
6. 계정 바뀜(§5-1)과 섞인 경우: `account_changed` 가 먼저 — 합치지 않는다

**백엔드로 검증 가능한 범위**: 서버는 저장본 한 덩어리 · revision 만 안다(칸을 모름). 「409 · 최신 번호 · 값 불변」은 기존 격리 MySQL 시험과
`account_id` 시험이 본다. 칸 합치기 자체는 FE 시험으로만 검증된다.

**브라우저(로컬 개발 서버, 운영 아님)**: 같은 계정으로 본편 탭 · 나주 탭을 열고 나주에서 퍼즐 하나 진행(PUT 200 확인) → 본편 탭에서 인벤토리 등
바꿔 저장(409 → 재시도) → 나주 탭 새로고침 → 나주 진행이 남아 있는지.

## 6. 결정 필요(PM · FE)

1. 안 A(합치기) / 안 B(멈춤) / B 먼저 내고 A 후속
2. `stage` 충돌 규칙(마지막 쓴 탭 · 나주 우선 · 더 뒤 단계 우선)
3. 남의 칸을 일부러 바꾼 변경(처음부터 다시)과 그 칸 주인 탭의 저장이 겹칠 때 어느 쪽이 이기는가
4. 같은 계정 두 탭 동시 플레이를 지원 범위로 볼지(아니면 안 B + 안내로 충분한지)
