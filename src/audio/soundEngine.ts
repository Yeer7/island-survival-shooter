import { clamp } from '../core/math';
import type { Surface } from '../world/terrain';

/**
 * Every sound in the game is synthesised with the Web Audio API: no downloads.
 * Short one-shots are noise bursts and oscillators through filters and envelopes;
 * the ambience is looping filtered noise with slow LFOs.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private echo!: DelayNode;
  private seaGain!: GainNode;
  private windGain!: GainNode;
  private fireGain!: GainNode;
  private crickets!: GainNode;
  private nextCrackle = 0;
  private fireLevel = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    // Slap-back echo for gunshots and the tree crash (open beach / forest).
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 1800;
    this.echo.connect(echoFilter).connect(fb).connect(this.echo);
    echoFilter.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbience();
  }

  private src(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Sea: low noise swelling with each wave.
    const sea = this.src();
    const seaLp = ctx.createBiquadFilter();
    seaLp.type = 'lowpass';
    seaLp.frequency.value = 520;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.35;
    lfo.connect(lfoGain).connect(swell.gain);
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0;
    sea.connect(seaLp).connect(swell).connect(this.seaGain).connect(this.master);
    sea.start();
    lfo.start();

    // Wind: band-passed noise with a wandering centre frequency.
    const wind = this.src();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.07;
    const wlg = ctx.createGain();
    wlg.gain.value = 180;
    wl.connect(wlg).connect(bp.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(bp).connect(this.windGain).connect(this.master);
    wind.start(0, 0.7);
    wl.start();

    // Fire bed: a soft roar, crackles are scheduled on top.
    const fire = this.src();
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 300;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    fire.connect(fl).connect(this.fireGain).connect(this.master);
    fire.start(0, 1.3);

    // Night crickets: an amplitude-modulated high tone.
    const osc = ctx.createOscillator();
    osc.frequency.value = 4300;
    const am = ctx.createGain();
    am.gain.value = 0;
    const chirp = ctx.createOscillator();
    chirp.type = 'square';
    chirp.frequency.value = 14;
    const chirpGain = ctx.createGain();
    chirpGain.gain.value = 0.5;
    chirp.connect(chirpGain).connect(am.gain);
    const slow = ctx.createOscillator();
    slow.frequency.value = 0.6;
    const slowGain = ctx.createGain();
    slowGain.gain.value = 0.5;
    slow.connect(slowGain).connect(am.gain);
    this.crickets = ctx.createGain();
    this.crickets.gain.value = 0;
    osc.connect(am).connect(this.crickets).connect(this.master);
    osc.start();
    chirp.start();
    slow.start();
  }

  /** Per-frame ambience mix. */
  updateAmbience(seaProximity: number, fireProximity: number, night: number, altitude: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.seaGain.gain.setTargetAtTime(0.03 + seaProximity * 0.3, t, 0.4);
    this.windGain.gain.setTargetAtTime(0.04 + clamp(altitude / 40, 0, 1) * 0.12, t, 0.6);
    this.fireLevel = fireProximity;
    this.fireGain.gain.setTargetAtTime(fireProximity * 0.18, t, 0.3);
    this.crickets.gain.setTargetAtTime(night * 0.006 * (1 - seaProximity * 0.5), t, 1.5);
    if (fireProximity > 0.05 && t > this.nextCrackle) {
      this.crackle(fireProximity);
      this.nextCrackle = t + 0.05 + Math.random() * 0.25;
    }
  }

  private burst(opts: {
    type?: BiquadFilterType;
    freq: number;
    q?: number;
    gain: number;
    attack?: number;
    decay: number;
    endFreq?: number;
    toEcho?: number;
    when?: number;
    offset?: number;
  }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.when ?? 0);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.endFreq) f.frequency.exponentialRampToValueAtTime(opts.endFreq, t + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + opts.decay);
    s.connect(f).connect(g).connect(this.sfx);
    if (opts.toEcho) {
      const e = ctx.createGain();
      e.gain.value = opts.toEcho;
      g.connect(e).connect(this.echo);
    }
    s.start(t, opts.offset ?? Math.random() * 1.5);
    s.stop(t + a + opts.decay + 0.05);
  }

  private tone(opts: { type?: OscillatorType; f0: number; f1?: number; gain: number; decay: number; attack?: number; when?: number; toEcho?: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.when ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.decay);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + opts.decay);
    o.connect(g).connect(this.sfx);
    if (opts.toEcho) {
      const e = ctx.createGain();
      e.gain.value = opts.toEcho;
      g.connect(e).connect(this.echo);
    }
    o.start(t);
    o.stop(t + a + opts.decay + 0.05);
  }

  whoosh(): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: 500, endFreq: 1600, q: 1.2, gain: 0.12, attack: 0.08, decay: 0.12 });
  }

  chopWood(): void {
    if (!this.ctx) return;
    const p = 0.9 + Math.random() * 0.2;
    this.burst({ type: 'bandpass', freq: 1100 * p, q: 1.4, gain: 0.7, decay: 0.07, toEcho: 0.15 });
    this.tone({ f0: 190 * p, f1: 80, gain: 0.55, decay: 0.12 });
    this.burst({ type: 'lowpass', freq: 600, gain: 0.25, decay: 0.18, when: 0.01 });
  }

  hitSoft(): void {
    if (!this.ctx) return;
    this.burst({ type: 'lowpass', freq: 700, gain: 0.35, decay: 0.12 });
    this.tone({ f0: 120, f1: 60, gain: 0.3, decay: 0.1 });
  }

  breakCase(): void {
    if (!this.ctx) return;
    this.burst({ type: 'highpass', freq: 1800, gain: 0.45, decay: 0.15, toEcho: 0.1 });
    this.burst({ type: 'bandpass', freq: 700, q: 2, gain: 0.5, decay: 0.2, when: 0.03 });
    this.tone({ type: 'triangle', f0: 900, f1: 400, gain: 0.12, decay: 0.08, when: 0.05 });
    this.tone({ type: 'triangle', f0: 1300, f1: 700, gain: 0.08, decay: 0.06, when: 0.11 });
  }

  treeCreak(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.linearRampToValueAtTime(55, t + 1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 420;
    lp.Q.value = 6;
    const trem = ctx.createOscillator();
    trem.frequency.value = 9;
    const tg = ctx.createGain();
    tg.gain.value = 0.08;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.5);
    trem.connect(tg).connect(g.gain);
    o.connect(lp).connect(g).connect(this.sfx);
    o.start(t);
    trem.start(t);
    o.stop(t + 1.6);
    trem.stop(t + 1.6);
    this.burst({ type: 'highpass', freq: 2500, gain: 0.2, decay: 0.3, when: 0.05 });
  }

  treeCrash(distance: number): void {
    if (!this.ctx) return;
    const v = clamp(1 - distance / 60, 0.15, 1);
    this.burst({ type: 'lowpass', freq: 900, endFreq: 120, gain: 0.9 * v, decay: 1.1, toEcho: 0.35 });
    this.tone({ f0: 70, f1: 32, gain: 0.8 * v, decay: 0.6 });
    for (let i = 0; i < 6; i++) this.burst({ type: 'highpass', freq: 2200 + Math.random() * 2000, gain: 0.12 * v, decay: 0.12, when: 0.04 + Math.random() * 0.5 });
  }

  gunshot(): void {
    if (!this.ctx) return;
    this.burst({ type: 'highpass', freq: 900, gain: 1.0, decay: 0.09, toEcho: 0.45 });
    this.burst({ type: 'lowpass', freq: 2400, endFreq: 300, gain: 0.8, decay: 0.35, toEcho: 0.3 });
    this.tone({ f0: 170, f1: 38, gain: 0.95, decay: 0.16 });
    this.tone({ type: 'square', f0: 2400, f1: 1200, gain: 0.05, decay: 0.03 });
  }

  dryFire(): void {
    if (!this.ctx) return;
    this.tone({ type: 'square', f0: 2200, f1: 1800, gain: 0.06, decay: 0.025 });
    this.burst({ type: 'highpass', freq: 4000, gain: 0.12, decay: 0.03 });
  }

  reload(): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: 2600, q: 3, gain: 0.25, decay: 0.05, when: 0.15 });
    this.tone({ type: 'square', f0: 900, f1: 600, gain: 0.05, decay: 0.04, when: 0.18 });
    this.burst({ type: 'bandpass', freq: 1800, q: 3, gain: 0.3, decay: 0.05, when: 0.85 });
    this.burst({ type: 'bandpass', freq: 3200, q: 4, gain: 0.35, decay: 0.04, when: 1.05 });
    this.tone({ type: 'square', f0: 1500, f1: 900, gain: 0.06, decay: 0.03, when: 1.06 });
  }

  impact(surface: Surface | 'wood' | 'metal'): void {
    if (!this.ctx) return;
    if (surface === 'metal') {
      this.tone({ type: 'triangle', f0: 2400 + Math.random() * 800, f1: 1400, gain: 0.12, decay: 0.15 });
      this.burst({ type: 'highpass', freq: 3000, gain: 0.2, decay: 0.05 });
    } else if (surface === 'water') {
      this.burst({ type: 'bandpass', freq: 900, endFreq: 300, q: 1, gain: 0.25, decay: 0.25 });
    } else if (surface === 'wood') {
      this.burst({ type: 'bandpass', freq: 1300, q: 2, gain: 0.3, decay: 0.06 });
    } else {
      this.burst({ type: 'lowpass', freq: 1500, gain: 0.25, decay: 0.12 });
    }
  }

  pickup(): void {
    if (!this.ctx) return;
    this.tone({ type: 'triangle', f0: 660, gain: 0.12, decay: 0.08 });
    this.tone({ type: 'triangle', f0: 990, gain: 0.1, decay: 0.12, when: 0.07 });
  }

  denied(): void {
    if (!this.ctx) return;
    this.tone({ type: 'triangle', f0: 300, f1: 220, gain: 0.1, decay: 0.12 });
  }

  eat(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) this.burst({ type: 'bandpass', freq: 1600 + Math.random() * 900, q: 1.5, gain: 0.25, decay: 0.06, when: i * 0.16 });
  }

  bandage(): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: 2500, endFreq: 5000, q: 1, gain: 0.25, attack: 0.05, decay: 0.35 });
    this.burst({ type: 'bandpass', freq: 3000, endFreq: 6000, q: 1, gain: 0.2, attack: 0.04, decay: 0.25, when: 0.45 });
  }

  dropLog(): void {
    if (!this.ctx) return;
    this.tone({ f0: 140, f1: 70, gain: 0.4, decay: 0.12 });
    this.burst({ type: 'lowpass', freq: 900, gain: 0.3, decay: 0.12 });
  }

  hurt(): void {
    if (!this.ctx) return;
    this.tone({ f0: 110, f1: 55, gain: 0.5, decay: 0.2 });
    this.burst({ type: 'lowpass', freq: 500, gain: 0.3, decay: 0.2 });
  }

  footstep(surface: Surface, sprint: boolean): void {
    if (!this.ctx) return;
    const v = sprint ? 1.25 : 1;
    switch (surface) {
      case 'sand':
        this.burst({ type: 'lowpass', freq: 900 + Math.random() * 300, gain: 0.16 * v, attack: 0.01, decay: 0.1 });
        break;
      case 'grass':
        this.burst({ type: 'bandpass', freq: 2600 + Math.random() * 800, q: 0.8, gain: 0.1 * v, attack: 0.01, decay: 0.08 });
        this.burst({ type: 'lowpass', freq: 400, gain: 0.08 * v, decay: 0.06 });
        break;
      case 'rock':
        this.burst({ type: 'bandpass', freq: 1500, q: 1.5, gain: 0.16 * v, decay: 0.05 });
        this.tone({ f0: 220, f1: 140, gain: 0.05 * v, decay: 0.04 });
        break;
      case 'wood':
        this.tone({ f0: 180 + Math.random() * 30, f1: 110, gain: 0.25 * v, decay: 0.09 });
        this.burst({ type: 'bandpass', freq: 900, q: 2, gain: 0.12 * v, decay: 0.05 });
        break;
      case 'water':
        this.burst({ type: 'bandpass', freq: 700 + Math.random() * 300, endFreq: 300, q: 1, gain: 0.2 * v, attack: 0.03, decay: 0.22 });
        break;
    }
  }

  private crackle(level: number): void {
    this.burst({ type: 'highpass', freq: 2500 + Math.random() * 3000, gain: (0.05 + Math.random() * 0.1) * level, decay: 0.02 + Math.random() * 0.03 });
    void this.fireLevel;
  }
}
