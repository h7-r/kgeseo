import * as THREE from "three";

// 「왜곡」 이야기. 강가의 평범한 지금 건물들이 왜곡에 휩쓸려 옛 나루의 모습과 뒤섞이고(siteCatalog.ts),
// 세계가 게임(본부실과 같은 툰) 모습으로 굳은 뒤, 앙암 앞에 닿으면 흔들림이 멎는다.
// 모두 여정 진행도(0~1, journey.ts) 하나로 정한다 — 스크롤을 거슬러 올라가면 그대로 되감긴다.

/** 흔들림이 가라앉기 시작하고 멎는 진행도(앙암 핀 구간, journey 의 앙암 정거장과 같다). */
const CALM_FROM = 0.72;
const CALM_TO = 0.84;
/** 게임 모습이 섞이는 최대치. */
const GAME_MAX = 0.22;

export interface StoryState {
  /** 화면과 건물이 흔들리고 어긋나는 정도. */
  distort: number;
  /** 세계가 게임(툰) 모습으로 굳은 정도. */
  game: number;
}

const { smoothstep } = THREE.MathUtils;

export function storyAt(t: number, out: StoryState): StoryState {
  // 사건 파일에서 크게 일렁이고, 앙암 앞에서 가라앉는다.
  const rising = smoothstep(t, 0.06, 0.2);
  out.distort = rising * (1 - smoothstep(t, CALM_FROM, CALM_TO));
  // 옛 모습이 다 섞인 뒤(사건 파일 끝)부터 게임 기운이 살짝 돈다. 다 굳히면 납작해져 달빛의 깊이가 사라진다.
  out.game = smoothstep(t, 0.26, 0.5) * GAME_MAX;
  return out;
}
