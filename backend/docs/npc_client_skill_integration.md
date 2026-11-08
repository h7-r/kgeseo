# NPC v0.4.15 + client_skill 통합

기준 main: `85a6e505388e35763e7a23874496f6c3ae6d9149`.
통합 브랜치: `feat/SJ-npc-client-skill-integration`.

## 반영 범위

- 원본 `f25f74a35deac43ac165b6b9369517cb80064981`: NPC 일반 팩 정책 v0.4.15.
- 원본 `11372f63cd6b8cf19c5eb8d48b644bd1f052b9be`: client_skill + complete.
- 두 작업의 공통 부모는 `339c3446370b81d4b41e42d74fbad3796d08d9fb`다.
  main에 없는 커밋은 각각 한 개이므로 해당 커밋만 출처를 기록해 cherry-pick했다.
- 공통 변경 파일 `app/services/publication_gate.py`는 자동 병합됐다. 수동 충돌 해결이나
  기능 재설계 없이 POLICY_DATA/GEN_PACK 검사와 complete의 EXECUTABLE_REFS 검사를 함께 유지한다.
- main 후속 변경인 환경 예제·README·테스트 계정 seed는 유지한다.
- 이번 통합의 추가 변경은 합성 결합 회귀 테스트와 이 문서다. 실제 콘텐츠·승인·게시·FE는 변경하지 않는다.

## NPC 정책과 호환성

신규 게시·재게시에서는 `npc.json`의 `ng`, `proper_nouns`가 필수다. 누락 또는 null은
POLICY_DATA 실패이며, 검수 결과 항목이 없는 명시적 빈 배열은 유효하다. 과거 게시본
읽기 모델의 None 호환 표현을 게시 허용 기본값으로 바꾸지 않는다.

GEN-CASE는 Client object_name과 NPC 인물/장소 이름·별칭을 검사한다. 숨김/비활성
물건도 포함하며 내부 ID나 zone_name을 임의로 고유명에 포함하지 않는다. GEN-LEAK는
정답·힌트·미공개 단서·NG 검사를 유지한다. client_skill의 정답 목록이 비어 있어도
같은 묶음의 다른 값 퍼즐 정답 및 NG 검사를 생략하지 않는다.

NPC Turn API의 요청·응답 계약과 일반 팩의 승인·공급 조건을 변경하지 않았다.
정책 PASS는 활성화나 G3 승인이 아니다. 실제 일반 팩과 나주 콘텐츠는 수정하지 않는다.

## client_skill과 FE 계약

- Server 퍼즐: `solve: {"mode": "client_skill"}`. accepted_answers는 생략/[]만 허용한다.
  solve를 생략한 기존 값 퍼즐에는 기존처럼 하나 이상의 정답이 필요하다.
- 기존 Interaction 경로의 `action: "complete"`, `target_type: "object"`, Object ID,
  현재 zone_id, 빈 `payload: {}`를 사용한다. puzzle ID 직접 제출이나 성공·별점 주장은 받지 않는다.
- 서버는 세션 잠금, 고정 콘텐츠, 현재 Zone, Object 연결·표시/활성 상태, solve 모드,
  선행 퍼즐·단서·소비 Item을 검증한다. 손놀림 수행 자체를 서버가 재현하는 새 프로토콜은 없다.
- 같은 이벤트의 재전송은 기존 응답을 재현한다. FE는 이벤트 ID·timestamp·본문을 보존해야 한다.
  같은 ID의 주소·timestamp·action 변경은 충돌이다. 새 이벤트로 이미 완료한 퍼즐을 보내도
  효과·Item 소비·시도 횟수·완료 시각을 중복 적용하지 않는다.
- input/select의 기존 값 판정과 Item·Hint·세션 누계 통계를 유지한다.
  별 점수나 퍼즐별 help_used, 새 테이블·컬럼·migration을 추가하지 않는다.
- 현재 FE의 src/server/playSession.ts는 input 제출만 구현한다. 이번에 complete 호출·재시도·
  UI 효과를 새로 구현하지 않았다. 이후 FE 연동은 서버 응답의 interaction ID와 state_changes로
  중복 연출을 막고 409에서 상태를 다시 읽어야 한다. 현재 api.ts의 action/target_type은 string이다.

## 결합 회귀 검증

`tests/test_npc_client_skill_integration.py`는 합성 데이터만 사용해 다음을 검증한다.

1. client_skill + 명시적 빈 검수 목록 + 안전한 일반 팩의 게시 게이트 통과.
2. complete가 있어도 ng/proper_nouns 누락·null의 필수 검사 우회 불가.
3. 혼합 skill/값 퍼즐에서 인물·별칭·Object 이름과 NG·기존 정답 누출을 계속 차단.
4. NPC 검수 데이터가 유효해도 실행 불가 퍼즐을 가리키는 complete는 차단.

실제 DB 검증은 새 전용 인스턴스 `127.0.0.1:33317`만 사용한다. 실행기가 실제 datadir·계정·
스키마를 대조하고 3306 및 다른 앱 TCP 연결을 차단한다. 테스트 계정은 root가 아니다.
기존 승인·게시·진행 상태는 조회하거나 변경하지 않는다.

## 다음 게시 CLI + NG 검사기 통합 시 주의

현재 main 기준 다음 브랜치에는 선행 커밋 세 개가 필요하다:
`81c7b48` → `6b8de7d` → `d12c93d`. 마지막 커밋만 가져오면 CLI/검사기 선행 파일이 빠진다.
현재 두 기능과 직접 겹치는 파일은 없지만 같은 게시 경로를 사용하므로 의미상 재검증이 필요하다.

- CLI가 통합된 최신 게시 게이트를 호출하고 POLICY_DATA 이유를 설명하는지 확인한다.
- NG/U 검사기의 ng/open 요구와 v0.4.15의 proper_nouns/ng 요구를 각각 유지한다.
  누락된 open이나 검수 목록을 빈 배열로 자동 보충하지 않는다.
- CLI 검사기와 최종 게시가 같은 BundleSnapshot을 사용하고 요청 case/version,
  fingerprint, 승인 대상이 일치해야 한다.
- CLI의 가상 fixture에도 검수 필드를 명시하고, client_skill/complete가 있는 묶음의
  참조·GEN-LEAK·GEN-CASE·실행 가능 상태를 함께 검증한다.
- 기존 fingerprint·G1/G2/G3 승인을 새 콘텐츠에 재사용하거나 실제 나주 콘텐츠를
  승인·게시하지 않는다. 실제 게시 CLI --commit은 이번 검증 범위가 아니다.

## 기본 품질 기준선

FE의 npm run lint에는 main의 기존 tools 오류 39건이 있다. 통합 후 오류의 파일·위치·규칙을
기준선과 대조하며 새 오류가 없는지 확인한다. FE 기능이나 lint 규칙을 변경해 숨기지 않는다.
검증 결과와 커밋 정보는 최종 검증 절에 기록한다.

## 최종 검증 결과 (2026-11-05)

- 정책 단위 52개·정책 MySQL 10개 통과.
- client_skill 단위 28개·MySQL 4개 통과.
- 추가 결합 회귀 11개 통과. Interaction/선택/NPC 턴/케이스/게시를 포함한 표적 묶음은 277개 통과.
- 전체 Backend 비DB 모드: 2,238 passed / 150 skipped. MySQL opt-in 149개와 환경상 심볼릭 링크 1개를 건너뛴다.
- MySQL opt-in을 모두 활성화한 전체 Backend: 2,387 passed / 1 skipped, 39 deprecation warnings.
  단일 skip은 Windows 환경의 심볼릭 링크 생성 권한 제한이다.
- Ruff 및 git diff --check 통과. FE lint는 기존 main의 오류 39건과 파일·위치·규칙까지 동일하며 신규 오류는 0건이다.
- 기존 24개 worktree의 브랜치/HEAD/status/index/refs/미커밋 바이트와 백업 2,670개 파일의 해시는 보존 기준과 일치한다.
- 운영 DB/기존 3306, 실제 콘텐츠 승인·게시, FE 기능 구현, push/PR/main 병합은 수행하지 않았다.

Windows의 재현 실행기는 `C:\dev\kgeseo-npc-client-skill-integration-20261105\run_checks.py`다.
전용 Python 3.13으로 `--label <이름>`을 주면 DB 접속 차단, `--label <이름> --mysql`이면
검증된 33317 격리 계정·datadir·스키마에서 전체 테스트를 실행한다. 로그·JUnit XML은 clone 밖의
같은 증거 폴더에 저장하며 자격증명은 출력하지 않는다.
