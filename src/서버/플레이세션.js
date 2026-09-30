import { useSyncExternalStore } from "react";

import {
  상호작용제출,
  익명세션생성,
  케이스번들조회,
  플레이세션생성,
  플레이세션조회,
} from "./api.js";

export const 플레이계약 = Object.freeze({
  caseId: "case_001",
  zoneId: "ZONE_SECRET_CORRIDOR",
  objectId: "OBJ_FIRE_CABINET_LOCK",
  puzzleId: "PUZZLE_FIRE_CABINET_LOCK",
  unlockedFlag: "fire_cabinet_unlocked",
});

let 상태 = {
  단계: "대기",
  playSessionId: null,
  최근결과: null,
  저장상태: null,
  오류: null,
};
let 시작중 = null;
let 제출중 = null;
const 듣는이 = new Set();

const 알리기 = (부분) => {
  상태 = { ...상태, ...부분 };
  for (const 듣기 of 듣는이) 듣기();
};

export const usePlaySession = () =>
  useSyncExternalStore(
    (듣기) => {
      듣는이.add(듣기);
      return () => 듣는이.delete(듣기);
    },
    () => 상태,
  );

function 번들확인(bundleResponse) {
  const zone = bundleResponse.data.zones.find(
    (item) => item.zone_id === 플레이계약.zoneId,
  );
  const object = zone?.objects.find(
    (item) => item.object_id === 플레이계약.objectId,
  );
  if (bundleResponse.data.entry_zone_id !== 플레이계약.zoneId || object?.interaction?.type !== "input") {
    throw new Error("case_001 bundle에 소화전 자물쇠 계약이 없습니다.");
  }
}

export function 플레이세션시작() {
  if (상태.playSessionId) return Promise.resolve(상태.playSessionId);
  if (시작중) return 시작중;

  알리기({ 단계: "세션 준비 중", 오류: null });
  시작중 = (async () => {
    const anonymous = await 익명세션생성();
    const bundle = await 케이스번들조회(플레이계약.caseId);
    번들확인(bundle);
    const play = await 플레이세션생성(
      anonymous.data.anonymous_session_id,
      플레이계약.caseId,
    );
    알리기({
      단계: "준비됨",
      playSessionId: play.data.play_session_id,
      저장상태: play.data.state,
      오류: null,
    });
    return play.data.play_session_id;
  })().catch((오류) => {
    알리기({ 단계: "준비 실패", 오류: 오류.message });
    시작중 = null;
    throw 오류;
  });

  return 시작중;
}

export function 소화전자물쇠제출(answer) {
  if (제출중) return 제출중;

  제출중 = (async () => {
    const playSessionId = await 플레이세션시작();
    알리기({ 단계: "판정 중", 오류: null });
    const result = await 상호작용제출(playSessionId, {
      client_event_id: crypto.randomUUID(),
      client_timestamp: new Date().toISOString(),
      zone_id: 플레이계약.zoneId,
      action: "input",
      target_type: "object",
      target_id: 플레이계약.objectId,
      payload: { answer },
    });

    if (result.result_type === "correct" || result.result_type === "already_completed") {
      const persisted = await 플레이세션조회(playSessionId);
      알리기({
        단계: "정답",
        최근결과: result,
        저장상태: persisted.data.state,
        오류: null,
      });
      return true;
    }

    알리기({ 단계: "오답", 최근결과: result, 오류: null });
    return false;
  })()
    .catch((오류) => {
      알리기({ 단계: "요청 실패", 오류: 오류.message });
      throw 오류;
    })
    .finally(() => {
      제출중 = null;
    });

  return 제출중;
}
