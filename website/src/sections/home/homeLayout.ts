// 메인 페이지 배치 상수. 단위는 1920 무대 기준 px.

/** 소개 덩이와 가입 폼이 함께 맞추는 세로 중심선. */
export const INTRO_CENTER_Y = 1938;

/** 소개 덩이와 가입 폼의 가로 자리. 양쪽 여백 215 로 대칭(215 + 755 + 175 + 560 + 215 = 1920). */
export const INTRO_LEFT = 215;
export const INTRO_WIDTH = 755;
const INTRO_FORM_GAP = 175;
export const SIGNUP_FORM_LEFT = INTRO_LEFT + INTRO_WIDTH + INTRO_FORM_GAP;
export const SIGNUP_FORM_WIDTH = 560;

/** 소개 덩이에서 가장 긴 글줄이 끝나는 x. 가르는 호는 상자가 아니라 이 값에 맞춘다. */
export const INTRO_TEXT_END = 883;

/** 앙암바위 구간이 가운데에 멈춰 있는 스크롤 길이. 그 아래 구간은 이만큼 내려간다. */
export const ANGAM_PIN_LENGTH = 600;

/** 사건 파일 구간의 멈춤 길이. 카메라가 먼저 움직이고 글이 뒤따라 앙암바위보다 길다. */
export const CASE_FILE_PIN_LENGTH = 1000;

/** 디자인 자리에서 각 구간을 옮기는 양(누적). 구간 사이 눈에 보이는 틈을 모두 320 으로 맞춘 값이다. */
export const SECTION_OFFSET = {
  caseFile: 228,
  regionSelect: 225,
  scenarioCards: -19,
  angam: -30,
  closing: -26,
  marquee: 15,
} as const;
