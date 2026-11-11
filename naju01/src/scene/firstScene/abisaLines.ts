/**
 * 첫 장면 대사 · 알림 — **초안**(이야기팀 승인 전, 미르가 화면 보고 정한다 · 11/8).
 * 기획 근거: 04 Scene 구성표 Scene 01 「돌아오지 않은 약속」 · 부록 E · 03 시나리오.
 *  - 아비사 = 의뢰인 NPC, 살아 있는 사람으로 보여야 한다(불안하지만 이상해 보이지 않게). 구렁이를 두려워하지 않는다(Scene 04 F-08).
 *  - 필수 발견: 택촌의 젊은 어부 아랑사 · 진부촌 처녀 아비사 · 밤마다 앙암바위에서 만남 · 약속한 날 오지 않음 · 그 뒤로 못 봄.
 *  - 인연 배경(병든 홀아버지 · 물고기를 못 구해 울던 아비사 · 아랑사가 건넨 물고기)은 불을 되살린 뒤 — 처음엔 골라 듣는 이야기였지만
 *    바위 아래로 넘어가기 전에 꼭 듣는다(미르 11/11).
 *  - 구렁이 = 첫 등장, 정체 설명 없음, 「조사관이 위험 요소로 판단해 떨어뜨림」. 아랑사로 확정하지 않는다.
 * 퍼즐의 답(구멍 번호 · 차례 · 횟수)은 말하지 않는다.
 */
import type { ClamStage } from "../../puzzles/fishTrap/clamState";
import type { FishTrapStage } from "../../puzzles/fishTrap/fishTrapState";

export const ABISA_NAME = "아비사";

/** 이 줄을 말하는 동안 바라볼 곳 — 없으면 플레이어 */
/** echo = 다시 나타나 물가에 머무는 구렁이 */
export type LookTarget = "hoe" | "hearth" | "rock" | "river" | "echo";

export interface AbisaLine {
  text: string;
  lookAt?: LookTarget;
  /** 고개를 떨군다 */
  isDown?: boolean;
}

/** 구렁이가 물러난 뒤 — 의뢰. 끊기면 다음에 그 줄부터 이어 말한다 */
export const REQUEST_LINES: AbisaLine[] = [
  { text: "…괜찮아요. 다치진 않았어요. 살펴 주셔서 고맙습니다." },
  { text: "저는 진부촌에 사는 아비사예요. 혹시… 사람을 찾아 주실 수 있나요?" },
  { text: "강 건너 택촌의 젊은 어부, 아랑사요. 우리는 밤마다 저 앙암바위에서 만났어요.", lookAt: "rock" },
  { text: "그런데 만나기로 한 그날, 그이가 오지 않았어요. 그 뒤로 한 번도 보지 못했어요.", isDown: true },
  {
    text: "화톳불도 꺼져 버렸어요. 그이가 돌아올 길을 밝혀 둬야 하는데… 불씨 물고기가 있으면 다시 지필 수 있어요.",
    lookAt: "hearth",
  },
  { text: "미끼로 쓸 조개는 저기 배 옆 호미로 캐요.", lookAt: "hoe" },
];

/**
 * 의뢰 중 사건 이야기 줄 수(아비사 · 아랑사 · 앙암바위 · 그날) — 뒤 두 줄은 일 지시(화톳불 · 조개)라 불을 되살린 뒤에 늦게 듣는다면
 * 건너뛴다(지난 지시를 지금 하라는 말이 된다, Codex 01)
 */
export const REQUEST_STORY_LINES = 4;

/**
 * 불을 되살린 뒤 — 인연의 시작. 처음엔 골라 듣는 이야기였지만, 안 듣고 넘어가면 이야기가 안 읽혀(미르 11/11 「설화를 다루는 게임이라
 * 스토리텔링이 중요하다」) 바위 아래로 넘어가기 전에 꼭 듣는다(leftBehind isAbisaStoryOwed)
 */
export const BACKSTORY_LINES: AbisaLine[] = [
  { text: "불이 살았네요… 고마워요.", lookAt: "hearth" },
  { text: "그이를 처음 만난 것도 이 물가였어요. 병드신 아버지께 드릴 물고기를 못 구해 울고 있었는데…", isDown: true },
  { text: "그이가 자기가 잡은 물고기를 건네줬어요. 그날부터였어요.", lookAt: "river" },
];

/** 구렁이가 다시 나타나 물가에 머무는 동안 말을 걸면 한 번 — 지금 느낌만(기억 · 정체를 말하지 않는다, F-08 · Codex 05) */
export const ECHO_LINE: AbisaLine = { text: "…이상하죠. 저 구렁이를 보면 무섭지가 않아요.", lookAt: "echo" };

/** 다시 말을 걸면 — 지금 단계에 맞는 한 줄 */
export function stageLine(clam: ClamStage, trap: FishTrapStage): AbisaLine {
  if (trap === "told") return { text: "연기가 흘러가는 쪽을 따라가 보세요. 그이의 흔적이 있을지도 몰라요." };
  if (trap === "lit") return { text: "불이 살았어요… 이제 그이도 길을 찾을 수 있겠죠.", lookAt: "hearth" };
  if (trap === "pulled") return { text: "올라온 통발의 불씨를 화톳불에 쏟아 주세요.", lookAt: "hearth" };
  if (trap === "full") return { text: "줄 하나가 떨려요! 그 줄 말뚝에서 당겨 보세요." };
  if (clam === "baiting" || clam === "baited")
    return { text: "물고기가 들 때까지 기다려 봐요. 줄이 떨리면 그 통발이에요." };
  if (clam === "held") return { text: "조개를 통발에 넣어 물에 굴려 넣어 보세요." };
  if (clam === "dug") return { text: "조개가 다 나왔어요. 한데 모아 주워 가세요." };
  if (clam === "hoe") return { text: "숨구멍마다 물이 솟는 게 달라요. 자루에 새긴 글을 떠올리며 파 보세요." };
  return REQUEST_LINES[REQUEST_LINES.length - 1];
}

/** 구렁이 — 처음 가까이 갔을 때(조사관의 판단) · 겨눔 안내 · 쫓아낼 때 */
export const SERPENT_NOTICE = "여인 곁에 커다란 구렁이가 똬리를 틀고 있다 — 가만두면 위험해 보인다.";
export const DRIVE_LABEL = "구렁이를 쫓아낸다";
export const DRIVE_NOTICE = "발을 구르며 다가서자 구렁이가 움찔 물러나더니, 물가로 미끄러져 강물 속으로 사라진다.";
/** 구렁이가 있는 동안 아비사에게 말을 걸면 */
export const WATCHING_NOTICE = "여인은 구렁이에게서 눈을 떼지 않는다. 먼저 구렁이를 떼어 놓아야겠다.";

/** 의뢰를 다 들으면 한 번 — 동행 입력 안내(동행이 켜져 있을 때만) */
/** 말 거는 키는 F 하나(계약 v0.4.16 §10-2) — 자유 입력([Enter])은 11/13 베타에서 껐다(§10-1, #70). 터치는 위 단추 줄 💬 */
export const COMPANION_TIP = "막히면 [F] 로 동행을 불러 물어볼 수 있어요";
export const COMPANION_TIP_TOUCH = "막히면 위의 💬 로 동행을 불러 물어볼 수 있어요";
