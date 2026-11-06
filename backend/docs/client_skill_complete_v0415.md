# client_skill + complete — PM v0.4.15 (2026-11-04)

기준 커밋: `339c3446370b81d4b41e42d74fbad3796d08d9fb`.
독립 브랜치: `feat/SJ-client-skill-complete-v0415`.
NPC 일반 팩 정책 v0.4.15와 소셜 인증 통합을 가져오지 않았다.

## 조사와 호환성

기준 커밋의 실제 `PuzzleDefinition`에는 `solve`가 없고 `accepted_answers`가 1개 이상 필수였다. `input`과 `select`가 그 목록을 비교한다. 명시적인 다른 solve 모드 이름은 기존 계약에 없으므로 새로 만들지 않는다.

- 기존 값 퍼즐: `solve` 생략, `accepted_answers` 1개 이상. 기존 비교·정규화·오답 시도 횟수 동작을 유지한다.
- 새 손놀림 퍼즐: `"solve": {"mode": "client_skill"}`. `accepted_answers`는 생략 또는 `[]`만 허용한다. 가짜 정답을 넣을 필요가 없으며 비어 있지 않은 정답 목록은 거부한다.
- 알 수 없는 `solve.mode`, 잘못된 solve 형식은 콘텐츠 스키마 오류다.
- `input`/`select`로 client_skill을 채점하거나 `complete`로 기존 값 퍼즐을 완료하려 하면 409다. 이미 완료한 경우에도 모드 검증을 우회하지 않는다.
- 실제 나주 ID·퍼즐 순서·콘텐츠 JSON은 작성하거나 수정하지 않았다. 새 테스트는 가상 콘텐츠만 사용한다.

## 기존 Interaction 경로 확장

`POST /api/v1/play-sessions/{play_session_id}/interactions`에 action만 추가했다. 새 경로·테이블·칼럼·Alembic revision은 없다.

FE 요청 형식(아래는 실제 ID가 아닌 자리 표시자):

```json
{
  "client_event_id": "<UUID>",
  "client_timestamp": "<timezone-aware ISO timestamp>",
  "zone_id": "<ZONE_ID>",
  "action": "complete",
  "target_type": "object",
  "target_id": "<OBJECT_ID>",
  "payload": {}
}
```

Client Object는 `interaction: {"type": "complete", "target_id": "<PUZZLE_ID>"}`로 연결한다. 외부 target은 기존 input/select와 같이 Object ID이며, 서버가 고정된 콘텐츠에서 내부 퍼즐 ID로 해석한다. `target_type: "puzzle"`은 이 액션의 계약이 아니다.

`success`, `answer`, `stars` 등 FE가 주장하는 판정·보상 값을 받지 않는다. 빈 payload 외 필드는 422다. 클라이언트 타임스탬프는 기존 이벤트 정보이며 성공 증거나 서버 완료 시각으로 사용하지 않는다. 서버가 확인하는 범위는 승인된 완료 신고의 유효성이다. 손놀림 수행 자체를 서버가 재현·검증하는 프로토콜은 이번 계약에 없다.

첫 완료는 기존 응답의 `result_type: "correct"`, `attempt_count: 1`, `puzzle_completed` 및 기존 효과 state_changes를 반환한다. `on_correct`의 단서·Item·flags·Object 효과와 장면/Case 완료를 기존 경로로 적용한다. 새 이벤트로 이미 완료한 퍼즐을 요청하면 `already_completed`와 빈 효과 목록을 반환하고 시도 횟수를 올리지 않는다.

## 서버 검증과 원자성

1. 기존 PlaySession 행 잠금(`FOR UPDATE`)을 획득하고 세션에 고정된 콘텐츠 로더인지 확인한다.
2. 같은 세션·이벤트 ID의 저장 응답을 먼저 확인한다. 같은 요청이면 위치·콘텐츠를 다시 판정하지 않고 원래 interaction ID와 응답을 반환한다.
3. 신규 요청이면 현재 Zone, 해당 Zone의 Object 존재·complete 연결, 내부 퍼즐 존재·solve 모드를 확인한다.
4. 미완료 퍼즐의 Object 유효 visible/enabled, 선행 퍼즐·단서, 소비할 Item의 보유 여부를 확인한다.
5. 퍼즐 ID별 시도 횟수·완료, 서버 효과, 장면/Case 완료와 이벤트를 한 트랜잭션으로 저장한다. 이벤트 저장 실패 시 상태와 효과도 롤백한다.

complete의 이벤트 비교에는 action(저장 interaction_type), Object target, Zone, timestamp, payload를 모두 포함한다. 같은 ID에 주소나 timestamp를 바꾼 요청은 409 충돌이다. 재시도 시 이벤트 ID·timestamp·본문을 보존해야 한다. Pydantic이 파싱한 값으로 비교하므로 JSON 공백·키 순서는 의미가 없다. 기존 액션의 이벤트 저장·비교 형식은 변경하지 않았다.

complete 이벤트의 `target_id`는 외부 Object ID를 보존하고 `payload_json`에 Zone·timestamp·빈 payload를 기록한다. 퍼즐 완료 기록과 state_changes는 내부 puzzle ID를 사용한다. 판정 출처는 `interaction_type: "complete"`로 구분한다.

게시 시 Client/Server 참조 검증에 complete 연결을 포함한다. idmap에서 실행 불가한 퍼즐을 complete가 참조하는 경우 기존 `EXECUTABLE_REFS`를 통과하지 못한다. 정답이 없는 skill 퍼즐은 기존 누출 검사의 정답 목록이 비어 있으며 단서·힌트 검사는 계속 적용된다. NPC 일반 팩 정책 코드는 변경하지 않았다.

## 혼합 단계·Item·통계

혼합 퍼즐의 각 단계를 별도 puzzle ID로 정의하고 다음 단계의 `requires_puzzle_ids`에 이전 단계 ID를 지정한다. 기존 참조 존재·중복·자기 참조·순환 검사를 그대로 적용한다. 값 판정과 client_skill 단계를 함께 연결할 수 있다.

기존 `grant_item_ids`, `consumes_item_ids`, `acquired_item_ids`, `consumed_item_ids` 계약을 사용한다. 이미 소비한 Item은 다른 미완료 퍼즐에서 재사용할 수 없다. 완료한 퍼즐의 재요청은 Item 소비와 보상을 다시 적용하지 않는다.

사용자 추가 지시에 따라 통계 저장 구조를 변경하지 않았다.

| 항목 | 현재 저장·처리 |
|---|---|
| 완료 | `state_json.completed_puzzle_ids`, 퍼즐 ID별 유일 기록 |
| 시도 횟수 | `state_json.attempt_counts[puzzle_id]`; 유효한 첫 complete는 1회, 중복 완료는 증가 없음 |
| 힌트 | `state_json.hint_levels[puzzle_id]` 유지; complete가 덮어쓰거나 차감하지 않음 |
| 도움 사용 | 기존 `PlaySession.help_used` 세션 누계 유지; complete는 변경하지 않음 |
| 힌트 잔액 | 기존 `PlaySession.hint_balance` 유지; complete는 변경하지 않음 |
| 별 점수 | 기준 Backend 모델·서비스·스키마에서 산정·저장 구현 없음. 임의로 추가하지 않음 |

공유 퍼즐 호스트 종류 집합에 complete를 추가하여 기존 Hint 발견 판정과 공개 퍼즐 맥락이 skill Object를 인식하게 했다. Hint API의 저장 구조·차감 규칙은 변경하지 않았다.

**후속 계약:** PM의 퍼즐 ID 단위 통계와 세션 누계 `help_used` 사이의 차이, 별 산정·저장·지급/랭킹 반영 규칙은 별도 확정이 필요하다. 이번 작업에서 퍼즐별 help_used나 별 필드를 만들지 않았다.

## 남은 FE 연동

- 손놀림 성공 후에만 빈 payload의 complete를 기존 Interaction 경로로 전송한다.
- 콘텐츠의 Object → puzzle 연결과 현재 Zone ID를 사용한다. 별도 API나 임의 정답을 만들지 않는다.
- 네트워크 재시도는 같은 client_event_id·timestamp·본문을 유지한다. 별도 사용자 동작은 새 ID를 사용한다.
- `puzzle_completed`, Item/flag/Object/scene/Case state_changes를 기존 처리기에 연결한다. 같은 interaction ID의 재응답을 FE에서도 중복 연출·보상으로 처리하지 않는다.
- 409 선행 조건/Zone/모드 불일치를 처리하고 서버 상태를 다시 읽는다. FE의 별 표시·로컬 통계는 별도 계약 전까지 서버 보상으로 해석하지 않는다.
- 실제 나주 퍼즐·호스트 대응표와 단계별 ID는 콘텐츠 담당자가 확정해야 한다.

## 변경 파일

- `app/schemas/puzzle_runtime.py`: solve 스키마, legacy 정답 필수/skill 정답 없음 검증.
- `app/schemas/interaction_api.py`, `app/schemas/interaction.py`: 외부/내부 complete 요청 모델.
- `app/services/external_interaction.py`: complete 어댑터(잠금 전에 Object를 해석하지 않음).
- `app/services/interaction.py`: 완료 판정·모드 보호·기존 효과/트랜잭션 재사용·complete 이벤트 비교.
- `app/api/v1/interactions.py`, `app/api/v1/error_responses.py`: 모드 불일치 409와 OpenAPI 오류 설명.
- `app/services/case_content_validation.py`, `app/services/publication_gate.py`: complete 참조 검증. 일반 팩 검사 부분은 변경 없음.
- `app/services/puzzle_question.py`: 공유 퍼즐 호스트 종류 집합에 complete 추가.
- `tests/client_skill_case.py`, `tests/test_client_skill_complete.py`, `tests/test_client_skill_complete_mysql.py`: 가상 콘텐츠·HTTP/모델/게시·격리 MySQL 검증.
- `tests/test_interactions.py`: OpenAPI 요청 union에 승인된 complete 추가 확인.
- 이 문서.

## 검증 결과

- 신규 완료/격리 MySQL/기존 Interaction 묶음: **54 passed** (게시 게이트 테스트 추가 전).
- 실제 MySQL에서 같은 이벤트 동시 재시도, 서로 다른 이벤트의 동시 완료, 서로 다른 본문 충돌, 단계별 Item 소비·장면/Case 완료, 이벤트 INSERT 실패 후 전체 롤백 및 재시도 성공 검증.
- 전용 MySQL 8.0.46: `127.0.0.1:33318`, worktree `tmp/mysql-skill/data`, 새 schema `test_npc_idem_skill_v0415`. 테스트가 포트·schema·실제 datadir·빈 테이블을 검사하고 기존 migration 체인을 적용·정리한다.
- 격리 MySQL을 포함한 Backend 전체 pytest: **2,330 passed / 28 skipped / 39 warnings**, 322.01초. 신규 정상 완료·모드 불일치·선행 조건·존재/Zone·중복/재시도·본문 충돌·Item/완료 원자성·게시 및 기존 Interaction/NPC/Hint 회귀를 포함한다.
- 미실행 28개: 별도 승인 DB 설정(`APPROVAL_MYSQL_ISOLATED`)이 필요한 승인 저장 13개와 저장 승인 게시 7개, opt-in 소셜 온보딩 7개, 환경상 만들 수 없는 심볼릭 링크 1개. 기존 deprecation 경고 39건은 httpx/BlockingPortal/datetime.utcnow 관련이다.
- 최종 `ruff check backend` 및 `git diff --check`: PASS.
- Alembic·DB 모델·소셜 인증 파일·NPC 일반 팩 정책 파일·실제 콘텐츠 변경 없음. 기존 NPC/소셜 worktree는 clean이며 NPC v0.4.15 worktree의 `f25f74a`도 그대로 유지했다.
- 격리 MySQL은 실제 datadir를 다시 확인한 뒤 종료했다.
- push·PR·merge·운영 DB 변경 및 실제 콘텐츠 수정은 하지 않는다.
