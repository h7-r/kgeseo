# 나주 퍼즐 · 오브젝트 ID 대응 검토표 (11/5, 확인용 · 확정 아님)

- 목적: 나주 공식 콘텐츠(`client.json` · `server.json` · `npc.json` · idmap)를 쓰기 전에, 흩어진 자료의 ID를 **바꾸지 않고** 나란히 놓는다.
- 기준 코드: `origin/main` @ `85a6e50`(FE `naju01/src` 포함). 문서는 코드 · 콘텐츠를 바꾸지 않는다.
- 게시 경로 · 검사 쪽은 `backend/docs/naju_case_publication_implementation_plan.md`.

## 1. 이 표의 원칙 (PM v0.4.15 협의 반영)

1. **퍼즐 ID는 해랑님 퍼즐 진행표의 `P01`~`P13` 체계를 그대로 쓴다.** 하위 퍼즐(`P02-2` 등)을 허용한다. 임의로 다시 번호를 매기지 않는다.
2. 서버 판정과 `client_skill`은 **ID가 아니라 `solve.mode`로 구분**한다. 화면(손놀림) 판정 퍼즐도 진행표 ID를 그대로 갖는다.
3. 장면 · 단순 상호작용(줍기 · 문 열기 · 연출 시작)을 무조건 퍼즐로 등록하지 않는다.
4. 자료끼리 이름 · 번호가 다르면 합치지 않고 **확인 필요**로 남긴다.
5. `solve.mode` 스키마는 학원 PC의 v0.4.15 · `client_skill` 코드에 있다(원격 미반영). 이 표의 `solve.mode` 칸은 진행표의 판정 구분을 옮긴 **후보**다.

> 정정: 11/4 조사에서 낸 「서버 판정 퍼즐만 추려 P01~P09로 재번호」 안은 **채택하지 않는다**.
> `backend/docs/naju_content_principles_v0414.md`의 「퍼즐 `P01`~`P09`(본선 진행 순서)」 문구도 진행표(`P01`~`P13`)와 다르다 — 문서 갱신 필요(§6-1).

## 2. 자료 출처

| 기호 | 자료 | 위치 | 비고 |
|---|---|---|---|
| **진행표** | 해랑님 퍼즐 진행표 | **저장소에 원본 없음.** 인용본: `docs/naju/NPC_대화창_BE계약_파악_1104.md` §4-2 | 인용본 자체가 「초안 — 해랑이 채울 것」, 안내판 대응에 ❓가 많다 |
| **FE** | 나주 코드 | `naju01/src/puzzles/**` (`registerInteractable` id · `setPuzzlePanel` id) | 현재 main 기준으로 다시 뽑음 |
| **초안 idmap** | PM 초안(10/27) | `docs/naju/naju-angam-01.idmap.draft.json` | 퍼즐 `PUZZLE_ANGAM_01~10`(이야기형, 전부 `unplaced`), 물건 13개 전부 `placed_no_interaction` |
| **개발판** | BE 개발용 골격(11/3) | 로컬 전용 커밋 `dbb7e0d` `backend/content_drafts/naju/` (원격 없음) | FE `5f88aa6` 기준, 후보 ID `PUZZLE_S*`(채택 안 함 — 참고만) |
| **원칙** | PM v0.4.14 §B | `backend/docs/naju_content_principles_v0414.md` | `case_id` · 판정 원칙 · 동굴 Zone 규칙 |

## 3. 진행표 퍼즐 대응표

칸 설명: **FE 상호작용 ID** = 지금 main의 `registerInteractable` id(`${k}`는 번호). **안내판** = `setPuzzlePanel` id와 화면 제목.
**호스트 Object** = 초안 · 개발판에 있는 런타임 Object ID(없으면 —). **선행 · 물건** = FE 코드에서 확인한 것만(근거 파일).

| 진행표 ID | 이름(진행표) | Zone | FE 상호작용 ID | 안내판(제목) | 호스트 Object | 판정(진행표) → `solve.mode` 후보 | 선행 · 물건(FE 근거) | 미확정 |
|---|---|---|---|---|---|---|---|---|
| P01 | 조개 숨구멍 캐기 | Z1/Z2 ❓ | `clam-hoe` · `clam-hole-${k}` · `clam-pick` | `clam-dig`(숨구멍 — 조개 캐기) | — | 서버 | 호미 줍기(`clam-hoe`) → 조개 → 통발 미끼(`ClamDig.tsx` `baiting`/`baited`) | Zone, 호스트 Object 신규 여부, 개발판의 `clam-spot`은 지금 `clam-hole-${k}` |
| P02 | 통발 고르기 | Z1 | `fish-trap-${index}` · `fish-trap-stake-${index}` | — | `OBJ_S1_FISH_TRAP_0..2`(초안 · 개발판, 초안은 상호작용 없음) | 서버(`select` 후보) | 조개 미끼(P01) | 고르는 값 · `accepted_answers`, 최신 좌표가 Z1 범위를 살짝 벗어남(개발판 경고) |
| P02-2 | 떨리는 줄 당기기(게이지) | Z1 | (게이지 HUD, 상호작용 ID 없음 — `PullGaugeHud.tsx` · `pullGauge.ts`) | — | — | 화면 → `client_skill` | P02 | 결과물 빛 물고기(`lightFish`)와의 연결 |
| P03 | 소리로 항아리 맞추기 | Z2/물굴 ❓ | `jar-${index}` · `jar-slot-${slot}`(장독대, `jars/JarPuzzle.tsx`) | **없음**(인용본은 `cave-stations` ❓) | — | 서버 | 결과 쌀(`rice`, `JarPuzzle.tsx`) → 기우제 제물 | 인용본의 `cave-stations`(엎어진 독 · 진주 빛 잇기, `AirStations.tsx`)와 장독대 항아리가 다른 퍼즐로 보임, 동굴 `cave-jar`(엎어진 독)와의 관계 |
| P04 | (인용본에 없음) | — | — | — | — | — | — | **진행표 확인 필요** |
| P05 | 돌탑 → 기우제 | Z1 ❓(인용본 Z1, 초안 돌탑 Z1) | `ritual-cairn-${index}` · `ritual-table` | — | `OBJ_S1_CAIRN_0`(초안 · 개발판, 상호작용 없음) | 서버 | 제물 3종 `lightFish` · `rice` · `makgeolli`(`RitualCircle.tsx` `OFFERINGS`), 막걸리는 배 술병(`boat-bottle-*`) | 제물을 Item으로 둘지 flags로 둘지(v0.4.14 §B 원칙은 flags) |
| P05-2 | (요청서에 언급) | — | — | — | — | — | — | **진행표 인용본에 없다.** 인용본의 하위는 P02-2 · P09-2 · P13-2. 같은 표기 체계인지 팀 확인 |
| P06 | (인용본에 없음) | — | — | — | — | — | — | **진행표 확인 필요** |
| P07 | 조개 진주 빛 잇기 | 물굴 | `cave-source-pearl` · `cave-clam-${k}` · `cave-big-clam` | `cave-stations`(진주 빛 잇기) — 인용본은 `cave-ring` ❓ | — | 화면 → `client_skill` | — | 인용본의 `cave-ring` 대응은 FE와 다름(아래 P08 · P09) |
| P08 | 물고기 굴 차례 | 물굴 | `cave-burrow-${k}` · `cave-burrow-pot` | `cave-burrows`(물고기 굴) | — | **확인 중** | — | 서버/화면 판정 미정. 별도 안내판 `cave-ring`(돌 고리 — 물고기 몰기, `Fishes.tsx`)이 어느 진행표 ID인지 미정 |
| P09 | 물레 고리 숫자 | 물굴 | `cave-valve` · `cave-gear-${k}` · `cave-tablet` | `cave-door`(물레 고리문) — 인용본은 `cave-ring` ❓ | — | 서버 | 뜬 돌 `floatStone` · 톱니돌 `gearStone`(`RingDoor.tsx`) | 숫자 정답, 톱니돌 획득처 |
| P09-2 | 물레 돌리기 | 물굴 | (`cave-valve` 회전 — 같은 파일) | `cave-door` | — | 화면 → `client_skill` | P09 | 개발판의 `cave-valve-rim-*`는 지금 코드에 없다 |
| P10 | 벽화 받침 순서 · 진주 | 석실 ❓ | `cave-pedestal-${k}` · `cave-altar` · `cave-socket` · `cave-scale` | `cave-chamber`(바위 홈 · 석실 받침) | — | 서버(오답 숨 −8s · 3s 잠김) | 큰 진주 `bigPearl` · 푸른 눈물 `scale` · 아랑사의 함 `letterBox`(`InnerChamber.tsx`) | 석실 Zone, 진행표 「큰 진주 소비」와 FE의 세 물건 차이 |
| P11 | 지게 · 궤 옮기기 | Z4 ❓ | `ridge-jige-${k}` · `ridge-jige-grab-${k}` · `ridge-knot` · `ridge-cart` · `ridge-cart-fit` · `ridge-cart-unload` · `ridge-chest` · `ridge-chest-jige` · `ridge-wheel` · `ridge-altar` | **없음**(인용본은 `ridge-posts` ❓) | — | 화면(물리) → `client_skill` | — | `ridge-posts` 안내판은 장승 고리(P12)다 |
| P12 | 천하대장군 장승 고리 | Z4 ❓ | `ridge-post-ring-${i}` · `ridge-chest-lid` | `ridge-posts`(장승 고리) | — | 서버 | — | 고리 정답 |
| P13 | 통나무 걸상 순서 | Z4 | `ridge-platform-story`(걸상별 ID 없음) | `ridge-stumps`(통나무 걸상) | `OBJ_S2_STOOL_0..4`(개발판만, 「새로 추가」) | 서버 | — | 걸상별 상호작용 ID, 개발판 Object ID 채택 여부 |
| P13-2 | 돌새 마주 보기 | Z4 | `ridge-statue-${k}` · `ridge-jar-reflection` · `ridge-fossil` | — | `OBJ_S2_SOTDAE_0..1`(개발판만) | 화면 → `client_skill` | 푸른 눈물 `scale`(`BirdHints.tsx`) | 초안은 `OBJ_S2_SOTDAE_2`만(Z1) |

## 4. 퍼즐로 등록하지 않을 후보 (단순 상호작용 · 장면 · 연출)

원칙 3에 따라 진행표 ID가 없는 상호작용은 퍼즐로 올리지 않는다. 진행 조건이 필요하면 flags · 단서 · 장면으로 다룬다(v0.4.14 §B).

| FE 상호작용 ID · 안내판 | 하는 일(코드) | 다룰 곳(후보) |
|---|---|---|
| `float-stone-${index}` · `river-parting`, 안내판 `float-stones`(물에 뜬 돌) | 뜬 돌 넷 건지기 → 강물 갈라짐 | 진행 flags(`floatStone`은 P09 재료) · 장면 |
| `cave-door` · `ring-door-open` | 물레 문 열림 | P09 결과 |
| `cave-jar`(엎어진 독), 안내판 `cave-stations` 첫 제목 | 공기 · 숨 보조 | 단순 상호작용 — P03과의 관계 확인 |
| `cave-exit` · `rift-entry` | 출구 · 틈 진입 | 이동(navigate) |
| `legend-${id}`(`lantern` · `oar` · `prints` · `ribbon` · `stele` · `wreck`) | 전설 흔적 보기 | 단서(inspect) 후보 |
| `world-item-${uid}` · `boat-bottle-*` | 물건 줍기 · 막걸리 얻기 | 진행 flags / Item(결정 대기) |
| `hearth-promise` · `birds-awakening` · `birds-circling` · `box-shadow-play` | 연출 · 장면 | 장면 |
| `ridge-box-lock` · `ridge-platform` · `ridge-paper` | 청동 열쇠 `bronzeKey`로 함 열기 · 낡은 종이 읽기(`BoxOpening.tsx` · `oldPaper.ts`) | 단서 · 진행 flags — 퍼즐 여부 확인 |

## 5. 호스트 Object · 로컬 키

- 초안 · 개발판 idmap의 `objects[].local`은 배치 키 `<배치 무리>#<번호>`만 받는다(`backend/app/services/idmap_validation.py` `OBJECT_LOCAL_KEY`).
- Object ID 규칙: `OBJ_S<씬>_<영문>_<번호>`(`OBJECT_ID_RULE`, 배치 무리의 `씬N`과 같아야 함).
- 위 표의 FE 상호작용 대부분(`cave-*` · `ritual-*` · `ridge-*` 등)은 **코드로 만든 물건이라 배치 키가 없다** → 지금 idmap 형식으로는 호스트 Object를 만들 수 없다.
  - 결정 필요: 코드 물건에 배치 무리를 만들지, idmap이 `registerInteractable` id를 로컬 키로 받게 바꿀지(BE 스키마 · 게이트 `LOCAL_IDS` 함께 변경).
- 게시 게이트 `LOCAL_IDS`는 idmap의 로컬 키가 FE에 실제로 있는지 본다 — 이 결정 전에는 목록을 만들 수 없다.
- 개발판의 FE ID 목록(`naju_fe_ids.dev.json`)은 FE `5f88aa6` 기준이다. 지금 main과 다른 것(11/5 대조):
  `clam-spot` → `clam-hole-${k}`(`ClamDig.tsx`), `cave-valve-rim-{n}`은 지금 코드에 없다. 그 밖의 대조 대상 ID는 그대로 있다.
  공식 목록은 개발판을 고치지 말고 v0.4.14 이후 기준으로 새로 만든다(게시 계획 문서 §6 5-1).

## 6. 자료 사이의 불일치 (통합하지 않음)

### 6-1. 퍼즐 번호 · 개수
| 자료 | 퍼즐 |
|---|---|
| 진행표(인용본) | P01 · P02 · P02-2 · P03 · P05 · P07 · P08 · P09 · P09-2 · P10 · P11 · P12 · P13 · P13-2 (P04 · P06 없음) |
| 요청서 | P05-2 언급 |
| PM v0.4.14 §B 문서 | 「`P01`~`P09`(본선 진행 순서)」 |
| 초안 idmap | `PUZZLE_ANGAM_01~10`(이야기형, 진행표와 관계 미정) |
| 개발판 | `PUZZLE_S1_FISH_TRAP` 등 9종 후보(채택 안 함) |

### 6-2. 안내판 대응
- 인용본 ❓ 칸과 FE 코드가 다르다: `cave-ring`은 「돌 고리 — 물고기 몰기」(`Fishes.tsx`), 물레는 `cave-door`(「물레 고리문」), 진주 빛 잇기는 `cave-stations`, `ridge-posts`는 장승 고리.
- 「돌 고리 — 물고기 몰기」(`cave-ring`)에 대응하는 진행표 ID가 없다.

### 6-3. Zone
- 동굴(물굴) · 석실은 Z1~Z4 밖이다(물굴 x 36~54 · z 44.5~88). v0.4.14 §B 원칙상 별도 입구 · 그 안의 퍼즐이 있으면 별도 Zone — 런타임 ID 미정.
- P01 · P03 · P05 · P11 · P12 · P13의 Zone은 인용본에서 ❓.

### 6-4. 물건
- 인용본 Item 표의 「호미 · 조개 미끼 · 통발 · 공기주머니 · 낡은 종이」가 FE `inventory.ts` ITEMS에 없고, FE의 「푸른 눈물(`scale`) · 진주(`pearl`) · 짚신 한 짝(`strawShoe`)」은 이름이 다르다.
- v0.4.14 §B는 진행 물건을 flags로 두라고 했다 — BE에 이미 있는 Item 획득 · 소비를 쓸지와 함께 결정 필요.

## 7. 팀 확인 질문

**해랑님(+지하님)**
1. 진행표 원본 공유 — P04 · P06의 정체, P05-2가 있는지(인용본의 P02-2 · P09-2 · P13-2와 같은 체계인지).
2. 위 §3 FE 상호작용 · 안내판 대응이 맞는지(특히 P03 · P07 · P08 · P09 · P11, 「돌 고리 — 물고기 몰기」).
3. 퍼즐별 Zone · 장면 · 본선/선택 · 엔딩 필수 여부, 서버 판정 퍼즐의 정답(별도 전달).
4. 코드로 만든 물건의 로컬 키 형식(§5).

**PM**
1. v0.4.14 §B 문서의 「P01~P09」 문구를 진행표 체계로 고칠지.
2. 진행 물건: flags만인지, 기존 Item 기능을 쓸지. flags 값 형식(bool 두 개 vs 문자열 값).
3. 동굴 · 석실 Zone 신설과 런타임 ID.
4. 초안 idmap의 이야기형 `PUZZLE_ANGAM_01~10` · 단서 27개를 진행표와 어떻게 이을지.
