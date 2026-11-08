/**
 * 아비사 대사 — **초안**(이야기팀 승인 전, 미르가 화면 보고 정한다 · 11/8).
 * 기획 ④의 선: 구렁이는 정체 불명(아랑사로 확정하지 않는다), 화톳불은 「아비사가 그 사람을 기다린 흔적」.
 * 첫 인사는 첫 행동(호미)까지만 좁혀 알려 준다. 다시 말을 걸면 지금 단계의 한 줄 — 조개 → 통발 → 줄 → 화톳불 → 연기.
 * 퍼즐의 답(구멍 번호 · 차례 · 횟수)은 말하지 않는다.
 */
import type { ClamStage } from "../../puzzles/fishTrap/clamState";
import type { FishTrapStage } from "../../puzzles/fishTrap/fishTrapState";

export const ABISA_NAME = "아비사";

export interface AbisaLine {
  text: string;
  /** 이 줄을 말하는 동안 바라볼 곳 — 없으면 플레이어 */
  lookAt?: "hoe";
}

/** 처음 다가갔을 때 — 인사(살짝 숙임) 뒤 차례로 */
export const GREETING_LINES: AbisaLine[] = [
  { text: "…손님이 오셨네요. 이 나루터엔 이제 아무도 오지 않는데." },
  { text: "화톳불이 꺼져 버렸어요. 그 사람이 돌아올 길을 밝혀 둬야 하는데…" },
  { text: "통발에 불씨 물고기가 들면 다시 지필 수 있어요. 미끼로 쓸 조개부터 있어야 해요." },
  { text: "조개는 저기 배 옆 호미로 캐요. 자루에 새긴 글도 봐 주세요.", lookAt: "hoe" },
];

/** 다시 말을 걸면 — 지금 단계에 맞는 한 줄 */
export function stageLine(clam: ClamStage, trap: FishTrapStage): AbisaLine {
  if (trap === "told") return { text: "연기가 흘러가는 쪽을 따라가 보세요. 길을 알려 줄 거예요." };
  if (trap === "lit") return { text: "불이 살았어요… 고마워요." };
  if (trap === "pulled") return { text: "올라온 통발의 불씨를 화톳불에 쏟아 주세요." };
  if (trap === "full") return { text: "줄 하나가 떨려요! 그 줄 말뚝에서 당겨 보세요." };
  if (clam === "baiting" || clam === "baited")
    return { text: "물고기가 들 때까지 기다려 봐요. 줄이 떨리면 그 통발이에요." };
  if (clam === "held") return { text: "조개를 통발에 넣어 물에 굴려 넣어 보세요." };
  if (clam === "dug") return { text: "조개가 다 나왔어요. 한데 모아 주워 가세요." };
  if (clam === "hoe") return { text: "숨구멍마다 물이 솟는 게 달라요. 자루에 새긴 글을 떠올리며 파 보세요." };
  return GREETING_LINES[GREETING_LINES.length - 1];
}

/** 첫 인사가 끝나면 한 번 — 동행 입력 안내(동행이 켜져 있을 때만) */
export const COMPANION_TIP = "막히면 동행에게 물어볼 수 있어요 — [Enter] 동행에게 입력";
