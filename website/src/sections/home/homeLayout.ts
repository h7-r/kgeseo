// 메인 페이지 배치 상수. 단위는 1920 무대 기준 px.

/** 디자인의 히어로 높이. 아래 구간 좌표는 전부 이 높이 밑에서 시작하게 그려져 있다. */
export const DESIGN_HERO_HEIGHT = 1149;
/** 창이 아주 낮아도 지킬 히어로 높이. 로고 · 설명 · 플레이 단추 묶음(약 580)이 위아래 여유를 두고 들어간다. */
export const HERO_MIN_HEIGHT = 640;

/** 소개 덩이와 가입 폼이 함께 맞추는 세로 중심선. */
export const INTRO_CENTER_Y = 1938;
/** 소개 덩이의 높이. 글 크기가 전부 px 로 고정이라 변하지 않는다. 가입 폼의 아랫선을 여기에 맞춘다. */
const INTRO_HEIGHT = 789;
/** 소개 덩이 아랫선(숫자 지표 이름 줄의 바닥) */
export const INTRO_BOTTOM_Y = INTRO_CENTER_Y + INTRO_HEIGHT / 2;

/** 소개 덩이와 가입 폼의 가로 자리. 양쪽 여백 215 로 대칭(215 + 755 + 175 + 560 + 215 = 1920). */
export const INTRO_LEFT = 215;
export const INTRO_WIDTH = 755;
const INTRO_FORM_GAP = 175;
export const SIGNUP_FORM_LEFT = INTRO_LEFT + INTRO_WIDTH + INTRO_FORM_GAP;
export const SIGNUP_FORM_WIDTH = 560;

/** 소개 덩이에서 가장 긴 글줄이 끝나는 x. 가르는 호는 상자가 아니라 이 값에 맞춘다. */
export const INTRO_TEXT_END = 883;

/** 앙암바위 구간이 멈춰 있는 스크롤 길이. 그 아래 구간은 이만큼 내려간다. */
export const ANGAM_PIN_LENGTH = 300;

/** 멈춘 동안 앙암바위 덩이가 화면 가운데보다 내려와 있는 거리. 위의 큰 제목까지 머리띠 아래로 함께 보인다. */
export const ANGAM_PIN_DROP = 140;

/** 디자인 자리에서 각 구간을 옮기는 양(누적). 사건 파일 아래 구간 사이 틈을 모두 200 으로 맞춘 값이다. */
export const SECTION_OFFSET = {
  caseFile: 228,
  angam: -2359,
  regionSelect: 717,
  scenarioCards: 307,
  closing: -834,
  marquee: -938,
} as const;
