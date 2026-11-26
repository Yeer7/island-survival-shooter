import { clamp } from '../core/math';
import type { Surface } from '../world/terrain';

/**
 * Sound for the game. Impacts, chops, swings, creaks, crashes and footsteps play real
 * recorded CC0 samples (Kenney Impact Sounds / RPG Audio, mastered by
 * scripts/master_audio.py into public/assets/audio); they decode in the background after
 * the first press, and until a family has decoded (or if it fails) the old synthesised
 * version plays instead. Everything else is synthesised: noise bursts and oscillators
 * through filters and envelopes, and the ambience is looping filtered noise with slow LFOs.
 */

/** Sample families and their take counts (files are `<family>_<n>.ogg`). */
const BANK: Record<string, number> = {
  chop: 4,
  whoosh: 3,
  creak: 2,
  crash: 2,
  hit: 4,
  thud: 3,
  break: 3,
  knock: 3,
  step_grass: 4,
  step_wood: 4,
  step_stone: 4,
  step_sand: 4,
};

interface PlayOpts {
  gain: number;
  /** Base playback rate before the ±7% variation. */
  rate?: number;
  when?: number;
  toEcho?: number;
  /** Low-pass cutoff (Hz) for distance. */
  lowpass?: number;
}
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
  /** Decoded takes per family; a family is absent until all its takes decoded. */
  private bank = new Map<string, AudioBuffer[]>();
  /** Last take played per family, so the same take never plays twice in a row. */
  private lastTake = new Map<string, number>();
  /** Sample loading report (for checks): decoded families, failures, samples played. */
  readonly sampleStats = { families: 0, failed: 0, played: 0, fallbacks: 0 };

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
    // A fast, hard limiter after the glue compressor so no impact ever clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    // Soft clip for the transient the limiter's 1 ms attack lets through: unity for
    // normal levels, approaching a -1 dBFS ceiling (0.891) and never above it.
    const clip = ctx.createWaveShaper();
    const N = 2049;
    const curve = new Float32Array(N);
    const ceil = 0.891;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = ceil * Math.tanh(x / ceil);
    }
    clip.curve = curve;
    this.master.connect(comp).connect(limiter).connect(clip).connect(ctx.destination);
    this.limiter = limiter;
    this.outTap = clip;
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
    this.loadSamples();
  }

  private limiter!: DynamicsCompressorNode;
  /** Last node before the speakers (for output checks). */
  private outTap!: AudioNode;

  /** Fetch and decode the sample bank in the background; each family switches on when ready. */
  private loadSamples(): void {
    const ctx = this.ctx!;
    for (const [family, n] of Object.entries(BANK)) {
      const takes = Array.from({ length: n }, (_, i) =>
        fetch(`assets/audio/${family}_${i}.ogg`)
          .then((r) => {
            if (!r.ok) throw new Error(`${r.status}`);
            return r.arrayBuffer();
          })
          .then((b) => ctx.decodeAudioData(b)),
      );
      Promise.all(takes)
        .then((bufs) => {
          this.bank.set(family, bufs);
          this.sampleStats.families++;
        })
        .catch(() => {
          // Unsupported codec or a missing file: the synthesised sound stays.
          this.sampleStats.failed++;
        });
    }
  }

  /**
   * Play one take of a family: never the same take twice in a row, ±7% rate and
   * ±1.5 dB per play. Returns false when the family is not decoded (caller synthesises).
   */
  private play(family: string, o: PlayOpts): boolean {
    const ctx = this.ctx;
    const takes = this.bank.get(family);
    if (!ctx || !takes || !takes.length) {
      this.sampleStats.fallbacks++;
      return false;
    }
    const last = this.lastTake.get(family) ?? -1;
    let i = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (takes.length - 1))) % takes.length;
    this.lastTake.set(family, i);
    const t = ctx.currentTime + (o.when ?? 0);
    const s = ctx.createBufferSource();
    s.buffer = takes[i];
    s.playbackRate.value = (o.rate ?? 1) * (0.93 + Math.random() * 0.14);
    const g = ctx.createGain();
    g.gain.value = o.gain * Math.pow(10, ((Math.random() * 2 - 1) * 1.5) / 20);
    let head: AudioNode = s;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      head.connect(f);
      head = f;
    }
    head.connect(g).connect(this.sfx);
    if (o.toEcho) {
      const e = ctx.createGain();
      e.gain.value = o.toEcho;
      g.connect(e).connect(this.echo);
    }
    s.start(t);
    this.sampleStats.played++;
    return true;
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
    if (this.play('whoosh', { gain: 0.7 })) return;
    this.burst({ type: 'bandpass', freq: 500, endFreq: 1600, q: 1.2, gain: 0.12, attack: 0.08, decay: 0.12 });
  }

  chopWood(): void {
    if (!this.ctx) return;
    // The player's own blow leads the mix: the loudest regular cue, a little forest slap-back.
    if (this.play('chop', { gain: 1.0, toEcho: 0.12 })) return;
    const p = 0.9 + Math.random() * 0.2;
    this.burst({ type: 'bandpass', freq: 1100 * p, q: 1.4, gain: 0.7, decay: 0.07, toEcho: 0.15 });
    this.tone({ f0: 190 * p, f1: 80, gain: 0.55, decay: 0.12 });
    this.burst({ type: 'lowpass', freq: 600, gain: 0.25, decay: 0.18, when: 0.01 });
  }

  /** Axe on an effigy: a dry stick knock and the tied bones rattling. */
  effigyHit(): void {
    if (!this.ctx) return;
    if (this.play('knock', { gain: 0.85, rate: 0.9 })) {
      // The tied bones still rattle.
      for (let i = 0; i < 4; i++) this.burst({ type: 'bandpass', freq: 3000 + Math.random() * 1800, q: 9, gain: 0.1, decay: 0.025, when: 0.05 + Math.random() * 0.25 });
      return;
    }
    const p = 0.92 + Math.random() * 0.16;
    this.burst({ type: 'bandpass', freq: 2100 * p, q: 2.2, gain: 0.55, decay: 0.05 });
    this.tone({ f0: 430 * p, f1: 240, gain: 0.32, decay: 0.08 });
    this.burst({ type: 'lowpass', freq: 800, gain: 0.2, decay: 0.1, when: 0.01 });
    for (let i = 0; i < 5; i++) this.burst({ type: 'bandpass', freq: 3000 + Math.random() * 1800, q: 9, gain: 0.16, decay: 0.025, when: 0.04 + Math.random() * 0.3 });
  }

  /** An effigy giving way: sticks snapping, a hollow thud, bones clattering and cloth flapping. */
  effigyBreak(): void {
    if (!this.ctx) return;
    if (this.play('break', { gain: 0.78, toEcho: 0.1 })) {
      this.play('thud', { gain: 0.6, when: 0.55 });
      for (let i = 0; i < 6; i++) this.burst({ type: 'bandpass', freq: 2600 + Math.random() * 2200, q: 10, gain: 0.1, decay: 0.03, when: 0.5 + Math.random() * 0.5 });
      return;
    }
    this.burst({ type: 'highpass', freq: 1500, gain: 0.6, decay: 0.09, toEcho: 0.12 });
    this.burst({ type: 'bandpass', freq: 900, q: 1.6, gain: 0.55, decay: 0.16, when: 0.02 });
    this.tone({ f0: 230, f1: 70, gain: 0.45, decay: 0.22, when: 0.01 });
    this.burst({ type: 'highpass', freq: 2200, gain: 0.35, decay: 0.06, when: 0.13 });
    this.burst({ type: 'bandpass', freq: 900, endFreq: 260, q: 0.8, gain: 0.16, attack: 0.04, decay: 0.38, when: 0.05 });
    // The fall: a hollow thud when it hits the ground.
    this.tone({ f0: 140, f1: 55, gain: 0.5, decay: 0.2, when: 0.55 });
    this.burst({ type: 'lowpass', freq: 500, gain: 0.35, decay: 0.18, when: 0.55 });
    for (let i = 0; i < 9; i++) this.burst({ type: 'bandpass', freq: 2600 + Math.random() * 2200, q: 10, gain: 0.18, decay: 0.03, when: 0.5 + Math.random() * 0.55 });
  }

  hitSoft(): void {
    if (!this.ctx) return;
    if (this.play('hit', { gain: 0.72 })) return;
    this.burst({ type: 'lowpass', freq: 700, gain: 0.35, decay: 0.12 });
    this.tone({ f0: 120, f1: 60, gain: 0.3, decay: 0.1 });
  }

  breakCase(): void {
    if (!this.ctx) return;
    if (this.play('break', { gain: 0.78, toEcho: 0.08 })) return;
    this.burst({ type: 'highpass', freq: 1800, gain: 0.45, decay: 0.15, toEcho: 0.1 });
    this.burst({ type: 'bandpass', freq: 700, q: 2, gain: 0.5, decay: 0.2, when: 0.03 });
    this.tone({ type: 'triangle', f0: 900, f1: 400, gain: 0.12, decay: 0.08, when: 0.05 });
    this.tone({ type: 'triangle', f0: 1300, f1: 700, gain: 0.08, decay: 0.06, when: 0.11 });
  }

  treeCreak(): void {
    if (!this.ctx) return;
    if (this.play('creak', { gain: 0.9, rate: 0.95 })) return;
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
    // Far away: quieter, duller (air takes the highs) and wetter in the forest echo.
    if (this.play('crash', { gain: 0.95 * v, toEcho: 0.25 + 0.25 * (1 - v), lowpass: 18000 * Math.exp(-distance / 35) + 600 })) {
      // A low thump under the recording so it carries weight on small speakers.
      this.tone({ f0: 70, f1: 32, gain: 0.35 * v, decay: 0.5 });
      return;
    }
    this.burst({ type: 'lowpass', freq: 900, endFreq: 120, gain: 0.9 * v, decay: 1.1, toEcho: 0.35 });
    this.tone({ f0: 70, f1: 32, gain: 0.8 * v, decay: 0.6 });
    for (let i = 0; i < 6; i++) this.burst({ type: 'highpass', freq: 2200 + Math.random() * 2000, gain: 0.12 * v, decay: 0.12, when: 0.04 + Math.random() * 0.5 });
  }

  bowDraw(): void {
    if (!this.ctx) return;
    this.tone({ type: 'sawtooth', f0: 70, f1: 120, gain: 0.03, attack: 0.3, decay: 0.35 });
    this.burst({ type: 'bandpass', freq: 1400, endFreq: 2200, q: 4, gain: 0.05, attack: 0.25, decay: 0.3 });
  }

  bowRelease(power: number): void {
    if (!this.ctx) return;
    this.tone({ type: 'triangle', f0: 180, f1: 90, gain: 0.25 * (0.5 + power * 0.5), decay: 0.12 });
    this.burst({ type: 'bandpass', freq: 900, endFreq: 2600, q: 1, gain: 0.18 * power, attack: 0.01, decay: 0.2 });
  }

  arrowHit(surface: 'flesh' | 'wood' | 'ground' | 'water'): void {
    if (!this.ctx) return;
    if (surface === 'flesh' && this.play('hit', { gain: 0.5, rate: 1.1 })) return;
    if (surface === 'wood' && this.play('knock', { gain: 0.75 })) return;
    if (surface === 'ground' && this.play('thud', { gain: 0.35, rate: 1.3 })) return;
    if (surface === 'flesh') {
      this.tone({ f0: 160, f1: 70, gain: 0.35, decay: 0.08 });
      this.burst({ type: 'lowpass', freq: 800, gain: 0.25, decay: 0.08 });
    } else if (surface === 'wood') {
      this.burst({ type: 'bandpass', freq: 1500, q: 3, gain: 0.35, decay: 0.05 });
      this.tone({ type: 'triangle', f0: 320, f1: 260, gain: 0.08, decay: 0.15 });
    } else if (surface === 'water') {
      this.impact('water');
    } else {
      this.burst({ type: 'lowpass', freq: 1200, gain: 0.25, decay: 0.07 });
    }
  }

  cast(): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: 2500, endFreq: 900, q: 2, gain: 0.12, attack: 0.05, decay: 0.4 });
    for (let i = 0; i < 6; i++) this.tone({ type: 'square', f0: 2600, gain: 0.015, decay: 0.01, when: 0.05 + i * 0.05 });
  }

  splash(big = false): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: big ? 700 : 1200, endFreq: 300, q: 1, gain: big ? 0.4 : 0.22, attack: 0.01, decay: big ? 0.45 : 0.25 });
  }

  fishCaught(): void {
    if (!this.ctx) return;
    this.splash(true);
    for (let i = 0; i < 10; i++) this.tone({ type: 'square', f0: 2200, gain: 0.02, decay: 0.008, when: i * 0.035 });
    this.tone({ type: 'triangle', f0: 660, gain: 0.12, decay: 0.1, when: 0.4 });
    this.tone({ type: 'triangle', f0: 880, gain: 0.12, decay: 0.14, when: 0.5 });
  }

  build(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) {
      this.tone({ f0: 210, f1: 120, gain: 0.35, decay: 0.08, when: i * 0.18 });
      this.burst({ type: 'bandpass', freq: 1300, q: 2, gain: 0.25, decay: 0.05, when: i * 0.18 });
    }
  }

  craft(): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: 1800, q: 2, gain: 0.2, decay: 0.08 });
    this.tone({ type: 'triangle', f0: 520, gain: 0.1, decay: 0.08, when: 0.1 });
    this.tone({ type: 'triangle', f0: 780, gain: 0.1, decay: 0.15, when: 0.2 });
  }

  levelUp(): void {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, gain: 0.12, decay: 0.25, when: i * 0.1 }));
  }

  /** Coming round in the wreck: muffled wind swelling, fire crackle, a fading ringing in the ears. */
  wakeUp(): void {
    if (!this.ctx) return;
    this.burst({ type: 'lowpass', freq: 380, endFreq: 900, gain: 0.32, attack: 1.1, decay: 2.6 });
    this.tone({ type: 'sine', f0: 4100, f1: 3900, gain: 0.035, attack: 0.08, decay: 3.2 });
    this.tone({ type: 'sine', f0: 70, f1: 50, gain: 0.25, attack: 0.02, decay: 1.2 });
    for (let i = 0; i < 10; i++) this.burst({ type: 'bandpass', freq: 1800 + Math.random() * 2000, q: 6, gain: 0.07, decay: 0.03, when: 0.6 + Math.random() * 2.2 });
  }

  sleep(): void {
    if (!this.ctx) return;
    [392, 330, 262].forEach((f, i) => this.tone({ f0: f, gain: 0.1, attack: 0.1, decay: 0.6, when: i * 0.35 }));
  }

  animalHurt(big: boolean): void {
    if (!this.ctx) return;
    this.tone({ type: 'sawtooth', f0: big ? 420 : 1400, f1: big ? 240 : 900, gain: 0.08, attack: 0.01, decay: big ? 0.3 : 0.12 });
    this.burst({ type: 'lowpass', freq: 700, gain: 0.25, decay: 0.1 });
  }

  sizzle(): void {
    if (!this.ctx) return;
    this.burst({ type: 'highpass', freq: 3500, gain: 0.12, attack: 0.1, decay: 0.8 });
  }

  /** Low growl for the chief, a hollow bone rattle-roar for the guardian, a howl-snarl for the alpha. */
  roar(kind: 'boss' | 'guardian' | 'alpha'): void {
    if (!this.ctx) return;
    if (kind === 'alpha') {
      this.tone({ type: 'sawtooth', f0: 220, f1: 520, gain: 0.12, attack: 0.25, decay: 0.9 });
      this.tone({ type: 'sawtooth', f0: 110, f1: 70, gain: 0.18, attack: 0.05, decay: 0.8, when: 0.7 });
      this.burst({ type: 'lowpass', freq: 600, gain: 0.35, attack: 0.05, decay: 0.7, when: 0.7, toEcho: 0.3 });
    } else if (kind === 'guardian') {
      this.tone({ type: 'sawtooth', f0: 70, f1: 45, gain: 0.3, attack: 0.15, decay: 1.4, toEcho: 0.4 });
      for (let i = 0; i < 8; i++) this.burst({ type: 'bandpass', freq: 2200 + Math.random() * 1500, q: 6, gain: 0.08, decay: 0.04, when: 0.1 + i * 0.09 });
    } else {
      this.tone({ type: 'sawtooth', f0: 140, f1: 85, gain: 0.22, attack: 0.1, decay: 0.9, toEcho: 0.3 });
      this.burst({ type: 'bandpass', freq: 500, q: 1.5, gain: 0.3, attack: 0.08, decay: 0.8 });
    }
  }

  /** A heavy blow landing on the player from a monster. */
  monsterHit(): void {
    if (!this.ctx) return;
    if (this.play('hit', { gain: 0.9, rate: 0.85 })) {
      this.play('thud', { gain: 0.55 });
      return;
    }
    this.tone({ f0: 90, f1: 40, gain: 0.6, decay: 0.25 });
    this.burst({ type: 'lowpass', freq: 900, gain: 0.45, decay: 0.2 });
  }

  bridge(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 5; i++) {
      this.tone({ f0: 190 + i * 8, f1: 110, gain: 0.3, decay: 0.08, when: i * 0.16 });
      this.burst({ type: 'bandpass', freq: 1200, q: 2, gain: 0.2, decay: 0.05, when: i * 0.16 });
    }
    this.tone({ type: 'triangle', f0: 120, f1: 80, gain: 0.15, decay: 0.6, when: 0.9 });
  }

  flashlightClick(): void {
    if (!this.ctx) return;
    this.tone({ type: 'square', f0: 2600, f1: 2000, gain: 0.05, decay: 0.02 });
    this.burst({ type: 'highpass', freq: 3500, gain: 0.12, decay: 0.025 });
  }

  repair(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) {
      this.tone({ f0: 240, f1: 140, gain: 0.32, decay: 0.07, when: i * 0.14 });
      this.burst({ type: 'bandpass', freq: 1600, q: 3, gain: 0.2, decay: 0.04, when: i * 0.14 });
    }
    this.burst({ type: 'bandpass', freq: 500, endFreq: 900, q: 1, gain: 0.12, attack: 0.1, decay: 0.4, when: 0.6 });
  }

  victory(): void {
    if (!this.ctx) return;
    [392, 494, 587, 784, 988].forEach((f, i) => this.tone({ type: 'triangle', f0: f, gain: 0.14, attack: 0.02, decay: 0.6, when: i * 0.16 }));
    this.tone({ type: 'triangle', f0: 784, gain: 0.1, attack: 0.2, decay: 1.8, when: 0.9 });
  }

  deathSting(): void {
    if (!this.ctx) return;
    [330, 262, 196].forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, f1: f * 0.94, gain: 0.08, attack: 0.05, decay: 0.7, when: i * 0.3 }));
    this.burst({ type: 'lowpass', freq: 300, gain: 0.3, attack: 0.3, decay: 1.6 });
  }

  impact(surface: Surface | 'wood' | 'metal'): void {
    if (!this.ctx) return;
    if (surface === 'metal') {
      this.tone({ type: 'triangle', f0: 2400 + Math.random() * 800, f1: 1400, gain: 0.12, decay: 0.15 });
      this.burst({ type: 'highpass', freq: 3000, gain: 0.2, decay: 0.05 });
    } else if (surface === 'water') {
      this.burst({ type: 'bandpass', freq: 900, endFreq: 300, q: 1, gain: 0.25, decay: 0.25 });
    } else if (surface === 'wood') {
      if (!this.play('knock', { gain: 0.55 })) this.burst({ type: 'bandpass', freq: 1300, q: 2, gain: 0.3, decay: 0.06 });
    } else {
      this.burst({ type: 'lowpass', freq: 1500, gain: 0.25, decay: 0.12 });
    }
  }

  pickup(): void {
    if (!this.ctx) return;
    this.tone({ type: 'triangle', f0: 660, gain: 0.12, decay: 0.08 });
    this.tone({ type: 'triangle', f0: 990, gain: 0.1, decay: 0.12, when: 0.07 });
  }

  /** Cabin door: a wooden creak, then the knock of the door settling. */
  door(open: boolean): void {
    if (!this.ctx) return;
    this.tone({ type: 'sawtooth', f0: open ? 150 : 220, f1: open ? 230 : 140, gain: 0.04, attack: 0.05, decay: 0.42 });
    this.burst({ type: 'bandpass', freq: 850, q: 6, gain: 0.12, attack: 0.04, decay: 0.38 });
    const knock = open ? 0.42 : 0.3;
    this.tone({ f0: 120, f1: 70, gain: 0.35, decay: 0.12, when: knock });
    this.burst({ type: 'lowpass', freq: 700, gain: 0.25, decay: 0.1, when: knock });
  }

  /** A water drop landing in a cave puddle: a short, bright plink with a little echo. */
  drip(vol = 1): void {
    if (!this.ctx) return;
    const f = 1400 + Math.random() * 900;
    this.tone({ type: 'sine', f0: f, f1: f * 1.6, gain: 0.06 * vol, attack: 0.002, decay: 0.09, toEcho: 0.5 });
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

  /**
   * One footfall, by the ground under the player: muffled grainy sand, grass with a
   * leafy rustle, dry stone (with a cave echo indoors), hollow planks, shallow splash.
   */
  footstep(surface: Surface, sprint: boolean, indoor = false): void {
    if (!this.ctx) return;
    const v = sprint ? 1.25 : 1;
    const j = 0.9 + Math.random() * 0.2;
    // Recorded steps per surface (quiet: the player's body stays under the action).
    const fam = surface === 'grass' ? 'step_grass' : surface === 'wood' ? 'step_wood' : surface === 'rock' ? 'step_stone' : surface === 'sand' ? 'step_sand' : '';
    if (fam && this.play(fam, { gain: (surface === 'wood' ? 0.42 : 0.5) * v, toEcho: indoor && surface === 'rock' ? 0.45 : 0 })) return;
    switch (surface) {
      case 'sand':
        // Soft thud plus a short crunch of grains.
        this.burst({ type: 'lowpass', freq: 700 * j, gain: 0.17 * v, attack: 0.012, decay: 0.12 });
        for (let i = 0; i < 4; i++) this.burst({ type: 'bandpass', freq: 3000 + Math.random() * 2500, q: 2, gain: 0.025 * v, decay: 0.012, when: 0.015 + i * 0.018 });
        break;
      case 'grass':
        // Low step and a brushing rustle of blades and leaves.
        this.burst({ type: 'lowpass', freq: 420 * j, gain: 0.09 * v, decay: 0.06 });
        this.burst({ type: 'bandpass', freq: 3200 * j, endFreq: 1800, q: 0.7, gain: 0.08 * v, attack: 0.02, decay: 0.14 });
        if (Math.random() < 0.5) this.burst({ type: 'highpass', freq: 5000, gain: 0.025 * v, attack: 0.03, decay: 0.08, when: 0.05 });
        break;
      case 'rock':
        // Dry click of a heel on stone; in the cave it rings back off the walls.
        this.burst({ type: 'bandpass', freq: 1700 * j, q: 2.2, gain: 0.17 * v, decay: 0.04, toEcho: indoor ? 0.55 : 0 });
        this.tone({ type: 'triangle', f0: 260 * j, f1: 170, gain: 0.05 * v, decay: 0.035, toEcho: indoor ? 0.3 : 0 });
        if (Math.random() < 0.4) this.burst({ type: 'highpass', freq: 4500, gain: 0.04 * v, decay: 0.02, when: 0.03 });
        break;
      case 'wood':
        // Hollow plank: a resonant knock over a short body tone.
        this.tone({ f0: 150 * j, f1: 95, gain: 0.26 * v, decay: 0.11 });
        this.burst({ type: 'bandpass', freq: 780 * j, q: 5, gain: 0.16 * v, decay: 0.09 });
        this.tone({ type: 'triangle', f0: 420 * j, f1: 360, gain: 0.04 * v, decay: 0.06, when: 0.01 });
        break;
      case 'water':
        // Light splash at the water's edge.
        this.burst({ type: 'bandpass', freq: 1400 * j, endFreq: 500, q: 0.9, gain: 0.16 * v, attack: 0.015, decay: 0.2 });
        this.burst({ type: 'highpass', freq: 3800, gain: 0.05 * v, attack: 0.03, decay: 0.12, when: 0.04 });
        break;
    }
  }

  /** Hit confirmation on the hit frame: a bright tick, harder and lower on enemies. */
  hitConfirm(enemy: boolean, kill = false): void {
    if (!this.ctx) return;
    if (enemy) {
      this.tone({ type: 'square', f0: kill ? 900 : 1300, f1: kill ? 500 : 900, gain: kill ? 0.08 : 0.06, decay: kill ? 0.09 : 0.05 });
      this.burst({ type: 'bandpass', freq: 2400, q: 3, gain: 0.12, decay: 0.03 });
    } else {
      this.tone({ type: 'triangle', f0: 1800, f1: 1500, gain: 0.05, decay: 0.035 });
    }
  }

  /** A tense sting when a cannibal first turns to hunt the player. */
  alert(): void {
    if (!this.ctx) return;
    this.tone({ type: 'sawtooth', f0: 233, f1: 247, gain: 0.05, attack: 0.04, decay: 0.7 });
    this.tone({ type: 'sawtooth', f0: 349, f1: 370, gain: 0.04, attack: 0.04, decay: 0.7 });
    this.tone({ f0: 70, f1: 45, gain: 0.35, decay: 0.25 });
    this.burst({ type: 'lowpass', freq: 300, gain: 0.25, decay: 0.2 });
  }

  /** Burning blow: a whoosh of flame on top of the strike. */
  fireHit(): void {
    if (!this.ctx) return;
    this.burst({ type: 'bandpass', freq: 900, endFreq: 2600, q: 0.8, gain: 0.16, attack: 0.02, decay: 0.3 });
    for (let i = 0; i < 4; i++) this.burst({ type: 'highpass', freq: 3000 + Math.random() * 2500, gain: 0.06, decay: 0.02, when: 0.04 + i * 0.05 });
  }

  private crackle(level: number): void {
    this.burst({ type: 'highpass', freq: 2500 + Math.random() * 3000, gain: (0.05 + Math.random() * 0.1) * level, decay: 0.02 + Math.random() * 0.03 });
    void this.fireLevel;
  }
}
