/**
 * 장면 인물 말 진행기 — 어부 셋 · 동행 자기소개가 쓴다(아비사는 제 진행을 그대로 두고 차례 · 멈춤 규칙만 같이 쓴다).
 *  - 시작할 때 대화 차례를 잡고(npcSpeech.claimTalk) 끝나거나 그칠 때 놓는다 — 한 번에 한 사람만 말한다(Codex 06회차).
 *  - 창(소지품 · 설정 · 힌트함 · 동행 입력) · 종이 · 게이지 · 카메라 연출 · 조작 풀림 동안은 멈추고 대사를 내린다.
 *    안 그러면 창을 보는 사이 한 번뿐인 대사가 흘러가 「들었음」으로 저장된다.
 *  - 줄마다 다 들으면 onLineDone(그 줄 번호) — 끊기면 다음에 그 줄부터 이어 말하게 저장한다.
 */
import * as THREE from "three";

import { isPointerActive } from "@/engine/input/virtualLock";

import { isGaugeActive } from "../../puzzles/fishTrap/pullGauge";
import { isWindowHeld } from "../../puzzles/pointerHold";
import { isPaperOpenNow } from "../../puzzles/ridge/oldPaper";
import { isCameraFocused } from "../cameraFocus";
import { stage } from "../immersion/state";
import { claimTalk, releaseTalk, setNpcSpeech } from "./npcSpeech";

export interface StoryLine {
  text: string;
  /** 이 줄을 말하는 동안 바라볼 곳(인물마다 뜻을 정한다) */
  lookAt?: string;
  /** 고개를 떨군다(돌린다) */
  isDown?: boolean;
}

/** 한 줄을 띄워 두는 시간(초) — 글이 길수록 길게 */
export const lineSeconds = (text: string) => THREE.MathUtils.clamp(1.6 + text.length * 0.075, 2.8, 5.5);

/** 말을 멈출 때 — 다른 일(창 · 종이 · 게이지 · 연출)에 묶여 있거나 조작이 풀려 있다 */
export const isTalkPaused = () =>
  !isPointerActive() || isWindowHeld() || isPaperOpenNow() || isGaugeActive() || isCameraFocused() || !!stage.cut;

export class StoryTalk {
  lines: StoryLine[] = [];
  /** -1 = 첫 줄 전 잠깐(인사 · 끄덕임 틈) */
  index = -1;
  /** 이 줄을 띄운 뒤 흐른 시간(멈춘 동안은 안 흐른다) */
  lineTime = 0;
  isActive = false;
  isPaused = false;
  /** 줄 하나를 다 들었다 — 끊긴 데부터 잇게 저장한다 */
  onLineDone: ((index: number) => void) | null = null;
  /** 끝까지 들었다 */
  onDone: (() => void) | null = null;

  constructor(
    readonly id: string,
    readonly speaker: string,
    private readonly canAdvance: boolean,
  ) {}

  /** 지금 줄(첫 줄 전 · 끝나면 null) */
  get line(): StoryLine | null {
    return this.isActive && this.index >= 0 ? (this.lines[this.index] ?? null) : null;
  }

  /** 말을 시작한다. 다른 사람이 말하는 중이면 false. lead = 첫 줄 전 틈(초) */
  start(lines: StoryLine[], lead = 0.2): boolean {
    if (!lines.length || !claimTalk(this.id)) return false;
    this.lines = lines;
    this.index = -1;
    this.lineTime = -lead;
    this.isActive = true;
    this.isPaused = false;
    return true;
  }

  /** 다음 줄로(겨누고 E · 시간이 다 됨) */
  next() {
    if (!this.isActive) return;
    if (this.index >= 0) this.onLineDone?.(this.index);
    this.index += 1;
    this.lineTime = 0;
    const line = this.lines[this.index];
    if (line) {
      if (!this.isPaused) this.show(line);
      return;
    }
    this.finish();
    this.onDone?.();
  }

  /** 그친다(멀어짐 · 편집) — 들은 줄까지만 남는다 */
  stop() {
    if (this.isActive) this.finish();
  }

  /** 매 프레임 */
  tick(dt: number) {
    if (!this.isActive) return;
    const shouldPause = isTalkPaused();
    if (shouldPause !== this.isPaused) {
      this.isPaused = shouldPause;
      const line = this.line;
      if (shouldPause) setNpcSpeech(null, this.id);
      else if (line) this.show(line);
    }
    if (shouldPause) return;
    this.lineTime += dt;
    const line = this.line;
    if (this.index < 0 ? this.lineTime >= 0 : this.lineTime >= lineSeconds(line?.text ?? "")) this.next();
  }

  private show(line: StoryLine) {
    setNpcSpeech({ speaker: this.speaker, text: line.text, canAdvance: this.canAdvance }, this.id);
  }

  private finish() {
    this.isActive = false;
    this.index = -1;
    releaseTalk(this.id);
  }
}
