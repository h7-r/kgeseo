import { buildOutlineSchema, useSavedControls } from "@/engine/leva/savedControls";

import { FORCE_LEGACY_TERRAIN } from "../app/runtimeFlags";
import { MOVEMENT_CONSTANTS } from "../movement/useTerrainMovement";
import { getTunableControl } from "../plan/sitePlan";
import { DISTORTION_STAGE_ORDER } from "../story/distortion";

/** Leva 옵션 값은 저장 데이터라 한글 그대로 두고, 코드에서는 이 표로 읽는다. */
const GROUND_SHADING = { 부드럽게: "smooth", 툰: "toon" } as const;
export type GroundShading = (typeof GROUND_SHADING)[keyof typeof GROUND_SHADING];

export function toGroundShading(option: string): GroundShading {
  return option === "툰" ? GROUND_SHADING.툰 : GROUND_SHADING.부드럽게;
}

/**
 * 「NAJU-01 그레이박스」 — 한 번의 useSavedControls 그대로(팀 기준값 112 키와 맞물린다).
 * 열쇠 순서도 저장값·팀 기준값과 같아야 한다. label 은 저장 데이터 열쇠라 한글 그대로.
 */
export function useNajuControls() {
  return useSavedControls("NAJU-01 그레이박스", {
    brightness: { value: 1, min: 0.3, max: 2, step: 0.05, label: "밝기" },
    // 하늘색은 배경이자 안개 색이다. 어두우면 먼 것이 전부 검게 잠긴다.
    skyColor: { value: "#5C6B7B", label: "하늘색" },
    groundColor: { value: "#3A3F49", label: "지반색" },
    riverColor: { value: "#3D5E78", label: "강색" },
    pathColor: { value: "#C9A227", label: "통로색" },
    cliffColor: { value: "#6B6152", label: "절벽색" },
    blockerColor: { value: "#57606C", label: "차단물색" },
    showLabels: { value: true, label: "라벨" },
    showGrid: { value: true, label: "격자" },
    showSections: { value: false, label: "단면선" },
    showInvestigationPoints: { value: true, label: "조사점표시" },
    // 1.7 m 키의 '자' — 절벽 높이가 읽히는지 보는 기준
    showHumanScale: { value: true, label: "사람자" },
    fallRecovery: { value: true, label: "낙하복귀" },
    groundDetail: { value: true, label: "바닥디테일" },
    // label 이 `새지형` 이 아닌 것은 그 열쇠에 false 가 저장된 브라우저가 있어서다.
    // 끄면 코드 지형으로 돌아간다(비교·되돌리기용 — edits.json 은 블렌더 지형 높이 기준이다).
    useBlenderTerrain: { value: !FORCE_LEGACY_TERRAIN, label: "블렌더지형" },
    // 본편 로비와 같은 툰 그라디언트라야 두 공간이 같은 게임으로 보인다.
    groundShading: { value: "툰", options: ["부드럽게", "툰"], label: "바닥셰이딩" },
    // 3 = 33 cm 간격. 판이 촘촘해야 돌 발치 그늘이 뭉개지지 않는다.
    groundCellsPerMeter: { value: 3, min: 0.5, max: 6, step: 0.5, label: "바닥칸당" },
    groundBumpScale: { value: 1, min: 0, max: 2.5, step: 0.05, label: "바닥요철" },
    // 기하는 얕게 두고 빛만 굴곡을 읽게 한다. 세면 normalBias 가 엉뚱하게 밀려 얼룩이 진다.
    normalExaggeration: { value: 3, min: 1, max: 14, step: 0.5, label: "법선과장" },
    scatterDensity: { value: 1, min: 0, max: 2, step: 0.05, label: "흩뿌림밀도" },
    cliffDetail: { value: true, label: "절벽디테일" },
    // 한 계단 안에 꼭짓점이 여러 개 들어가야 각진 면이 평면으로 읽힌다.
    cliffCellsPerMeter: { value: 5, min: 0.5, max: 8, step: 0.5, label: "절벽칸당" },
    cliffCarveDepth: { value: 2.4, min: 0, max: 5, step: 0.1, label: "절벽파임" },
    // 되풀이되는 지층 띠가 곧 '높이의 눈금'이다.
    strataThickness: { value: 1.8, min: 0.4, max: 5, step: 0.1, label: "층두께" },
    // 0 = 점토 덩어리 · 1 = 평면으로 쪼개진 바위
    angularity: { value: 0.8, min: 0, max: 1, step: 0.05, label: "각짐" },
    screeCount: { value: 110, min: 0, max: 400, step: 10, label: "너덜" },
    blockerDetail: { value: true, label: "차단물디테일" },
    rockCellsPerMeter: { value: 2.4, min: 0.4, max: 5, step: 0.2, label: "바위칸당" },
    rockCarveDepth: { value: 1.35, min: 0, max: 3, step: 0.05, label: "바위파임" },
    // 작은 바위에 절벽 주기를 쓰면 판때기가 된다 — 소음 주기를 죈다.
    rockPatternScale: { value: 3.5, min: 1, max: 8, step: 0.25, label: "바위무늬" },
    treeCount: { value: 34, min: 0, max: 120, step: 2, label: "나무수" },
    // 1 m² 당 포기 수. Z4 는 풀이 깔려야 능선으로 읽힌다.
    grassDensity: { value: 1.3, min: 0, max: 4, step: 0.1, label: "풀" },
    riverDetail: { value: true, label: "강디테일" },
    waveHeight: { value: 0.09, min: 0, max: 0.4, step: 0.01, label: "물결높이" },
    waveSpeed: { value: 1, min: 0, max: 3, step: 0.05, label: "물결속도" },
    // 꼭짓점 격자(1.7 m)보다 잔 물결은 픽셀 셰이더로만 담는다.
    waterRipple: { value: 1, min: 0, max: 2, step: 0.05, label: "물잔결" },
    // 바닥은 uv 가 없어 이미지 텍스처 대신 삼면(triplanar) 결을 얹는다.
    groundGrain: { value: 1, min: 0, max: 2, step: 0.05, label: "바닥결" },
    groundRockGrain: { value: 1, min: 0, max: 2, step: 0.05, label: "바닥바위결" },
    bankStoneCount: { value: 90, min: 0, max: 300, step: 10, label: "물가돌" },
    // 강 건너 능선은 택촌 뒤에 선다. 물가에 세우면 마을을 통째로 가렸다.
    showFarBank: { value: true, label: "건너편" },
    pathDetail: { value: true, label: "길디테일" },
    shoulderWidth: { value: 0.9, min: 0, max: 3, step: 0.1, label: "갓길폭" },
    shoulderDrop: { value: 0.35, min: 0, max: 1.5, step: 0.05, label: "갓길낙차" },
    slopeCarveDepth: { value: 0.5, min: 0, max: 2, step: 0.05, label: "비탈파임" },
    roadsideStones: { value: 0.55, min: 0, max: 1, step: 0.05, label: "길가돌" },
    fences: { value: true, label: "울타리" },
    // 이만큼(m) 넘게 떨어지는 쪽에만 울타리를 세운다.
    fenceMinDrop: { value: 0.8, min: 0.3, max: 3, step: 0.1, label: "울타리낙차" },
    connectorRamp: { value: true, label: "연결로" },
    // 코어를 벗어나는 것은 기획 결정이라 기본은 막아 둔다.
    allowLeavingCore: { value: false, label: "밖으로나가기" },
    slopeDecor: { value: true, label: "비탈장식" },
    skyDome: { value: true, label: "하늘돔" },
    cloudCount: { value: 26, min: 0, max: 80, step: 2, label: "구름" },
    distantLandscape: { value: true, label: "원경" },
    forestCount: { value: 760, min: 0, max: 2000, step: 20, label: "숲수" },
    villageHouseCount: { value: 34, min: 0, max: 120, step: 2, label: "마을집수" },
    taekchonHouseCount: { value: 26, min: 0, max: 80, step: 2, label: "택촌집수" },
    scene1Props: { value: true, label: "씬1요소" },
    scene2Props: { value: true, label: "씬2요소" },
    scene3Props: { value: true, label: "씬3요소" },
    scene4Props: { value: true, label: "씬4요소" },
    scene5Props: { value: true, label: "씬5요소" },
    // 손으로 깎은 자연물 ↔ Meshy 모형. 눈으로 대 봐야 정하는 값이다.
    bakedNature: { value: true, label: "모형자연" },
    steppingStones: { value: true, label: "돌다리" },
    // 씬 1 의 왜곡은 약해서 모르고 보면 안 보인다 — 켜고 끄며 대 보도록 기본은 끈다.
    showDistortion: { value: false, label: "왜곡보기" },
    distortionStage: { value: "초기", options: DISTORTION_STAGE_ORDER, label: "왜곡단계" },
    // 1 = 문서의 「미묘하게」. 크게 올리는 것은 확인용이다.
    distortionStrength: { value: 1, min: 0, max: 4, step: 0.1, label: "왜곡세기" },
    ferryBoat: { value: true, label: "나룻배" },
    roadsideBushes: { value: true, label: "길가수풀" },
    roadsideMargin: { value: 0.9, min: 0, max: 4, step: 0.1, label: "길가여백" },
    roadsideBand: { value: 3.2, min: 0.5, max: 8, step: 0.2, label: "길가띠" },
    roadsideDensity: { value: 1.1, min: 0, max: 2, step: 0.05, label: "길가밀도" },
    hillVegetation: { value: true, label: "언덕수풀" },
    hillTreeCount: { value: 420, min: 0, max: 1200, step: 20, label: "언덕나무" },
    hillShrubCount: { value: 900, min: 0, max: 2400, step: 50, label: "언덕덤불" },
    // assets/rocks/*.glb — 파일이 없으면 꺼진 것과 같다.
    rockAsset: { value: false, label: "바위에셋" },
    rockAssetWidth: { value: 22, min: 4, max: 40, step: 0.5, label: "바위폭" },
    rockAssetX: { value: 45, min: 30, max: 60, step: 0.25, label: "바위X" },
    rockAssetZ: { value: 28, min: 22, max: 36, step: 0.25, label: "바위Z" },
    rockAssetY: { value: 0, min: -8, max: 8, step: 0.25, label: "바위Y" },
    rockAssetRotation: { value: 0, min: -180, max: 180, step: 5, label: "바위회전" },
    boulders: { value: true, label: "바위덩어리" },
    cliffVegetation: { value: true, label: "절벽수풀" },
    cliffShrubCount: { value: 320, min: 0, max: 900, step: 20, label: "절벽덤불" },
    cliffTreeCount: { value: 24, min: 0, max: 160, step: 2, label: "절벽나무" },
    // 텍스처만 갈아 끼우므로 판정과 무관하다.
    bakedTerrainTexture: { value: false, label: "구운지형" },
    // 하드 섀도·툰 램프·외곽선이 같이 있어야 본편 로비처럼 보인다.
    shadows: { value: true, label: "그림자" },
    // 거의 평평한 바닥은 그림자맵이 제 자신을 가린다(acne).
    shadowNormalBias: { value: 0.6, min: 0, max: 8, step: 0.1, label: "그림자노멀보정" },
    // 안개는 공기 원근용이다. 본편 실내 값을 쓰면 15 m 밖이 검게 잠긴다.
    fog: { value: true, label: "안개" },
    fogNear: { value: 70, min: 5, max: 300, step: 5, label: "안개시작" },
    fogFar: { value: 900, min: 50, max: 2000, step: 20, label: "안개끝" },
    // 환경광이 세면 툰 램프가 한 칸에 몰려 램버트와 구별이 안 된다.
    ambientIntensity: { value: 0.26, min: 0, max: 1.2, step: 0.02, label: "환경광" },
    hemisphereIntensity: { value: 0.36, min: 0, max: 1.5, step: 0.02, label: "하늘빛" },
    sunIntensity: { value: 1.95, min: 0, max: 3, step: 0.05, label: "햇빛" },
    // 그림자 카메라가 사람을 따라다니므로 좁혀도 눈앞은 늘 덮인다(70 유닛 ≈ 21 m).
    shadowRange: { value: 70, min: 20, max: 230, step: 5, label: "그림자범위" },
    // 그림자 맵을 움직일 때만 다시 그린다(ShadowMapUpdater). 이상하면 끄면 매 프레임으로 돌아간다.
    throttleShadowUpdates: { value: true, label: "그림자갱신아낌" },
    // 방위 0 = 북 · 90 = 동 · 180 = 남. 나주는 북반구라 해는 남쪽에 있어야 절벽면이 밝다.
    sunAzimuth: { value: 205, min: 0, max: 360, step: 5, label: "해방위" },
    sunElevation: { value: 38, min: 5, max: 85, step: 1, label: "해고도" },
    hemisphereSkyColor: { value: "#93A8C6", label: "하늘빛색" },
    // 어두우면 모든 밑면이 검게 뭉친다 — 야외에서 밑면이 완전히 검은 일은 없다.
    hemisphereGroundColor: { value: "#7A6A54", label: "땅반사색" },
    // 미결값 — 확정하려면 sitePlan 의 기본값을 고쳐야 팀에 전달된다.
    cliffHeight: { ...getTunableControl("cliffHeight"), label: "절벽높이" },
    blockerHeight: { ...getTunableControl("blockerHeight"), label: "차단물높이" },
    eyeHeight: { ...getTunableControl("eyeHeight"), label: "눈높이" },
    fov: { ...getTunableControl("fov"), label: "FOV" },
    walkSpeed: { ...getTunableControl("walkSpeed", MOVEMENT_CONSTANTS.walk), label: "걷기속도" },
    ...buildOutlineSchema({ width: 2.5, color: "#1B1F27", crease: false }),
    // <Outlines> 는 screenspace 일 때만 월드 단위다. 야외라 픽셀 고정이면 먼 물건이 선에 삼켜진다.
    // 0.05 유닛 = 1.5 cm. engine buildOutlineSchema 의 눈금(0.5)으로는 못 다뤄 따로 둔다.
    outlineWorldWidth: { value: 0.05, min: 0, max: 0.3, step: 0.005, label: "외곽선세계굵기" },
    // 켜지 말 것 — 숲이 검은 덩어리가 되고 한 겹 잎에 흰 얼룩이 끼며 삼각형이 +53 % 다.
    vegetationOutline: { value: false, label: "초목외곽선" },
  });
}

export type NajuControls = ReturnType<typeof useNajuControls>;
