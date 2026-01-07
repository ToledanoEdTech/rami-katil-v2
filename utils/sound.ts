
export const Sound = {
  ctx: null as AudioContext | null,
  masterGain: null as GainNode | null,
  isMuted: false,
  noiseBuffer: null as AudioBuffer | null,
  
  // Initialize as null to prevent immediate errors on import
  menuTrack: null as HTMLAudioElement | null,
  gameTrack: null as HTMLAudioElement | null,
  
  currentMode: 'menu' as 'menu' | 'game',
  musicEnabled: true, // Flag to disable music if files are missing

  init: function() {
    // אתחול הקונטקסט לאפקטים (יריות, פיצוצים)
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.masterGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        this.createNoiseBuffer();
      }
    } catch (e) {
      console.warn("AudioContext init failed:", e);
    }

    // אתחול וטיפול בקבצי מוזיקה עם הגנה מפני שגיאות
    if (!this.menuTrack) {
        try {
            this.menuTrack = new Audio('./menu.mp3');
            this.menuTrack.loop = true;
            this.menuTrack.volume = 0.5;
            this.menuTrack.addEventListener('error', (e) => {
                console.warn("Menu music file not found or unsupported. Disabling music.");
                this.musicEnabled = false;
            });
        } catch (e) {
            console.warn("Failed to create menu audio element", e);
            this.musicEnabled = false;
        }
    }

    if (!this.gameTrack) {
        try {
            this.gameTrack = new Audio('./game.mp3');
            this.gameTrack.loop = true;
            this.gameTrack.volume = 0.35;
            this.gameTrack.addEventListener('error', (e) => {
                console.warn("Game music file not found or unsupported. Disabling music.");
                this.musicEnabled = false;
            });
        } catch (e) {
            console.warn("Failed to create game audio element", e);
            this.musicEnabled = false;
        }
    }
  },

  // פונקציה לניגון מוזיקת תפריט
  playMenuMusic: function() {
    this.currentMode = 'menu';
    if (this.isMuted || !this.musicEnabled || !this.menuTrack) return;

    // עצירת מוזיקת משחק אם היא מנגנת
    if (this.gameTrack) {
        this.gameTrack.pause();
        this.gameTrack.currentTime = 0;
    }

    // ניסיון לנגן תפריט
    const playPromise = this.menuTrack.play();
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        // טיפול שקט בשגיאות טעינה או Autoplay
        if (error.name === 'NotSupportedError' || error.message.includes('supported sources')) {
             this.musicEnabled = false;
        } else {
             console.log("Autoplay waiting for interaction");
        }
      });
    }
  },

  // פונקציה לניגון מוזיקת משחק
  playGameMusic: function() {
    this.currentMode = 'game';
    if (this.isMuted || !this.musicEnabled || !this.gameTrack) return;

    // עצירת מוזיקת תפריט אם היא מנגנת
    if (this.menuTrack) {
        this.menuTrack.pause();
        this.menuTrack.currentTime = 0;
    }

    // ניסיון לנגן משחק
    const playPromise = this.gameTrack.play();
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        if (error.name === 'NotSupportedError' || error.message.includes('supported sources')) {
             this.musicEnabled = false;
        } else {
             console.log("Autoplay waiting for interaction");
        }
      });
    }
  },

  // פונקציה כללית לעצירת כל המוזיקה
  stopMusic: function() {
    if (this.menuTrack) {
        this.menuTrack.pause();
        this.menuTrack.currentTime = 0;
    }
    if (this.gameTrack) {
        this.gameTrack.pause();
        this.gameTrack.currentTime = 0;
    }
  },

  // פונקציה שנקראת בלחיצה הראשונה של המשתמש
  resume: function() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(e => console.error("Audio resume failed", e));
    }

    // אם אנחנו לא מושתקים, נסה לנגן את הטרק המתאים למצב הנוכחי
    if (!this.isMuted && this.musicEnabled) {
      if (this.currentMode === 'menu' && this.menuTrack && this.menuTrack.paused) {
        this.menuTrack.play().catch(() => {});
      } else if (this.currentMode === 'game' && this.gameTrack && this.gameTrack.paused) {
        this.gameTrack.play().catch(() => {});
      }
    }
  },

  toggleMute: function() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopMusic();
    } else {
      if (this.currentMode === 'menu') this.playMenuMusic();
      else this.playGameMusic();
    }
    return this.isMuted;
  },

  // --- מכאן והלאה: לוגיקה של אפקטים קוליים (SFX) באמצעות סינתיסייזר ---

  createNoiseBuffer: function() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 1; 
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  },

  playTone: function(freq: number, type: OscillatorType, duration: number, volume: number, decayType: 'exp' | 'lin' = 'exp') {
    if (!this.ctx || this.isMuted || !this.masterGain) return;
    
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(volume, now + 0.02); 
    if (decayType === 'exp') {
      g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    } else {
      g.gain.linearRampToValueAtTime(0, now + duration);
    }
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.1);
    return osc;
  },

  playNoise: function(filterFreq: number, duration: number, volume: number) {
    if (!this.ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, now);
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    source.start(now);
  },

  play: function(type: 'shoot' | 'hit' | 'coin' | 'bomb' | 'explosion' | 'powerup' | 'ui_click' | 'boss_hit') {
    if (!this.ctx || this.isMuted || !this.masterGain) return;
    this.resume(); // מוודא שהקונטקסט ער
    const now = this.ctx.currentTime;

    if (type === 'shoot') {
      const osc = this.playTone(800, 'square', 0.15, 0.08);
      if (osc) osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
      this.playTone(150, 'triangle', 0.1, 0.15);
    } else if (type === 'ui_click') {
      this.playTone(1200, 'sine', 0.05, 0.05);
    } else if (type === 'hit') {
      this.playTone(60, 'sawtooth', 0.3, 0.2, 'lin');
      if (this.noiseBuffer) this.playNoise(200, 0.2, 0.1);
    } else if (type === 'explosion' || type === 'bomb') {
      this.playTone(40, 'sine', 1.2, 0.6, 'lin');
      this.playTone(80, 'triangle', 0.8, 0.4, 'lin');
      if (this.noiseBuffer) {
        const source = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1500, now);
        filter.frequency.exponentialRampToValueAtTime(40, now + 1.0);
        filter.Q.setValueAtTime(10, now);
        source.buffer = this.noiseBuffer;
        g.gain.setValueAtTime(0.5, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        source.connect(filter);
        filter.connect(g);
        g.connect(this.masterGain);
        source.start(now);
      }
    } else if (type === 'coin' || type === 'powerup') {
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'sine', 0.3, 0.08), i * 60);
      });
    } else if (type === 'boss_hit') {
      const osc = this.playTone(300, 'sawtooth', 0.1, 0.15);
      if (osc) osc.frequency.linearRampToValueAtTime(50, now + 0.1);
    }
  }
};
