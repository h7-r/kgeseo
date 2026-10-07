/**
 * 배전반 속 치수. 길이 값은 대부분 함 크기 대비 비율이라 함을 바꿔도 같이 따라간다(절대값이면 작은 함에서 벽을 뚫는다).
 * 축: z 가 가로, y 가 세로, x 가 깊이. 깊이는 X(t) 로만 쓴다 — t 는 뒤판 0, 함 앞면 깊이로 잰 값이라
 * 방향(d)이 뒤집혀도 숫자를 그대로 쓴다.
 */
export interface PanelDimensions {
  width: number;
  height: number;
  depth: number;
  /** 앞면이 향하는 x 방향(+1 / −1) */
  d: number;
  /** 분기차단기 몇 줄 — 맨 아래부터 쌓인다 */
  breakerRows: number;
  /** 세로 두께 — 줄 간격이 따라간다 */
  switchThickness: number;
  /** 안폭 대비 */
  switchWidth: number;
  /** deep() 기준 */
  switchDepth: number;
  /** 안폭 대비 — 가운데에서 한 열까지 */
  switchSpacing: number;
  /** 스위치 가로 대비 */
  knobWidth: number;
  /** 스위치 두께 대비 */
  knobHeight: number;
  /** 스위치 가로 대비 — 켜짐/꺼짐 사이 거리 */
  knobTravel: number;
  /** 안높 대비(상한 0.2) */
  mainBreakerHeight: number;
  /** 안폭 대비 */
  mainBreakerWidth: number;
  /** deep() 기준 */
  mainBreakerDepth: number;
  /** 위 칸 안에서 위아래(0=아래 1=위) */
  mainBreakerPosition: number;
  /** 안높 대비(상한 0.14) */
  junctionHeight: number;
  /** 안폭 대비 */
  junctionWidth: number;
  /** 안높 대비 — 함 한가운데가 0 */
  junctionPosition: number;
  /** 안폭 대비 */
  meterWidth: number;
  /** 주차단기 높이 대비 */
  meterHeight: number;
  /** 안폭 대비 — 가운데에서 옆으로 */
  meterPosition: number;
  /** 계기함 대비 */
  displayWidth: number;
  displayHeight: number;
  /** 관창 꽂는 구멍. 꽂을 물건이 고정 크기라 여기만 절대값이다. */
  hasSocket: boolean;
  /** 관창 끝 지름 0.084 + 헐거움 */
  socketDiameter: number;
  /** 판 뒤로 파이는 깊이 */
  socketDepth: number;
  /** 계기창 아래 틈 — 키우면 구멍이 아래로 내려간다 */
  socketGap: number;
  /** 안폭 대비(음수 쪽 = 화면 오른쪽) */
  lampX: number;
  /** 안높 대비 */
  lampY: number;
  /** 안폭 대비(상한 0.07) */
  lampSize: number;
  /** 등 크기 대비 — 두 알 사이 */
  lampSpacing: number;
  /** 테두리 대비 */
  redLampSize: number;
  greenLampSize: number;
  /** 안폭 대비 */
  groundX: number;
  /** 동판 폭(절대) */
  groundWidth: number;
  /** 퍼즐 선 · 분기 배선 */
  wireRadius: number;
  /** 인입 케이블 */
  thickWireRadius: number;
}

export type PanelLayout = ReturnType<typeof computePanelLayout>;

/** 색 → 선을 뽑아 낼 쪽. z 부호와 화면 좌우가 반대라(+x 를 보는 함 앞에 서면 화면 오른쪽 = −z) 빨강만 −1 이다. */
export const PULL_SIDE = [-1, 1, 1] as const;
/** 같은 쪽으로 나가는 파랑·노랑은 차선을 달리한다 — 같은 자리면 세로 구간이 겹친다. */
const LANE = [0, 1, 0] as const;
/** 스위치 앞면보다 앞으로 나오면 허공에 뜬 선으로 보여 뒤로 붙인다 */
export const WIRE_BACK_OFFSET = [0.062, 0.062, 0.062] as const;
/** 줄 칸 크기의 기준 줄 수. 줄 수로 나누면 줄을 뺄 때 차단기가 통째로 커진다. */
const REFERENCE_ROWS = 11;

export function computePanelLayout(dims: PanelDimensions) {
  const { width, height, depth, d } = dims;
  const halfDepth = depth / 2;
  const innerWidth = width - 0.24;
  const innerHeight = height - 0.24;
  const X = (t: number) => d * (t - halfDepth);

  // 얕아져도 부품이 문을 뚫지 않게 깊이 방향만 줄인다. 닫힌 문 안쪽 면이 앞에서 0.06 이라
  // 쓸 수 있는 깊이(깊이 − 0.06)로 잰다. 설계값 0.4 에서 정확히 1 이다.
  const depthScale = Math.min(1, Math.max(0.15, (depth - 0.06) / 0.34));
  const plateThickness = 0.03 * depthScale;
  const plateT = 0.085 * depthScale;
  const plateFront = plateT + plateThickness / 2; // 모든 부품이 올라서는 바닥
  /** 판 앞면에서 a 만큼 앞. 깊이 배율이 여기서 한 번에 걸린다. */
  const deep = (a: number) => X(plateFront + a * depthScale);

  // 안쪽 벽의 진짜 면은 벽 두께(0.06) 절반만큼 안이다.
  const wallFace = innerWidth / 2 - 0.03;

  // 인입 케이블 다발 — 케이블과 클램프가 같은 값을 봐야 클램프가 허공을 물지 않는다.
  const inletSpacing = Math.min(0.046, innerWidth * 0.034);
  const inletZ0 = -innerWidth * 0.26;
  const inletCenter = inletZ0 + inletSpacing * 2;
  const inletWidth = inletSpacing * 4 + 0.085;

  const topRowHeight = Math.min(0.5, innerHeight * 0.3);
  const mainHeight = Math.min(0.2, innerHeight * dims.mainBreakerHeight);
  const branchTop = innerHeight / 2 - topRowHeight;
  // 위 칸 가운데보다 조금 아래 — 더 올리면 인입 케이블 자리가 없고, 내리면 부스바로 가는 선이 되올라간다.
  const mainY = branchTop + topRowHeight * dims.mainBreakerPosition;
  const mainZ = -innerWidth * 0.02;
  const mainWidth = innerWidth * dims.mainBreakerWidth;
  const mainDepth = dims.mainBreakerDepth;
  const meterZ = innerWidth * dims.meterPosition;
  const meterWidth = innerWidth * dims.meterWidth;
  const meterHeight = mainHeight * dims.meterHeight;

  const branchBottom = -innerHeight / 2 + Math.min(0.12, innerHeight * 0.07);
  const referenceSpacing = (branchTop - branchBottom) / (REFERENCE_ROWS - 1);
  // 스위치를 두껍게 하면 줄 간격도 벌어진다(칸이 고정이면 두께 슬라이더가 중간에서 멈춘다).
  const rowSpacing = Math.max(referenceSpacing, dims.switchThickness * 1.28);
  const breakerHeight = Math.min(dims.switchThickness, rowSpacing * 0.78);
  // 간격이 벌어지면 들어갈 줄 수도 준다 — 넘기면 함 밖으로 나간다.
  const fittingRows = Math.max(1, Math.floor((branchTop - branchBottom) / rowSpacing) + 1);
  const rowCount = Math.max(1, Math.min(dims.breakerRows | 0, fittingRows));
  const topRowY = branchBottom + (rowCount - 1) * rowSpacing;
  const breakerWidth = innerWidth * dims.switchWidth;
  const breakerDepth = dims.switchDepth;
  const columnZ = [-innerWidth * dims.switchSpacing, innerWidth * dims.switchSpacing] as const;
  // 아래에서 위로 쌓는다(r=0 이 맨 아래). 위쪽은 비워 둔다.
  const rowYs = Array.from({ length: rowCount }, (_, r) => branchBottom + r * rowSpacing);
  /** 줄 → 색. 위에서부터 빨강·파랑·노랑 순으로 돈다. */
  const colorOfRow = (r: number) => (rowCount - 1 - r) % 3;
  const outerZ = (c: number) => PULL_SIDE[c] * (wallFace - 0.06 - LANE[c] * 0.1);

  // 끊어진 자리 — 굵은 다발이 함 한가운데 접속함에 물리고 세 줄이 나와 허공에서 끝난다.
  // 끝을 띄워야 "이을 자리"로 읽힌다. 스위치와 사이를 비워 둔 틈이 끊긴 자리라는 단서다.
  const junctionY = innerHeight * dims.junctionPosition;
  const junctionDepth = 0.06;
  // 함을 따라간다 — 고정이면 작은 함에서 케이블이 위로 들어가려다 되올라간다.
  const junctionHeight = Math.min(0.14, innerHeight * dims.junctionHeight);
  const hangingZ = [-innerWidth * 0.17, innerWidth * 0.02, innerWidth * 0.17] as const;
  // 자유단 높이 — 맨 위 스위치 줄보다 위, 접속함 아래, 분기 영역 안으로 묶는다.
  // 아래 칸은 스위치 두께 기준이다(줄 간격으로 재면 두꺼울수록 줄이 짧아진다).
  const freeEndY = Math.max(
    branchBottom,
    Math.min(
      junctionY - junctionHeight / 2 - 0.05,
      // 끝 높이를 엇갈리게 두느라 0.045 를 더 먹는다
      topRowY + breakerHeight / 2 + Math.max(0.26, breakerHeight * 1.8),
    ),
  );

  // 접지 동판 — 왼쪽 위, 주차단기 옆 빈 자리
  const groundZ = -innerWidth * dims.groundX;
  const groundTop = innerHeight / 2 - 0.1;
  const groundBottom = branchTop + Math.min(0.1, topRowHeight * 0.2);

  // 세로 부스바 3줄 — 두 차단기 열 사이 틈에 바 두께까지 재서 넣는다.
  const gapHalf = innerWidth * dims.switchSpacing - breakerWidth / 2;
  const busThickness = Math.min(0.034, gapHalf * 0.6);
  const busSpacing = Math.max(0, gapHalf - busThickness / 2 - 0.004) * 0.78;
  const busZ = [-busSpacing, 0, busSpacing] as const;
  // 꼭대기는 주차단기 바로 아래, 차단기가 몇 줄 안 남으면 거기까지만 — 빈 자리까지 뻗으면 어색하다.
  const busTop = Math.min(branchTop + 0.12, mainY - mainHeight / 2 - 0.02, topRowY + rowSpacing * 0.85);
  const busBottom = branchBottom - 0.05;
  const tagWidth = Math.min(0.1, gapHalf * 1.7);

  // 관창 구멍. 함 뒤판을 뚫으면 안 되므로 판앞까지로 묶는다.
  const socketRadius = Math.max(0.02, dims.socketDiameter / 2);
  const socketY = mainY - meterHeight / 2 - dims.socketGap - socketRadius;
  const socketHollow = Math.max(0.02, Math.min(dims.socketDepth, plateFront - 0.01));

  // 표시등 두 알 — 오른쪽(−z) 가운데. 크기가 함을 따라가야 작은 함에서 옆벽을 안 뚫는다.
  const lampRadius = Math.min(0.07, innerWidth * dims.lampSize);
  const lampZ = -innerWidth * dims.lampX;
  const lampYs = [
    innerHeight * dims.lampY + lampRadius * dims.lampSpacing,
    innerHeight * dims.lampY - lampRadius * dims.lampSpacing,
  ] as const;

  return {
    dims,
    halfDepth,
    innerWidth,
    innerHeight,
    X,
    depthScale,
    plateThickness,
    plateT,
    plateFront,
    deep,
    wallFace,
    inletSpacing,
    inletZ0,
    inletCenter,
    inletWidth,
    topRowHeight,
    mainHeight,
    branchTop,
    mainY,
    mainZ,
    mainWidth,
    mainDepth,
    meterZ,
    meterWidth,
    meterHeight,
    branchBottom,
    rowSpacing,
    breakerHeight,
    rowCount,
    topRowY,
    breakerWidth,
    breakerDepth,
    columnZ,
    rowYs,
    colorOfRow,
    outerZ,
    junctionY,
    junctionDepth,
    junctionHeight,
    hangingZ,
    freeEndY,
    groundZ,
    groundTop,
    groundBottom,
    busThickness,
    busZ,
    busTop,
    busBottom,
    tagWidth,
    socketRadius,
    socketY,
    socketHollow,
    lampRadius,
    lampZ,
    lampYs,
  };
}
