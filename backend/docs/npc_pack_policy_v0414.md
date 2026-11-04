# 일반 대사 팩 정책 검사 — PM v0.4.14 §A 반영 (11/4, 팀 검토 대기)

기준: PM 「세진님 회신 — 일반 팩 정책 검사 · 나주 퍼즐 서버 연결 (11/4)」 계약 v0.4.14 §A, 팀 결정(11/4 4건).
코드: `app/services/dialogue_pack_policy.py`, `npc_general_pack.read_published_cases`, `api/v1/npc.get_general_pack_policy`,
`publication_gate`(`GEN_PACK`), `nickname_policy.forbidden_terms_in`. 운영 · 개발 DB · 배포 설정은 바꾸지 않았다.

## 1. 사용 조건 (변경 없음 + 정책 검사 실체화)

| 대상 | 필수 |
|---|---|
| `case_content` | G1 · G2 · G3 (그대로) |
| `dialogue_pack` | G3 승인 **and** 정책 검사 PASS **and** 공급 설정 `NPC_GENERAL_PACK` |

- 정책 검사를 통과해도 G3 기록을 만들거나 팩을 켜지 않는다. G3 판정 · 정책 검사 · 공급은 따로 판정 · 표시한다.
- 차단 중 `reply: null`, 승인 철회 뒤 재전송 미노출은 그대로다(테스트 유지).

## 2. 검사 6종과 데이터 출처

| 코드 | 판정 | 데이터 출처 · 의미 |
|---|---|---|
| GEN-LEAK | 게시 케이스마다 기존 출력 검사 `check_generated_line` 재사용 | 「아무것도 풀지 · 얻지 · 해금하지 않은 상태」로 정답(짧은 정답 포함, 기존 규칙) · 미공개 단서(title/summary/body) · 힌트(8자 연속 또는 핵심어 2개) · npc.json `ng[]`. U 단정은 v0.4.14 표에 없어 제외. `ng` 없으면 UNVERIFIED |
| GEN-CASE | **고유명 계약 필드 없음 → 게시 케이스가 있으면 UNVERIFIED** | zone_name · object_name · clue title을 고유명으로 간주하지 않는다(팀 결정). 목록이 주어지면 기존 정규화로 포함 검사 |
| GEN-WORD | 닉네임 금칙어 검사 그대로 | `FORBIDDEN` 10개(욕설만, 혐오어 목록 없음) · NFKC · casefold · leet · 부분 포함. 목록 · 예외 추가 없음 |
| GEN-SYS | `GENERIC_PAUSE_*`만 | PM 예시 6개(오류 · 서버 · 점검 · 버그 · 연결 · 시스템), 공백 제거 후 포함 |
| GEN-TIME | `GENERIC_PAUSE_*`만 | PM 예시 3개: 「곧」(한 낱말일 때만) · 「몇 분」 · 「잠시 뒤 돌아」(공백 제거 후 포함). 「잠시만 기다려 주세요」 · 「잠시 숨을」 · 「곧장」 · 「뒤를 돌아봐요」는 해당 없음 |
| GEN-LEN | 전 문장 | 80자 이하(코드 포인트) |

결과: 전체(PASS/FAIL/UNVERIFIED) · 검사별 상태 · 근거(`code` · `line_id` · `ANSWER:<case>@v<n>:<puzzle_id>` · `term:서버` ·
`length:81` · `proper_name:<case>@v<n>:<목록 위치>` 등). 정답 · 미공개 문장 원문은 근거에 없다.

### 게시 케이스 범위 (팀 결정)
- 게시 DB(`npc_publication_states`)의 published · suspended · blocked 버전 전부. 내용은 메모리 저장소의 검증된 게시본.
- DB를 읽지 못하거나, 한 버전이라도 저장소에 없거나 fingerprint가 다르면 「전체 확인 불가」 → GEN-LEAK · GEN-CASE UNVERIFIED.
- 게시 케이스 0개면 두 검사는 PASS(대조 대상 없음).
- **레거시 `case_001`은 계약 공백**이다(게시 체계 밖, npc.json · NG 없음, NPC 409라 일반 팩이 나오지 않음). 대상에 넣지 않았고
  DB에 등록하지 않았다. 참고로 공식 팩과 case_001 정답 · 힌트는 겹치지 않았다(정보용 확인).

### 판정 시점
- NPC 턴마다 라우터 의존성이 게시 케이스를 읽어 그 요청 동안 고정한다(잠금 없는 마지막 commit 값). 게시 확정 직후 저장소 등록 전
  순간에는 「확인 불가」라 그 사이 일반 팩을 쓰지 않는다(fail closed).
- 확인 명령: `python -m scripts.general_pack_status general_default/v1 [--db]` — `--db`는 게시 루트(`PUBLISHED_CONTENT_ROOT`)
  원본으로 대조하고 `g3_approval` · `supplied` · `usable`을 따로 출력한다(읽기 전용).

## 3. 새 케이스 게시: 설정된 일반 팩 재검사 (`GEN_PACK`, 팀 결정)

| 설정 `NPC_GENERAL_PACK` | 결과 |
|---|---|
| 비어 있음 | NOT_APPLICABLE(게시 흐름 그대로) |
| 팩 파일을 읽지 못함 | FAIL `general_pack:<이유>` → 게시 거부 |
| 새 케이스와 GEN-LEAK · GEN-CASE 충돌 | FAIL → 게시 거부(어느 쪽을 고칠지 PM) |
| 새 케이스 `ng` 없음 · 고유명 목록 없음 | UNVERIFIED → 게시 거부 |

- 게이트 결과 이유: `GEN-LEAK:<line_id>:ANSWER:<case>@v<n>:<puzzle_id>` 등 ID만.
- `publish_new` · `resume` · 개발 로더(`load_and_publish`)가 같은 게이트를 쓴다. 서버 재시작 복구는 게이트를 다시 돌리지 않는다
  (이미 게시된 케이스 원본 · 상태는 바꾸지 않음).
- 동시성: 재검사 대상은 저장소의 고정 팩 파일과 게시하려는 원본 스냅샷뿐이라 DB 경합이 없다. 같은 버전 동시 게시 3건이 모두
  거부되고 상태 · 저장소에 남지 않음을 격리 MySQL로 확인했다.
- **팩을 나중에 켤 때**: 설정을 켜는 절차에 「기존 게시 케이스 전체와 재검사」가 필요하다. 지금은 NPC 턴마다 정책 검사가 게시 케이스
  전체와 대조하므로 충돌하면 팩이 쓰이지 않는다(자동 차단). 켜기 전 `general_pack_status --db`로 `policy`를 확인한다.

## 4. 현재 실제 상태 (11/4)

- 공식 `general_default/v1`: 원문 · fingerprint(`sha256:a625988f…cea086be`) 그대로. 정적 검사(GEN-WORD · SYS · TIME · LEN) PASS.
- **운영에서 일반 팩은 아직 쓸 수 없다.** 이유:
  1. **GEN-CASE 고유명 데이터 계약 없음** → 게시 케이스가 하나라도 있으면 UNVERIFIED. 「잠시 멈춤」은 긴급 중단(게시 기록이 있는
     케이스) 때만 나오므로, 이 계약 전에는 사실상 쓰일 수 없다.
  2. 게시 케이스 npc.json에 `ng`가 없으면 GEN-LEAK UNVERIFIED.
  3. 실제 G3 승인 기록 없음(이 노트북은 대상 DB 미설정, 승인 INSERT 안 함). 공급 설정(`NPC_GENERAL_PACK`)도 운영 미적용.
- 같은 이유로 일반 팩을 설정한 상태에서는 **새 케이스 게시도 GEN-CASE UNVERIFIED로 막힌다**(설정이 비어 있으면 영향 없음).

## 5. 필요한 계약 (PM)

1. 고유명 데이터: 예) `server.json` 또는 `npc.json`에 `proper_names[]`(설화 인물 · 장소 · 퍼즐 · 단서 이름) — 필드 위치 · 작성 책임 · 비교 규칙(낱말/부분 포함)
2. GEN-WORD: 혐오어 목록 필요 여부. 현재 부분 포함 규칙은 「둘러보지 않아도」 · 「자지 마세요」 같은 정상 문장을 FAIL로 잡는다(테스트로 고정한 알려진 오탐, 공식 문장은 해당 없음)
3. GEN-SYS · GEN-TIME: PM 예시 외 표현(예: 「금방」 · 「N분 후」 · 「잠시 후 돌아」)을 넣을지
4. 레거시 `case_001`을 게시 케이스로 볼지(게시 체계 편입 여부)
5. 일반 팩 활성화 절차(재검사 · 승인 · 설정 순서)를 운영 문서로 확정
