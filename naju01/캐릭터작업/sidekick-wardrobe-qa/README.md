# Sidekick 현대 의상 · 어깨 · 눈동자 QA

브랜치 `codex/sidekick-wardrobe-controls` (기준 `b23e096`).

## 산출물

| 항목 | 위치 |
|---|---|
| 런타임 GLB | `public/models/sidekick-customizer.glb` |
| Blender 원본(라이선스 파츠 포함 · 저장소 밖) | `~/Downloads/SIDEKICK_customizer_wardrobe.blend` (입력: `~/Downloads/SIDEKICK_customizer_base.blend`) |
| 의상 빌드 스크립트 | `naju01/도구/build_sidekick_wardrobe.py` |
| QA 무대 / 캡처 | `naju01/qa-wardrobe.html`, `naju01/도구/사이드킥의상QA.jsx`, `naju01/도구/사이드킥의상QA캡처.mjs` |
| 캡처·수치 | 이 폴더의 `*.png`, `metrics.json`, `build-report.json` |

## 다시 만들기

```bash
# 1) 공통 리그 라이브러리 (Unity 패키지는 저장소 밖)
Blender --background --factory-startup --python naju01/도구/build_sidekick_modular_library.py -- \
  --unity-package ~/Downloads/SIDEKICK_Starter_Unity_2021_3_v1_0_4.unitypackage \
  --blend-output ~/Downloads/SIDEKICK_customizer_base.blend --glb-output /tmp/base.glb
# 2) 현대 의상 16벌 + shoulderWidth
Blender --background --factory-startup --python naju01/도구/build_sidekick_wardrobe.py -- \
  --base-blend ~/Downloads/SIDEKICK_customizer_base.blend \
  --blend-output ~/Downloads/SIDEKICK_customizer_wardrobe.blend \
  --glb-output public/models/sidekick-customizer.glb \
  --report naju01/캐릭터작업/sidekick-wardrobe-qa/build-report.json
# 3) QA (naju01 개발 서버 5174 실행 중)
node naju01/도구/사이드킥의상QA캡처.mjs naju01/캐릭터작업/sidekick-wardrobe-qa
```

## 제작 방식

- 의상: 기본 몸 파츠(몸통·팔·골반·다리)를 합쳐 1단계 세분 → 옷 외곽으로 절단·단면 정리 →
  기본/masculineFeminine/defaultHeavy/defaultBuff/defaultSkinny 레이어마다 그 레이어 법선으로 오프셋 →
  같은 레이어의 몸에 대해 최소 간격 투영(shrinkwrap) → 소매·밑단 안쪽 접힘. 웨이트는 복제한 몸 표면에서
  보간, 치마는 몸 표면 웨이트 전이 + 좌/우 허벅지 분배. 모든 정점 웨이트 합 1, 최대 4본.
- 옷이 덮는 피부는 런타임 셰이더가 bind 좌표로 숨긴다(가장자리 2~3.5cm 안쪽만).
- shoulderWidth: `upperarm_*`, `shoulderAttach_*` 본을 ±3.5cm 옮기고, 본이 옮기지 않는 몸통 몫만
  morph로 담는다. 몸·SF·기사 상체 파츠와 모든 의상에 같은 식으로 들어가 접합부 간격 0.
- 눈동자: 원본 눈 메시 셰이더에서 안구 중심 기준 각도로 홍채·동공을 그린다(별도 구체·평면 없음).

## 수치 결과 (metrics.json, 539 샘플, 페이지 오류 0)

- 발 접지 오차: 신발(맨발) 발바닥 정점 기준. 얼굴 시트의 1.04는 눈높이 정렬용으로 발을 일부러 옮긴 값.
- 몸 접합부 간격 최대 1e-05 m = 찢김 없음. 본 길이 오차 1e-05 = 모션 중 크기 변화 없음.
- "팔 수평"은 상완이 수평에서 15° 미만인 샘플 수다. Jump_Loop·Punch_Jab·질주 일부 프레임의
  실제 동작이며, 모션 시트에서 T포즈 정지가 없음을 확인했다.
- 어깨 관절 간격: 0.75 → 0.318 m, 1.0 → 0.388 m, 1.25 → 0.457 m (모션·체격 1에서도 유지).

| 시트 | 샘플 | 발 접지 오차 최대(m) | 몸 접합부 간격 최대(m) | 본 길이 오차 최대 | 팔 수평(오탐 포함) | 치마 관통 프레임 | 치마 관통 최대(m) |
|---|---|---|---|---|---|---|---|
| garments-masculine | 24 | 0 | 0 | 1e-05 | 0 | - | - |
| garments-feminine | 24 | 0 | 1e-05 | 1e-05 | 0 | 0/6 | 0 |
| extremes-shape-masculine | 27 | 0 | 1e-05 | 1e-05 | 0 | - | - |
| extremes-scale-masculine | 24 | 0 | 1e-05 | 1e-05 | 0 | - | - |
| shoulder-masculine | 24 | 0 | 1e-05 | 1e-05 | 0 | - | - |
| extremes-shape-feminine | 27 | 0 | 1e-05 | 1e-05 | 0 | - | - |
| extremes-scale-feminine | 24 | 0 | 1e-05 | 1e-05 | 0 | - | - |
| shoulder-feminine | 24 | 0 | 1e-05 | 1e-05 | 0 | - | - |
| motions-masculine-7-7 | 33 | 0 | 0 | 1e-05 | 6 | - | - |
| motions-masculine-5-5 | 33 | 0 | 0 | 1e-05 | 6 | - | - |
| motions-feminine-10-10 | 33 | 0 | 1e-05 | 1e-05 | 6 | 15/33 | 0.0512 |
| motions-feminine-9-11 | 33 | 0 | 1e-05 | 1e-05 | 6 | 15/33 | 0.0529 |
| motions-feminine-11-8 | 33 | 0 | 1e-05 | 1e-05 | 6 | - | - |
| skirt-cycle-10-Walk_Loop | 8 | 0 | 1e-05 | 1e-05 | 0 | 0/8 | 0 |
| skirt-cycle-10-Jog_Fwd_Loop | 8 | 0 | 1e-05 | 1e-05 | 1 | 7/8 | 0.0549 |
| skirt-cycle-10-Sprint_Loop | 8 | 0 | 1e-05 | 1e-05 | 2 | 7/8 | 0.0589 |
| skirt-cycle-10-Crouch_Fwd_Loop | 8 | 0 | 1e-05 | 1e-05 | 0 | 8/8 | 0.0589 |
| skirt-cycle-11-Walk_Loop | 8 | 0 | 1e-05 | 1e-05 | 0 | 2/8 | 0.0419 |
| skirt-cycle-11-Jog_Fwd_Loop | 8 | 0 | 1e-05 | 1e-05 | 1 | 7/8 | 0.0568 |
| skirt-cycle-11-Sprint_Loop | 8 | 0 | 1e-05 | 1e-05 | 2 | 7/8 | 0.0568 |
| skirt-cycle-11-Crouch_Fwd_Loop | 8 | 0 | 1e-05 | 1e-05 | 0 | 8/8 | 0.0583 |
| face-pupil | 16 | 1.0417 | 1e-05 | 1e-05 | 0 | - | - |
| face-pupil-walk | 8 | 1.0417 | 1e-05 | 1e-05 | 0 | - | - |
| combos-masculine | 48 | 0 | 0 | 1e-05 | 0 | - | - |
| combos-feminine | 48 | 0 | 1e-05 | 1e-05 | 0 | 0/24 | 0 |

| 모션 | 샘플 | 발 접지 오차 최대(m) | 몸 접합부 간격 최대(m) | 본 길이 오차 최대 | 팔 수평(오탐 포함) | 치마 관통 프레임 | 치마 관통 최대(m) |
|---|---|---|---|---|---|---|---|
| Idle_Loop | 197 | 1.0417 | 1e-05 | 1e-05 | 0 | 0/12 | 0 |
| Walk_Loop | 135 | 1.0417 | 1e-05 | 1e-05 | 0 | 2/46 | 0.0419 |
| Jog_Fwd_Loop | 31 | 0 | 1e-05 | 1e-05 | 2 | 20/22 | 0.0568 |
| Sprint_Loop | 43 | 0 | 1e-05 | 1e-05 | 4 | 20/22 | 0.0589 |
| Crouch_Idle_Loop | 15 | 0 | 1e-05 | 1e-05 | 0 | 6/6 | 0.0529 |
| Crouch_Fwd_Loop | 31 | 0 | 1e-05 | 1e-05 | 0 | 22/22 | 0.0589 |
| Jump_Start | 15 | 0 | 1e-05 | 1e-05 | 0 | 0/6 | 0 |
| Jump_Loop | 15 | 0 | 1e-05 | 1e-05 | 15 | 0/6 | 0 |
| Jump_Land | 15 | 0 | 1e-05 | 1e-05 | 0 | 6/6 | 0.0192 |
| Punch_Jab | 15 | 0 | 1e-05 | 1e-05 | 15 | 0/6 | 0 |
| Punch_Cross | 27 | 0 | 1e-05 | 1e-05 | 0 | 0/6 | 0 |

## 남은 문제와 재현

1. **치마 × 조깅·질주·웅크리기**: 무릎을 높이 들면 치마 앞 중앙이 갈라져 허벅지 안쪽이 3~6cm 앞으로 나온다.
   걷기는 A라인 0/8, 플리츠 2/8 프레임(최대 4cm). 스키닝만으로는 한계라 치마 보조 본이나 천 시뮬레이션이 필요하다.
   재현: `skirt-cycle-10-Sprint_Loop.png`, 또는 QA 페이지에서 bottom 10, Sprint_Loop t=0.3, 정면.
2. **상의 밑단 겹침 띠**: 하의 허리 위로 1.7cm 띄운 밑단이 흰 띠처럼 두껍게 보인다. 체격 1에서는 밑단 테두리에
   점 자국이 보인다. 재현: `extremes-shape-masculine-front.png` 체격 1.
3. **치마 허리 점 자국**: 뒤에서 상의 밑단 위로 치마 허리선이 점처럼 비친다. 재현: `garments-feminine-back.png`.
4. **기본 신발**: 현대 운동화는 이번 범위에 없다. 기본값은 맨발이고, SF·기사 신발은 선택지로 남아 있다.
5. **속옷 하의 모양**: Synty 기본 몸의 골반 메시에 사각 속옷 밑단이 z≈0.705m 형상으로 모델링되어 있어
   흰색 경계를 그 턱에 맞췄다(무릎까지 번지지 않음). 삼각 팬티 모양으로 바꾸려면 몸 메시 수정이 필요하다.
