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
- 속옷 요철 제거: Synty 기본 골반 메시에는 속옷 허리 밴드·앞트임 단추·밑단 턱이 형상으로 조각돼 있다.
  의상은 이 요철을 Taubin 스무딩으로 지운 표면으로 만들고(접합부 정점 고정), 옷 가장자리 6cm는
  원래 몸에 대해서도 7mm 간격을 다시 확보한다. 런타임은 옷을 하나라도 입으면 허리 구간(0.80m 위)만
  지우는 \`underwearFlat\` morph를 켠다. 속옷 밑단 모양은 남겨 보이는 흰 속옷 경계가 깨지지 않는다.
- 옷이 덮는 피부는 런타임 셰이더가 bind 좌표로 숨긴다(가장자리 1.2~2cm 안쪽만). 상의를 입으면
  속옷 복제본과 하의 옷(바지·치마)의 상의 밑단 안쪽 부분도 그리지 않아 옷 위로 비치지 않는다.
- shoulderWidth: `upperarm_*`, `shoulderAttach_*` 본을 ±3.5cm 옮기고, 본이 옮기지 않는 몸통 몫만
  morph로 담는다. 몸·SF·기사 상체 파츠와 모든 의상에 같은 식으로 들어가 접합부 간격 0.
- 눈동자: 원본 눈 메시 셰이더에서 안구 중심 기준 각도로 홍채·동공을 그린다(별도 구체·평면 없음).

## 수치 결과 (metrics.json, 539 샘플, 페이지 오류 0)

- 발 접지 오차 최대 0 m(얼굴 시트 제외: 눈높이 정렬용으로 발을 옮김)
- 몸 접합부 간격 최대 1e-05 m, 본 길이 오차 최대 1e-05 (찢김·크기 변화 없음)
- 모든 필수 모션 재생 확인, T포즈 정지 없음(팔을 수평으로 드는 Jump_Loop·Punch_Jab는 정상 동작)
- 어깨 관절 간격: 0.75 → 0.318 m, 1.0 → 0.388 m, 1.25 → 0.457 m

| 모션 | 치마 관통 프레임 | 치마 관통 최대(m) |
|---|---|---|
| Idle_Loop | 0/12 | 0 |
| Walk_Loop | 2/46 | 0.0065 |
| Jog_Fwd_Loop | 19/22 | 0.0573 |
| Sprint_Loop | 21/22 | 0.0569 |
| Crouch_Idle_Loop | 6/6 | 0.0501 |
| Crouch_Fwd_Loop | 22/22 | 0.0565 |
| Jump_Start | 3/6 | 0.0056 |
| Jump_Loop | 6/6 | 0.0093 |
| Jump_Land | 6/6 | 0.0236 |
| Punch_Jab | 0/6 | 0 |
| Punch_Cross | 0/6 | 0 |

## 남은 문제와 재현

1. **치마 × 조깅·질주·웅크리기**: 무릎을 높이 들면 치마 앞 중앙이 갈라져 허벅지 안쪽이 3~6cm 앞으로 나온다.
   걷기는 관통 최대 0.65cm. 스키닝만으로는 한계라 치마 보조 본이나 천 시뮬레이션이 필요하다.
   재현: `skirt-cycle-10-Sprint_Loop.png`, 또는 QA 페이지에서 bottom 10, Sprint_Loop t=0.3, 정면.
2. **체격 1 반바지 밑단**: 걷기 중 여성 반바지 밑단 가장자리에 1~2cm짜리 피부 점이 가끔 보인다.
   재현: 여성, 하의 8, heavy 1, Walk_Loop t=0.3, 정면.
3. **상의 밑단 두께**: 하의 허리 위로 띄운 밑단이 약간 두툼하게 보인다(겹침 비침은 셰이더로 해결됨).
4. **기본 신발**: 현대 운동화는 이번 범위에 없다. 기본값은 맨발이고, SF·기사 신발은 선택지로 남아 있다.
5. **속옷 하의 모양**: Synty 기본 몸의 골반 메시에 사각 속옷 밑단이 z≈0.705m 형상으로 모델링되어 있어
   흰색 경계를 그 턱에 맞췄다(무릎까지 번지지 않음). 삼각 팬티 모양으로 바꾸려면 몸 메시 수정이 필요하다.
