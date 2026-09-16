# Sidekick 게임 공간 검증

- 브랜치: `codex/sidekick-game-space-test`
- 실행 모델: `public/models/sidekick-customizer.glb`
- 실행 컴포넌트: `naju01/src/사이드킥게임아바타.jsx`
- 테스트 공간: `naju01` (`http://127.0.0.1:5174/`)
- 조작: `V` 3인칭 전환, `T` 입력 잠금, `WASD` 걷기, `Shift + WASD` 달리기, `C` 앉기, `Space` 점프

## 모션 사용법

- 오른쪽 `동작`을 `자동 · 게임 상태`로 두면 입력에 맞춰 대기·걷기·달리기·앉기·점프·착지가 전환된다.
- 드롭다운에서 특정 동작을 고르면 이동 상태보다 우선해 그 동작을 제자리에서 미리보기한다. 테스트가 끝나면 `자동`으로 돌린다.
- 반복 동작: 대기·보행·달리기·앉기·밀기·수영·마법/권총/검 대기·운전.
- 1회 동작: 점프 시작/착지·구르기·상호작용·줍기·피격·사망·펀치·마법 발사·검 공격·권총 사격/재장전.
- 앉기·마법·무기 모션은 `진입 → 대기(반복) → 행동 → 해제`를 하나의 상태 머신으로 연결해야 한다. 현재 UI는 모션·리깅 검증용이고 게임플레이 키 배치는 다음 단계에서 행동 시스템에 연결한다.

## 현재 검증 범위

- Synty가 제공한 공통 89본 스켈레톤과 스킨 웨이트를 그대로 사용한다.
- Quaternius Universal Animation Library의 43개 동작을 모두 선택할 수 있다.
- 자동 모드에서는 대기·걷기·달리기·앉기·점프/착지를 게임 상태에 맞춰 전환한다.
- 동작은 처음 선택할 때만 리타게팅한 뒤 캐시하므로 43개를 한꺼번에 변환하지 않는다.
- 얼굴 2종, 헤어 11종, 눈썹·귀·수염·치아 각 10종, 코 11종을 선택할 수 있다.
- 기본/SF/기사 상·하의·신발과 머리·얼굴·등·허리·어깨·팔꿈치·무릎 장비를 조합할 수 있다.
- 남성/여성, 마름/근육/체격 morph와 피부·머리·의상·신발·장비 색을 바꿀 수 있다.
- 기존 Meshy 캐릭터, 기존 게임 리그, 로비 코드는 수정하지 않는다.
- 현재 외형은 파이프라인 검증용 조합이며 최종 의상·헤어가 아니다.

## 출처 및 배포 주의

원본 에셋은 **Synty Sidekick Modular Characters - Free Starter Pack**이다. 다운로드한 Unity/Unreal 원본 패키지는 저장소에 넣지 않는다. 생성된 GLB를 커밋하거나 배포하기 전에는 팀 저장소의 공개 범위와 Synty 라이선스를 다시 확인한다.

## 빌드 확인

```bash
npx vite build --config naju01/vite.config.js
```

현재 프로덕션 빌드 통과 및 실제 `naju01` 맵에서 모듈 교체와 동작 선택을 검증했다.

## 모듈 GLB 다시 만들기

Synty Unity 원본 패키지의 모든 Starter 파츠를 저장소 밖에서 읽어 하나의 공통 리그 GLB로 만든다.

```bash
'/Applications/Blender.app/Contents/MacOS/Blender' --background --factory-startup \
  --python 'naju01/도구/build_sidekick_modular_library.py' -- \
  --unity-package "$HOME/Downloads/SIDEKICK_Starter_Unity_2021_3_v1_0_4.unitypackage" \
  --blend-output /tmp/sidekick-customizer.blend \
  --glb-output public/models/sidekick-customizer.glb
```
