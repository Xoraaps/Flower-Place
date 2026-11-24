/**
 * Subtle Procedural Botanical Web Audio Engine
 * - Dual-band filtered meadow wind (pink/brown noise + slow atmospheric LFO)
 * - Tactile grass-parting rustle modulated by 3D cursor velocity
 * - Delicate pastoral D-Lydian harmonic chimes when flowers bloom or are sown
 */

// Open pastoral D-Lydian / Major-9th frequencies (Hz) — warm, contemplative, never arcade-like
const PASTORAL_SCALE_HZ = [
  293.66, // D4
  329.63, // E4
  369.99, // F#4
  440.00, // A4
  493.88, // B4
  554.37, // C#5
  587.33, // D5
  659.25, // E5
  739.99, // F#5
  880.00, // A5
];

export class MeadowAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private rustleGain: GainNode | null = null;
  private rustleFilter: BiquadFilterNode | null = null;
  private enabled = false;
  private lastChimeTime = 0;
  private noteIndex = 0;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggle(): boolean {
    if (!this.enabled) {
      this.enable();
    } else {
      this.disable();
    }
    return this.enabled;
  }

  public enable(): void {
    if (!this.ctx) {
      this.initAudioGraph();
    }
    if (!this.ctx || !this.masterGain) return;

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    this.enabled = true;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.85, now, 0.45);
  }

  public disable(): void {
    this.enabled = false;
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.0, now, 0.25);
  }

  private initAudioGraph(): void {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Generate 4-second seamless pink noise buffer
    const length = ctx.sampleRate * 4;
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;

      // Crossfade loop ends smoothly
      const fade = Math.min(1, i / 2000, (length - i) / 2000);
      data[i] = pink * fade;
    }

    // 1. Ambient Meadow Breeze Channel
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer;
    windSrc.loop = true;

    const windBand = ctx.createBiquadFilter();
    windBand.type = 'bandpass';
    windBand.frequency.value = 340;
    windBand.Q.value = 0.75;

    const windLowpass = ctx.createBiquadFilter();
    windLowpass.type = 'lowpass';
    windLowpass.frequency.value = 680;

    // Slow wind-gust LFO sweeping filter cutoff gently
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.11;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 160;
    lfo.connect(lfoDepth);
    lfoDepth.connect(windBand.frequency);

    const windGain = ctx.createGain();
    windGain.gain.value = 0.14;

    windSrc.connect(windBand);
    windBand.connect(windLowpass);
    windLowpass.connect(windGain);
    windGain.connect(master);

    windSrc.start();
    lfo.start();
    this.windGain = windGain;

    // 2. Cursor Stem/Grass Rustle Channel
    const rustleSrc = ctx.createBufferSource();
    rustleSrc.buffer = noiseBuffer;
    rustleSrc.loop = true;

    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'bandpass';
    rustleFilter.frequency.value = 1450;
    rustleFilter.Q.value = 1.4;

    const rustleGain = ctx.createGain();
    rustleGain.gain.value = 0.0;

    rustleSrc.connect(rustleFilter);
    rustleFilter.connect(rustleGain);
    rustleGain.connect(master);
    rustleSrc.start(0, 1.3);

    this.rustleFilter = rustleFilter;
    this.rustleGain = rustleGain;
  }

  public update(cursorSpeed: number, windStrength: number): void {
    if (!this.enabled || !this.ctx || !this.windGain || !this.rustleGain || !this.rustleFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.11 * windStrength, now, 0.25);

    const rustleTarget = Math.min(0.12, (cursorSpeed / 14.0) * 0.11);
    this.rustleGain.gain.setTargetAtTime(rustleTarget, now, 0.08);
    this.rustleFilter.frequency.setTargetAtTime(1100 + Math.min(900, cursorSpeed * 55), now, 0.1);
  }

  /**
   * Plays a quiet, warm acoustic-glass / harp-harmonic tone when blossoms open.
   * Rate-limited so dense phrases produce a delicate shimmering arpeggio rather than clipping.
   */
  public triggerBloomChime(panNormalized = 0, intensity = 1.0): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    if (now - this.lastChimeTime < 0.075) return;
    this.lastChimeTime = now;

    const step = Math.random() < 0.65 ? 1 : 2;
    this.noteIndex = (this.noteIndex + step) % PASTORAL_SCALE_HZ.length;
    const freq = PASTORAL_SCALE_HZ[this.noteIndex];

    const osc = this.ctx.createOscillator();
    const overtone = this.ctx.createOscillator();
    osc.type = 'sine';
    overtone.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    overtone.frequency.setValueAtTime(freq * 2.0, now);

    const overtoneGain = this.ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.12, now);

    const env = this.ctx.createGain();
    const peak = 0.048 * Math.min(1.2, intensity);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.024);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.85);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-0.75, Math.min(0.75, panNormalized)), now);

    osc.connect(env);
    overtone.connect(overtoneGain);
    overtoneGain.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain);

    osc.start(now);
    overtone.start(now);
    osc.stop(now + 1.9);
    overtone.stop(now + 1.9);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
