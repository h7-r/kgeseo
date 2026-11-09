# 게시 CLI + NPC v0.4.15 + client_skill 통합

기준: `feat/SJ-npc-client-skill-integration` / `a73dfaf8e70b3426aced4ddf47b1aea34f32b523`.
브랜치: `feat/SJ-publication-policy-integration`.

## 계보와 반영 범위

원격 게시 브랜치의 실제 공통 기준은 main `85a6e505388e35763e7a23874496f6c3ae6d9149`다.
현재 브랜치에 없는 커밋은 아래 세 개뿐이며 순서대로 출처를 기록해 반영했다.

1. `81c7b48ebc31d764baf57ff14fa40fb01ba1a2bc`: 승인·게시·복원 확인 CLI.
2. `6b8de7de98d702d02babecbd134a73a3523bc41e`: 넛지 NG/U 검사기.
3. `d12c93d350d26d4792b767f8fab909c93c71788b`: CLI 평가·게시 경로의 검사기 및 snapshot 연결.

텍스트 충돌은 없었다. 이전 NPC 정책·complete 구현은 다시 적용하지 않았다.
의미상 호환성 보완은 기존 누락 테스트의 fixture 보정과 CLI POLICY_DATA 설명 추가다.

v0.4.15의 base_documents는 이미 ng=[]를 담는다. 과거 테스트는 필드에 값을 넣지 않는
방법으로 누락을 만들었으므로 이제 실제로 누락되지 않았다. test_case_ng_check와
test_case_publication_ng_integration에서 누락 대상 키를 명시적으로 제거하도록 바꿨다.
런타임·게시 판정을 완화하거나 새 기본값을 넣지 않았다.

## NPC 필드와 NG/U 판정의 구분

- 신규 게시에서 ng 및 proper_nouns는 필수다. 누락/null은 POLICY_DATA 실패다.
  proper_nouns의 text/kind(person 또는 place)/aliases 형식을 유지한다. 명시적 []는 유효하다.
- open은 현재 NpcContentPack의 호환 읽기 모델에서 선택 필드다. 이번에 필수 스키마 필드로
  바꾸지 않는다. 다만 NG/U 검사 근거로 ng와 open이 모두 필요하므로 open 누락/null이면
  NG는 UNVERIFIED이고 게시가 차단된다. POLICY_DATA는 이때 PASS일 수 있다.
- proper_nouns만 누락되면 빈 ng/open의 NG는 PASS여도 POLICY_DATA 실패로 게시되지 않는다.
  검사별 의미를 합치거나 누락을 []로 바꾸지 않는다.
- ng=[] 및 open=[]는 NG/U 위반 규칙이 없다는 명시적인 검수 데이터다. NG PASS일 뿐
  fingerprint·승인·이름·누출·idmap·로컬 ID 등 다른 검사를 통과시켜 주지 않는다.

검사기는 기존 policy_rules_from_pack, npc_generation_policy의 _forms/_contains를 재사용한다.
NG patterns가 없으면 기존 규칙대로 text를 비교하며, 정규화 후 비교할 수 없는 규칙이
하나라도 있으면 검사기를 만들지 않아 UNVERIFIED다. U는 patterns가 필요하다. 현재
pack 변환에는 hedges가 없어 패턴 일치를 모두 보수적으로 차단한다. 임의의 유보 허용
문구나 새 규칙을 만들지 않았다.

검사 범위는 기존 계약의 general_nudges와 puzzles[].nudges다. fallback_lines와
npc_scenario를 임의로 포함하지 않았다. 정답·힌트·미공개 텍스트 보호(PROTECTED_TEXT,
LEAK_CLIENT)와 일반 팩 GEN-LEAK/GEN-CASE는 별도 검사로 유지한다. client_skill에
가짜 정답을 추가하지 않으며, 혼합 묶음의 다른 값 퍼즐 정답·NG·고유명 검사를 생략하지 않는다.

계약 v0.4.16 §3(상황 대사는 넛지와 같은 PUB 검사)에 따라 NG/U 검사 범위에 `situations[].lines[]`를
더했다. 상황 대사는 NPC 검사에서 넛지와 같이 PROTECTED_TEXT(정답 예외 없음)를 받는다. 상황 대사에는
`reveal_when`이 없어(계약 §4) 어느 상태에서나 나올 수 있으므로, 일반 팩 GEN-LEAK과 같은 「아무것도 공개되지
않은 상태」의 기존 출력 검사로 미공개 단서·힌트 겹침을 보고 UNREVEALED_LEAK으로 막는다. 케이스 팩 대사라
GEN-CASE(고유명)는 대상이 아니다(계약 §6). fallback_lines·npc_scenario 범위는 바꾸지 않았다.

## CLI 평가와 실제 실행의 일치

한 CLI 실행은 다음 순서를 따른다.

1. --commit이면 actor/reason, --confirm-db, PUBLISHED_CONTENT_ROOT와 content-root의
   실제 경로 일치를 DB 접속 전에 확인한다.
2. read_case_bundle이 읽기 전용 바이트 snapshot을 한 번 만들고 공식 fingerprint 및
   각 파일 header를 확인한다. 그 snapshot의 NPC로 NG/U 검사기를 만든다.
3. 기본 dry-run은 DB 접속 없이 승인 미확인으로 차단한다. --db는 승인·기존 버전을
   공유 잠금으로 읽고 rollback하며 게시하지 않는다.
4. --commit은 동일 snapshot 및 동일 검사기를 publish_and_register로 전달한다.
   파일을 다시 읽어 검사 규칙과 대상이 달라지지 않게 한다. snapshot의 case/version이
   요청과 다르면 거부한다. root 위치 검증은 CLI 입력·로더에서 수행한다.
5. NpcPublicationService가 실제 트랜잭션에서 fingerprint·G1/G2/G3·버전·전체 게이트를
   다시 검증한다. CLI 미리보기 결과를 믿고 게이트를 생략하지 않는다.

별도 명령 실행 사이에는 매번 파일과 fingerprint를 새로 확인한다. 승인 뒤 변경된
콘텐츠는 기존 fingerprint의 승인을 재사용할 수 없다. 한 실행 중 디스크 파일이 바뀌어도
최종 판정 대상은 처음 읽은 승인 대상 snapshot이며 변경된 새 바이트를 게시하지 않는다.
변경 파일의 재시작 복구는 DB fingerprint 불일치로 차단된다. 게시 버전의 원본 파일은
운영 절차에서도 불변으로 보존해야 한다.

idmap이 있는데 LOCAL_IDS를 제공하지 않으면 UNVERIFIED다. --local-ids 입력은 실제
FE의 수집 결과여야 한다. complete의 실행 가능 Object→puzzle 참조 검사도 계속 적용한다.

CLI의 메모리 등록은 실행한 CLI 프로세스의 저장소에 대한 것이다. 별도 앱 서버의
PUBLISHED_CONTENT_ROOT 설정과 복원 확인은 기존 check_published_restore 절차를 따른다.
DB 게시와 후속 메모리 등록·앱 복원 상태를 같은 것으로 취급하지 않는다.

## 검증 범위와 보호

새 합성 회귀는 누락/null/빈 배열/정상 proper_nouns, 양쪽 넛지의 NG/U, 일반 팩의
GEN-LEAK/GEN-CASE, 독립 PROTECTED_TEXT 및 read-only CLI를 검증한다.
새 MySQL 종단 간 회귀는 전용 33317 계정·스키마에서만 다음을 수행한다.

- 합성 승인 뒤 파일 변경 → stale 승인 차단, 게시 상태 미생성.
- 승인된 원본 복원 → 게시·복원 → 실제 게시 guard로 세션 생성.
- complete 최초 처리·동일 이벤트 replay·새 이벤트 중복 효과 방지.
- 게시 뒤 파일 변경 → 충돌 차단, 기존 fingerprint/게시 이벤트/등록 내용 보존.

모든 테스트의 콘텐츠와 승인·게시 기록은 테스트용 가상 데이터이며 정리된다.
실제 나주 콘텐츠나 운영 승인·게시 기록은 생성하지 않는다. 3306에는 접속하지 않는다.
FE 기능, 별 점수, 퍼즐별 help_used, 기존 schema/DB 모델은 변경하지 않는다.
이전 통합 브랜치·원본 완료 브랜치·main 및 기존 worktree·백업을 보존한다.

## 남은 PM/운영 결정

- U의 허용 유보 표현(hedges), 예외와 적용 범위는 PM 확정이 필요하다. 현재는 기존 보수적 차단을 유지한다.
- open의 공식 필수 필드 승격 여부는 별도 계약 결정이다. 현재 누락 검사는 fail closed로 유지한다.
- fallback/scenario까지 NG 검사 범위를 넓힐지는 별도 정책이다. 이번 범위에 임의 포함하지 않는다.
- CLI는 내부 관리 절차다. 운영 승인자 인증·권한 연결과 실제 콘텐츠의 검수 목록·로컬 ID는
  별도 운영 준비가 필요하다. 테스트 통과를 실제 G1/G2/G3 승인 또는 게시 허가로 취급하지 않는다.

## 최종 검증 (2026-11-05)

- CLI·NG/U·정책·client_skill·NPC HTTP·select·게시 게이트 표적: 251 passed / 10 MySQL opt-in skipped.
- 새 합성 MySQL 종단 간 테스트: 1 passed. 마지막 CLI 안내 문구 확인: 15 passed.
- 전체 Backend 비DB 모드: 2,351 passed / 163 skipped(MySQL 162개, 심볼릭 링크 1개).
- 33317 MySQL opt-in을 모두 활성화한 전체 Backend: 2,513 passed / 1 skipped / 40 deprecation warnings.
  단일 skip은 Windows 환경에서 심볼릭 링크를 만들 수 없는 기존 권한 제한이다.
- Ruff 및 git diff --check 통과. FE lint는 기존 main의 오류 39건과 파일·위치·규칙까지 동일, 신규 오류 0건.
- 기존 24개 worktree의 브랜치·HEAD·status·index·refs·미커밋 바이트, 백업 2,670개 파일의 해시가 보존 기준과 일치한다.

검증 로그·JUnit XML은 clone 밖 `C:\dev\kgeseo-publication-policy-integration-20261105`에
기록한다. 그 폴더의 run_checks.py는 기존 전용 Python 3.13 및 검증된 33317 실행기를
재사용하며 --label <이름>은 DB 접속 차단, --label <이름> --mysql은 격리 계정·스키마의
전체 테스트를 실행한다. 평문 .env와 실제 콘텐츠를 복사하거나 실제 승인·게시를 실행하지 않았다.
