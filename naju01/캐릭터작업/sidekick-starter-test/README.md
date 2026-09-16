# Sidekick 게임 공간 검증

- 브랜치: `codex/sidekick-game-space-test`
- 실행 모델: `public/models/sidekick-naju-test.glb`
- 실행 컴포넌트: `naju01/src/사이드킥게임아바타.jsx`
- 테스트 공간: `naju01` (`http://127.0.0.1:5174/`)
- 조작: `V` 3인칭 전환, `T` 입력 잠금, `WASD` 걷기, `Shift + WASD` 달리기

## 현재 검증 범위

- Synty가 제공한 공통 89본 스켈레톤과 스킨 웨이트를 그대로 사용한다.
- 대기 자세에서 A/T 포즈의 팔을 몸 옆으로 내린다.
- 걷기와 달리기는 같은 스켈레톤을 직접 구동한다.
- 기존 Meshy 캐릭터, 기존 게임 리그, 로비 코드는 수정하지 않는다.
- 현재 외형은 파이프라인 검증용 조합이며 최종 의상·헤어가 아니다.

## 출처 및 배포 주의

원본 에셋은 **Synty Sidekick Modular Characters - Free Starter Pack**이다. 다운로드한 Unity/Unreal 원본 패키지는 저장소에 넣지 않는다. 생성된 GLB를 커밋하거나 배포하기 전에는 팀 저장소의 공개 범위와 Synty 라이선스를 다시 확인한다.

## 빌드 확인

```bash
npm run build -- --config naju01/vite.config.js
```

현재 프로덕션 빌드 통과 및 실제 `naju01` 맵에서 대기·걷기·달리기 육안 검증까지 완료했다.
