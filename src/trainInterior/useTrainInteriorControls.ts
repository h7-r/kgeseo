import { buildOutlineSchema, useSavedControls } from "@/engine/leva/savedControls";

// 「유리색」~「유리얼룩」·「유리밝기」·「막투명도」·「좌석천색2」 는 지금 화면에 쓰이지 않는다.
// 저장값과 패널을 그대로 두려고 남겨 둔다.
const TRAIN_INTERIOR_SCHEMA = {
  // 밝은 바탕이라 벽의 얼룩·균열이 또렷하게 읽힌다.
  bodyColor: { value: "#525252", label: "차체색" },
  // 허리 아래를 한 톤 낮춰야 공간이 바닥에 붙어 보인다.
  lowerWallColor: { value: "#5c5c5c", label: "아랫단색" },
  floorColor: { value: "#939393", label: "바닥색" },
  ceilingColor: { value: "#6c6c6c", label: "천장색" },
  // 갈색이면 본부실 나무 가구와 겹쳐 방에서 옮겨 온 의자처럼 보인다.
  seatFabricColor: { value: "#575758", label: "좌석천색" },
  seatFabricColor2: { value: "#1d1d1d", label: "좌석천색2" },
  seatFrameColor: { value: "#383b3e", label: "좌석틀색" },
  armrestColor: { value: "#3c4046", label: "팔걸이색" },
  windowFrameColor: { value: "#626161", label: "창틀색" },
  shelfColor: { value: "#9d9d9d", label: "선반색" },
  doorColor: { value: "#454b55", label: "문색" },
  // 역은 전체를 눌러 놓았다. 기차만 밝으면 밖에서 들어올 때 눈이 부시고 화풍이 끊긴다.
  brightness: { value: 0.64, min: 0.2, max: 2, step: 0.02, label: "밝기" },
  ceilingLightIntensity: { value: 1.0, min: 0, max: 4, step: 0.05, label: "천장등세기" },
  // 세면 그림자가 지워져 툰 밝기 단이 안 보이고 납작해진다.
  ambient: { value: 1.4, min: 0, max: 3, step: 0.02, label: "밑빛" },
  lampCount: { value: 6, min: 2, max: 12, step: 1, label: "등개수" },
  lampColor: { value: "#ffffff", label: "등색" },
  lampOffColor: { value: "#2c2d2e", label: "꺼진등색" },
  deadLampRatio: { value: 0.55, min: 0, max: 1, step: 0.05, label: "죽은등비율" },
  flickerLampRatio: { value: 0.35, min: 0, max: 1, step: 0.05, label: "깜빡등비율" },
  lampSeed: { value: 3, min: 1, max: 99, step: 1, label: "등시드" },
  /** 깜빡임 주기(초). 등마다 ±20% 흩어진다. */
  flickerPeriod: { value: 20, min: 6, max: 60, step: 1, label: "깜빡주기" },
  wallSeed: { value: 558, min: 1, max: 999, step: 1, label: "벽시드" },
  wallWear: { value: 1.0, min: 0, max: 2, step: 0.05, label: "벽낡음" },
  floorSeed: { value: 514, min: 1, max: 999, step: 1, label: "바닥시드" },
  glassColor: { value: "#161c25", label: "유리색" },
  reflectionColor: { value: "#ffffff", label: "반사색" },
  reflectionStrength: { value: 0.12, min: 0, max: 1, step: 0.02, label: "반사세기" },
  glassSmudge: { value: 0.1, min: 0, max: 2, step: 0.05, label: "유리얼룩" },
  glassBrightness: { value: 0.25, min: 0.2, max: 2, step: 0.05, label: "유리밝기" },
  boardedWindowRatio: { value: 0.25, min: 0, max: 1, step: 0.05, label: "막힌창비율" },
  showOutside: { value: true, label: "창밖보이기" },
  outsideBrightness: { value: 0.9, min: 0, max: 2, step: 0.05, label: "창밖밝기" },
  glassOpacity: { value: 0.3, min: 0, max: 1, step: 0.02, label: "막투명도" },
  /** 창밖 이미지 좌우 방향 뒤집기 */
  flipOutside: { value: false, label: "창밖뒤집기" },
  windowSeed: { value: 5, min: 1, max: 99, step: 1, label: "창시드" },
  plankColor: { value: "#584634", label: "판자색" },
  plankCount: { value: 3, min: 1, max: 5, step: 1, label: "판자수" },
  plankThickness: { value: 0.3, min: 0.1, max: 0.8, step: 0.02, label: "판자두께" },
  // 1인용 좌석 네 개가 마주 보는 묶음(통로 양옆 하나씩 × 마주 보는 두 줄).
  seatGroupCount: { value: 3, min: 1, max: 6, step: 1, label: "좌석묶음수" },
  groupSpacing: { value: 13, min: 8, max: 24, step: 0.5, label: "묶음간격" },
  /** 마주 보는 두 줄 사이(무릎 공간) */
  facingGap: { value: 5.0, min: 3, max: 9, step: 0.1, label: "마주간격" },
  /** 문에서 얼마나 떨어져 시작하나 */
  seatStart: { value: 20, min: 8, max: 40, step: 0.5, label: "좌석시작" },
  /** 창가 벽에서 떨어진 거리 */
  seatWallGap: { value: 2.3, min: 1, max: 4, step: 0.05, label: "좌석벽간격" },
  /** 1.0 = 폭 1.7 · 깊이 1.55 · 등받이 위 4.4 유닛. 1.25 면 무궁화호 좌석에 가깝다. */
  seatScale: { value: 1.3, min: 0.7, max: 1.8, step: 0.05, label: "좌석크기" },
  fogColor: { value: "#383838", label: "안개색" },
  fogNear: { value: 20, min: 0, max: 120, step: 1, label: "안개시작" },
  fogFar: { value: 120, min: 20, max: 400, step: 1, label: "안개끝" },
  ...buildOutlineSchema({ width: 2.5, color: "#12151a", crease: true, creaseAngle: 45, creaseColor: "#191d25" }),
};

/** Leva 「기차 내부」 */
export function useTrainInteriorControls() {
  return useSavedControls("기차 내부", TRAIN_INTERIOR_SCHEMA);
}
