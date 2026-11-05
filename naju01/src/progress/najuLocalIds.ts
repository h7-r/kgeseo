/**
 * 퍼즐 코드가 서버로 보낼 때 쓰는 나주 로컬 ID — 대응표(najuProgress.setIdTable)의 왼쪽 열이다.
 * 런타임 ID(ZONE_* · OBJ_* · P번호)는 팀 확정 전이라 여기 두지 않는다. 대응표에 없으면 서버로 가지 않는다.
 *
 * 아래 값은 시범 연결(P03 · P07)용 **제안**이다.
 *   - Z2: 도면(sitePlan) 구역 코드 그대로
 *   - cave-hall: 물굴 큰 방 — 도면에 없는 구역이다. 물굴 이동 감지 · navigate 는 해랑님 담당이라 코드 이름은 그쪽과 맞춘다
 *   - jar-slots: P03 대표 물건(장독대 자리 여섯을 한 물건으로) — registerInteractable 의 jar-slot-0~5 를 묶은 이름
 *   - cave-big-clam: P07 대표 물건 — registerInteractable id 그대로
 */
export const NAJU_LOCAL = {
  zones: {
    Z2: "Z2",
    caveHall: "cave-hall",
  },
  objects: {
    P03: "jar-slots",
    P07: "cave-big-clam",
  },
} as const;
