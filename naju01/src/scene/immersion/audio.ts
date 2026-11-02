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
export type SoundName = "단서" | "징" | "전환" | "진입" | "첨벙" | "똑" | "우르릉" | (string & {});

class ImmersionAudio {
  ctx: AudioContext | null = null;
  targets = { 바람: 0, 물: 0, 비: 0, 새: 0, 벌레: 0, 개구리: 0 };
  nextFrog = 0;
  nextBird = 0;
  nextInsect = 0;
  gates: PannerNode[] = [];
  gateSpots: GateSpot[] | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private reverbAmount!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private wind!: Layer;
  private water!: Layer;
  private ripple!: Layer;
  private rain!: Layer;

  /** 화면을 한 번 누르면 켜진다(브라우저 자동재생 정책) */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = settings.볼륨;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.reverb = c.createConvolver();
    this.reverb.buffer = makeReverbBuffer(c, 2.6);
    this.reverbAmount = c.createGain();
    this.reverbAmount.gain.value = 0.25;
    this.reverb.connect(this.reverbAmount).connect(this.master);
    this.white = makeNoiseBuffer(c, 4, false);
    this.brown = makeNoiseBuffer(c, 6, true);
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
      tail.connect(g).connect(this.master);
      s.start();
      return { g, fs };
    };
    this.wind = layer(this.brown, [["bandpass", 420, 0.5]]);
    this.water = layer(this.brown, [["lowpass", 520]]);
    this.ripple = layer(this.white, [["bandpass", 1500, 2]]);
    this.rain = layer(this.white, [["highpass", 700], ["lowpass", 4200]]); // 10/13 — 덜 시끄럽게(고음을 깎음)
    if (this.gateSpots) this.buildGates(this.gateSpots);
    this.mix();
  }
  mix() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.targets;
    this.water.g.gain.setTargetAtTime(0.22 * m.물, t, 0.8);
    this.ripple.g.gain.setTargetAtTime(0.05 * m.물, t, 0.8);
    this.rain.g.gain.setTargetAtTime(0.15 * m.비, t, 0.6);
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
      g.connect(p).connect(this.master);
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
    this.wind.g.gain.setTargetAtTime(0.2 * this.targets.바람 * (0.45 + 0.8 * gust), t, 0.25);
    this.wind.fs[0].frequency.setTargetAtTime(280 + 420 * gust, t, 0.25);
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
  private noiseBurst(start: number, length: number, level: number, filters: BurstFilterSpec[], out: AudioNode, brown = false) {
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
      const out = this.makeOutput(0.25, Math.random() * 1.6 - 0.8);
      const f = 900 + Math.random() * 900;
      this.tone(f, "sine", t, 0.05, 0.002, 0.09, out, f * 0.55);
    } else if (name === "우르릉") {
      const out = this.makeOutput(0.5);
      this.noiseBurst(t, 3.2, 0.7, [["lowpass", 160], ["lowpass", 160]], out, true);
      this.noiseBurst(t + 0.5, 2.4, 0.45, [["lowpass", 110]], out, true);
    }
  }
  setReverb(amount: number) {
    if (this.ctx) this.reverbAmount.gain.setTargetAtTime(amount, this.ctx.currentTime, 1.0);
  }
  applyVolume() {
    if (this.ctx) this.master.gain.setTargetAtTime(settings.볼륨, this.ctx.currentTime, 0.05);
  }
}

export const audio = new ImmersionAudio();
