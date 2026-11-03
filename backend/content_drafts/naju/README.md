# 나주 개발용 콘텐츠 골격 (dev, 게시 · 등록 금지)

- 기준: BE `6977cb0`, 최신 FE `origin/feat/랑-화풍-나주톤` @ `5f88aa6`
  - `dcba86d` 이후 FE 변경은 웹사이트 영상 1건뿐이고, 나주 코드는 같다.
- 참고 자료: `나주_BE_FE_통합결정표_1103_최신화.md`, `backend/docs/fe_be_contract_check_1103.md` §6, PM 초안 `docs/naju/naju-angam-01.idmap.draft.json`(FE 브랜치, 10/27)
- 이 디렉터리는 케이스 로더(`app/content/cases`)와 게시 로더(`<root>/<case_id>/v<n>/`) 어느 쪽도 읽지 않는다. 공식 게시본도, 승인 기록도, fingerprint도 없다.
- **정답 · 판정 규칙 · 힌트 원문은 적지 않았다.** FE 코드 안의 정답 상수는 어디에 있는지만 적었다(`fe_answer_location`).

| 파일 | 내용 | 검증 |
|---|---|---|
| `naju_fe_ids.dev.json` | FE `registerInteractable` ID 48개 묶음(9종 28 · 그 밖 20)과 개수 상수, 배치 키 · 좌표 10개 | `python -m scripts.verify_naju_fe_ids`(FE 커밋과 양방향 대조) |
| `naju-angam-01.idmap.dev.json` | PM 초안 idmap을 최신 FE 배치로 갱신한 개발판. 장면 · 구역 · 길 · 차단물은 초안 그대로, 물건 20개 | `validate_idmap`: 스키마 · 내부 참조 통과, 게시 차단 |
| `naju_puzzles.dev.json` | 9종별 후보 Puzzle ID · Zone · FE ID · 런타임 Object · 서버 기록 수단 · 빈칸 | `tests/test_naju_content_skeleton.py` |

## 1. 확정한 ID (FE 코드 근거)

| 종류 | ID | 근거 |
|---|---|---|
| Zone | Z1 `ZONE_FERRY_TERRACE` · Z2 `ZONE_GRAVEL_BEACH` · Z3 `ZONE_CLIFF_TOP` · Z4 `ZONE_JINBU_RIDGE` | FE `sitePlan.ts` `ZoneCode` · 범위가 PM 초안과 같음(런타임 ID는 PM 초안 값) |
| 길 · 차단물 | T1~T4, B1~B4 | FE `sitePlan.ts`와 초안이 같음 |
| Scene | 로컬 1~5 → `SCENE_TWO_NAMES` … `SCENE_SSITGIM` | FE는 `endScene(1..5)` · `focus.clearedScenes`(최대 5). 런타임 ID는 PM 초안 값 |
| 배치 ↔ FE 상호작용 | `씬1.통발#0..2` = `fish-trap-0..2` → `OBJ_S1_FISH_TRAP_0..2` | `FishTrapPuzzle.tsx`가 배치 무리 `씬1.통발`을 읽어 같은 자리에 바꿔 끼움 |
| 배치 ↔ FE 상호작용 | `씬2.솟대#0..1` = `ridge-statue-0..1` → `OBJ_S2_SOTDAE_0..1`(새로 추가) | `RidgeBirds.tsx`가 솟대 0 · 1번을 숨기고 다시 그림(`STATUE_IDS`) |
| 배치 | `씬2.걸상#0..4` → `OBJ_S2_STOOL_0..4`(새로 추가) | `StumpStairs.tsx`가 `씬2.걸상` 5개를 읽음. 걸상별 상호작용 ID는 없음 |

새 Object ID는 PM 규칙 `OBJ_S<씬>_<영문 이름>_<번호>`에 초안의 이름 기반(`OBJ_S2_SOTDAE`, `OBJ_S2_STOOL`)을 그대로 넣었다.
그래서 `씬2.걸상`을 「배치 없는 묶음」 목록에서 뺐다.

## 2. 9종 대응표

Puzzle ID는 1103 결정표 §3의 **후보**다. 서버에 없고 API에 쓰면 안 된다.

| # | 후보 Puzzle ID | Zone | 런타임 Object | FE 상호작용 ID |
|---|---|---|---|---|
| 1 | `PUZZLE_S1_FISH_TRAP` | Z1 | `OBJ_S1_FISH_TRAP_0..2` | `fish-trap-{0..2}`, `fish-trap-stake-{0..2}`, `clam-hoe` · `clam-spot` · `clam-pick` |
| 2 | `PUZZLE_S1_RAIN_RITUAL` | Z2 | — | `ritual-cairn-{0..5}`, `ritual-table`, `float-stone-{0..3}` |
| 3 | `PUZZLE_S3_AIR_JAR` | **동굴(Zone 없음)** | — | `cave-jar` |
| 4 | `PUZZLE_S3_PEARL_LIGHT_CHAIN` | 동굴 | — | `cave-source-pearl`, `cave-clam-{0..3}`, `cave-big-clam` |
| 5 | `PUZZLE_S3_RING_DOOR` | 동굴 | — | `cave-float-{0..3}`, `cave-valve`, `cave-valve-rim-{0..11}`, `cave-gear-{0..2}`, `cave-tablet`, `cave-door` |
| 6 | `PUZZLE_S3_INNER_STAND` | 동굴 | — | `cave-pedestal-{0..3}`, `cave-altar`, `cave-socket`, `cave-scale`, `cave-exit` |
| 7 | `PUZZLE_S4_POST_RINGS` | Z4 | — | `ridge-post-ring-{0..3}` |
| 8 | `PUZZLE_S4_RIDGE_STAIRS` | Z4 | `OBJ_S2_STOOL_0..4` | `ridge-platform-story` |
| 9 | `PUZZLE_S4_STONE_BIRD_ALIGNMENT` | Z4 | `OBJ_S2_SOTDAE_0..1` | `ridge-statue-{0..1}`, `ridge-jar-reflection`, `ridge-fossil` |

- 1103 결정표에서 「미확인」이던 석실 받침(6)과 걸상(8)은 FE 근거를 찾았다.
- 9종 밖 FE 상호작용 20묶음(항아리 자리 · 막걸리 병 · 물고기 굴 · 전설 흔적 · 능선 수레 · 함 · 지게 · `world-item-*`)은 `naju_fe_ids.dev.json`에 `puzzle: null`로 둔다.

## 3. 서버 판정 가능 항목과 FE 로컬 처리

- **BE가 지금 할 수 있는 것:**
  - 정답 검증으로 퍼즐 완료: `input` · `select` + `accepted_answers`.
  - FE가 판정하고 서버는 완료만 기록: `inspect` 효과의 `complete_puzzle_ids`.
  - 그 밖에 선행 퍼즐 · 단서, Item 획득 · 소비, Object 숨김 · 잠금 해제, flag, 장면 완료(`clear_when`), 케이스 완료.
  - 나주 전용 「완료 이벤트」 action은 없다.
- **FE 로컬로 남는 것(9종 공통):** 회전 · 각도 · 드래그 · 물리 · 빛 연산 · 게이지 · 연출 · 숨 게이지.
- **어느 쪽으로 할지는 정하지 않았다.** 정답은 모두 FE 상수로 있다(`CATCHING_TRAP`, `NODE_NOTCHES`, `LIGHT_ANSWER`, `RINGS`, `ORDER`, `POSTS[].answer`, `ANSWER`). 이것을 서버 콘텐츠로 옮길지는 PM 결정이다.

## 4. 만들지 못한 것과 부족한 데이터

**server.json — 만들 수 없다.**
- `PuzzleDefinition.accepted_answers`는 1개 이상이어야 한다. FE가 판정하고 서버가 완료만 기록하는 방식이어도 필수다. → 9종 모두 정답 값 또는 스키마 결정이 필요하다.
- `on_correct`(얻는 단서 · flag · 잠금 해제)가 9종 모두 미정이다.
- `scenes[].clear_when`: 9종과 장면 1~5의 연결 근거가 FE에 없다. FE 장면 종료는 개발용 `endScene(n)`뿐이다.
- `case_completion`(엔딩 필수 퍼즐)이 미정이다.

**client.json — 만들지 않았다.**
- `zone_type` · `object_type` · 초기 `visible`/`enabled` · `interaction`이 미정이다.
- 동굴(퍼즐 3~6)은 Z1~Z4 밖이라 넣을 Zone이 없다. 동굴 범위는 x 36~54 · z 44.5~88, 지하다.
- 9종 상호작용 28묶음(인스턴스 66개) 중 26묶음에 런타임 Object ID가 없다. 배치 무리가 없는 FE 코드 물건이라 PM 규칙의 `씬` 번호를 정할 수 없다.

**idmap**
- `objects[].local`은 `<배치 무리>#<번호>`만 받는다. 코드로 만든 FE 상호작용 ID(`cave-jar`, `ritual-cairn-3` 등)를 넣을 형식이 없다.
- `puzzles[]`는 `scene_id`가 필수인데, 9종의 장면이 미정이라 비워 두었다.
- PM 초안의 이야기형 퍼즐 `PUZZLE_ANGAM_01~10`과 단서 27개는 9종과의 관계가 미정이라 개발판에서 뺐다. 원본 초안은 그대로다.
- `content_version` · `content_fingerprint`가 없다(공식 4파일이 없으면 계산할 수 없다).

**ID 규칙 어긋남(보고만)**
- 후보 Puzzle ID의 `S1/S3/S4`는 idmap 장면 번호(1~5, 이야기 장면)와 다른 체계다. 예: 돌새 · 걸상의 배치는 `씬2`인데 후보 ID는 `S4`.
- `씬1.통발#0..2`의 최신 좌표(z 44.6~44.9)가 Z1 범위(z 30~44)를 살짝 벗어난다. 초안 Zone(Z1)을 그대로 두었다.
- `씬2.솟대#2`가 장면 2의 구역(Z4) 밖인 Z1에 있다. 초안부터 있던 경고다.

## 5. 결정이 필요한 최소 항목

**PM**
1. 9종 각각의 서버 판정 방식: 정답 검증(정답 값 제공)인지, FE 판정 + 완료 기록인지. 완료 기록이라도 `accepted_answers`에 넣을 값 또는 스키마 변경 여부.
2. 9종과 장면 1~5의 연결, 엔딩 필수 퍼즐 목록. 이야기형 `PUZZLE_ANGAM_01~10`과의 관계.
3. 동굴을 별도 Zone으로 둘지. 둔다면 런타임 ID와 진입 경로(돌탑 기우제 `parted` 뒤).
4. Puzzle ID 체계(`S1/S3/S4` 후보 대 장면 번호), 공식 `case_id` · 버전.
5. 서버 Item 사용 여부(제물 · `gearStone` · `bigPearl` · `scale` 등).

**FE**
1. 코드로 만든 상호작용 물건을 idmap에서 부를 로컬 키 형식. 지금 `registerInteractable` ID를 그대로 쓸지, 배치 무리를 만들지. BE idmap 스키마도 함께 바꿔야 한다.
2. 걸상별 상호작용 ID(서버로 보낼 대상이면).
3. 퍼즐마다 서버로 보낼 시점 이벤트(stage 전이 중 어느 것인지).
