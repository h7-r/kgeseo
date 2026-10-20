import * as THREE from "three";

// 「왜곡」 이야기. 강가의 평범한 지금 건물들이 왜곡에 휩쓸려 옛 나루의 모습과 뒤섞이고(siteCatalog.ts),
// 세계가 게임(본부실과 같은 툰) 모습으로 굳은 뒤, 앙암 앞에서 봉인 조각이 맞물려 흔들림이 멎는다.
// 모두 여정 진행도(0~1, journey.ts) 하나로 정한다 — 스크롤을 거슬러 올라가면 그대로 되감긴다.

/** 봉인 조각 수. 앙암 핀 구간에서 하나씩 맞물린다. */
export const SEAL_PIECES = 6;

/** 봉인이 맞물리기 시작하고 끝나는 진행도(앙암 핀 구간, journey 의 앙암 정거장과 같다). */
const SEAL_FROM = 0.72;
const SEAL_TO = 0.84;

export interface StoryState {
  /** 화면과 건물이 흔들리고 어긋나는 정도. */
  distort: number;
  /** 세계가 게임(툰) 모습으로 굳은 정도. */
  game: number;
  /** 봉인 조각이 모인 정도(0~SEAL_PIECES). 정수 자리마다 한 조각이 딸깍 맞물린다. */
  seal: number;
  /** 조각들이 화면에 나와 있는 정도. */
  fragments: number;
}

const { smoothstep } = THREE.MathUtils;

/** 조각 하나가 맞물리는 동안 0→1. 진행도에 끌려가되 끝에서 짧게 붙어 「딸깍」 느낌을 낸다. */
function lockProgress(t: number, index: number): number {
  const span = (SEAL_TO - SEAL_FROM) / SEAL_PIECES;
  const start = SEAL_FROM + span * index;
  return smoothstep(t, start + span * 0.15, start + span * 0.85);
}

export function storyAt(t: number, out: StoryState): StoryState {
  let seal = 0;
  for (let i = 0; i < SEAL_PIECES; i += 1) seal += lockProgress(t, i);
  // 사건 파일에서 크게 일렁이고, 봉인이 맞물린 만큼 가라앉는다.
  const rising = smoothstep(t, 0.06, 0.2);
  out.distort = rising * (1 - seal / SEAL_PIECES);
  // 옛 모습이 다 섞인 뒤(사건 파일 끝)부터 게임 모습으로 굳는다.
  out.game = smoothstep(t, 0.26, 0.5);
  out.seal = seal;
  out.fragments = smoothstep(t, 0.66, 0.72);
  return out;
}
