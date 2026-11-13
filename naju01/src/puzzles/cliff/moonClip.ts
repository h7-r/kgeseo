/**
 * 세 사발의 달빛이 선바위에 모여 비추는 영상 — 「바위 위의 밤」(public/naju-film/rock-nights.mp4, 25초). 그림판 영상(moonPlay)을 이 영상으로 바꿨다(해랑 11/13).
 *   물 세 그릇에 달이 내려앉는다 → 달빛이 바위 위 발자국을 비춘다 → 아비사가 빌고, 벼랑 끝에서 구렁이가 올라온다
 *   → 구렁이가 아비사에게 머리를 숙인다 → 횃불 든 마을 젊은이들이 올라온다 → 아비사가 구렁이 앞을 막아선다 → 구렁이는 물러나고 아비사 혼자 남는다.
 * 자막 · 소리 큐 시각은 영상의 컷에 맞춘다(0.5초 간격 장면표로 잼). 마지막 컷에는 글을 두지 않는다 — 그 뒤의 일은 굿판의 그림패가 말한다.
 * 영상이 끝나면 BowlRite 가 사발을 깬다. moonPlay 의 그림은 굿판 그림패(gut/tagArt) · 엔딩 되짚기(ending)가 아직 쓴다.
 */
import type { FilmCaption } from "../filmCaption";
import { createFilmClip } from "../filmClip";

const URL = "/naju-film/rock-nights.mp4";
/** 영상 크기(px) — 위아래 검은 띠는 잘라 넣었다 */
const SOURCE = { width: 1280, height: 604 };
/** 판 크기(미터) — 선바위 앞에 뜬다. 가장자리가 풀리므로 그림판 때(3.0)보다 조금 넓게 */
const PLANE = { width: 3.6, height: (3.6 * SOURCE.height) / SOURCE.width };

/** 컷 시작 시각(초) */
const CUT = { bowls: 0, trail: 3.0, rise: 6.0, touch: 10.0, torch: 14.0, alone: 21.3 };
export const MOON_CLIP_SECONDS = 25.0;
/** 빛이 약해지며 영상이 사라지는 시간(끝에서) */
export const MOON_CLIP_FADE = 1.4;

export const MOON_CLIP_CAPTIONS: readonly FilmCaption[] = [
  { from: 0.5, to: CUT.rise, text: "아랑사가 떠난 뒤에도, 아비사는 밤마다 바위에 올랐어요." },
  { from: CUT.rise, to: CUT.touch, text: "어느 밤, 벼랑 끝 바위 틈에서 구렁이가 올라왔어요." },
  { from: CUT.touch, to: CUT.torch, text: "아비사는 구렁이를 두려워하지 않았어요." },
  { from: CUT.torch, to: CUT.alone, text: "그 모습을 마을 젊은이들이 보았어요." },
];
/** 소리 — 끝에 물이 흔들리는 소리와 함께 사발의 물이 일렁인다(BowlRite) */
export const MOON_CLIP_CUES: { at: number; sound: "우르릉" | "징" | "첨벙" | "전환"; shake?: number }[] = [
  { at: 0.1, sound: "징" },
  { at: CUT.rise + 0.5, sound: "우르릉" },
  { at: CUT.torch, sound: "전환" },
  { at: MOON_CLIP_SECONDS - MOON_CLIP_FADE, sound: "첨벙", shake: 0.14 },
];

export const createMoonClip = () => createFilmClip(URL, PLANE);
