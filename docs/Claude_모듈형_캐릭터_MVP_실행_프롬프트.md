# Claude 실행 프롬프트 — 「왜곡」 모듈형 플레이어 캐릭터 MVP 완성

아래 프로젝트 저장소에서 기존 작업을 감사하고, 지역 설화 기반 R3F 방탈출 게임 「왜곡」에 사용할 모듈형 플레이어 캐릭터 MVP를 완성해 주세요.

이 요청은 새 캐릭터를 처음부터 생성하라는 뜻이 아닙니다. 저장소에는 이미 Synty Sidekick 기반 공통 리그, 모듈 파츠, Quaternius 애니메이션, R3F 런타임과 QA 결과가 있습니다. 먼저 실제 파일과 실행 결과를 확인하고, 쓸 수 있는 작업을 보존한 상태에서 부족한 부분만 완성해야 합니다.

## 1. 최종 목표

게임 공간에서 다음 조건을 충족하는 플레이어 캐릭터 한 시스템을 준비합니다.

- 남성형과 여성형을 선택할 수 있음
- 헤어스타일 4종
- 상의 4종
- 하의 4종
- 신발 4종
- 피부색, 머리색, 상의색, 하의색, 신발색 변경
- 가능하면 눈동자 색상과 크기 변경
- 외형 설정 저장 및 다시 불러오기
- 기본 동작 7종
  - `Idle`
  - `Walk`
  - `Run`
  - `Jump`
  - `Interact`
  - `Dance_01`
  - `Dance_02`
- 1인칭과 3인칭 전환 가능
- 캐릭터 이동 중 크기가 바뀌지 않음
- 바닥에 파묻히거나 공중에 뜨지 않음
- 걷기 중 불필요한 점프 모션이 재생되지 않음
- 움직일 때 몸, 팔, 다리, 의상이 찢어지거나 분리되지 않음
- 브라우저 기반 R3F 게임에서 안정적으로 실행됨

최종 결과는 “파일이 존재한다”가 아니라 실제 게임 공간에서 조작하고 시각적으로 확인할 수 있어야 합니다.

## 2. 반드시 먼저 확인할 현재 상태

작업 시작 전에 다음 파일을 읽고 실제 구현을 확인해 주세요.

- `package.json`
- `docs/메쉬-캐릭터-파이프라인.md`
- `naju01/캐릭터작업/sidekick-starter-test/README.md`
- `naju01/캐릭터작업/sidekick-wardrobe-qa/README.md`
- `naju01/src/사이드킥게임아바타.jsx`
- `naju01/src/사이드킥꾸미기패널.jsx`
- `naju01/src/사이드킥옵션.js`
- `naju01/src/모션보정.js`
- `naju01/도구/build_sidekick_modular_library.py`
- `naju01/도구/build_sidekick_wardrobe.py`
- `naju01/도구/사이드킥의상QA.jsx`
- `naju01/도구/사이드킥의상QA캡처.mjs`
- `public/models/sidekick-customizer.glb`
- `public/models/vendor/quaternius-universal-animation-library.glb`
- `public/models/vendor/QUATERNIUS-ANIMATIONS-LICENSE.txt`

저장소를 확인한 시점의 알려진 상태는 다음과 같지만, 사실 여부는 직접 검증해야 합니다.

- 프런트엔드: React 19, R3F, Drei, Three.js, Vite
- Sidekick 공통 89본 Skeleton과 원본 skin weight 사용
- Quaternius Universal Animation Library의 약 43개 동작을 런타임 리타게팅
- `sidekick-customizer.glb`에 모듈형 신체·얼굴·헤어·의상 파츠 존재
- 외형 선택 및 모션 미리보기 UI 존재
- 의상 및 어깨 폭 QA 캡처·수치 자료 존재
- 기존 QA 문서에는 치마와 달리기·웅크리기 조합의 관통 문제가 기록되어 있음
- 현재 저장소에는 사용자 및 다른 에이전트의 미커밋 변경이 다수 존재함

문서에 적혀 있다는 이유만으로 완료라고 판단하지 말고 코드, GLB 구조, 빌드, 실제 브라우저 재생을 확인하세요.

## 3. Git과 원본 보호 규칙

- 작업을 시작하기 전에 현재 branch와 `git status`를 기록하세요.
- 현재 branch를 임의로 변경하거나 checkout하지 마세요.
- 사용자의 미커밋 변경을 덮어쓰거나 삭제하지 마세요.
- `git reset --hard`, `git clean`, 광범위한 파일 삭제를 금지합니다.
- 기존 로비와 게임 공간 원본을 직접 재작성하지 마세요.
- 새 기능은 기존 feature flag, 테스트 경로 또는 격리된 컴포넌트에서 먼저 검증하세요.
- 이미 존재하는 캐릭터 후보와 스크립트를 무작정 삭제하지 마세요. 무엇을 폐기할지 근거와 영향 범위를 먼저 보고하세요.
- Synty 원본 Unity/Unreal 패키지는 저장소에 복사하거나 커밋하지 마세요.
- 라이선스가 불명확한 에셋은 배포 대상으로 승인하지 마세요.

## 4. 핵심 기술 결정 — 임의로 뒤집지 마세요

### 4.1 기준 몸체와 리그

MVP의 기준은 기존 **Synty Sidekick Skeleton과 skin weight**입니다.

- Meshy나 다른 AI가 생성한 임의 몸체를 Sidekick Skeleton에 갈아 끼우지 마세요.
- 몸체를 교체하고 자동 웨이트를 다시 주는 방식으로 돌아가지 마세요.
- 캐릭터마다 Skeleton을 새로 만들지 마세요.
- 모든 몸체·상의·하의·신발은 동일한 Rest Pose, bone name, bone hierarchy를 공유해야 합니다.
- 헤어는 가능한 한 Head bone에 rigid attachment하고, 변형이 필요한 파츠만 제한적으로 skinning하세요.

기존 Sidekick 구조가 요구사항을 충족할 수 없다고 판단할 경우, 즉시 새 구조를 만들지 말고 다음을 먼저 제출하세요.

1. 충족할 수 없는 요구사항
2. 재현 방법
3. 원인이 asset, topology, rig, weight, animation, runtime 중 무엇인지
4. 기존 구조를 유지한 대안
5. 구조를 교체할 경우 잃는 작업과 예상 비용

### 4.2 애니메이션

- 애니메이션을 처음부터 손으로 keyframe하지 마세요.
- 기존 Quaternius 모션을 먼저 사용하고, 품질이 부족한 개별 동작만 대체 후보를 검토하세요.
- 걷기·달리기·점프는 기본적으로 in-place animation을 사용하세요.
- 실제 월드 이동과 수직 점프는 게임 controller가 담당해야 합니다.
- animation root translation과 게임 이동을 동시에 적용하지 마세요.
- 동작 전환에는 crossfade를 사용하되, 전환 중 scale·root 위치·바닥 높이가 바뀌지 않게 하세요.
- `Idle → Walk → Run`, `Idle/Walk/Run → Jump → Land`, `Idle → Interact`, `Idle → Dance → Idle` 전이를 명시적인 상태 머신으로 관리하세요.

### 4.3 모듈형 의상

- 4×4×4×4 조합을 256개의 완성 GLB로 굽지 마세요.
- 하나의 Skeleton과 모듈식 `SkinnedMesh` 또는 bone attachment를 공유하세요.
- 선택하지 않은 파츠는 로드 반복이 아니라 visibility 또는 안정적인 파츠 교체 방식으로 관리하세요.
- 옷 아래 몸체 노출은 기존 body masking 또는 검증된 대안을 사용하세요.
- 색상 변경은 동일 mesh의 material palette/parameter를 우선 사용하세요.
- 파츠를 바꿔도 Skeleton, scale, pivot, animation state가 초기화되지 않아야 합니다.

## 5. AI가 자율적으로 수행할 작업

다음은 사용자에게 세부 조작을 요구하지 말고 직접 수행하세요.

1. 저장소·GLB·Skeleton·AnimationClip·Morph Target·Material·파츠 목록 감사
2. 기존 구현 중 재사용/수정/폐기 후보 분류
3. 기준 캐릭터와 기준 Skeleton 확정 제안
4. 7개 MVP 동작 후보 선정 및 clip mapping
5. 애니메이션 상태 머신과 crossfade 구현 또는 수정
6. in-place 및 root/pivot/scale 문제 수정
7. R3F 캐릭터 loader, Skeleton clone, animation playback, 파츠 visibility, material color 처리
8. 남녀형과 외형 선택 데이터 모델 정리
9. localStorage 또는 기존 avatar API에 맞춘 외형 저장/복원
10. 개발용 미리보기 패널과 전체 조합 테스트 페이지 유지·개선
11. Blender Python을 이용한 반복 가능한 GLB 빌드·검사·렌더 자동화
12. 정면·측면·후면 및 주요 모션 contact sheet 생성
13. 치수, 접합부, 발 접지, scale, bone hierarchy, clip 존재 여부 자동 검사
14. `npm run build`, lint 가능 범위, 프로젝트 검사 스크립트 실행
15. 실제 브라우저에서 키 입력, 모션 전환, 카메라 전환, 외형 저장을 end-to-end 테스트
16. 변경 파일, 검증 결과, 남은 결함과 재현 방법 문서화

## 6. 사용자 판단이 필요한 지점

사용자에게는 아래 항목만 명확한 비교 자료와 함께 요청하세요.

1. 최종 실루엣과 귀여움 정도 선택
2. 남성형·여성형의 외형 차이 허용 범위
3. 4개씩 제공할 헤어·상의·하의·신발의 최종 디자인 선택
4. Idle, Walk, Run, Dance의 미적 선호 승인
5. 치마처럼 일부 동작에서 관통 위험이 있는 조합을 MVP에 포함할지 결정
6. Synty 및 외부 애니메이션 라이선스와 배포 범위의 최종 승인
7. 유료 에셋 구매가 필요한 경우 예산 승인
8. 게임 본편과 로비에 적용하는 최종 merge 승인

사용자에게 Blender의 bone placement, weight paint, Action Editor 조작을 시키지 마세요. 기술적으로 자동화 또는 코드로 처리할 수 없는 경우에만, 사용자가 해야 할 최소 행동을 화면 위치와 순서까지 짧게 안내하세요.

## 7. 단계별 작업과 품질 게이트

각 단계가 끝날 때 결과를 검증하고 통과한 뒤 다음 단계로 넘어가세요. 여러 단계를 한꺼번에 진행한 뒤 마지막에 문제가 드러나는 방식을 피합니다.

### Gate 0 — 현황 감사

산출물:

- 현재 branch와 dirty worktree 요약
- 관련 파일·모델·모션·파츠 목록
- 재사용 가능/불가 목록
- 실제 실행 URL 또는 테스트 진입 방법
- 현재 가장 큰 결함 5개
- 최소 변경 실행 계획

통과 조건:

- 기존 Sidekick/Quaternius 경로와 Meshy 실험 경로가 구분됨
- 원본과 테스트 코드의 경계가 확인됨
- 사용자 작업을 덮어쓰지 않는 계획이 제시됨

### Gate 1 — 기준 리그와 정지 상태

검증 항목:

- 정면·측면에서 Skeleton이 몸 안에 정상 배치
- 남녀형 모두 같은 hierarchy와 Rest Pose
- scale과 pivot 고정
- 발바닥이 같은 Y 높이에 위치
- Idle에서 T/A pose가 노출되지 않음
- 머리·팔·다리·의상 파츠가 분리되지 않음

산출물:

- 남녀 정면·측면·후면 캡처
- Skeleton 및 mesh 통계
- 실패 항목과 수정 내역

### Gate 2 — 기본 이동 모션

먼저 `Idle`, `Walk`, `Run`만 연결합니다.

검증 항목:

- 캐릭터 scale이 clip 전환 전후 동일
- 발바닥 접지 유지
- 걷기 중 Jump clip이 실행되지 않음
- Walk/Run이 controller 속도와 시각적으로 일치
- 무릎·다리가 과도하게 벌어지지 않음
- 팔과 상체 움직임이 지나치게 뻣뻣하거나 뒤틀리지 않음
- 겨드랑이, 골반, 무릎, 허리 파열 없음

이 Gate가 통과하기 전에는 Jump, Dance, 전체 의상 조합을 추가하지 마세요.

### Gate 3 — Jump와 Interact

- Jump는 최소 `start → airborne/loop → land` 상태 또는 품질이 검증된 단일 clip로 처리
- 수직 이동은 controller가 담당
- 착지 시 발이 지면으로 복귀
- Interact는 특정 물체와 정밀 접촉이 필요 없는 범용 조사/손 뻗기 동작으로 시작
- 향후 정밀 상호작용은 target/IK 별도 단계로 분리

### Gate 4 — Dance 2종과 감정 동작

- Dance 2종은 루프 여부, 시작·종료 조건을 명시
- 취소 시 Idle로 자연스럽게 복귀
- 월드 이동 입력 시 정책을 명시: dance 취소 또는 이동 잠금
- 의상 관통과 발 미끄러짐 검사

### Gate 5 — 외형 선택

남녀 각각 다음 선택을 실제 UI에서 검증합니다.

- Hair 4
- Top 4
- Bottom 4
- Shoes 4
- 색상 변경
- 외형 저장/복원

모든 256개 조합을 사람이 볼 필요는 없지만 자동 순회로 다음을 검사하세요.

- 파츠 누락
- 파츠가 머리·몸에서 떨어짐
- body seam
- scale/pivot 변화
- 필수 material 누락
- Skeleton 불일치

시각 검수는 대표 조합과 위험 조합을 우선합니다.

### Gate 6 — 게임 공간 통합

- 테스트 공간에서 먼저 검증
- 1인칭에서는 자기 몸 표시 정책을 명시
- 3인칭 카메라가 캐릭터 정면까지 회전 가능
- 카메라 전환이 캐릭터 방향·시점을 비정상적으로 틀지 않음
- 지면 raycast/collision과 캐릭터 발 높이가 일치
- 이동 중 파묻힘·부유·순간 scale 변화 없음
- 원본 로비와 본 게임은 최종 승인 전까지 feature flag 또는 별도 경로 유지

### Gate 7 — 빌드와 회귀 검증

- `npm run build`
- 프로젝트 전용 검사 명령
- 관련 Playwright 또는 브라우저 자동 테스트
- 개발자 콘솔 오류 0
- 누락 asset 요청 0
- 캐릭터를 끈 기본 경로 회귀 없음
- 라이선스와 출처 기록 유지

## 8. 수치 및 시각 검증 기준

최소한 다음을 기록하세요.

- Skeleton bone count와 hierarchy hash
- animation clip 이름·길이·loop 여부
- clip별 root translation 범위
- clip 전환 전후 character bounding box와 scale
- 발바닥 최소·최대 높이
- 몸-파츠 seam 거리
- skin weight 합과 vertex당 최대 influence 수
- 대표 pose에서 몸체·의상 관통 여부
- 전체 GLB 크기, texture 크기, draw call과 skinned mesh 수
- 모바일이 아니라 프로젝트 목표 브라우저/PC 환경에서 프레임과 로딩 시간

수치가 정상이어도 자연스러움은 자동으로 보장되지 않습니다. 반드시 다음 캡처를 만드세요.

- 남녀 × Idle/Walk/Run: 정면·측면·후면
- Jump start/air/land
- Interact 중간 프레임
- Dance 2종 대표 프레임
- 대표 외형 조합 8개 이상
- 위험 조합: 치마 × Run/Jump, 큰 체형 × 긴팔, 넓은 어깨 × 상의

## 9. 알려진 결함 처리

기존 QA 문서에 기록된 치마 관통 문제를 숨기지 마세요.

- 달리기·웅크리기에서 치마가 3~6cm 수준으로 관통한다면 “통과”로 보고하지 마세요.
- MVP 선택지는 다음 중 하나를 근거와 함께 권고하세요.
  1. 치마는 Idle/Walk 전용으로 제한
  2. Run/Jump 시 다른 하의로 강제 교체하지 말고 해당 조합을 선택 불가 처리
  3. 치마 보조 bone 또는 별도 skirt rig 구현
  4. 품질 좋은 기존 Sidekick 호환 치마 파츠 사용
- 천 시뮬레이션은 웹 런타임 비용과 재현성을 검토하지 않은 채 기본 해법으로 채택하지 마세요.

## 10. 금지 사항

- 새 Meshy 캐릭터 생성으로 문제를 우회
- 기존 몸체에 다른 비율의 몸체를 덧씌우기
- 자동 웨이트 결과를 시각 검증 없이 승인
- 동작마다 별도 캐릭터 GLB를 런타임에서 교체
- root motion과 controller 이동 중복 적용
- 사용자가 만든 파일을 삭제하거나 원상복구
- 원본 로비/게임 코드를 feature flag 없이 바로 교체
- 모든 조합을 완료했다고 수치·캡처 없이 주장
- Synty 원본 패키지 또는 재배포 금지 소스 파일 커밋
- 라이선스가 불명확한 애니메이션 사용
- 현재 구현을 읽지 않고 새로운 캐릭터 시스템을 병렬로 하나 더 만들기

## 11. 질문 및 진행 방식

- 기술적 판단은 가능한 한 직접 내리고 진행하세요.
- 사용자의 취향·예산·라이선스·최종 배포 승인만 질문하세요.
- 한 단계에서 사용자 판단이 필요하면 선택지마다 실제 캡처와 장단점을 함께 제시하세요.
- 단순 상태 보고로 멈추지 말고 안전한 다음 작업이 있으면 계속 진행하세요.
- 단, 품질 Gate가 실패하면 다음 단계로 넘어가지 말고 원인을 수정하거나 `needs_user_decision`으로 명확히 종료하세요.

## 12. 최종 보고 형식

작업이 끝나면 아래 순서로 보고하세요.

1. **결론**: 게임 테스트 가능 / 조건부 가능 / 불가
2. **실제 사용 경로**: URL, 키 조작, 외형 UI 사용법
3. **재사용한 기존 작업**
4. **변경한 파일과 이유**
5. **7개 모션 매핑표**
6. **4×4×4×4 외형 선택 목록**
7. **자동 검증 결과**
8. **시각 QA 캡처 링크**
9. **남은 결함과 재현 방법**
10. **사용자가 결정해야 할 항목**
11. **본편·로비 적용 전 체크리스트**

결과를 “완료”라고 부르려면 실제 게임 공간에서 걷기, 달리기, 점프, 상호작용, Dance 2종, 외형 교체, 저장/복원을 확인하고 빌드를 통과해야 합니다.

