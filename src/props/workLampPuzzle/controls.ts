/**
 * Scene 의 Leva 폴더 「작업등 퍼즐」 값. Scene 이 폴더를 만들고 통째로 넘긴다.
 * 열쇠 = 아래 필드 이름, label = 옛 한글 열쇠(괄호 안).
 */
export interface WorkLampPuzzleValues {
  /** 보이기 */
  visible: boolean;
  // ── 램프가 처음 굴러다니는 자리 ──
  /** 바닥x */ floorX: number;
  /** 바닥y */ floorY: number;
  /** 바닥z */ floorZ: number;
  /** 바닥기울기 */ floorTilt: number;
  // ── 분기함 세 곳 (A·C 안쪽벽, B 바깥벽) ──
  /** A_z */ junctionAZ: number;
  /** B_z */ junctionBZ: number;
  /** C_z */ junctionCZ: number;
  /** 함y */ boxY: number;
  /** 함폭 */ boxWidth: number;
  /** 함높이 */ boxHeight: number;
  /** 함깊이 */ boxDepth: number;
  /** 함때 */ boxWear: number;
  /** 함밝기 */ boxBrightness: number;
  // ── 분필 자국 — 몇 번째 자리인지(order)와 글자 ──
  /** A_칸 */ markAOrder: number;
  /** A_글자 */ markAGlyph: string;
  /** B_칸 */ markBOrder: number;
  /** B_글자 */ markBGlyph: string;
  /** C_칸 */ markCOrder: number;
  /** C_글자 */ markCGlyph: string;
  /** A_자국z */ markAZ: number;
  /** B_자국z */ markBZ: number;
  /** C_자국z */ markCZ: number;
  /** 자국y */ markY: number;
  /** 자국크기 */ markSize: number;
  /** 자국색 */ markColor: string;
  /** 자국씨 */ markSeed: number;
  /** 자국띄움 */ markOffset: number;
  /** B_자국띄움 — 문짝이 벽보다 앞이다 */ markBOffset: number;
  // ── 램프 생김새 ──
  /** 램프크기 */ lampScale: number;
  /** 쇠색 */ metalColor: string;
  /** 고무색 */ rubberColor: string;
  /** 전구색 */ bulbColor: string;
  /** 바닥반짝 */ floorGlint: number;
  // ── 빛 — 손(배터리)과 꽂힘(전원)을 크게 벌린다 ──
  /** 불색 */ lightColor: string;
  /** 손세기 */ handIntensity: number;
  /** 손거리 */ handDistance: number;
  /** 손빛앞 */ handLightForward: number;
  /** 손빛아래 */ handLightDown: number;
  /** 꽂힘세기 */ pluggedIntensity: number;
  /** 꽂힘거리 */ pluggedDistance: number;
  // ── 손에 든 모습 ──
  /** 손앞 */ handForward: number;
  /** 손아래 */ handDown: number;
  /** 손옆 */ handSide: number;
  /** 손크기 */ handScale: number;
  /** 손기울기 */ handTilt: number;
  /** 손비틀기 */ handTwist: number;
  /** 손켜짐 */ handGlow: number;
  // ── 바닥에 놓였을 때 ──
  /** 바닥세기 */ floorIntensity: number;
  /** 바닥거리 */ floorDistance: number;
  /** 바닥켜짐 */ floorGlow: number;
  /** 놓는거리 */ dropDistance: number;
  // ── 차단기함 + 3칸 자물쇠 ──
  /** 차단기보이기 */ breakerVisible: boolean;
  /** 차단기z */ breakerZ: number;
  /** 차단기y */ breakerY: number;
  /** 차단기폭 */ breakerWidth: number;
  /** 차단기높이 */ breakerHeight: number;
  /** 차단기깊이 */ breakerDepth: number;
  /** 자물쇠크기 */ lockScale: number;
  /** 자물쇠조작거리 */ lockOperateDistance: number;
  /** 자물쇠깊이 */ lockDepth: number;
  /** 자물쇠높이 */ lockHeight: number;
  /** 자물쇠옆 */ lockSide: number;
  /** 정답 */ lockAnswer: string;
  /** 씨1 */ lockSeed1: number;
  /** 씨2 */ lockSeed2: number;
  /** 씨3 */ lockSeed3: number;
  // ── Scene 이 쓰는 값(복도 어둠·등) ──
  /** 켜질등수 */ lightCount: number;
  /** 등z시작 */ lightStartZ: number;
  /** 등z끝 */ lightEndZ: number;
  /** 어둠경계z */ darkBoundaryZ: number;
  /** 처음어둡게 */ startDark: boolean;
  /** 어둠계수 */ darkFactor: number;
  /** 반경계z */ halfPowerBoundaryZ: number;
  // ── ⟦분리수거 퍼즐⟧ ──
  /** 통z일반 */ binGeneralZ: number;
  /** 통z플라 */ binPlasticZ: number;
  /** 통띄움 */ binOffset: number;
  /** 쓰레기크기 */ trashScale: number;
  // ── ⟦그림 퍼즐⟧ ──
  /** 그림z */ paintingZ: number;
  /** 그림y */ paintingY: number;
  /** 그림폭 */ paintingWidth: number;
  /** 시험반y */ switchPanelY: number;
  /** 시험반옆 */ switchPanelSide: number;
}

/** 손에 든 모습만 쓰는 값 */
export type HeldPoseValues = Pick<WorkLampPuzzleValues, "handForward" | "handDown" | "handSide">;
