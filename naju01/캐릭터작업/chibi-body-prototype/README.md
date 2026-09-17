# 치비 몸체 시제품 — 1단계 (몸 + 43개 모션)

브랜치 `codex/chibi-body-prototype` (기준 `ff38a3b`). 기존 Sidekick 캐릭터·편집창·로비 경로는 수정하지 않았다.

## 확인 방법

- 로비: `http://localhost:5173/?avatar=chibi` — 왼쪽 패널에서 남/여, 43개 동작, 키·머리, 피부색
- 비교: `http://localhost:5173/?avatar=sidekick` — 기존 캐릭터(그대로)
- 캡처: `qa/chibi-compare-*.png`(Sidekick·치비 남·여 같은 모션), `qa/chibi-*-motions-*.png`(43개 전체)

## 만든 방식

원본은 V4 검토본 `sunny_stroll_20260915/v4_new_source/base_rig.blend`(Meshy 알몸 몸체 + 얼굴 파츠 + 속옷, 22본). 읽기만 했고
작업 전 `~/Documents/kgeseo-backups/v4_new_source_backup_20260917`에 백업했다.

1. 팔을 Sidekick T포즈 방향으로 펴고(V4 스킨), 어깨 0° → 팔꿈치 90° → 손목 180°로 나누어 비틀어
   손바닥 위·엄지 뒤(원본)를 손바닥 아래·엄지 앞(Sidekick)으로 맞췄다.
2. 비율: 머리 ×1.12, 다리 길이 ×0.76, 팔 두께 ×1.38, 다리 두께 ×1.32, 몸통 폭 ×1.14, 목 두께 ×1.35 → 키 1.45 m 기준 약 3등신.
3. Sidekick 89본 뼈대(이름·계층·축 그대로)를 새 관절 위치로 옮기고 V4 가중치를 옮겨 묶었다(정점당 최대 4본).
4. 런타임 `naju01/src/치비게임아바타.jsx`는 Sidekick과 같은 리타게팅·자동 동작·발 접지 규칙을 쓴다.

| 파일 | 내용 |
|---|---|
| `naju01/도구/build_chibi_body.py` | 위 1~3 빌드 스크립트(파라미터로 비율 조절) |
| `public/models/chibi-male.glb`, `chibi-female.glb` | 각 약 3.5 MB |
| `~/Downloads/CHIBI_body_prototype.blend` | Blender 원본(저장소 밖) |
| `tpose-front.png`, `tpose-side.png`, `lobby-chibi.png` | 기본 자세·로비 캡처 |

## 검증 결과 (`qa/metrics.json`, 235 샘플, 페이지 오류 0)

- 43개 모션 모두 남·여 몸체에서 재생, 매핑된 본 53개.
- 팔 각도가 같은 시각의 Sidekick과 일치(예: Idle 68.9°, Jog 40°, Punch_Jab 12.7°).
- 본 길이 오차 1e-05(모션 중 크기 변화 없음). 발 접지 오차는 서 있는 동작에서 0~0.2 mm.

## 알려진 한계 (1단계)

- `Pistol_Aim_Up`, `Pistol_Aim_Down`: 팔이 짧고 머리가 커서 손이 머리에 파묻힌다.
- `Roll`, `Swim_Fwd_Loop`: 발바닥 기준 접지라 몸이 지면 아래로 내려간다(Sidekick과 같은 규칙).
- 앉기·운전 동작은 의자 없이 재생하므로 공중에 앉은 자세로 보인다.
- 손가락은 손 본에 묶여 있어 주먹 쥐기 등 손가락 모션이 반영되지 않는다.
- 얼굴은 V4의 임시 입체 파츠이고, 색은 단색 재질이다. 2단계(2D 질감)에서 교체한다.
- 헤어·의상·체형 조절은 아직 없다(3·4단계).
