import { Platform } from 'react-native';

class AudioAlertService {
  private audioCtx: AudioContext | null = null;
  private isSirenActive: boolean = false;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private mainGain: GainNode | null = null;
  private sweepTimer: any = null;

  private initContext() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && !this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
  }

  // Realistic dual-tone wailing civil defense siren sweep (450Hz <-> 950Hz)
  public playEmergencySiren() {
    if (Platform.OS !== 'web' || this.isSirenActive) return;

    this.initContext();
    if (!this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.isSirenActive = true;

    try {
      const now = this.audioCtx.currentTime;

      // Master output volume (substantially boosted for true alarm presence)
      this.mainGain = this.audioCtx.createGain();
      this.mainGain.gain.setValueAtTime(0.35, now);
      this.mainGain.connect(this.audioCtx.destination);

      // Primary horn oscillator
      this.osc1 = this.audioCtx.createOscillator();
      this.osc1.type = 'sawtooth';

      // Harmonic detuned secondary horn for piercing mechanical resonance
      this.osc2 = this.audioCtx.createOscillator();
      this.osc2.type = 'square';
      this.osc2.detune.setValueAtTime(14, now);

      this.osc1.connect(this.mainGain);
      this.osc2.connect(this.mainGain);

      this.osc1.start(now);
      this.osc2.start(now);

      // Continuous pitch sweep function
      let goingUp = true;
      const cycleSweep = () => {
        if (!this.isSirenActive || !this.audioCtx || !this.osc1 || !this.osc2) return;
        const t = this.audioCtx.currentTime;
        const targetFreq = goingUp ? 960 : 460;
        const duration = 1.1; // 1.1s rise and 1.1s fall time

        this.osc1.frequency.cancelScheduledValues(t);
        this.osc1.frequency.exponentialRampToValueAtTime(targetFreq, t + duration);

        this.osc2.frequency.cancelScheduledValues(t);
        this.osc2.frequency.exponentialRampToValueAtTime(targetFreq * 1.02, t + duration);

        goingUp = !goingUp;
      };

      // Initial pitch start
      this.osc1.frequency.setValueAtTime(460, now);
      this.osc2.frequency.setValueAtTime(469, now);
      cycleSweep();

      this.sweepTimer = setInterval(cycleSweep, 1100);
    } catch (err) {
      console.warn('Web Audio playback error:', err);
    }
  }

  public stopEmergencySiren() {
    this.isSirenActive = false;

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    if (this.mainGain && this.audioCtx) {
      try {
        // Quick 50ms fadeout to prevent harsh speaker pops
        this.mainGain.gain.setValueAtTime(this.mainGain.gain.value, this.audioCtx.currentTime);
        this.mainGain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.05);

        setTimeout(() => {
          this.osc1?.stop();
          this.osc2?.stop();
          this.osc1?.disconnect();
          this.osc2?.disconnect();
          this.mainGain?.disconnect();
          this.osc1 = null;
          this.osc2 = null;
          this.mainGain = null;
        }, 60);
      } catch {
        // Safe cleanup fallback
      }
    }
  }

  public isPlaying(): boolean {
    return this.isSirenActive;
  }

  public requestNotificationPermission() {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }

  public sendPushAlert(title: string, body: string) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
        });
      }
    }
  }
}

export const audioAlertService = new AudioAlertService();