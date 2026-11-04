# 나주 콘텐츠 서버 연결 원칙 — PM v0.4.14 §B (11/4, 원칙만 · 실제 표 대기)

일반 대사 팩 정책 검사(v0.4.14 §A, `npc_pack_policy_v0414.md`)와 별개 안건이다. 퍼즐 순서 · 정답 · 장면 연결은
해랑 · 지하 대응표 전까지 확정하지 않는다. 나주 유효 콘텐츠 JSON은 작성하지 않았다.

## 1. PM 확정 원칙 🟢

| 항목 | 원칙 |
|---|---|
| ID | `case_id = "naju-angam-01"`, 첫 게시 `content_version = 1`, 퍼즐 `P01`~`P09`(본선 진행 순서) |
| 판정 | 값 퍼즐(번호 · 순서 · 선택 · 조합) = BE 판정, 정답은 `server.json`에만. 손놀림 퍼즐(게이지 · 회전 · 물리 배치) = FE 판정 후 완료 신고, `solve.mode: "client_skill"` |
| 엔딩 | 본선 경로 퍼즐 = 엔딩 필수, 본선 밖 = 선택(숨은 요소로 셀 수 있음) |
| 진행용 물건 | 제물 · 기어스톤 등 진행을 막거나 여는 물건은 `state_json.flags`(예: `item:gearstone=acquired|used`) + `flag_updated`. 인벤토리 · 조합 UI 없음 |
| 동굴 | 별도 입구(스테이지 게이트)가 있거나 그 안에만 있는 퍼즐 · 단서가 있으면 별도 Zone, 지나가는 길이면 이웃 Zone |

## 2. 현행 코드와의 차이 (조사, 변경 없음)

| 원칙 | 현행 | 필요한 것 |
|---|---|---|
| `client_skill` | **미지원.** `PuzzleDefinition`에 `solve` 필드가 없고(`extra="forbid"`라 넣으면 스키마 오류), `accepted_answers`는 1개 이상 필수, 완료만 받는 action이 없다(501) | 스키마 필드 · 완료 신고 action · 게이트 처리(정답 없는 퍼즐의 누출 · 정답 검사 제외) |
| 값 퍼즐 BE 판정 | 지원(`input` · `select` → `_grade_puzzle`) | 없음 |
| 엔딩 필수 | `case_completion.requires_puzzle_ids`로 표현 가능 | 대응표 |
| `flags` 문자열 값(`acquired|used`) | 상태는 `dict[str, Any]`지만 콘텐츠 효과 `set_flags`는 **bool만**, 장면 `clear_when`도 bool flag만 | 값 형식 결정: 예) bool 두 개(`item:gearstone:acquired` · `…:used`) 또는 문자열 값 지원(스키마 · clear_when 변경) |
| `flag_updated` | 있음(`flag`, `value`) | 없음 |
| 「state_changes 기존 5종」 | 현행 13종(`puzzle_completed` · `clue_acquired` · `zone_unlocked` · `current_zone_changed` · `hint_level_changed` · `flag_updated` · `object_revealed` · `object_hidden` · `object_unlocked` · `case_completed` · `item_acquired` · `item_consumed` · `scene_cleared`) | PM 문구와 대조 확인 |
| 인벤토리 폐기 | BE에는 아이템 획득 · 소비(`grant_item_ids` · `consumes_item_ids` · `item_acquired/consumed`)가 이미 있다 | 나주는 flags만 쓸지, 기존 아이템 기능을 쓰지 않는다는 뜻인지 확인 |
| 퍼즐 ID `P01` | idmap 초안은 `PUZZLE_ANGAM_01`~`10`(10개), 검증기는 `PUZZLE_` 접두가 아니면 경고(`RUNTIME_ID_PREFIX`) | 초안 · 검증기 접두 규칙 갱신(경고라 게시를 막지는 않음) |
| 동굴 Zone | Zone 추가는 콘텐츠(client.json · idmap · navigation) 변경만 | 대응표 |
| `case_id` | `SCENE_REQUIRED_CASES = {"naju-angam-01"}` 이미 있음(장면 정의 필수) | 없음 |

## 3. `client_skill` 완료 신고의 신뢰성

- 서버는 「풀었다」를 검증할 수 없다. 확인할 수 있는 것은 선행 조건(필요 단서 · 퍼즐 · 장면 도달) · 현재 구역 · 중복(`client_event_id` 멱등)뿐이다.
- 위조 완료가 가능하므로, 완료 이벤트에 판정 출처(`client_skill`)를 남기고 보상(현장 미션 · 지자체) · 순위 반영 여부를 PM이 정해야 한다.
- 게시 게이트의 `LEAK_CLIENT`(client.json 정답 누출)는 손놀림 퍼즐에 해당이 없다(정답 값 없음). 판정 로직이 FE 코드에 있다는 점은 게이트가 검사하지 않는다.
- 엔딩 필수 퍼즐이 `client_skill`이면 엔딩 판정도 클라이언트 신고에 의존한다 — 표에 「본선 · client_skill」 조합이 몇 개인지 확인 필요.

## 4. 다음 순서

1. 해랑(+지하): 퍼즐 9종 표(`P번호 | 이름 | Zone | 장면 | 본선/선택 | 판정 | 필요 단서 · 물건 | 결과`), 정답은 별도 전달
2. PM: flags 값 형식, `client_skill` 보상 · 순위 반영, 「5종」 · 인벤토리 문구 확인
3. BE: 확정 뒤 `client_skill` 스키마 · action 설계안 → 리뷰 → 구현, 그다음 `server.json` · `client.json` 작성
