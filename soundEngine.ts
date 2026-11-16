import { WeaponClass } from '../types/game';

export type MusicMode = 'lobby' | 'combat';

// Japanese Hirajoshi & Miyako-bushi frequencies centered on D (D, Eb, G, A, Bb, C#)
const HIRAJOSHI = [
  146.83, // 0: D3
  155.56, // 1: Eb3
  196.0,  // 2: G3
  220.0,  // 3: A3
  233.08, // 4: Bb3
  293.66, // 5: D4
  311.13, // 6: Eb4
  392.0,  // 7: G4
  440.0,  // 8: A4
  466.16, // 9: Bb4
  587.33, // 10: D5
  622.25, // 11: Eb5
  783.99, // 12: G5
];

// 64-step serene twilight koto phrase (4 bars)
const LOBBY_KOTO: number[] = [
  5, -1, 7, 8, -1, 7, 5, -1, 4, -1, 3, 5, -1, 3, 1, 0,
  5, -1, 8, 9, -1, 8, 7, -1, 5, -1, 4, 3, -1, 1, 0, -1,
  2, -1, 5, 7, -1, 8, 10, -1, 9, -1, 8, 7, -1, 5, 4, 3,
  5, -1, 7, 5, -1, 4, 3, 1, 0, -1, 3, -1, 5, -1, -1, -1,
];

// Driving 16-step shamisen bass & riff patterns
const COMBAT_BASS_A = [0, 0, -1, 0, 5, 0, -1, 3, 0, 0, -1, 0, 4, 3, 1, 0];
const COMBAT_BASS_B = [2, 2, -1, 2, 7, 2, -1, 5, 1, 1, -1, 1, 4, 3, 1, 0];
const COMBAT_RIFF_A = [5, -1, 7, 8, -1, 7, 5, -1, 4, 5, 7, -1, 8, 9, 8, 7];
const COMBAT_RIFF_B = [10, -1, 9, 8, -1, 7, 8, 9, 10, -1, 11, 10, 9, 8, 7, 5];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delaySend: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private musicMode: MusicMode = 'lobby';
  private combatClimax = false;
  private musicRunning = false;
  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;

  private createHallImpulse(ctx: AudioContext, seconds = 1.75, decay = 2.6): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay) * (i < rate * 0.015 ? i / (rate * 0.015) : 1);
        const white = (Math.random() * 2 - 1) * env;
        // One-pole lowpass damping so reverb tail is warm wooden hall instead of harsh fizz
        lp = lp * 0.72 + white * 0.28;
        data[i] = lp;
      }
    }
    return impulse;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.18;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.48;
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.56;
      this.musicGain.connect(this.compressor);

      // Temple Hall Convolver Reverb
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.createHallImpulse(this.ctx, 1.85, 2.7);
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.42;
      this.reverbSend.connect(this.reverbNode);
      this.reverbNode.connect(this.musicGain);

      // Subtle Echo Delay
      this.delayNode = this.ctx.createDelay(1.0);
      this.delayNode.delayTime.value = 0.265;
      const delayFb = this.ctx.createGain();
      delayFb.gain.value = 0.28;
      const delayFilter = this.ctx.createBiquadFilter();
      delayFilter.type = 'lowpass';
      delayFilter.frequency.value = 1850;
      this.delaySend = this.ctx.createGain();
      this.delaySend.gain.value = 0.22;

      this.delaySend.connect(this.delayNode);
      this.delayNode.connect(delayFilter);
      delayFilter.connect(delayFb);
      delayFb.connect(this.delayNode);
      delayFilter.connect(this.musicGain);

      // Reusable white noise buffer
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        ch[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.48, this.ctx.currentTime);
    }
    if (!muted) {
      this.startMusic();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && !this.musicRunning) {
      this.startMusic();
    }
  }

  public setMusicMode(mode: MusicMode): void {
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.stepIndex = 0;
  }

  public setCombatClimax(climax: boolean): void {
    this.combatClimax = climax;
  }

  public startMusic(): void {
    if (this.musicRunning || this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.musicRunning = true;
    this.nextStepTime = ctx.currentTime + 0.08;
    this.schedulerId = window.setInterval(() => this.scheduleMusicSteps(), 45);
  }

  public stopMusic(): void {
    this.musicRunning = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  private scheduleMusicSteps(): void {
    if (!this.ctx || !this.musicGain || this.muted || this.ctx.state !== 'running') return;
    const lookahead = 0.16;
    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      const stepDur =
        this.musicMode === 'lobby'
          ? 0.36
          : this.combatClimax
          ? 0.104
          : 0.132; // Speeds up sharply on final heart / deciding round!
      this.triggerMusicStep(this.stepIndex, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  }

  private triggerMusicStep(step: number, time: number, stepDur: number): void {
    if (this.musicMode === 'lobby') {
      // Lush dark string pad chord progression (Dm -> Bb -> Gm -> A/D)
      if (step % 16 === 0) {
        const bar = Math.floor(step / 16);
        const roots = [73.42, 58.27, 98.0, 73.42];
        const fifths = [110.0, 87.31, 146.83, 110.0];
        const colors = [155.56, 146.83, 196.0, 138.59];
        this.playTwilightPad(
          [roots[bar], fifths[bar], colors[bar]],
          time,
          stepDur * 15.8,
          0.11
        );
      }

      // Delicate Koto melody with stereo echo & hall reverb
      const kotoNote = LOBBY_KOTO[step];
      if (kotoNote >= 0) {
        const pan = ((step % 4) - 1.5) * 0.22;
        this.playKotoString(HIRAJOSHI[kotoNote], time, 0.21, 1.45, pan, true);
      }

      // Expressive Shakuhachi solo phrases
      if (step === 2 || step === 18 || step === 34 || step === 50) {
        const phrases = [587.33, 466.16, 622.25, 440.0];
        this.playShakuhachi(phrases[Math.floor(step / 16)], time, stepDur * 10, 0.14);
      }

      // Resonant bronze temple bell & soft heart-pulse taiko
      if (step === 0 || step === 32) {
        this.playTempleBell(step === 0 ? 587.33 : 440.0, time, 0.08);
      }
      if (step % 16 === 0) {
        this.playTaiko(time, 0.22, false);
      }
    } else {
      // COMBAT MODE: Cinematic 64-step (4-bar) Japanese Battle Score
      const bar = Math.floor(step / 16);
      const s16 = step % 16;

      // Sub-pad harmonic anchor every bar
      if (s16 === 0) {
        const chordRoots = [73.42, 73.42, 98.0, 77.78]; // D -> D -> G -> Eb
        this.playTwilightPad([chordRoots[bar], chordRoots[bar] * 1.5], time, stepDur * 15.5, 0.095);
      }

      // Multi-layered Taiko Drum Groove (speeds up & intensifies on final heart)
      const isKick =
        s16 === 0 ||
        s16 === 6 ||
        s16 === 10 ||
        (this.combatClimax && (s16 === 3 || s16 === 8 || s16 === 14));
      if (isKick) {
        this.playTaiko(time, s16 === 0 ? 0.64 : this.combatClimax ? 0.5 : 0.44, true);
      }

      // Chu-daiko / Shime-daiko syncopated rhythms + bar-4 fill
      if (s16 === 4 || s16 === 12 || (bar === 3 && s16 >= 12)) {
        this.playShimeTap(time, s16 === 4 || s16 === 12 ? 0.28 : 0.2);
      }
      // Subtle off-beat shaker/tsuzumi tick for momentum
      if (s16 % 2 === 1 && (bar >= 1 || this.combatClimax)) {
        this.playShimeTap(time, this.combatClimax ? 0.11 : 0.075);
      }

      // Hyoshigi wooden clack turnaround at end of bar 2 & 4
      if ((bar === 1 || bar === 3) && (s16 === 14 || s16 === 15)) {
        this.playHyoshigi(time, s16 === 14 ? 0.17 : 0.13);
      }

      // Driving Shamisen Bassline (alternating bars A/A/B/A)
      const bassPat = bar === 2 ? COMBAT_BASS_B : COMBAT_BASS_A;
      const bassIdx = bassPat[s16];
      if (bassIdx >= 0) {
        this.playKotoString(HIRAJOSHI[bassIdx] * 0.5, time, 0.25, 0.36, -0.15, false);
      }

      // Call-and-Response Shamisen Lead Melody (enters strongly in bars 2, 3, 4)
      const riffPat = bar % 2 === 1 ? COMBAT_RIFF_B : COMBAT_RIFF_A;
      const leadIdx = riffPat[s16];
      if (leadIdx >= 0 && (bar >= 1 || s16 % 4 === 0)) {
        const pan = s16 % 2 === 0 ? 0.22 : -0.18;
        this.playKotoString(HIRAJOSHI[leadIdx], time, 0.16, 0.48, pan, true);
      }

      // Dramatic Shakuhachi Battle Call on bar starts
      if (step === 0 || step === 32 || (this.combatClimax && step === 48)) {
        const battleNote = step === 0 ? 587.33 : step === 32 ? 622.25 : 783.99;
        this.playShakuhachi(battleNote, time, stepDur * 13, 0.17);
      }
    }
  }

  private playTwilightPad(freqs: number[], time: number, dur: number, vol: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, time);
    filter.frequency.linearRampToValueAtTime(520, time + dur * 0.45);
    filter.frequency.linearRampToValueAtTime(220, time + dur);
    filter.Q.value = 1.2;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + dur * 0.28);
    gain.gain.linearRampToValueAtTime(vol * 0.72, time + dur * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + dur);

    filter.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);

    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      osc.type = idx === 0 ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(f, time);
      osc.detune.setValueAtTime(idx % 2 === 0 ? -5 : 6, time);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    });
  }

  private playKotoString(
    freq: number,
    time: number,
    vol: number,
    decay: number,
    pan: number,
    sendFx: boolean
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const oscHarm = this.ctx.createOscillator();
    osc.type = 'triangle';
    oscHarm.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    oscHarm.frequency.setValueAtTime(freq * 2, time);

    const harmGain = this.ctx.createGain();
    harmGain.gain.setValueAtTime(0.32, time);
    harmGain.gain.exponentialRampToValueAtTime(0.04, time + decay * 0.4);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(5400, freq * 8.5), time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(240, freq * 1.35), time + decay * 0.75);
    filter.Q.value = 2.1;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + decay);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, time);

    osc.connect(filter);
    oscHarm.connect(harmGain);
    harmGain.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.musicGain);

    if (sendFx && this.reverbSend && this.delaySend) {
      panner.connect(this.reverbSend);
      panner.connect(this.delaySend);
    }

    osc.start(time);
    oscHarm.start(time);
    osc.stop(time + decay + 0.03);
    oscHarm.stop(time + decay + 0.03);
  }

  private playShakuhachi(freq: number, time: number, dur: number, vol: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc.type = 'sine';
    osc2.type = 'triangle';

    // Expressive Japanese pitch scoop
    osc.frequency.setValueAtTime(freq * 0.91, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.16);
    osc2.frequency.setValueAtTime(freq * 0.91, time);
    osc2.frequency.exponentialRampToValueAtTime(freq * 1.002, time + 0.16);

    // Expressive 5.2 Hz vibrato delayed slightly after attack
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.setValueAtTime(5.2, time);
    lfoGain.gain.setValueAtTime(0, time);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.012, time + 0.35);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(osc2.frequency);

    const osc2Level = this.ctx.createGain();
    osc2Level.gain.value = 0.22;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + dur * 0.24);
    gain.gain.linearRampToValueAtTime(vol * 0.72, time + dur * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + dur);

    osc.connect(gain);
    osc2.connect(osc2Level);
    osc2Level.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);

    osc.start(time);
    osc2.start(time);
    lfo.start(time);
    osc.stop(time + dur + 0.05);
    osc2.stop(time + dur + 0.05);
    lfo.stop(time + dur + 0.05);

    // Bamboo breath air resonance
    if (this.noiseBuffer) {
      const breath = this.ctx.createBufferSource();
      breath.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq * 2.0, time);
      bp.Q.value = 6.5;
      const bGain = this.ctx.createGain();
      bGain.gain.setValueAtTime(0.001, time);
      bGain.gain.linearRampToValueAtTime(vol * 0.28, time + 0.12);
      bGain.gain.exponentialRampToValueAtTime(0.0008, time + dur * 0.85);
      breath.connect(bp);
      bp.connect(bGain);
      bGain.connect(this.reverbSend);
      breath.start(time);
      breath.stop(time + dur);
    }
  }

  private playTaiko(time: number, vol: number, withSnap: boolean): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    // Sub membrane boom
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(112, time);
    sub.frequency.exponentialRampToValueAtTime(42, time + 0.26);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(vol, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.42);
    sub.connect(subGain);
    subGain.connect(this.musicGain);
    sub.start(time);
    sub.stop(time + 0.44);

    // Resonant wood shell overtone
    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(165, time);
    body.frequency.exponentialRampToValueAtTime(78, time + 0.16);
    const bodyGain = this.ctx.createGain();
    bodyGain.gain.setValueAtTime(vol * 0.42, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    body.connect(bodyGain);
    bodyGain.connect(this.musicGain);
    bodyGain.connect(this.reverbSend);
    body.start(time);
    body.stop(time + 0.24);

    // Bachi stick-on-skin transient
    if (withSnap && this.noiseBuffer) {
      const hit = this.ctx.createBufferSource();
      hit.buffer = this.noiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.setValueAtTime(340, time);
      lp.Q.value = 1.4;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(vol * 0.55, time);
      nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.065);
      hit.connect(lp);
      lp.connect(nGain);
      nGain.connect(this.musicGain);
      nGain.connect(this.reverbSend);
      hit.start(time);
      hit.stop(time + 0.075);
    }
  }

  private playShimeTap(time: number, vol: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1180, time);
    bp.Q.value = 3.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.055);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);
    src.start(time);
    src.stop(time + 0.065);
  }

  private playHyoshigi(time: number, vol = 0.16): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1820, time);
    osc.frequency.exponentialRampToValueAtTime(1340, time + 0.032);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  private playTempleBell(freq: number, time: number, vol: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    [1, 2.02, 3.17].forEach((ratio, idx) => {
      if (!this.ctx || !this.musicGain || !this.reverbSend) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * ratio, time);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol / (idx + 1), time);
      gain.gain.exponentialRampToValueAtTime(0.0004, time + 2.4 / (idx + 1));
      osc.connect(gain);
      gain.connect(this.musicGain);
      gain.connect(this.reverbSend);
      osc.start(time);
      osc.stop(time + 2.5);
    });
  }

  private triggerNoiseBurst(
    startTime: number,
    dur: number,
    freqStart: number,
    freqEnd: number,
    q: number,
    vol: number,
    filterType: BiquadFilterType = 'bandpass',
    withReverb = false
  ): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(40, freqStart), startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + dur);
    filter.Q.value = q;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    if (withReverb && this.reverbSend) {
      gain.connect(this.reverbSend);
    }

    src.start(startTime);
    src.stop(startTime + dur + 0.02);
  }

  public playSwing(weapon: WeaponClass, heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const dur = heavy ? 0.28 : 0.15;

    const baseFreq = weapon === 'daggers' ? 1950 : weapon === 'katana' ? 1280 : 680;
    this.triggerNoiseBurst(
      now,
      dur,
      baseFreq * (heavy ? 0.85 : 1.15),
      baseFreq * 0.28,
      weapon === 'katana' ? 3.2 : weapon === 'daggers' ? 2.4 : 1.5,
      heavy ? 0.48 : 0.3,
      'bandpass'
    );

    if (weapon === 'daggers' && !heavy) {
      // Quick twin-flick zip
      this.triggerNoiseBurst(now + 0.045, 0.09, 2400, 950, 2.8, 0.18, 'bandpass');
    } else if (weapon === 'katana') {
      // Singing blade edge whistle
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(heavy ? 1620 : 1940, now);
      osc.frequency.exponentialRampToValueAtTime(heavy ? 640 : 1080, now + dur * 0.85);
      const sGain = ctx.createGain();
      sGain.gain.setValueAtTime(heavy ? 0.1 : 0.045, now);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.88);
      osc.connect(sGain);
      sGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + dur);
    } else if (weapon === 'staff' && heavy) {
      // Heavy wind pole rumble
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(88, now + dur);
      const sGain = ctx.createGain();
      sGain.gain.setValueAtTime(0.16, now);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(sGain);
      sGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    }
  }

  public playHit(heavy: boolean, weapon: WeaponClass, isCrit = false, isUltimate = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // 1. Chest-thumping sub-bass punch
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subDur = isUltimate ? 0.34 : heavy ? 0.25 : 0.14;
    sub.frequency.setValueAtTime(isUltimate ? 165 : heavy ? 148 : 205, now);
    sub.frequency.exponentialRampToValueAtTime(isUltimate ? 28 : 36, now + subDur);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(isUltimate ? 0.92 : heavy ? 0.78 : 0.52, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + subDur);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + subDur + 0.02);

    // 2. Martial impact snap + bone/armor crunch burst
    this.triggerNoiseBurst(
      now,
      heavy || isUltimate ? 0.14 : 0.075,
      heavy ? 1850 : 2200,
      heavy ? 320 : 540,
      1.2,
      isUltimate ? 0.65 : heavy ? 0.52 : 0.36,
      'bandpass',
      isUltimate || isCrit
    );

    // 3. Weapon-specific impact signature
    if (weapon === 'katana') {
      // Razor steel slash + bright harmonic flash
      const slice = ctx.createOscillator();
      slice.type = 'sawtooth';
      slice.frequency.setValueAtTime(heavy ? 1180 : 1420, now);
      slice.frequency.exponentialRampToValueAtTime(290, now + 0.12);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600, now);
      bp.Q.value = 2.2;

      const pGain = ctx.createGain();
      pGain.gain.setValueAtTime(heavy ? 0.28 : 0.18, now);
      pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.125);
      slice.connect(bp);
      bp.connect(pGain);
      pGain.connect(this.masterGain);
      if (this.reverbSend && (heavy || isCrit || isUltimate)) pGain.connect(this.reverbSend);
      slice.start(now);
      slice.stop(now + 0.14);
    } else if (weapon === 'daggers') {
      // Twin-blade crisp double-cut snap
      [0, 0.032].forEach((offset, idx) => {
        if (!this.masterGain) return;
        const t = now + offset;
        const snap = ctx.createOscillator();
        snap.type = 'sawtooth';
        snap.frequency.setValueAtTime(idx === 0 ? 1560 : 1920, t);
        snap.frequency.exponentialRampToValueAtTime(420, t + 0.07);
        const pGain = ctx.createGain();
        pGain.gain.setValueAtTime((heavy ? 0.22 : 0.14) * (idx === 0 ? 1 : 0.75), t);
        pGain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
        snap.connect(pGain);
        pGain.connect(this.masterGain);
        snap.start(t);
        snap.stop(t + 0.085);
      });
    } else {
      // Bo Staff resonant hardwood thwack!
      const wood = ctx.createOscillator();
      wood.type = 'triangle';
      wood.frequency.setValueAtTime(heavy ? 320 : 410, now);
      wood.frequency.exponentialRampToValueAtTime(125, now + 0.11);
      const wGain = ctx.createGain();
      wGain.gain.setValueAtTime(heavy ? 0.45 : 0.3, now);
      wGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      wood.connect(wGain);
      wGain.connect(this.masterGain);
      if (this.reverbSend && heavy) wGain.connect(this.reverbSend);
      wood.start(now);
      wood.stop(now + 0.13);
    }

    // 4. Crit / Ultimate high crystalline steel ring
    if (isCrit || isUltimate) {
      [1760, 2640].forEach((freq, i) => {
        if (!this.masterGain) return;
        const chime = ctx.createOscillator();
        chime.type = 'sine';
        chime.frequency.setValueAtTime(freq, now);
        chime.frequency.exponentialRampToValueAtTime(freq * 0.88, now + 0.26);
        const cGain = ctx.createGain();
        cGain.gain.setValueAtTime((isUltimate ? 0.14 : 0.09) / (i + 1), now);
        cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
        chime.connect(cGain);
        cGain.connect(this.masterGain);
        if (this.reverbSend) cGain.connect(this.reverbSend);
        chime.start(now);
        chime.stop(now + 0.28);
      });
    }
  }

  public playBlock(isParry: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Sparks burst on steel contact
    this.triggerNoiseBurst(
      now,
      isParry ? 0.18 : 0.08,
      isParry ? 4200 : 1800,
      isParry ? 1400 : 600,
      isParry ? 2.5 : 1.4,
      isParry ? 0.34 : 0.22,
      'highpass',
      isParry
    );

    const freqs = isParry ? [1480, 2240, 3190] : [580, 890];
    const dur = isParry ? 0.45 : 0.14;

    freqs.forEach((f, idx) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * (isParry ? 0.86 : 0.62), now + dur);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime((isParry ? 0.24 : 0.18) / (idx + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(gain);
      gain.connect(this.masterGain);
      if (isParry && this.reverbSend) gain.connect(this.reverbSend);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    });
  }

  public playDash(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Shadow-step air rush + low whoosh
    this.triggerNoiseBurst(now, 0.16, 1150, 260, 1.9, 0.28, 'bandpass');

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.13);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playFeint(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    this.triggerNoiseBurst(now, 0.11, 1650, 520, 2.6, 0.24, 'bandpass');

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(860, now + 0.06);
    osc.frequency.exponentialRampToValueAtTime(310, now + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playSuperStrike(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    [587.33, 880, 1174.66].forEach((freq, idx) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.03);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.12, now + 0.26);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18 / (idx + 1), now + idx * 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(now + idx * 0.03);
      osc.stop(now + 0.3);
    });
  }

  public playTagIn(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    this.triggerNoiseBurst(now, 0.2, 1600, 380, 1.8, 0.3, 'bandpass', true);
    const freqs = [330, 495, 660];
    freqs.forEach((f, idx) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.045);
      osc.frequency.exponentialRampToValueAtTime(f * 1.4, now + idx * 0.045 + 0.24);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now + idx * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(now + idx * 0.045);
      osc.stop(now + idx * 0.045 + 0.27);
    });
  }

  public playUltimate(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Stage 1 (0.00 - 0.30s): Shadow Vacuum Charge Swell
    this.triggerNoiseBurst(now, 0.3, 280, 2400, 2.2, 0.32, 'bandpass', true);
    const riser = ctx.createOscillator();
    riser.type = 'sawtooth';
    riser.frequency.setValueAtTime(110, now);
    riser.frequency.exponentialRampToValueAtTime(620, now + 0.3);
    const riserFilter = ctx.createBiquadFilter();
    riserFilter.type = 'lowpass';
    riserFilter.frequency.setValueAtTime(400, now);
    riserFilter.frequency.exponentialRampToValueAtTime(2400, now + 0.3);
    const riserGain = ctx.createGain();
    riserGain.gain.setValueAtTime(0.05, now);
    riserGain.gain.linearRampToValueAtTime(0.32, now + 0.27);
    riserGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    riser.connect(riserFilter);
    riserFilter.connect(riserGain);
    riserGain.connect(this.masterGain);
    if (this.reverbSend) riserGain.connect(this.reverbSend);
    riser.start(now);
    riser.stop(now + 0.35);

    // Stage 2 (0.30s): Shadow Eclipse Bass Detonation Drop
    const dropAt = now + 0.28;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(155, dropAt);
    sub.frequency.exponentialRampToValueAtTime(32, dropAt + 0.55);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.85, dropAt);
    subGain.gain.exponentialRampToValueAtTime(0.001, dropAt + 0.58);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(dropAt);
    sub.stop(dropAt + 0.6);

    // Stage 3: Ethereal Shadow Blade Chord (D + A + Eb5)
    [293.66, 440.0, 622.25].forEach((freq, i) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, dropAt);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.015, dropAt + 0.55);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14 / (i + 1), dropAt);
      g.gain.exponentialRampToValueAtTime(0.001, dropAt + 0.65);
      osc.connect(g);
      g.connect(this.masterGain);
      if (this.reverbSend) g.connect(this.reverbSend);
      if (this.delaySend) g.connect(this.delaySend);
      osc.start(dropAt);
      osc.stop(dropAt + 0.68);
    });
  }

  public playFinisherKO(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Dramatic sub-bass KO boom
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(125, now);
    boom.frequency.exponentialRampToValueAtTime(26, now + 0.65);
    const bGain = ctx.createGain();
    bGain.gain.setValueAtTime(0.88, now);
    bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
    boom.connect(bGain);
    bGain.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.7);

    // Reverberant crash burst
    this.triggerNoiseBurst(now, 0.38, 1200, 180, 1.1, 0.35, 'lowpass', true);
  }

  public playGong(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const partials = [110, 165, 232, 318];
    partials.forEach((freq, i) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.985, now + 1.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.24 / (i + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.45);
      osc.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbSend) gain.connect(this.reverbSend);
      osc.start(now);
      osc.stop(now + 1.5);
    });
  }
}

export const soundEngine = new SoundEngine();
