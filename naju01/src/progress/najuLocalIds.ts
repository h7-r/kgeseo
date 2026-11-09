/**
 * 퍼즐 코드가 서버로 보낼 때 쓰는 나주 로컬 ID — 대응표(najuProgress.setIdTable)의 왼쪽 열이다.
 * 런타임 ID(ZONE_* · OBJ_*)는 najuIdTable(대응표 v1)에 있다. 대응표에 없으면 서버로 가지 않는다.
 *
 * 아래 값은 대응표 v1(11/8)의 왼쪽 열과 같다.
 *   - Z2: 도면(sitePlan) 구역 코드 그대로
 *   - cave-hall: 물굴 큰 방 — 도면에 없는 구역이다. 물굴 이동 감지 · navigate 는 해랑님 담당이라 코드 이름은 그쪽과 맞춘다
 *   - jar-slots: P03 대표 물건(장독대 자리 여섯을 한 물건으로) — registerInteractable 의 jar-slot-0~5 를 묶은 이름
 *   - cave-big-clam: P07 대표 물건 — registerInteractable id 그대로
 *   - Z1 · clam-holes: P01 나루터(도면 구역 코드) · 대표 물건(숨구멍 일곱 clam-hole-0~6 을 한 물건으로)
 */
export const NAJU_LOCAL = {
  zones: {
    Z1: "Z1",
    Z2: "Z2",
    caveHall: "cave-hall",
  },
  objects: {
    P01: "clam-holes",
    P03: "jar-slots",
    P07: "cave-big-clam",
    // P09 대표 물건 — 돌바퀴(registerInteractable id 그대로, 대응표 1105 의 cave-door)
    P09: "cave-door",
    // P09 단서 비석 — inspect(읽었다) 기록. 제출 조건은 아니다
    caveTablet: "cave-tablet",
  },
} as const;
