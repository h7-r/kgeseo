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
  caseId: null,
  playSessionId: null,
  최근결과: null,
  저장상태: null,
  상태출처: null,
  오류: null,
};
let 시작중 = null;
let 시작중CaseId = null;
let 제출중 = null;
const 듣는이 = new Set();
const 게스트플레이저장키 = "kgeseo.guest-play.v1";

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

export const 현재플레이상태 = () => 상태.저장상태;
export const 플레이상태구독 = (듣기) => {
  듣는이.add(듣기);
  return () => 듣는이.delete(듣기);
};
export const 퍼즐완료됨 = (puzzleId) =>
  !!puzzleId && 상태.저장상태?.completed_puzzle_ids.includes(puzzleId) === true;
export const usePuzzleCompleted = (puzzleId) =>
  useSyncExternalStore(플레이상태구독, () => 퍼즐완료됨(puzzleId));
export const 플레이플래그 = (flagId) =>
  flagId ? 상태.저장상태?.flags[flagId] : undefined;
export const usePlayFlag = (flagId) =>
  useSyncExternalStore(플레이상태구독, () => 플레이플래그(flagId));
export const usePlayStateSource = () =>
  useSyncExternalStore(플레이상태구독, () => 상태.상태출처);

function 문자열인가(값) {
  return typeof 값 === "string" && 값.length > 0;
}

function 저장값읽기() {
  try {
    const 값 = JSON.parse(localStorage.getItem(게스트플레이저장키) || "null");
    if (
      !값 ||
      typeof 값 !== "object" ||
      Array.isArray(값) ||
      !문자열인가(값.caseId) ||
      !(값.anonymousSessionId === null || 문자열인가(값.anonymousSessionId)) ||
      !(값.playSessionId === null || 문자열인가(값.playSessionId))
    ) {
      if (값 !== null) localStorage.removeItem(게스트플레이저장키);
      return null;
    }
    return 값;
  } catch {
    try {
      localStorage.removeItem(게스트플레이저장키);
    } catch {
      /* localStorage를 사용할 수 없으면 메모리 상태로만 진행한다. */
    }
    return null;
  }
}

function 저장값쓰기(값) {
  try {
    localStorage.setItem(게스트플레이저장키, JSON.stringify(값));
  } catch {
    /* 저장 실패가 현재 플레이 시작까지 막지는 않는다. */
  }
}

function 플레이ID지우기(저장값, caseId) {
  const 다음 = {
    anonymousSessionId: 저장값?.anonymousSessionId ?? null,
    playSessionId: null,
    caseId,
  };
  저장값쓰기(다음);
  return 다음;
}

function 익명ID지우기(caseId) {
  const 다음 = {
    anonymousSessionId: null,
    playSessionId: null,
    caseId,
  };
  저장값쓰기(다음);
  return 다음;
}

function 번들확인(bundleResponse, caseId) {
  if (bundleResponse.data.case_id !== caseId) {
    throw new Error(`${caseId} bundle의 case_id가 일치하지 않습니다.`);
  }
  if (caseId !== 플레이계약.caseId) return;

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

async function 새플레이세션생성(caseId, 저장값) {
  let anonymousSessionId = 저장값?.anonymousSessionId ?? null;

  if (anonymousSessionId) {
    알리기({ 단계: "신규 생성", 오류: null });
    try {
      return {
        anonymousSessionId,
        play: await 플레이세션생성(anonymousSessionId, caseId),
      };
    } catch (오류) {
      if (오류.status !== 404 && 오류.status !== 410) throw 오류;
      익명ID지우기(caseId);
    }
  }

  알리기({ 단계: "신규 생성", 오류: null });
  const anonymous = await 익명세션생성();
  anonymousSessionId = anonymous.data.anonymous_session_id;
  저장값쓰기({ anonymousSessionId, playSessionId: null, caseId });

  return {
    anonymousSessionId,
    play: await 플레이세션생성(anonymousSessionId, caseId),
  };
}

export function 플레이세션시작(caseId = 플레이계약.caseId) {
  if (!문자열인가(caseId)) return Promise.reject(new Error("caseId가 필요합니다."));
  if (상태.playSessionId && 상태.caseId === caseId) {
    return Promise.resolve(상태.playSessionId);
  }
  if (시작중) {
    if (시작중CaseId === caseId) return 시작중;
    return 시작중.then(() => 플레이세션시작(caseId));
  }

  알리기({ 단계: "시작 중", caseId, 오류: null });
  let 실패단계 = "준비 실패";
  시작중CaseId = caseId;
  시작중 = (async () => {
    let 저장값 = 저장값읽기();
    if (저장값?.playSessionId && 저장값.caseId === caseId) {
      실패단계 = "복원 실패";
      알리기({ 단계: "복원 중", 오류: null });
      try {
        const play = await 플레이세션조회(저장값.playSessionId);
        if (play.data.case_id === caseId && play.data.completed_at === null) {
          const bundle = await 케이스번들조회(caseId);
          번들확인(bundle, caseId);
          알리기({
            단계: "복원됨",
            caseId,
            playSessionId: play.data.play_session_id,
            저장상태: play.data.state,
            상태출처: "복원",
            오류: null,
          });
          return play.data.play_session_id;
        }
        저장값 = 플레이ID지우기(저장값, caseId);
      } catch (오류) {
        if (오류.status !== 404) throw 오류;
        저장값 = 플레이ID지우기(저장값, caseId);
      }
    } else if (저장값?.playSessionId) {
      저장값 = 플레이ID지우기(저장값, caseId);
    }

    실패단계 = "준비 실패";
    const bundle = await 케이스번들조회(caseId);
    번들확인(bundle, caseId);
    const { anonymousSessionId, play } = await 새플레이세션생성(caseId, 저장값);
    저장값쓰기({
      anonymousSessionId,
      playSessionId: play.data.play_session_id,
      caseId,
    });
    알리기({
      단계: "준비됨",
      caseId,
      playSessionId: play.data.play_session_id,
      저장상태: play.data.state,
      상태출처: "신규",
      오류: null,
    });
    return play.data.play_session_id;
  })().catch((오류) => {
    알리기({ 단계: 실패단계, 오류: 오류.message });
    throw 오류;
  }).finally(() => {
    시작중 = null;
    시작중CaseId = null;
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
        상태출처: "상호작용",
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
