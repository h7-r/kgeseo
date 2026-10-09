export type WallCabinetKind = "panel" | "hydrant";

/**
 * 벽함 문 id. 열림·덜컹·자물쇠가 모두 이 한 이름으로 묶인다.
 * 함과 자물쇠 쪽이 각자 문자열을 조립하면 소수점 한 자리만 달라져도 자물쇠가 딴 문을 지키게 되므로 여기 하나로 둔다.
 */
export const getWallCabinetDoorId = (kind: WallCabinetKind, x: number, z: number) =>
  `wallCabinet:${kind}:${x.toFixed(1)},${z.toFixed(1)}`;
