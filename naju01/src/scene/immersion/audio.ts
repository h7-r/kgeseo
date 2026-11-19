/**
 * audio.ts — ② 소리: 전부 Web Audio 로 합성한다 (옛 몰입연출.jsx 「소리」 객체 이식)
 *   받은 음원 0 — 라이선스 걱정 없음. 바람·물·비·새·벌레·개구리 바탕음 + 왜곡의 문 위치음 + 큐 효과음.
 *
 * [옛 이름 → 새 이름]
 *   소리 → audio · 시작 → start · 섞기 → mix · 문만들기 → buildGates · 귀 → updateListener
 *   틱 → tick · 출구 → makeOutput · 음 → tone · 잡음한번 → noiseBurst · 새 → bird · 개구리 → frog
 *   벌레 → insect · 재생 → play · 울림맞춤 → setReverb · 크기맞춤 → applyVolume
 *   잡음버퍼 → makeNoiseBuffer · 울림버퍼 → makeReverbBuffer · 목표 → targets · 문들 → gates · 문자리 → gateSpots
 */
import * as THREE from "three";

import { isGameFrozen, trackAudioContext } from "@/engine/input/gamePause";

import { UNITS_PER_METER } from "../../plan/sitePlan";
import type { GateSpot } from "./focusFog";
import { noise, settings } from "./state";

const U = UNITS_PER_METER;

function makeNoiseBuffer(c: AudioContext, seconds: number, brown: boolean) {
  const n = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        prev = (prev + 0.02 * w) / 1.02;
        d[i] = prev * 3.5;
      } else d[i] = w;
    }
  }
  return b;
}
function makeReverbBuffer(c: AudioContext, seconds: number) {
  const n = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  }
  return b;
}

interface Layer {
  g: GainNode;
  fs: BiquadFilterNode[];
}
type FilterSpec = [BiquadFilterType, number, number?];
type BurstFilterSpec = [BiquadFilterType, number, number?, number?];
export type SoundName =
  | "단서"
  | "징"
  | "전환"
  | "진입"
  | "첨벙"
  | "똑"
  | "우르릉"
  | "물뿌림"
  | "사기"
  | "깨짐"
  | "불붙음"
  | "불길"
  | (string & {});

class ImmersionAudio {
  ctx: AudioContext | null = null;
  targets = { 바람: 0, 물: 0, 비: 0, 새: 0, 벌레: 0, 개구리: 0 };
  nextFrog = 0;
  nextBird = 0;
  nextInsect = 0;
  gates: PannerNode[] = [];
  gateSpots: GateSpot[] | null = null;
  private master!: GainNode;
  /** 게임 설정의 「효과음」 배율. O 판의 소리 크기에 곱한다 */
  private sfxScale = 1;
  private reverb!: ConvolverNode;
  private reverbAmount!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private wind!: Layer;
  private water!: Layer;
  private ripple!: Layer;
  private rain!: Layer;
  /** 폭풍 — 낮게 웅웅대는 빗소리 덩어리. 기우제 뒤에만 켠다 */
  private storm!: Layer;
  /** 폭풍 세기(0~1) — 빗소리 · 바람을 키우고 천둥을 저절로 울린다 */
  private stormLevel = 0;
  private nextThunder = 0;
  /** 바탕음(바람·물·비·문)이 모이는 곳 — 퍼즐이 귀를 기울일 때 줄인다 */
  private ambientBus!: GainNode;
  private ambientLevel = 1;

  /** 화면을 한 번 누르면 켜진다(브라우저 자동재생 정책) */
  start() {
    if (this.ctx) {
      // 터치 모드에서 얼어 있으면(멈춤 · 창) 깨우지 않는다 — 풀릴 때 등록부가 다시 켠다
      if (this.ctx.state === "suspended" && !isGameFrozen()) void this.ctx.resume();
      return;
    }
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    trackAudioContext(c);
    this.master = c.createGain();
    this.master.gain.value = settings.볼륨 * this.sfxScale;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.reverb = c.createConvolver();
    this.reverb.buffer = makeReverbBuffer(c, 2.6);
    this.reverbAmount = c.createGain();
    this.reverbAmount.gain.value = 0.25;
    this.reverb.connect(this.reverbAmount).connect(this.master);
    this.white = makeNoiseBuffer(c, 4, false);
    this.brown = makeNoiseBuffer(c, 6, true);
    this.ambientBus = c.createGain();
    this.ambientBus.gain.value = this.ambientLevel;
    this.ambientBus.connect(this.master);
    const layer = (buffer: AudioBuffer, filters: FilterSpec[]): Layer => {
      const s = c.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      let tail: AudioNode = s;
      const fs = filters.map(([type, f, q]) => {
        const b = c.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        if (q) b.Q.value = q;
        tail.connect(b);
        tail = b;
        return b;
      });
      const g = c.createGain();
      g.gain.value = 0;
      tail.connect(g).connect(this.ambientBus);
      s.start();
      return { g, fs };
    };
    this.wind = layer(this.brown, [["bandpass", 420, 0.5]]);
    this.water = layer(this.brown, [["lowpass", 520]]);
    this.ripple = layer(this.white, [["bandpass", 1500, 2]]);
    this.rain = layer(this.white, [
      ["highpass", 700],
      ["lowpass", 4200],
    ]); // 10/13 — 덜 시끄럽게(고음을 깎음)
    this.storm = layer(this.brown, [["lowpass", 420]]);
    if (this.gateSpots) this.buildGates(this.gateSpots);
    this.mix();
  }
  mix() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.targets;
    this.water.g.gain.setTargetAtTime(0.22 * m.물, t, 0.8);
    this.ripple.g.gain.setTargetAtTime(0.05 * m.물, t, 0.8);
    this.rain.g.gain.setTargetAtTime(0.15 * m.비 * (1 + 2.2 * this.stormLevel), t, 0.6);
    this.storm.g.gain.setTargetAtTime(0.32 * this.stormLevel, t, 0.8);
  }
  /** 왜곡의 문 위치음 — 낮은 두 음이 천천히 울렁인다(HRTF) */
  buildGates(spots: GateSpot[] | null) {
    this.gateSpots = spots;
    if (!this.ctx || this.gates.length || !spots) return;
    const c = this.ctx;
    for (const d of spots) {
      const p = c.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = 2 * U;
      p.maxDistance = 30 * U;
      p.rolloffFactor = 1.6;
      const x = d.x * U;
      const y = (d.y + 1.5) * U;
      const z = d.z * U;
      if (p.positionX) {
        p.positionX.value = x;
        p.positionY.value = y;
        p.positionZ.value = z;
      } else p.setPosition(x, y, z);
      const g = c.createGain();
      g.gain.value = 0.1;
      for (const [f, dt] of [
        [98, 0],
        [147.5, 3],
      ]) {
        const o = c.createOscillator();
        o.frequency.value = f;
        o.detune.value = dt;
        o.connect(g);
        o.start();
      }
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 0.21;
      lg.gain.value = 0.05;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      g.connect(p).connect(this.ambientBus);
      this.gates.push(p);
    }
  }
  updateListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = cam.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t);
      L.positionY.setValueAtTime(p.y, t);
      L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t);
      L.forwardY.setValueAtTime(f.y, t);
      L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(u.x, t);
      L.upY.setValueAtTime(u.y, t);
      L.upZ.setValueAtTime(u.z, t);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }
  tick(time: number) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    // 돌풍 — 바람 크기와 필터를 같이 흔든다(셰이더 흔들림과 같은 잡음)
    const gust = 0.5 + 0.5 * noise(time * 0.35, 7);
    this.wind.g.gain.setTargetAtTime(
      0.2 * this.targets.바람 * (0.45 + 0.8 * gust) * (1 + 1.6 * this.stormLevel),
      t,
      0.25,
    );
    // 폭풍 동안 천둥이 저절로 친다
    if (this.stormLevel > 0.3 && t > this.nextThunder) {
      if (this.nextThunder > 0) this.play("우르릉");
      this.nextThunder = t + 5 + Math.random() * 6;
    }
    this.wind.fs[0].frequency.setTargetAtTime(280 + 420 * gust, t, 0.25);
    if (this.ambientLevel < 0.5) return; // 귀를 기울이는 동안 새·벌레·개구리도 쉰다
    if (this.targets.새 > 0.01 && t > this.nextBird) {
      this.bird();
      this.nextBird = t + 0.6 + (Math.random() * 3.5) / this.targets.새;
    }
    if (this.targets.벌레 > 0.01 && t > this.nextInsect) {
      this.insect();
      this.nextInsect = t + 0.35 + Math.random() * 0.7;
    }
    if (this.targets.개구리 > 0.01 && t > this.nextFrog) {
      this.frog();
      this.nextFrog = t + 0.8 + (Math.random() * 3.5) / this.targets.개구리;
    }
  }
  // ── 한 번 소리 ──
  private makeOutput(reverb = 0.3, pan = 0) {
    const c = this.ctx!;
    const g = c.createGain();
    const sp = c.createStereoPanner();
    sp.pan.value = pan;
    g.connect(sp);
    sp.connect(this.master);
    if (reverb > 0) {
      const s = c.createGain();
      s.gain.value = reverb;
      sp.connect(s).connect(this.reverb);
    }
    return g;
  }
  private tone(
    f: number,
    shape: OscillatorType,
    start: number,
    level: number,
    rise: number,
    length: number,
    out: AudioNode,
    endF?: number,
  ) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = shape;
    o.frequency.setValueAtTime(f, start);
    if (endF) o.frequency.exponentialRampToValueAtTime(endF, start + length);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(level, start + rise);
    g.gain.exponentialRampToValueAtTime(0.0001, start + rise + length);
    o.connect(g).connect(out);
    o.start(start);
    o.stop(start + rise + length + 0.05);
  }
  private noiseBurst(
    start: number,
    length: number,
    level: number,
    filters: BurstFilterSpec[],
    out: AudioNode,
    brown = false,
  ) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    const g = c.createGain();
    s.buffer = brown ? this.brown : this.white;
    let tail: AudioNode = s;
    for (const [type, f0, f1, q] of filters) {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.setValueAtTime(f0, start);
      if (f1) b.frequency.exponentialRampToValueAtTime(f1, start + length);
      if (q) b.Q.value = q;
      tail.connect(b);
      tail = b;
    }
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(level, start + length * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    tail.connect(g).connect(out);
    s.start(start, Math.random() * 2);
    s.stop(start + length + 0.05);
  }
  private bird() {
    const t = this.ctx!.currentTime + 0.02;
    const out = this.makeOutput(0.15, Math.random() * 1.6 - 0.8);
    const n = 2 + Math.floor(Math.random() * 3);
    const f = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) this.tone(f, "sine", t + i * 0.11, 0.05 * this.targets.새, 0.01, 0.07, out, f * 1.45);
  }
  // 개구리 — 「개굴」 두 마디. 낮은 톱니파를 빠르게 끊어(진동 30~45 Hz) 목 울림 대역(0.9~1.3 kHz)만 통과시킨다.
  //   마리마다 음높이 · 자리(좌우) · 마디 수가 다르다.
  private frog() {
    const c = this.ctx!;
    const t0 = c.currentTime + 0.02;
    const out = this.makeOutput(0.2, Math.random() * 1.6 - 0.8);
    const base = 140 + Math.random() * 160;
    const tremolo = 30 + Math.random() * 15;
    const level = 0.09 * this.targets.개구리;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 400;
    bp.Q.value = 3;
    bp.connect(out);
    const syllables = 2 + (Math.random() < 0.3 ? 1 : 0);
    for (let k = 0; k < syllables; k++) {
      const s0 = t0 + k * (0.18 + Math.random() * 0.05);
      const length = 0.11 + Math.random() * 0.05;
      const o = c.createOscillator();
      const g = c.createGain();
      const am = c.createOscillator();
      const amg = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(base * (k ? 0.92 : 1), s0);
      o.frequency.linearRampToValueAtTime(base * 1.12, s0 + length);
      am.type = "square";
      am.frequency.value = tremolo;
      amg.gain.value = 0.5;
      g.gain.setValueAtTime(0.0001, s0);
      g.gain.exponentialRampToValueAtTime(level, s0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + length);
      const gate = c.createGain();
      gate.gain.value = 0.5;
      am.connect(amg).connect(gate.gain);
      o.connect(gate).connect(g).connect(bp);
      o.start(s0);
      am.start(s0);
      o.stop(s0 + length + 0.05);
      am.stop(s0 + length + 0.05);
    }
  }
  private insect() {
    const t = this.ctx!.currentTime + 0.02;
    const out = this.makeOutput(0.05, Math.random() * 1.4 - 0.7);
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 3; i++) this.tone(f, "sine", t + i * 0.045, 0.02 * this.targets.벌레, 0.004, 0.03, out);
  }
  /** 큐 효과음 — 이름은 큐 시트의 「소리」 값 그대로(한글, 데이터) */
  play(name: SoundName) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime + 0.02;
    if (name === "단서") {
      const out = this.makeOutput(0.45);
      this.tone(1046.5, "triangle", t, 0.12, 0.005, 1.4, out);
      this.tone(1568, "sine", t + 0.07, 0.07, 0.005, 1.6, out);
      this.tone(2093, "sine", t + 0.14, 0.04, 0.005, 1.2, out);
    } else if (name === "징") {
      const out = this.makeOutput(0.6);
      for (const [r, k, d] of [
        [1, 0.22, 5],
        [1.47, 0.12, 4],
        [2.09, 0.08, 3.5],
        [2.56, 0.05, 3],
        [3.11, 0.03, 2.5],
      ])
        this.tone(92 * r, "sine", t, k, 0.01, d, out, 92 * r * 0.985);
      this.noiseBurst(t, 0.25, 0.08, [["lowpass", 900]], out);
    } else if (name === "전환") {
      const out = this.makeOutput(0.35);
      this.noiseBurst(t, 1.3, 0.25, [["bandpass", 300, 2400, 1.2]], out);
      this.tone(180, "sine", t, 0.12, 0.05, 1.2, out, 60);
    } else if (name === "진입") {
      const out = this.makeOutput(0.4);
      this.tone(110, "sawtooth", t, 0.025, 1.0, 2.2, out);
      this.tone(164.8, "sawtooth", t + 0.1, 0.018, 1.0, 2.2, out);
      this.tone(220, "triangle", t + 0.2, 0.03, 0.8, 2.4, out);
    } else if (name === "첨벙") {
      const out = this.makeOutput(0.15, Math.random() * 0.4 - 0.2);
      this.noiseBurst(t, 0.22, 0.32, [["bandpass", 1800, 700, 0.9]], out);
      this.tone(320, "sine", t, 0.08, 0.005, 0.12, out, 140);
    } else if (name === "똑") {
      if (this.ambientLevel < 0.5) return; // 빗방울 잡음이 퍼즐의 빗방울 음과 섞이지 않게
      const out = this.makeOutput(0.25, Math.random() * 1.6 - 0.8);
      const f = 900 + Math.random() * 900;
      this.tone(f, "sine", t, 0.05, 0.002, 0.09, out, f * 0.55);
    } else if (name === "쉬익") {
      // 구렁이 — 낮게 쉬익. 높은 잡음을 좁게 걸러 숨 내쉬듯 두 번(첫 장면, 정체 불명이라 크지 않게)
      const out = this.makeOutput(0.2, Math.random() * 0.3 - 0.15);
      this.noiseBurst(
        t,
        0.75,
        0.05,
        [
          ["highpass", 2600],
          ["bandpass", 5200, 3600, 0.8],
        ],
        out,
      );
      this.noiseBurst(
        t + 0.55,
        0.9,
        0.035,
        [
          ["highpass", 2400],
          ["bandpass", 4800, 3200, 0.8],
        ],
        out,
      );
    } else if (name === "짹짹") {
      // 작은 새 — 위로 미끄러지는 짧은 소리 두세 번, 좌우 아무 데서나
      const out = this.makeOutput(0.22, Math.random() * 1.6 - 0.8);
      const base = 2600 + Math.random() * 1400;
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const s0 = t + i * (0.09 + Math.random() * 0.05);
        this.tone(base, "sine", s0, 0.05, 0.004, 0.07, out, base * (1.25 + Math.random() * 0.3));
      }
    } else if (name === "물뿌림") {
      // 그릇의 물을 땅에 끼얹는 소리 — 쏴 하고 날아가 흙에 철썩 떨어지고, 잔물이 후드득 뒤따른다
      const out = this.makeOutput(0.3, Math.random() * 0.3 - 0.15);
      this.noiseBurst(t, 0.55, 0.55, [["bandpass", 3200, 1400, 0.7]], out);
      this.noiseBurst(t + 0.28, 0.4, 0.75, [["bandpass", 900, 420, 0.9]], out);
      this.tone(210, "sine", t + 0.3, 0.12, 0.01, 0.16, out, 95);
      for (let i = 0; i < 8; i++) {
        const drop = t + 0.45 + i * 0.07 + Math.random() * 0.04;
        this.noiseBurst(drop, 0.05, 0.24, [["bandpass", 1500 + Math.random() * 1500, 0, 2]], out);
      }
    } else if (name === "사기") {
      // 사기그릇을 돌 위에 내려놓는 소리 — 굽이 돌에 닿는 「달그락」과 낮은 「툭」. 그릇이 살짝 한 번 더 논다
      const out = this.makeOutput(0.22, Math.random() * 0.4 - 0.2);
      const ring = 1750 + Math.random() * 350;
      for (const [delay, level] of [
        [0, 0.2],
        [0.085, 0.08],
      ]) {
        this.tone(ring, "sine", t + delay, level, 0.002, 0.11, out, ring * 0.97);
        this.tone(ring * 1.63, "sine", t + delay, level * 0.55, 0.002, 0.07, out);
        this.noiseBurst(t + delay, 0.05, level * 1.8, [["bandpass", 2600, 0, 1.4]], out);
      }
      this.noiseBurst(t, 0.09, 0.4, [["lowpass", 380]], out);
    } else if (name === "깨짐") {
      // 사기그릇이 깨지는 소리 — 「쨍」 하고 갈라져 조각이 돌 위에 흩어진다
      const out = this.makeOutput(0.3, Math.random() * 0.4 - 0.2);
      this.noiseBurst(t, 0.16, 0.8, [["highpass", 2600]], out);
      for (const ring of [2300, 3150, 4400]) this.tone(ring, "sine", t, 0.14, 0.002, 0.22, out, ring * 0.94);
      for (let i = 0; i < 6; i++) {
        const shard = t + 0.12 + i * 0.07 + Math.random() * 0.05;
        const ring = 1900 + Math.random() * 2400;
        this.tone(ring, "sine", shard, 0.07, 0.002, 0.06, out);
        this.noiseBurst(shard, 0.03, 0.18, [["bandpass", 3000, 0, 1.5]], out);
      }
    } else if (name === "불붙음") {
      // 관솔불이 횃불에 옮겨붙는 소리 — 「화륵」 하고 숨을 들이켜듯 솟고, 송진이 탁탁 튄다
      const out = this.makeOutput(0.28, Math.random() * 0.3 - 0.15);
      this.noiseBurst(t, 0.75, 0.9, [["bandpass", 320, 2200, 0.8]], out);
      this.noiseBurst(t + 0.05, 1.1, 0.55, [["lowpass", 420]], out, true);
      this.tone(95, "sine", t, 0.2, 0.03, 0.4, out, 55);
      for (let i = 0; i < 7; i++) {
        const snap = t + 0.12 + Math.random() * 0.9;
        this.noiseBurst(snap, 0.025, 0.3, [["highpass", 2400 + Math.random() * 2000]], out);
      }
    } else if (name === "불길") {
      // 불기둥이 치솟는 소리 — 낮게 으르렁대며 커졌다 오래 타고, 그동안 나무가 터지듯 튄다
      const out = this.makeOutput(0.45);
      const seconds = 6.5;
      this.noiseBurst(t, seconds, 1.5, [["lowpass", 260, 520]], out, true);
      this.noiseBurst(t, seconds, 0.85, [["bandpass", 500, 1400, 0.6]], out);
      this.noiseBurst(t + 0.2, seconds * 0.8, 0.4, [["bandpass", 1800, 3200, 0.7]], out);
      this.tone(62, "sine", t, 0.3, 0.6, seconds * 0.7, out, 44);
      for (let i = 0; i < 26; i++) {
        const snap = t + 0.3 + Math.random() * (seconds - 1);
        this.noiseBurst(snap, 0.03, 0.4, [["highpass", 1800 + Math.random() * 2600]], out);
      }
    } else if (name === "물발소리") {
      // 발목까지 찬 물을 헤치는 소리 — 쏴 하고 밀리는 물 + 낮게 출렁
      const out = this.makeOutput(0.18, Math.random() * 0.3 - 0.15);
      this.noiseBurst(t, 0.32, 0.22, [["bandpass", 700, 1600, 0.8]], out);
      this.tone(170 + Math.random() * 40, "sine", t + 0.03, 0.05, 0.02, 0.22, out, 110);
    } else if (name === "우르릉") {
      const out = this.makeOutput(0.5);
      this.noiseBurst(
        t,
        3.2,
        0.7,
        [
          ["lowpass", 160],
          ["lowpass", 160],
        ],
        out,
        true,
      );
      this.noiseBurst(t + 0.5, 2.4, 0.45, [["lowpass", 110]], out, true);
    }
  }
  /** 폭풍 세기(0~1) — 0 이면 평소 비 */
  setStorm(level: number) {
    this.stormLevel = level;
    if (level <= 0.3) this.nextThunder = 0;
    this.mix();
  }
  /** 바탕음 크기(0~1). 1.2초쯤에 걸쳐 바뀐다 */
  setAmbientLevel(level: number) {
    this.ambientLevel = level;
    if (this.ctx) this.ambientBus.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }
  /**
   * 옹기 항아리를 친 소리 — 또렷한 기본음과 옥타브에 「퉁」 하는 짧은 잡음.
   * 위치(유닛)를 주면 그 자리에서 난다. 빗방울(soft)은 작고 끝에 물 튀는 소리가 붙는다.
   */
  jar(frequency: number, at: THREE.Vector3, soft = false) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const panner = c.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2 * U;
    panner.rolloffFactor = 1.2;
    if (panner.positionX) {
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
    } else panner.setPosition(at.x, at.y, at.z);
    const out = c.createGain();
    out.connect(panner).connect(this.master);
    const send = c.createGain();
    send.gain.value = 0.18; // 울림이 길면 다음 음과 섞여 음높이가 흐려진다
    panner.connect(send).connect(this.reverb);
    const level = soft ? 0.45 : 0.6;
    // 음높이가 또렷하게 — 세모파 기본음 + 정확한 옥타브. 어긋난 배음·내려앉는 음은 뺀다(반음 차이가 안 들린다)
    this.tone(frequency, "triangle", t, level, 0.004, 1.9, out);
    this.tone(frequency * 2, "sine", t, level * 0.22, 0.004, 1.1, out);
    this.noiseBurst(t, 0.04, level * 0.2, [["bandpass", frequency * 1.5, frequency, 1.2]], out);
    if (soft) this.tone(2400, "sine", t, 0.04, 0.002, 0.06, out, 1300);
  }
  setReverb(amount: number) {
    if (this.ctx) this.reverbAmount.gain.setTargetAtTime(amount, this.ctx.currentTime, 1.0);
  }
  applyVolume() {
    if (this.ctx) this.master.gain.setTargetAtTime(settings.볼륨 * this.sfxScale, this.ctx.currentTime, 0.05);
  }
  setSfxScale(scale: number) {
    this.sfxScale = scale;
    this.applyVolume();
  }
}

export const audio = new ImmersionAudio();
