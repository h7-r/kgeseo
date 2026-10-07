/** 증거물 종류. 손에 든 물건 종류 id(numberTag·box·collectionBox)와 맞춘다. */
export type EvidenceKind = "envelope" | "numberTag" | "box" | "collectionBox";

/** 증거물 한 개. name·item·description·clue 는 화면에 보이는 글이다. */
export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  /** 번호표만 */
  number?: number;
  name: string;
  caseNo: string;
  item: string;
  description: string;
  clue: string;
}

/** 방에 놓인 증거물 — 방을 코드가 아니라 데이터로 정의하는 첫 단계(SceneInventory 씨앗). */
export const EVIDENCE_ITEMS: EvidenceItem[] = [
  {
    id: "E-01",
    kind: "envelope",
    name: "증거물 봉투 #01",
    caseNo: "2026-나주-014",
    item: "향토지 사본 3면",
    description: "1998년 나주군 향토지에서 뜯겨 나온 낱장. 완사천 항목이 있어야 할 자리다.",
    clue: "페이지 번호가 건너뛴다 — 187 다음이 190.",
  },
  {
    id: "E-02",
    kind: "numberTag",
    number: 2,
    name: "증거 번호 표지 2",
    caseNo: "2026-나주-014",
    item: "현장 표지",
    description: "완사천 우물 옆 바닥에 세워 둔 노란 삼각 표지. 촬영용 번호다.",
    clue: "표지가 가리키던 자리에는 지금 아무것도 남아 있지 않다.",
  },
  {
    id: "E-03",
    kind: "box",
    name: "증거물 상자",
    caseNo: "2026-나주-014",
    item: "압수 기록 일괄",
    description: "현장에서 걷어 온 기록을 담은 상자. 봉인 테이프가 한 번 뜯겼다가 다시 붙었다.",
    clue: "봉인 날짜와 재봉인 날짜가 다르다.",
  },
  {
    id: "E-04",
    kind: "numberTag",
    number: 1,
    name: "증거 번호 표지 1",
    caseNo: "2026-나주-014",
    item: "현장 표지",
    description: "안내판 바로 앞에 세운 표지. 1번은 늘 '문제의 물건'에 붙는다.",
    clue: "안내판 문구가 2019년 판과 한 글자 다르다 — 그 한 글자가 전부다.",
  },
  {
    id: "E-05",
    kind: "numberTag",
    number: 3,
    name: "증거 번호 표지 3",
    caseNo: "2026-나주-014",
    item: "현장 표지",
    description: "우물에서 동문다리 쪽으로 스무 걸음 떨어진 자리에 세운 표지.",
    clue: "3번 자리는 현장 사진에만 있고 조서에는 빠져 있다.",
  },
  {
    id: "E-06",
    kind: "collectionBox",
    name: "현장 수거품 상자",
    caseNo: "2026-나주-014",
    item: "현장 수거품 일괄",
    description: "완사천 주변에서 걷어 온 잡물. 아직 분류 전이라 반출 대기 딱지가 붙어 있다.",
    clue: "봉인 날짜가 증거물 상자보다 하루 늦다.",
  },
];
