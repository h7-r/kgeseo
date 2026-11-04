# 게시 상태 ↔ 세션 콘텐츠 저장소 연결 (v0.1, 팀 검토 대기)

코드: `app/services/content_release.py`, `app/services/publication_gate.rebuild_published_content`, `app/main.py`(lifespan),
세션 생성 guard(`app/services/play_session.py`, `app/api/v1/play_sessions.py`).

## 흐름

1. 운영자가 게시 루트에 원본을 둔다: `<PUBLISHED_CONTENT_ROOT>/<case_id>/v<content_version>/{client,server,npc,idmap?}.json`
2. 검증된 관리자가 G1~G3를 기록한다(`gate_review.create_gate_review`, `npc_approval_reviews`).
3. 관리 절차가 `publish_and_register()`를 부른다.
   - 원본을 한 번 읽는다(없으면 아무것도 하지 않는다).
   - `NpcPublicationService.publish_new()`: 승인 대상 잠금 → DB 승인 이력 + 재계산 fingerprint로 게이트 → 버전 · 상태 · 이력을 한 트랜잭션으로 commit.
   - commit 뒤 메모리 저장소(`PinnedContentStore`)에 등록한다.
4. 신규 세션(`POST /play-sessions` + `content_version`): 저장소에 그 버전이 있고, 같은 트랜잭션에서 읽은 DB 게시 상태가
   `published`이며 fingerprint가 같을 때만 만든다. 아니면 409 `CASE_VERSION_UNAVAILABLE`.
5. 진행 중 세션: 저장소의 고정 묶음을 그대로 쓴다(일반 · 긴급 중단에도 게임 · Bundle · Hint 유지, PM v0.4.6).

## 상태별 동작

| DB 상태 | 신규 세션 | 진행 중 세션 게임 콘텐츠 | 재시작 때 저장소 복구 |
|---|---|---|---|
| 없음 | 409 | — | 안 함 |
| `published` | 허용 | 유지 | 함 |
| `suspended` | 409 | 유지 | 함 |
| `blocked` | 409 | 유지 | 함 |

케이스 NPC 대사의 긴급 중단(generic 전환)은 NPC 라우터 쪽 정책이다. 현재 NPC 라우터의 승인 출처 기본값이 None이라
케이스 대사는 모두 미승인(generic)이다. 승인 출처를 DB에 연결할 때 `PublicationPolicy.serves_case_npc_content`를 함께 적용해야 한다.

## 재시작 복구

- 설정 `PUBLISHED_CONTENT_ROOT`가 비어 있으면 복구하지 않는다(DB도 읽지 않는다). 고정 세션은 모두 409다.
- 설정이 있으면 서버 시작 때 `restorable_versions()`(published · suspended · blocked)마다 원본을 읽어
  `npc_content_versions`의 불변 fingerprint와 재계산 값이 같은지 보고, 게이트와 같은 파싱 · 머리 · 스키마 · 장면 규칙으로
  묶음을 다시 만든다. 승인 · NG · 로컬 ID는 다시 판정하지 않는다(게시 뒤 철회는 게시본을 자동으로 내리지 않는다 — PM).
- 실패한 버전만 등록하지 않는다(오류 로그: case_id · 버전 · 상태 · 이유 코드만). 서버 시작은 막지 않는다.
- DB를 읽지 못하면 아무것도 등록하지 않고 시작한다. `sync_published_content()`로 다시 채울 수 있다(여러 번 불러도 된다).

## 운영 규칙(필수)

- 앱은 게시 루트에 쓰지 않는다. 게시한 버전의 파일은 바꾸거나 지우지 않는다. 바뀌면 재시작 때 그 버전은 비활성(`rebuild_failed:fingerprint`)이고
  그 버전에 고정된 세션은 409가 된다. 불변성은 저장소 권한 · 백업으로 보장해야 한다(앱이 보장하지 않는다).
- 다중 프로세스(워커 여러 개)에서는 저장소가 프로세스마다 따로다. 게시한 프로세스 밖의 워커는 재조정(`sync_published_content`) 전까지 409다.
