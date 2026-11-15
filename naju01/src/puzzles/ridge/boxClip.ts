/**
 * 함에서 솟은 빛 속의 영상 — 「그날 밤」(public/naju-film/box-night.mp4, 25초). 그림판 영상(shadowPlay)을 이 영상으로 바꿨다(해랑 11/13).
 *   달 앞 벼랑을 초롱 들고 걷는 아랑사 → 벼랑 끝에 선다, 풀숲이 흔들린다 → 미끄러진다 → 벼랑 끝에서 셋이 내려다본다
 *   → 추락 · 눈가의 눈물 → 달아나는 셋 → 물보라 → 가라앉은 수면에 초롱만 떠 있다.
 * 자막 · 소리 큐 시각은 영상의 컷에 맞춘다(0.5초 간격 장면표로 잼). 「세 사람의 계략으로 미끄러져 떨어졌다」는 글이 짚는다(미르 11/11).
 * shadowPlay 의 그림은 굿판 그림패(gut/tagArt) · 엔딩 되짚기(ending)가 아직 쓴다 — 그쪽은 미르 영역이라 손대지 않았다.
 */
import type { FilmCaption } from "../filmCaption";
import { createFilmClip } from "../filmClip";

const URL = "/naju-film/box-night.mp4";
/** 영상 크기(px) — 위아래 검은 띠는 잘라 넣었다 */
const SOURCE = { width: 1024, height: 484 };
/** 판 크기(미터) — 가장자리가 풀리므로 그림판 때(3.2)보다 조금 넓게 */
const PLANE = { width: 3.8, height: (3.8 * SOURCE.height) / SOURCE.width };

/** 컷 시작 시각(초) */
const CUT = { walk: 0, edge: 4.0, rustle: 5.6, slip: 7.1, watch: 9.0, fall: 12.0, flee: 17.0, impact: 19.0, after: 22.0 };
export const BOX_CLIP_SECONDS = 25.0;
/** 빛이 약해지며 영상이 사라지는 시간(끝에서) */
export const BOX_CLIP_FADE = 2.4;

export const BOX_CLIP_CAPTIONS: readonly FilmCaption[] = [
  { from: 0.4, to: CUT.rustle, text: "그 밤, 아랑사는 초롱을 들고 바위에 올랐어요." },
  { from: CUT.rustle, to: CUT.slip, text: "풀숲에 누군가 숨어 있었어요." },
  { from: CUT.slip, to: CUT.fall, text: "그들이 꾸민 계략에, 아랑사는 발이 미끄러졌어요." },
  { from: CUT.fall, to: CUT.flee, text: "아랑사는 강으로 떨어졌어요." },
  { from: CUT.flee, to: CUT.impact, text: "그들은 달아났어요." },
  { from: CUT.after, to: BOX_CLIP_SECONDS - 0.8, text: "초롱이 꺼졌어요. 아랑사는 돌아오지 못했어요." },
];
export const BOX_CLIP_CUES: { at: number; sound: "우르릉" | "징" | "첨벙" | "전환"; shake?: number }[] = [
  { at: CUT.rustle, sound: "우르릉" },
  { at: CUT.slip, sound: "징", shake: 0.16 },
  { at: CUT.impact, sound: "첨벙", shake: 0.3 },
];

export const createBoxClip = () => createFilmClip(URL, PLANE);
