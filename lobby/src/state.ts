// 방 상태 — 방 안에서만 공유한다(설계 v0.19 5절 「상태」).
// 연결 ID(맵 키 = sessionId)·닉네임·검사한 외형·위치·방향·이동 상태만. 계정 ID·티켓 ID 는 넣지 않는다.
import { schema, t } from "@colyseus/schema";

export const Player = schema(
  {
    nickname: t.string(),
    /** 검사한 외형 JSON. 틀린 외형이면 "" — 받는 쪽이 그 성별 기본 착장으로 그린다 */
    look: t.string(),
    /** 첫 정상 위치를 받기 전에는 false — 받는 쪽은 그리지 않는다 */
    placed: t.boolean(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    ry: t.float32(),
    gait: t.string(),
  },
  "Player",
);
export type Player = InstanceType<typeof Player>;

export const LobbyState = schema(
  {
    players: t.map(Player),
  },
  "LobbyState",
);
export type LobbyState = InstanceType<typeof LobbyState>;
