
import { DICTIONARY, SUGIOT } from '../constants';
import { Word, SugiaModifier } from '../types';
import { Sound } from '../utils/sound';

export interface GameConfig {
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'common' | 'berachot' | 'bava_kamma';
  skin: string;
  location?: string;
  modifier?: SugiaModifier;
  sugiaTitle?: string;
  customDictionary?: Word[];
  /**
   * True only for teacher practice sessions (e.g. via teacher link).
   * Note: `customDictionary` may also be used for dynamic words / filtering,
   * so it must NOT be treated as "teacher mode" by itself.
   */
  isTeacherPractice?: boolean;
}

class Particle {
    x = 0; y = 0; vx = 0; vy = 0; alpha = 0; size = 0; decay = 0; color = ''; active = false;
    init(x: number, y: number, color: string) {
        this.x = x; this.y = y; this.color = color;
        this.vx = (Math.random() - 0.5) * 12;
        this.vy = (Math.random() - 0.5) * 12;
        this.alpha = 1;
        this.size = Math.random() * 3 + 1;
        this.decay = Math.random() * 0.04 + 0.02;
        this.active = true;
    }
    update(dt: number) {
        this.x += this.vx * dt; this.y += this.vy * dt; this.alpha -= this.decay * dt;
        if (this.alpha <= 0) this.active = false;
    }
}

class PoolableProjectile {
    x = 0; y = 0; vx = 0; vy = 0; type = ''; life = 0; angle = 0; active = false;
    targetY = -100; // הגובה אליו הקרן מגיעה
    hasHit = false; // האם כבר פגע במשהו
}

class PoolableEnemy {
    x = 0; y = 0; text = ''; isCorrect = false; radius = 35; speed = 0; rotation = 0; rotationSpeed = 0; active = false;
    baseX = 0; waveOffset = 0;
}

type BossId = 'tannina' | 'koy' | 'shed' | 'ashmedai' | 'agirat' | 'leviathan' | 'ziz';

type BossTextureMode = 'static' | 'sheet';

type BossSheetMeta = {
    // Number of frames in the sheet
    frames: number;
    // Frames per second (game dt is normalized to 60fps, see App.tsx)
    fps: number;
    // Optional grid layout (defaults to a horizontal strip)
    cols?: number;
    rows?: number;
    /**
     * Optional color-key to treat a solid background as transparent.
     * Useful when the sheet has an opaque white background.
     */
    keyColor?: string;
    /** Color distance tolerance (0-255), default ~10 */
    keyTolerance?: number;
};

const BOSS_SEQUENCE: BossId[] = ['tannina', 'koy', 'shed', 'ashmedai', 'agirat', 'leviathan', 'ziz'];

const BOSS_NAMES: Record<BossId, string> = {
    tannina: 'תנינא',
    koy: 'כוי',
    shed: 'שד',
    ashmedai: 'אשמדאי',
    agirat: 'אגירת',
    leviathan: 'לויתן',
    ziz: 'זיז שדי'
};

type BossProjectile = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    owner: BossId;
    radius?: number;
    spin?: number;
    variant?: string;
    tick?: number;
    seed?: number;
};

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  activeDictionary: Word[] = [];
  currentDeck: Word[] = [];
  
  player: { x: number; y: number; width: number; height: number; isHit: boolean; velocityX: number; bankAngle: number };
  
  enemyPool: PoolableEnemy[] = Array.from({length: 30}, () => new PoolableEnemy());
  projectilePool: PoolableProjectile[] = Array.from({length: 120}, () => new PoolableProjectile());
  particlePool: Particle[] = Array.from({length: 500}, () => new Particle());
  jetParticles: {x: number, y: number, vx: number, vy: number, alpha: number, size: number, life: number}[] = [];
  lastJetSpawnFrame: number = 0;

  // --- Ship texture system (5 skins) ---
  shipTextures: Record<string, HTMLImageElement | null> = {};
  shipTextureStatus: Record<string, 'idle' | 'loading' | 'loaded' | 'error'> = {};
  shipEnhancedTextures: Record<string, HTMLCanvasElement | null> = {};
  shipEngineGlowSprites: Record<string, HTMLCanvasElement | null> = {};
  shipAuraSprites: Record<string, HTMLCanvasElement | null> = {};
  bossAuraSprites: Partial<Record<BossId, HTMLCanvasElement>> = {};

  // --- Boss texture system (optional user-provided images in public/bosses) ---
  bossTextures: Partial<Record<BossId, HTMLImageElement | null>> = {};
  bossTextureStatus: Partial<Record<BossId, 'idle' | 'loading' | 'loaded' | 'error'>> = {};
  bossSprites: Partial<Record<BossId, HTMLCanvasElement | null>> = {};
  bossTextureMode: Partial<Record<BossId, BossTextureMode>> = {};
  bossSheetMeta: Partial<Record<BossId, BossSheetMeta>> = {};
  bossSheetCanvas: Partial<Record<BossId, HTMLCanvasElement | null>> = {};
  bossSheetFrameCache: Partial<Record<BossId, Array<{ sx: number; sy: number; sw: number; sh: number; cx: number; cy: number; cw: number; ch: number }> | null>> = {};
  
  // --- Boss cycle: after defeating Ziz, loop bosses from the start with stronger stats ---
  bossCycleMode: boolean = false;
  bossSequenceIndex: number = 0; // next boss in BOSS_SEQUENCE (when bossCycleMode=true)
  bossLoop: number = 0; // 0 = before loop; 1+ = loop difficulty

  bossProjectiles: BossProjectile[] = [];
  bossProjectileSprites: Partial<Record<BossId, HTMLCanvasElement>> = {};
  maxBossProjectiles: number = 220;
  bonuses: any[] = [];
  hazards: any[] = [];
  boss: any = null;
  bossDamageTaken: boolean = false; 

  starLayers: {x: number, y: number, size: number, speed: number, alpha: number}[][] = [[], [], []];
  shakeAmount: number = 0;

  score: number = 0;
  level: number = 1;
  subLevel: number = 1; 
  lives: number = 3;
  combo: number = 0;
  bombs: number;
  shields: number;
  potions: number;

  isPaused: boolean = false;
  playerExploding: boolean = false;
  isTransitioning: boolean = false;
  explosionTimer: number = 0;
  gameFrame: number = 0;
  shieldStrength: number = 0; 
  timeSlowTimer: number = 0;
  weaponType: string = 'normal';
  weaponAmmo: number = 0;
  config: GameConfig;

  onStatsUpdate: (stats: any) => void;
  onGameOver: (score: number) => void;
  onFeedback: (msg: string, isGood: boolean) => void;
  onAchievement: (id: string) => void;
  onUnitComplete: (stats: any) => void;

  constructor(
    canvas: HTMLCanvasElement, 
    config: GameConfig,
    inventory: { bombs: number, shields: number, potions: number },
    callbacks: { onStatsUpdate: any, onGameOver: any, onFeedback: any, onAchievement: any, onUnitComplete: any }
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.width = canvas.width;
    this.height = canvas.height;
    this.config = config;
    this.level = config.modifier ? SUGIOT.find(s => s.modifier === config.modifier)?.requiredLevel || 1 : 1;
    this.subLevel = 1;
    this.bombs = inventory.bombs;
    this.shields = inventory.shields;
    this.potions = inventory.potions;
    this.onStatsUpdate = callbacks.onStatsUpdate;
    this.onGameOver = callbacks.onGameOver;
    this.onFeedback = callbacks.onFeedback;
    this.onAchievement = callbacks.onAchievement;
    this.onUnitComplete = callbacks.onUnitComplete;

    this.applySkinWeapon();

    const isMobile = this.width < 600;
    const pW = isMobile ? 18 : 24;
    const pH = isMobile ? 18 : 24;
    this.player = { x: this.width / 2, y: this.height - (isMobile ? 180 : 150), width: pW, height: pH, isHit: false, velocityX: 0, bankAngle: 0 };
    
    if (config.customDictionary && config.customDictionary.length > 0) {
      this.activeDictionary = config.customDictionary;
    } else {
      this.activeDictionary = DICTIONARY.filter(w => w.cat === config.category);
    }
    
    if (this.activeDictionary.length === 0) this.activeDictionary = [...DICTIONARY];
    
    this.currentDeck = [...this.activeDictionary];

    this.initParallax();
    this.loadShipTextures();
    this.loadBossTextures();
    this.startRound();
  }

  private assetUrl(path: string): string {
    const rawBase = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
    const base = rawBase.replace(/\/$/, ''); // remove trailing slash for consistent joins
    const cleaned = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleaned}`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const raw = hex.trim().replace('#', '');
    if (raw.length === 3) {
      const r = parseInt(raw[0] + raw[0], 16);
      const g = parseInt(raw[1] + raw[1], 16);
      const b = parseInt(raw[2] + raw[2], 16);
      return { r, g, b };
    }
    if (raw.length === 6) {
      const r = parseInt(raw.slice(0, 2), 16);
      const g = parseInt(raw.slice(2, 4), 16);
      const b = parseInt(raw.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }

  private buildEngineGlowSprite(color: string): HTMLCanvasElement {
    const size = 96;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    const rgb = this.hexToRgb(color) || { r: 255, g: 255, b: 255 };
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
    g.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
    g.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    return c;
  }

  private buildAuraSprite(color: string): HTMLCanvasElement {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    const rgb = this.hexToRgb(color) || { r: 96, g: 165, b: 250 };
    const cx = size / 2;
    const cy = size / 2;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';

    // Soft ring base
    const ringOuter = size * 0.48;
    const ringInner = size * 0.30;
    const ring = ctx.createRadialGradient(cx, cy, ringInner, cx, cy, ringOuter);
    ring.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    ring.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
    ring.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
    ring.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, ringOuter, 0, Math.PI * 2);
    ctx.fill();

    // Streaks (so rotation is visible)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const r1 = ringInner + 8 + Math.random() * 18;
      const r2 = ringOuter - 6 - Math.random() * 10;
      const x1 = cx + Math.cos(a) * r1;
      const y1 = cy + Math.sin(a) * r1;
      const x2 = cx + Math.cos(a) * r2;
      const y2 = cy + Math.sin(a) * r2;
      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.08 + Math.random() * 0.10})`;
      ctx.lineWidth = 1 + Math.random() * 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // Small sparkles
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = ringInner + Math.random() * (ringOuter - ringInner);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.04 + Math.random() * 0.10})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + Math.random() * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    return c;
  }

  private buildGoldShipSprite(): HTMLCanvasElement {
    // Procedural, high-quality golden ship built in-code (no external image)
    const h = 420;
    const w = 340;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';

    ctx.translate(w / 2, h / 2);

    // Colors
    const goldBright = '#fff3c4';
    const goldMain = '#fbbf24';
    const goldMid = '#d97706';
    const goldDark = '#78350f';
    const line = 'rgba(255,255,255,0.18)';

    // ===== Hull =====
    const hull = new Path2D();
    hull.moveTo(0, -170);
    hull.bezierCurveTo(44, -135, 62, -55, 52, 75);
    hull.quadraticCurveTo(0, 175, -52, 75);
    hull.bezierCurveTo(-62, -55, -44, -135, 0, -170);
    hull.closePath();

    const hullG = ctx.createLinearGradient(0, -170, 0, 175);
    hullG.addColorStop(0, goldBright);
    hullG.addColorStop(0.18, goldMain);
    hullG.addColorStop(0.55, goldMid);
    hullG.addColorStop(1, goldDark);
    ctx.fillStyle = hullG;
    ctx.fill(hull);

    // Side shading (masked to hull alpha)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const side = ctx.createLinearGradient(-120, 0, 120, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.32)');
    side.addColorStop(0.28, 'rgba(0,0,0,0.00)');
    side.addColorStop(0.72, 'rgba(0,0,0,0.00)');
    side.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = side;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    // Rim highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 3;
    ctx.stroke(hull);

    // ===== Wings (mirror) =====
    const wing = new Path2D();
    wing.moveTo(-44, -35);
    wing.lineTo(-165, 35);
    wing.quadraticCurveTo(-135, 82, -82, 98);
    wing.lineTo(-52, 70);
    wing.quadraticCurveTo(-70, 30, -44, -35);
    wing.closePath();

    const wingG = ctx.createLinearGradient(-170, -20, -40, 110);
    wingG.addColorStop(0, goldDark);
    wingG.addColorStop(0.35, goldMid);
    wingG.addColorStop(1, goldMain);

    const drawWing = () => {
      ctx.fillStyle = wingG;
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.stroke(wing);

      // Panel line
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-120, 55);
      ctx.lineTo(-55, 20);
      ctx.stroke();

      // Neon trim (very subtle)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-150, 40);
      ctx.lineTo(-80, 85);
      ctx.stroke();
      ctx.restore();
    };

    drawWing();
    ctx.save();
    ctx.scale(-1, 1);
    drawWing();
    ctx.restore();

    // ===== Canopy (glass) =====
    const canopy = new Path2D();
    canopy.moveTo(0, -120);
    canopy.bezierCurveTo(22, -108, 22, -70, 0, -56);
    canopy.bezierCurveTo(-22, -70, -22, -108, 0, -120);
    canopy.closePath();
    const glass = ctx.createLinearGradient(0, -120, 0, -52);
    glass.addColorStop(0, 'rgba(56, 189, 248, 0.65)');
    glass.addColorStop(0.5, 'rgba(14, 116, 144, 0.55)');
    glass.addColorStop(1, 'rgba(2, 132, 199, 0.18)');
    ctx.fillStyle = glass;
    ctx.fill(canopy);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke(canopy);

    // Glass highlight
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(-6, -95, 8, 18, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ===== Nose emitter (fits beam weapon) =====
    const emitterY = -155;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const emit = ctx.createRadialGradient(0, emitterY, 0, 0, emitterY, 28);
    emit.addColorStop(0, 'rgba(255,255,255,0.95)');
    emit.addColorStop(0.2, 'rgba(255,240,180,0.8)');
    emit.addColorStop(0.55, 'rgba(251,191,36,0.35)');
    emit.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = emit;
    ctx.beginPath();
    ctx.arc(0, emitterY, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Emitter lens ring
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, emitterY, 10, 0, Math.PI * 2);
    ctx.stroke();

    // ===== Engine pods =====
    const engineY = 120;
    const engine = (x: number) => {
      const shell = ctx.createLinearGradient(x, engineY - 24, x, engineY + 26);
      shell.addColorStop(0, goldDark);
      shell.addColorStop(0.4, goldMid);
      shell.addColorStop(1, goldMain);
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.roundRect(x - 22, engineY - 26, 44, 58, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner nozzle
      const noz = ctx.createRadialGradient(x, engineY + 18, 0, x, engineY + 18, 18);
      noz.addColorStop(0, 'rgba(255,255,255,0.95)');
      noz.addColorStop(0.25, 'rgba(251,191,36,0.7)');
      noz.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = noz;
      ctx.beginPath();
      ctx.arc(x, engineY + 18, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    engine(-28);
    engine(28);

    // ===== Micro detail lines (masked) =====
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -145);
    ctx.lineTo(0, 120);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-26, -20);
    ctx.lineTo(-8, 70);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(26, -20);
    ctx.lineTo(8, 70);
    ctx.stroke();
    ctx.restore();

    // ===== Outer rim glow (masked) =====
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.22;
    const rim = ctx.createRadialGradient(0, -40, 40, 0, -40, 200);
    rim.addColorStop(0, 'rgba(255,255,255,0.35)');
    rim.addColorStop(0.6, 'rgba(255,255,255,0.06)');
    rim.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    return c;
  }

  private buildDefaultShipSprite(): HTMLCanvasElement {
    // Sleek metallic fighter with blue neon accents (procedural)
    const h = 420;
    const w = 340;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);

    const steelLight = '#e2e8f0';
    const steelMain = '#94a3b8';
    const steelMid = '#64748b';
    const steelDark = '#0f172a';
    const accent = '#60a5fa';

    // Hull (angular)
    const hull = new Path2D();
    hull.moveTo(0, -175);
    hull.lineTo(52, -130);
    hull.lineTo(70, -35);
    hull.quadraticCurveTo(62, 130, 0, 175);
    hull.quadraticCurveTo(-62, 130, -70, -35);
    hull.lineTo(-52, -130);
    hull.closePath();

    const hullG = ctx.createLinearGradient(0, -175, 0, 175);
    hullG.addColorStop(0, steelLight);
    hullG.addColorStop(0.22, steelMain);
    hullG.addColorStop(0.62, steelMid);
    hullG.addColorStop(1, steelDark);
    ctx.fillStyle = hullG;
    ctx.fill(hull);

    // Side shading (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const side = ctx.createLinearGradient(-140, 0, 140, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.38)');
    side.addColorStop(0.30, 'rgba(0,0,0,0)');
    side.addColorStop(0.70, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = side;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.stroke(hull);

    // Wings (delta)
    const wing = new Path2D();
    wing.moveTo(-42, -22);
    wing.lineTo(-178, 58);
    wing.quadraticCurveTo(-150, 112, -92, 128);
    wing.lineTo(-52, 74);
    wing.quadraticCurveTo(-70, 28, -42, -22);
    wing.closePath();

    const wingG = ctx.createLinearGradient(-190, -20, -40, 150);
    wingG.addColorStop(0, steelDark);
    wingG.addColorStop(0.45, steelMid);
    wingG.addColorStop(1, steelMain);

    const drawWing = () => {
      ctx.fillStyle = wingG;
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.stroke(wing);

      // Panel lines
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-132, 66);
      ctx.lineTo(-60, 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-150, 82);
      ctx.lineTo(-84, 122);
      ctx.stroke();

      // Neon edge trim
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = 'rgba(96,165,250,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-165, 62);
      ctx.lineTo(-88, 124);
      ctx.stroke();
      ctx.restore();

      // Weapon pod
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-170, 52, 34, 18, 9);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    drawWing();
    ctx.save();
    ctx.scale(-1, 1);
    drawWing();
    ctx.restore();

    // Canopy
    const canopy = new Path2D();
    canopy.moveTo(0, -132);
    canopy.bezierCurveTo(22, -118, 20, -76, 0, -60);
    canopy.bezierCurveTo(-20, -76, -22, -118, 0, -132);
    canopy.closePath();
    const glass = ctx.createLinearGradient(0, -140, 0, -52);
    glass.addColorStop(0, 'rgba(125, 211, 252, 0.70)');
    glass.addColorStop(0.55, 'rgba(14, 116, 144, 0.55)');
    glass.addColorStop(1, 'rgba(2, 132, 199, 0.18)');
    ctx.fillStyle = glass;
    ctx.fill(canopy);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke(canopy);

    // Intake + center spine (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -160);
    ctx.lineTo(0, 140);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(96,165,250,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, -40);
    ctx.lineTo(-6, 88);
    ctx.moveTo(18, -40);
    ctx.lineTo(6, 88);
    ctx.stroke();
    ctx.restore();

    // Engine housings
    const engineY = 125;
    const engine = (x: number) => {
      const shell = ctx.createLinearGradient(x, engineY - 26, x, engineY + 32);
      shell.addColorStop(0, steelDark);
      shell.addColorStop(0.45, steelMid);
      shell.addColorStop(1, steelMain);
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.roundRect(x - 22, engineY - 26, 44, 62, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Nozzle glow (baked lightly)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const noz = ctx.createRadialGradient(x, engineY + 20, 0, x, engineY + 20, 18);
      noz.addColorStop(0, 'rgba(255,255,255,0.95)');
      noz.addColorStop(0.35, 'rgba(96,165,250,0.7)');
      noz.addColorStop(1, 'rgba(96,165,250,0)');
      ctx.fillStyle = noz;
      ctx.beginPath();
      ctx.arc(x, engineY + 20, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    engine(-28);
    engine(28);

    // Subtle rim glow (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.18;
    const rim = ctx.createRadialGradient(0, -40, 50, 0, -40, 210);
    rim.addColorStop(0, 'rgba(255,255,255,0.25)');
    rim.addColorStop(0.6, 'rgba(96,165,250,0.08)');
    rim.addColorStop(1, 'rgba(96,165,250,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    // Tiny nav lights
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-88, 118, 3, 0, Math.PI * 2);
    ctx.arc(88, 118, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    return c;
  }

  private buildButzinaShipSprite(): HTMLCanvasElement {
    // Mystical purple ship with a “holy flame” core
    const h = 420;
    const w = 340;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);

    const pBright = '#f5d0fe';
    const pMain = '#c084fc';
    const pMid = '#a855f7';
    const pDark = '#3b0764';

    // Hull (organic/flame-like)
    const hull = new Path2D();
    hull.moveTo(0, -178);
    hull.bezierCurveTo(66, -120, 82, -30, 46, 98);
    hull.quadraticCurveTo(0, 178, -46, 98);
    hull.bezierCurveTo(-82, -30, -66, -120, 0, -178);
    hull.closePath();

    const hullG = ctx.createLinearGradient(0, -180, 0, 180);
    hullG.addColorStop(0, pBright);
    hullG.addColorStop(0.20, pMain);
    hullG.addColorStop(0.60, pMid);
    hullG.addColorStop(1, pDark);
    ctx.fillStyle = hullG;
    ctx.fill(hull);

    // Side shading (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const side = ctx.createLinearGradient(-150, 0, 150, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.34)');
    side.addColorStop(0.32, 'rgba(0,0,0,0)');
    side.addColorStop(0.68, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = side;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.stroke(hull);

    // Wings (curved “petals”)
    const wing = new Path2D();
    wing.moveTo(-42, -58);
    wing.quadraticCurveTo(-190, -10, -160, 108);
    wing.quadraticCurveTo(-120, 144, -72, 122);
    wing.quadraticCurveTo(-52, 48, -42, -58);
    wing.closePath();

    const wingG = ctx.createLinearGradient(-190, -60, -40, 160);
    wingG.addColorStop(0, pDark);
    wingG.addColorStop(0.5, pMid);
    wingG.addColorStop(1, pMain);

    const drawWing = () => {
      ctx.fillStyle = wingG;
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.stroke(wing);

      // Rune etchings
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-130, 40);
      ctx.lineTo(-76, 10);
      ctx.moveTo(-150, 70);
      ctx.lineTo(-92, 110);
      ctx.stroke();
      ctx.restore();

      // Neon edge
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = 'rgba(192,132,252,0.60)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-170, 35);
      ctx.lineTo(-120, 132);
      ctx.stroke();
      ctx.restore();
    };
    drawWing();
    ctx.save();
    ctx.scale(-1, 1);
    drawWing();
    ctx.restore();

    // Core “holy flame” (glowing energy sphere)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const coreY = -25;
    const core = ctx.createRadialGradient(0, coreY, 0, 0, coreY, 90);
    core.addColorStop(0, 'rgba(255,255,255,0.85)');
    core.addColorStop(0.18, 'rgba(245,208,254,0.65)');
    core.addColorStop(0.45, 'rgba(192,132,252,0.55)');
    core.addColorStop(1, 'rgba(168,85,247,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, coreY, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Canopy (crystal)
    const canopy = new Path2D();
    canopy.moveTo(0, -132);
    canopy.bezierCurveTo(20, -114, 20, -78, 0, -64);
    canopy.bezierCurveTo(-20, -78, -20, -114, 0, -132);
    canopy.closePath();
    const glass = ctx.createLinearGradient(0, -140, 0, -58);
    glass.addColorStop(0, 'rgba(224, 231, 255, 0.70)');
    glass.addColorStop(0.5, 'rgba(147, 51, 234, 0.35)');
    glass.addColorStop(1, 'rgba(30, 41, 59, 0.15)');
    ctx.fillStyle = glass;
    ctx.fill(canopy);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 2;
    ctx.stroke(canopy);

    // Engines (purple plasma)
    const engineY = 132;
    const engine = (x: number) => {
      ctx.fillStyle = pDark;
      ctx.beginPath();
      ctx.roundRect(x - 18, engineY - 22, 36, 54, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const noz = ctx.createRadialGradient(x, engineY + 18, 0, x, engineY + 18, 20);
      noz.addColorStop(0, 'rgba(255,255,255,0.9)');
      noz.addColorStop(0.35, 'rgba(192,132,252,0.7)');
      noz.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = noz;
      ctx.beginPath();
      ctx.arc(x, engineY + 18, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    engine(-26);
    engine(26);

    // Subtle mystical sigil lines (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.3;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 10, -150);
      ctx.quadraticCurveTo(i * 20, -10, i * 8, 150);
      ctx.stroke();
    }
    ctx.restore();

    return c;
  }

  private buildTorahShipSprite(): HTMLCanvasElement {
    // Torah base sprite (scroll only). Live fire is rendered dynamically in `renderShipWithTexture`
    // so it won't look like a static “sticker” or a clipped rectangle.
    const w = 360;
    const h = 440;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);

    const goldMain = '#fbbf24';
    const goldMid = '#d97706';
    const goldDark = '#92400e';
    const parchment1 = '#fff7d6';
    const parchment2 = '#fde68a';
    const parchment3 = '#fcd34d';
    const ink = '#78350f';

    // ===== Scroll rods (Etz Chaim) =====
    const rod = (x: number) => {
      // Wooden cylinder core (more like real Torah rollers)
      const wood = ctx.createLinearGradient(x - 18, 0, x + 18, 0);
      wood.addColorStop(0, '#2b1b10');
      wood.addColorStop(0.2, '#7c4a1b');
      wood.addColorStop(0.5, '#e2c28b');
      wood.addColorStop(0.8, '#7c4a1b');
      wood.addColorStop(1, '#2b1b10');

      ctx.fillStyle = wood;
      ctx.beginPath();
      ctx.roundRect(x - 18, -175, 36, 350, 18);
      ctx.fill();

      // Subtle wood grain (masked)
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const yy = -160 + i * 40;
        ctx.beginPath();
        ctx.moveTo(x - 14, yy);
        ctx.quadraticCurveTo(x, yy + 8, x + 14, yy);
        ctx.stroke();
      }
      ctx.restore();

      // Golden bands (top + bottom)
      const band = (y: number) => {
        const g = ctx.createLinearGradient(x, y, x, y + 44);
        g.addColorStop(0, '#fff3c4');
        g.addColorStop(0.35, goldMain);
        g.addColorStop(0.75, goldMid);
        g.addColorStop(1, goldDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x - 22, y, 44, 44, 18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();
      };
      band(-184);
      band(140);

      // Rimonim (decorations) on top
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rim = ctx.createRadialGradient(x, -196, 0, x, -196, 26);
      rim.addColorStop(0, 'rgba(255,255,255,0.75)');
      rim.addColorStop(0.35, 'rgba(251,191,36,0.45)');
      rim.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(x, -196, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = goldMid;
      ctx.beginPath();
      ctx.arc(x, -196, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(x - 3, -199, 3, 0, Math.PI * 2);
      ctx.fill();

      // Bottom handle tip
      ctx.fillStyle = goldDark;
      ctx.beginPath();
      ctx.roundRect(x - 10, 186, 20, 14, 7);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(x, 193, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    rod(-122);
    rod(122);

    // ===== Parchment body =====
    const bodyW = 220;
    const bodyH = 280;
    const parchment = new Path2D();
    parchment.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 18);

    const pg = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
    pg.addColorStop(0, parchment1);
    pg.addColorStop(0.45, parchment2);
    pg.addColorStop(1, parchment3);
    ctx.fillStyle = pg;
    ctx.fill(parchment);
    ctx.strokeStyle = 'rgba(146, 64, 14, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke(parchment);

    // Rolled edges shading (masked) — makes it feel like a real scroll, not a flat rectangle
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.18;
    const edgeL = ctx.createLinearGradient(-bodyW / 2, 0, -bodyW / 2 + 22, 0);
    edgeL.addColorStop(0, 'rgba(0,0,0,0.35)');
    edgeL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = edgeL;
    ctx.fillRect(-bodyW / 2, -bodyH / 2, 22, bodyH);
    const edgeR = ctx.createLinearGradient(bodyW / 2, 0, bodyW / 2 - 22, 0);
    edgeR.addColorStop(0, 'rgba(0,0,0,0.35)');
    edgeR.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = edgeR;
    ctx.fillRect(bodyW / 2 - 22, -bodyH / 2, 22, bodyH);
    ctx.restore();

    // Inner golden frame (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = goldMid;
    ctx.lineWidth = 4;
    ctx.strokeRect(-bodyW / 2 + 12, -bodyH / 2 + 12, bodyW - 24, bodyH - 24);
    ctx.restore();

    // “Text” columns (ink) — a bit denser for authenticity
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ink;
    const colX = [-48, 0, 48];
    for (let col = 0; col < colX.length; col++) {
      for (let i = 0; i < 18; i++) {
        const y = -105 + i * 12;
        const len = 28 + ((i + col) % 4) * 8;
        ctx.fillRect(colX[col] - len / 2, y, len, 2);
      }
    }
    ctx.restore();

    // Crown seal at top center
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const seal = ctx.createRadialGradient(0, -170, 0, 0, -170, 42);
    seal.addColorStop(0, 'rgba(255,255,255,0.85)');
    seal.addColorStop(0.2, 'rgba(251,191,36,0.65)');
    seal.addColorStop(0.55, 'rgba(249,115,22,0.28)');
    seal.addColorStop(1, 'rgba(249,115,22,0)');
    ctx.fillStyle = seal;
    ctx.beginPath();
    ctx.arc(0, -170, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Overall glow around the scroll (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.18;
    const rim = ctx.createRadialGradient(0, -20, 40, 0, -20, 240);
    rim.addColorStop(0, 'rgba(255,255,255,0.18)');
    rim.addColorStop(0.5, 'rgba(251,191,36,0.10)');
    rim.addColorStop(1, 'rgba(249,115,22,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    return c;
  }

  private buildChoshenShipSprite(): HTMLCanvasElement {
    // High Priest Choshen: gold frame + 3 rows of 4 diamond-like gemstones (no spaceship body)
    const w = 420;
    const h = 340;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);

    const goldMain = '#fbbf24';
    const goldMid = '#d97706';
    const goldDark = '#92400e';
    const fabricDark = '#0b1226';
    const fabricMid = '#111827';

    const plateW = 330;
    const plateH = 260;
    const plateR = 28;

    // Outer golden plate
    const plate = new Path2D();
    plate.roundRect(-plateW / 2, -plateH / 2, plateW, plateH, plateR);

    const frameG = ctx.createLinearGradient(0, -plateH / 2, 0, plateH / 2);
    frameG.addColorStop(0, '#fff3c4');
    frameG.addColorStop(0.25, goldMain);
    frameG.addColorStop(0.68, goldMid);
    frameG.addColorStop(1, goldDark);
    ctx.fillStyle = frameG;
    ctx.fill(plate);

    // Inner bevel
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 8;
    ctx.strokeRect(-plateW / 2 + 10, -plateH / 2 + 10, plateW - 20, plateH - 20);
    ctx.restore();

    // Border outline
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    ctx.stroke(plate);

    // Inner fabric panel (masked)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const inner = new Path2D();
    inner.roundRect(-plateW / 2 + 18, -plateH / 2 + 18, plateW - 36, plateH - 36, 22);
    const fabricG = ctx.createLinearGradient(0, -plateH / 2, 0, plateH / 2);
    fabricG.addColorStop(0, fabricMid);
    fabricG.addColorStop(1, fabricDark);
    ctx.fillStyle = fabricG;
    ctx.fill(inner);
    ctx.restore();

    // Top loops for chains (gold rings)
    const ring = (x: number) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      const g = ctx.createRadialGradient(x, -plateH / 2 + 20, 0, x, -plateH / 2 + 20, 22);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.35, 'rgba(251,191,36,0.35)');
      g.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, -plateH / 2 + 20, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = goldMid;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, -plateH / 2 + 20, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, -plateH / 2 + 20, 12, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(-plateW * 0.28);
    ring(plateW * 0.28);

    // Gem grid: 4 rows × 3 columns (12 stones) — like the High Priest's Choshen
    type GemSpec =
      | { kind: 'solid'; color: string }
      | { kind: 'tri' }                     // red / green / white-black
      | { kind: 'rainbow' }                 // all colors mixed
      | { kind: 'turquoiseMix' }            // teal + turquoise blend
      | { kind: 'crystal' }                 // white / transparent
      | { kind: 'midnight' }                // dark blue / almost black
      | { kind: 'oliveGold' }               // olive oil gold-green
      | { kind: 'deepBlack' };              // deep black

    const gems: GemSpec[] = [
      // Row 1 (top)
      { kind: 'solid', color: '#ef4444' },          // red
      { kind: 'solid', color: '#a3e635' },          // green / yellow-green
      { kind: 'tri' },                              // colorful: 1/3 red, 1/3 green, 1/3 white/black

      // Row 2
      { kind: 'solid', color: '#7dd3fc' },          // sky blue
      { kind: 'midnight' },                         // night blue / black-blue
      { kind: 'crystal' },                          // white / transparent (silver-like)

      // Row 3
      { kind: 'solid', color: '#1d4ed8' },          // sapphire deep blue
      { kind: 'turquoiseMix' },                     // turquoise mixed
      { kind: 'solid', color: '#a855f7' },          // purple

      // Row 4 (bottom)
      { kind: 'oliveGold' },                        // olive oil gold-green
      { kind: 'deepBlack' },                        // deep black
      { kind: 'rainbow' }                           // all colors mixed
    ];

    const cols = 3;
    const rows = 4;
    const cellX = 108;
    const cellY = 64;
    const startX = -((cols - 1) * cellX) / 2;
    const startY = -((rows - 1) * cellY) / 2;

    const drawDiamondGem = (x: number, y: number, s: number, spec: GemSpec, seed: number) => {
      const diamond = new Path2D();
      diamond.moveTo(x, y - s);
      diamond.lineTo(x + s, y);
      diamond.lineTo(x, y + s);
      diamond.lineTo(x - s, y);
      diamond.closePath();

      const gemBaseColor =
        spec.kind === 'solid' ? spec.color :
        spec.kind === 'turquoiseMix' ? '#22d3ee' :
        spec.kind === 'oliveGold' ? '#a3a635' :
        spec.kind === 'midnight' ? '#1e3a8a' :
        spec.kind === 'deepBlack' ? '#0f172a' :
        spec.kind === 'crystal' ? '#e2e8f0' :
        spec.kind === 'tri' ? '#ffffff' :
        '#ffffff'; // rainbow default

      // Soft shadow for depth
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill(diamond);
      ctx.restore();

      // Colored glow (makes the stone color dominant even from far away)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.20;
      ctx.shadowBlur = 22;
      ctx.shadowColor = gemBaseColor;
      ctx.fillStyle = gemBaseColor;
      ctx.fill(diamond);
      ctx.restore();

      // Gem body fill (varies per stone)
      ctx.save();
      ctx.clip(diamond);

      const fillSolid = (color: string) => {
        const g = ctx.createRadialGradient(x - s * 0.28, y - s * 0.32, 2, x, y, s * 1.25);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.22, color);
        g.addColorStop(0.65, color);
        g.addColorStop(1, 'rgba(0,0,0,0.85)');
        ctx.fillStyle = g;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
      };

      if (spec.kind === 'solid') {
        fillSolid(spec.color);
      } else if (spec.kind === 'tri') {
        // 1/3 red, 1/3 green, 1/3 white-black (striped)
        const bandW = (s * 2) / 3;
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x - s - 2, y - s - 2, bandW + 2, (s + 2) * 2);
        ctx.fillStyle = '#a3e635';
        ctx.fillRect(x - s + bandW - 1, y - s - 2, bandW + 2, (s + 2) * 2);
        const mono = ctx.createLinearGradient(x - s + bandW * 2, y - s, x + s, y + s);
        mono.addColorStop(0, 'rgba(255,255,255,0.95)');
        mono.addColorStop(0.5, 'rgba(0,0,0,0.95)');
        mono.addColorStop(1, 'rgba(255,255,255,0.65)');
        ctx.fillStyle = mono;
        ctx.fillRect(x - s + bandW * 2 - 1, y - s - 2, bandW + 3, (s + 2) * 2);

        // Add a glassy highlight on top
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.22;
        const hi = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
        hi.addColorStop(0, 'rgba(255,255,255,0.75)');
        hi.addColorStop(0.35, 'rgba(255,255,255,0.15)');
        hi.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hi;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
      } else if (spec.kind === 'rainbow') {
        const rG = ctx.createLinearGradient(x - s, y + s, x + s, y - s);
        rG.addColorStop(0.00, '#ef4444');
        rG.addColorStop(0.15, '#f97316');
        rG.addColorStop(0.30, '#eab308');
        rG.addColorStop(0.45, '#22c55e');
        rG.addColorStop(0.60, '#06b6d4');
        rG.addColorStop(0.75, '#3b82f6');
        rG.addColorStop(0.90, '#a855f7');
        rG.addColorStop(1.00, '#ec4899');
        ctx.fillStyle = rG;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);

        // Prismatic “sparkle film”
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.16;
        const film = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
        film.addColorStop(0, 'rgba(255,255,255,0)');
        film.addColorStop(0.5, 'rgba(255,255,255,0.55)');
        film.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = film;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
        ctx.globalAlpha = 1;
      } else if (spec.kind === 'turquoiseMix') {
        const tG = ctx.createLinearGradient(x - s, y + s, x + s, y - s);
        tG.addColorStop(0, '#14b8a6');
        tG.addColorStop(0.35, '#22d3ee');
        tG.addColorStop(0.7, '#0ea5e9');
        tG.addColorStop(1, '#22c55e');
        ctx.fillStyle = tG;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);

        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.16;
        const hi = ctx.createRadialGradient(x - s * 0.25, y - s * 0.35, 2, x, y, s * 1.25);
        hi.addColorStop(0, 'rgba(255,255,255,0.65)');
        hi.addColorStop(0.35, 'rgba(255,255,255,0.10)');
        hi.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hi;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
      } else if (spec.kind === 'crystal') {
        const cG = ctx.createRadialGradient(x - s * 0.25, y - s * 0.35, 2, x, y, s * 1.35);
        cG.addColorStop(0, 'rgba(255,255,255,0.95)');
        cG.addColorStop(0.18, 'rgba(241,245,249,0.70)');
        cG.addColorStop(0.5, 'rgba(148,163,184,0.22)');
        cG.addColorStop(1, 'rgba(148,163,184,0)');
        ctx.fillStyle = cG;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);

        // Frost edge tint
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = 'rgba(125,211,252,0.35)';
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 0.45);
      } else if (spec.kind === 'midnight') {
        const mG = ctx.createRadialGradient(x - s * 0.25, y - s * 0.35, 2, x, y, s * 1.35);
        mG.addColorStop(0, 'rgba(255,255,255,0.25)');
        mG.addColorStop(0.18, 'rgba(37,99,235,0.22)');
        mG.addColorStop(0.55, 'rgba(15,23,42,0.95)');
        mG.addColorStop(1, 'rgba(2,6,23,1)');
        ctx.fillStyle = mG;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
      } else if (spec.kind === 'oliveGold') {
        const oG = ctx.createLinearGradient(x - s, y + s, x + s, y - s);
        oG.addColorStop(0, '#6b7c2a');
        oG.addColorStop(0.35, '#a3a635');
        oG.addColorStop(0.7, '#fbbf24');
        oG.addColorStop(1, '#d97706');
        ctx.fillStyle = oG;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.14;
        const hi = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
        hi.addColorStop(0, 'rgba(255,255,255,0.6)');
        hi.addColorStop(0.4, 'rgba(255,255,255,0.10)');
        hi.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hi;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
      } else if (spec.kind === 'deepBlack') {
        const bG = ctx.createRadialGradient(x - s * 0.25, y - s * 0.35, 2, x, y, s * 1.35);
        bG.addColorStop(0, 'rgba(255,255,255,0.22)');
        bG.addColorStop(0.25, 'rgba(30,41,59,0.95)');
        bG.addColorStop(1, 'rgba(2,6,23,1)');
        ctx.fillStyle = bG;
        ctx.fillRect(x - s - 2, y - s - 2, (s + 2) * 2, (s + 2) * 2);
      }

      ctx.restore();

      // Facet lines (cross + diagonals)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
      ctx.moveTo(x - s, y);
      ctx.lineTo(x + s, y);
      ctx.moveTo(x - s * 0.65, y - s * 0.15);
      ctx.lineTo(x + s * 0.15, y + s * 0.65);
      ctx.moveTo(x - s * 0.15, y - s * 0.65);
      ctx.lineTo(x + s * 0.65, y + s * 0.15);
      ctx.stroke();
      ctx.restore();

      // Thin gold bezel outline (keeps gems separated without tinting them)
      ctx.save();
      ctx.globalAlpha = 0.40;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.stroke(diamond);
      ctx.restore();

      // Tiny sparkle highlight (randomized per gem for variety)
      const sx = x - s * (0.25 + (seed % 3) * 0.05);
      const sy = y - s * (0.35 + (seed % 2) * 0.08);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy);
      ctx.lineTo(sx + 5, sy);
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx, sy + 5);
      ctx.stroke();
      ctx.restore();
    };

    let gemSeed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c2 = 0; c2 < cols; c2++) {
        const idx = r * cols + c2;
        const x = startX + c2 * cellX;
        const y = startY + r * cellY;
        const spec = gems[idx] || { kind: 'solid', color: '#fbbf24' };
        drawDiamondGem(x, y, 24, spec, gemSeed++);
      }
    }

    // Divine gold shimmer (masked) — keep subtle so it won't tint the gemstones
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.10;
    const rim = ctx.createRadialGradient(0, 0, 60, 0, 0, 240);
    rim.addColorStop(0, 'rgba(255,255,255,0.10)');
    rim.addColorStop(0.55, 'rgba(255,255,255,0.06)');
    rim.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    return c;
  }

  private buildEnhancedShipSprite(skin: string, img: HTMLImageElement): HTMLCanvasElement {
    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const aspect = srcW / Math.max(1, srcH);

    // High-res cached sprite for crisp scaling (cheap per-frame drawImage)
    const targetH = 384;
    const targetW = Math.max(1, Math.round(targetH * aspect));

    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';

    // Base image
    ctx.drawImage(img, 0, 0, targetW, targetH);

    // IMPORTANT: Mask all post-effects to the ship alpha so we never paint a rectangle around it.

    // Directional highlight sheen (masked to ship alpha)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = skin === 'skin_gold' ? 0.18 : 0.14;
    const sheen = ctx.createLinearGradient(-targetW * 0.15, 0, targetW * 0.85, targetH);
    sheen.addColorStop(0, 'rgba(255,255,255,0.9)');
    sheen.addColorStop(0.35, 'rgba(255,255,255,0.15)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.restore();

    // Subtle vignette for depth (masked to ship alpha)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.18;
    const vig = ctx.createRadialGradient(targetW / 2, targetH / 2, targetH * 0.12, targetW / 2, targetH / 2, targetH * 0.7);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.restore();

    return c;
  }

  private getSourceSize(source: CanvasImageSource): { w: number; h: number } {
    if (source instanceof HTMLImageElement) {
      return { w: source.naturalWidth || source.width || 1, h: source.naturalHeight || source.height || 1 };
    }
    if (source instanceof HTMLCanvasElement) {
      return { w: source.width || 1, h: source.height || 1 };
    }
    const s = source as any;
    return { w: s?.width || 1, h: s?.height || 1 };
  }

  private isLikelyTransparentSprite(img: HTMLImageElement): boolean {
    // Guard: if we can't read pixels, assume it's OK (same-origin images should be readable)
    try {
      const c = document.createElement('canvas');
      const size = 64;
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
      if (!ctx) return true;

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      const total = size * size;
      let nonOpaque = 0;

      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) nonOpaque++;
      }

      // If essentially fully opaque, it will look like a rectangle in-game.
      // We allow a tiny number of non-opaque pixels for resampling noise.
      return nonOpaque > Math.max(16, total * 0.003);
    } catch {
      return true;
    }
  }

  private loadShipTextureWithFallback(skin: string, candidates: string[]) {
    this.shipTextureStatus[skin] = 'loading';

    const tryLoad = (idx: number) => {
      const img = new Image();
      img.decoding = 'async';
      let handled = false;

      const handleLoad = () => {
        if (handled) return;
        handled = true;
        // Prevent “rectangle around the ship” if the asset has no transparency (e.g., full scene image)
        if (!this.isLikelyTransparentSprite(img)) {
          console.warn(`[ships] Ignoring ${candidates[idx]} for ${skin}: image has no transparency (use a PNG with transparent background).`);
          if (idx + 1 < candidates.length) {
            tryLoad(idx + 1);
            return;
          }
          this.shipTextures[skin] = null;
          this.shipTextureStatus[skin] = 'error';
          this.shipEnhancedTextures[skin] = null;
          this.shipEngineGlowSprites[skin] = null;
          this.shipAuraSprites[skin] = null;
          return;
        }

        this.shipTextures[skin] = img;
        this.shipTextureStatus[skin] = 'loaded';

        // Build cached “premium” sprites once (fast in-game rendering)
        this.shipEnhancedTextures[skin] = this.buildEnhancedShipSprite(skin, img);
        this.shipEngineGlowSprites[skin] = this.buildEngineGlowSprite(this.getShipGlowColor(skin));
        this.shipAuraSprites[skin] = this.buildAuraSprite(this.getShipGlowColor(skin));
      };

      const handleError = () => {
        if (handled) return;
        handled = true;
        if (idx + 1 < candidates.length) {
          tryLoad(idx + 1);
          return;
        }
        this.shipTextures[skin] = null;
        this.shipTextureStatus[skin] = 'error';
        this.shipEnhancedTextures[skin] = null;
        this.shipEngineGlowSprites[skin] = null;
        this.shipAuraSprites[skin] = null;
      };

      img.onload = handleLoad;
      img.onerror = handleError;
      img.src = this.assetUrl(candidates[idx]);

      // If the image is already cached, `onload` may not fire in time for the first frame.
      // Force-handle immediately to prevent a one-frame fallback/flicker.
      if (img.complete) {
        if (img.naturalWidth > 0) handleLoad();
        else handleError();
      }
    };

    tryLoad(0);
  }

  loadShipTextures() {
    // Hybrid setup:
    // - Keep Torah + Choshen as procedural (as requested)
    // - Default/Gold/Butzina are loaded from user-provided images in public/ships (so replacing files updates the in-game ships)

    // Procedural (kept as-is)
    const proceduralBuilders: Record<string, () => HTMLCanvasElement> = {
      skin_torah: () => this.buildTorahShipSprite(),
      skin_choshen: () => this.buildChoshenShipSprite()
    };

    Object.entries(proceduralBuilders).forEach(([skin, builder]) => {
      this.shipTextures[skin] = null;
      this.shipTextureStatus[skin] = 'loaded';
      this.shipEnhancedTextures[skin] = builder();
      this.shipEngineGlowSprites[skin] = this.buildEngineGlowSprite(this.getShipGlowColor(skin));
      this.shipAuraSprites[skin] = this.buildAuraSprite(this.getShipGlowColor(skin));
    });

    // Image-based (replace these files to change ships in-game)
    const imageCandidates: Record<string, string[]> = {
      skin_default: ['ships/skin_default.png', 'ships/default.png'],
      skin_gold: ['ships/skin_gold.png', 'ships/gold.png'],
      skin_butzina: ['ships/skin_butzina.png', 'ships/butzina.png']
    };

    Object.entries(imageCandidates).forEach(([skin, candidates]) => {
      this.shipTextures[skin] = null;
      this.shipTextureStatus[skin] = 'idle';
      this.shipEnhancedTextures[skin] = null;
      this.shipEngineGlowSprites[skin] = null;
      this.shipAuraSprites[skin] = null;
      this.loadShipTextureWithFallback(skin, candidates);
    });
  }

  // ============================
  // Boss texture system (images)
  // ============================

  private isBossSheetCandidate(path: string): boolean {
    return path.includes('_sheet');
  }

  private inferBossSheetMeta(img: HTMLImageElement): BossSheetMeta {
    // Default assumptions:
    // - horizontal strip
    // - 4 frames (or 5 if width divides nicely and looks reasonable)
    // - ~8fps at 60fps base tick
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;

    for (const frames of [5, 4]) {
      if (frames > 1 && w % frames === 0) {
        const fw = w / frames;
        const aspect = fw / h;
        if (aspect > 0.45 && aspect < 3.2) return { frames, fps: 8 };
      }
    }
    return { frames: 4, fps: 8 };
  }

  private async loadBossSheetMeta(id: BossId) {
    try {
      const res = await fetch(this.assetUrl(`bosses/${id}_sheet.json`));
      if (!res.ok) return;
      const data: any = await res.json();

      const current = this.bossSheetMeta[id];
      const framesRaw = typeof data.frames === 'number' ? data.frames : current?.frames;
      const fpsRaw = typeof data.fps === 'number' ? data.fps : current?.fps;
      const colsRaw = typeof data.cols === 'number' ? data.cols : undefined;
      const rowsRaw = typeof data.rows === 'number' ? data.rows : undefined;
      const keyColorRaw = typeof data.keyColor === 'string' ? data.keyColor : current?.keyColor;
      const keyToleranceRaw = typeof data.keyTolerance === 'number' ? data.keyTolerance : current?.keyTolerance;

      const frames = Math.max(1, Math.min(60, Math.floor(framesRaw || 4)));
      const fps = Math.max(1, Math.min(60, Number(fpsRaw || 8)));

      const meta: BossSheetMeta = { frames, fps };
      if (Number.isFinite(colsRaw)) meta.cols = Math.max(1, Math.floor(colsRaw));
      if (Number.isFinite(rowsRaw)) meta.rows = Math.max(1, Math.floor(rowsRaw));
      if (typeof keyColorRaw === 'string' && keyColorRaw.trim()) meta.keyColor = keyColorRaw.trim();
      if (typeof keyToleranceRaw === 'number' && Number.isFinite(keyToleranceRaw)) meta.keyTolerance = Math.max(0, Math.min(255, keyToleranceRaw));

      this.bossSheetMeta[id] = meta;

      if ((import.meta as any).env?.DEV) {
        console.info(`[bosses] Loaded bosses/${id}_sheet.json meta`, meta);
      }

      // Meta might change frames/grid/keying; rebuild cached crop rects
      if (this.bossTextureMode[id] === 'sheet') {
        this.rebuildBossSheetFrameCache(id);
      }
    } catch {
      // No meta file / invalid JSON — ignore and keep inferred defaults
    }
  }

  private rebuildBossSheetFrameCache(id: BossId) {
    const img = this.bossTextures[id];
    if (!img || !img.complete || img.naturalWidth <= 0) return;

    const meta = this.bossSheetMeta[id] || this.inferBossSheetMeta(img);
    const frames = Math.max(1, Math.min(60, Math.floor(meta.frames || 4)));

    // Decide whether we need color-keying (usually only if the sheet is fully opaque)
    const hasAlpha = this.isLikelyTransparentSprite(img);
    const wantsKey = typeof meta.keyColor === 'string' && meta.keyColor.trim().length > 0;
    const needsKeying = wantsKey || !hasAlpha;

    // Build (or clear) the processed sheet canvas
    let sheetCanvas: HTMLCanvasElement | null = null;
    if (needsKeying) {
      const w = img.naturalWidth || img.width || 1;
      const h = img.naturalHeight || img.height || 1;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);

        try {
          const imageData = ctx.getImageData(0, 0, w, h);
          const data = imageData.data;

          // Key color: meta.keyColor OR the most likely corner background color
          let key = wantsKey ? (this.hexToRgb(meta.keyColor!.trim()) || { r: 255, g: 255, b: 255 }) : { r: 255, g: 255, b: 255 };
          if (!wantsKey) {
            const get = (x: number, y: number) => {
              const i = (y * w + x) * 4;
              return { r: data[i], g: data[i + 1], b: data[i + 2] };
            };
            const tl = get(0, 0);
            const tr = get(w - 1, 0);
            const bl = get(0, h - 1);
            const br = get(w - 1, h - 1);
            // Pick the most common exact RGB among corners; fallback to top-left
            const corners = [tl, tr, bl, br];
            let best = tl;
            let bestCount = 0;
            for (let i = 0; i < corners.length; i++) {
              let count = 0;
              for (let j = 0; j < corners.length; j++) {
                if (corners[i].r === corners[j].r && corners[i].g === corners[j].g && corners[i].b === corners[j].b) count++;
              }
              if (count > bestCount) { bestCount = count; best = corners[i]; }
            }
            key = best;
          }

          const tol = typeof meta.keyTolerance === 'number' ? Math.max(0, Math.min(255, meta.keyTolerance)) : 10;
          // Use max-channel distance for cheap comparisons
          const within = (r: number, g: number, b: number) =>
            Math.max(Math.abs(r - key.r), Math.abs(g - key.g), Math.abs(b - key.b)) <= tol;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (within(r, g, b)) data[i + 3] = 0;
          }
          ctx.putImageData(imageData, 0, 0);
          sheetCanvas = c;
        } catch {
          // If we can't read pixels, fall back to drawing the original (may show a rectangle)
          sheetCanvas = c;
        }
      }
    }

    this.bossSheetCanvas[id] = sheetCanvas;

    const source: CanvasImageSource = sheetCanvas || img;
    const srcW = sheetCanvas ? sheetCanvas.width : (img.naturalWidth || img.width || 1);
    const srcH = sheetCanvas ? sheetCanvas.height : (img.naturalHeight || img.height || 1);

    let cols = meta.cols && meta.cols > 1 ? Math.floor(meta.cols) : 0;
    if (cols > 1 && cols < frames) cols = cols; // ok
    const rows = cols > 1 ? (meta.rows && meta.rows > 0 ? Math.floor(meta.rows) : Math.ceil(frames / cols)) : 1;

    const frameW = cols > 1 ? Math.floor(srcW / cols) : Math.floor(srcW / frames);
    const frameH = cols > 1 ? Math.floor(srcH / rows) : srcH;
    if (frameW <= 0 || frameH <= 0) return;

    // Build per-frame crop rects (to remove large transparent padding)
    const tmp = document.createElement('canvas');
    tmp.width = frameW;
    tmp.height = frameH;
    const tctx = tmp.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!tctx) return;

    const cache: Array<{ sx: number; sy: number; sw: number; sh: number; cx: number; cy: number; cw: number; ch: number }> = [];
    for (let i = 0; i < frames; i++) {
      const sx = cols > 1 ? (i % cols) * frameW : i * frameW;
      const sy = cols > 1 ? Math.floor(i / cols) * frameH : 0;

      let cx = 0, cy = 0, cw = frameW, ch = frameH;
      try {
        tctx.clearRect(0, 0, frameW, frameH);
        tctx.drawImage(source as any, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
        const data = tctx.getImageData(0, 0, frameW, frameH).data;

        const alphaMin = 10;
        let minX = frameW, minY = frameH, maxX = -1, maxY = -1;
        for (let p = 3, px = 0; p < data.length; p += 4, px++) {
          const a = data[p];
          if (a <= alphaMin) continue;
          const x = px % frameW;
          const y = (px / frameW) | 0;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        if (maxX >= minX && maxY >= minY) {
          cx = minX;
          cy = minY;
          cw = Math.max(1, (maxX - minX + 1));
          ch = Math.max(1, (maxY - minY + 1));
        }
      } catch {
        // If we can't read pixels, use full frame rect
      }

      cache.push({ sx, sy, sw: frameW, sh: frameH, cx, cy, cw, ch });
    }

    this.bossSheetFrameCache[id] = cache;

    if ((import.meta as any).env?.DEV) {
      console.info(`[bosses] Rebuilt sheet cache for ${id}: frames=${frames}, frame=${frameW}x${frameH}, keyed=${needsKeying}`);
    }
  }

  private getBossTextureDrawBox(id: BossId): { w: number; h: number; offsetY: number } {
    // Tuned to roughly match the procedural bosses' footprint (before the mobile 0.75 scale in drawBoss()).
    // offsetY shifts the image down a bit so the boss "sits" similarly to the procedural art.
    if (id === 'ziz') return { w: 560, h: 420, offsetY: 30 };
    return { w: 520, h: 420, offsetY: 30 };
  }

  private buildBossSprite(id: BossId, img: HTMLImageElement): HTMLCanvasElement {
    const box = this.getBossTextureDrawBox(id);
    const c = document.createElement('canvas');
    c.width = box.w;
    c.height = box.h;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';

    ctx.clearRect(0, 0, c.width, c.height);

    // Fit the image inside the boss box while preserving aspect ratio (contain)
    const pad = Math.round(Math.min(c.width, c.height) * 0.05);
    const availW = Math.max(1, c.width - pad * 2);
    const availH = Math.max(1, c.height - pad * 2);

    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const scale = Math.min(availW / srcW, availH / srcH);

    const w = srcW * scale;
    const h = srcH * scale;
    const dx = (c.width - w) / 2;
    const dy = (c.height - h) / 2;

    // Subtle baked shadow to integrate better with the VFX layer (cheap at runtime)
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.drawImage(img, dx, dy, w, h);
    ctx.restore();

    return c;
  }

  private loadBossTextureWithFallback(id: BossId, candidates: string[]) {
    this.bossTextureStatus[id] = 'loading';

    const tryLoad = (idx: number) => {
      const img = new Image();
      img.decoding = 'async';

      img.onload = () => {
        const candidatePath = candidates[idx];
        const mode: BossTextureMode = this.isBossSheetCandidate(candidatePath) ? 'sheet' : 'static';
        const hasAlpha = this.isLikelyTransparentSprite(img);

        // Prevent “rectangle around the boss” for static images (but allow opaque sprite sheets + color keying).
        if (mode !== 'sheet' && !hasAlpha) {
          console.warn(`[bosses] Ignoring ${candidates[idx]} for ${id}: image has no transparency (use a PNG/WebP with transparent background).`);
          if (idx + 1 < candidates.length) {
            tryLoad(idx + 1);
            return;
          }
          this.bossTextures[id] = null;
          this.bossTextureStatus[id] = 'error';
          this.bossTextureMode[id] = 'static';
          this.bossSprites[id] = null;
          this.bossSheetMeta[id] = undefined;
          this.bossSheetCanvas[id] = null;
          this.bossSheetFrameCache[id] = null;
          return;
        }

        this.bossTextureMode[id] = mode;

        this.bossTextures[id] = img;
        this.bossTextureStatus[id] = 'loaded';

        if (mode === 'sheet') {
          this.bossSprites[id] = null;
          this.bossSheetMeta[id] = this.inferBossSheetMeta(img);
          // Build crop cache now (may rebuild after meta loads). Also handles opaque sheets via keyColor/meta.
          this.rebuildBossSheetFrameCache(id);
          void this.loadBossSheetMeta(id);
        } else {
          this.bossSheetMeta[id] = undefined;
          this.bossSheetCanvas[id] = null;
          this.bossSheetFrameCache[id] = null;
          this.bossSprites[id] = this.buildBossSprite(id, img);
        }

        // Dev-only: show which boss asset actually loaded (helps debug naming / caching issues)
        if ((import.meta as any).env?.DEV) {
          const meta = this.bossSheetMeta[id];
          if (mode === 'sheet' && meta) {
            console.info(`[bosses] Loaded ${candidatePath} for ${id} (sheet: frames=${meta.frames}, fps=${meta.fps}, cols=${meta.cols ?? 0}, rows=${meta.rows ?? 0}, alpha=${hasAlpha})`);
          } else {
            console.info(`[bosses] Loaded ${candidatePath} for ${id} (static)`);
          }
        }
      };

      img.onerror = () => {
        if ((import.meta as any).env?.DEV) {
          console.info(`[bosses] Failed to load ${candidates[idx]} for ${id}`);
        }
        if (idx + 1 < candidates.length) {
          tryLoad(idx + 1);
          return;
        }
        this.bossTextures[id] = null;
        this.bossTextureStatus[id] = 'error';
        this.bossTextureMode[id] = 'static';
        this.bossSprites[id] = null;
        this.bossSheetMeta[id] = undefined;
        this.bossSheetCanvas[id] = null;
        this.bossSheetFrameCache[id] = null;
      };

      img.src = this.assetUrl(candidates[idx]);
    };

    tryLoad(0);
  }

  loadBossTextures() {
    // Image-based (replace these files to change bosses in-game).
    // If a boss image is missing, we fall back to the procedural boss rendering.
    const imageCandidates: Record<BossId, string[]> = {
      tannina: [
        'bosses/tannina_sheet.webp', 'bosses/tannina_sheet.png',
        'bosses/tannina.webp', 'bosses/tannina.png', 'bosses/boss_tannina.png', 'bosses/skin_tannina.png'
      ],
      koy: [
        'bosses/koy_sheet.webp', 'bosses/koy_sheet.png',
        'bosses/koy.webp', 'bosses/koy.png', 'bosses/boss_koy.png', 'bosses/skin_koy.png'
      ],
      shed: [
        'bosses/shed_sheet.webp', 'bosses/shed_sheet.png',
        'bosses/shed.webp', 'bosses/shed.png', 'bosses/boss_shed.png', 'bosses/skin_shed.png'
      ],
      ashmedai: [
        'bosses/ashmedai_sheet.webp', 'bosses/ashmedai_sheet.png',
        'bosses/ashmedai.webp', 'bosses/ashmedai.png', 'bosses/boss_ashmedai.png', 'bosses/skin_ashmedai.png'
      ],
      agirat: [
        'bosses/agirat_sheet.webp', 'bosses/agirat_sheet.png',
        'bosses/agirat.webp', 'bosses/agirat.png', 'bosses/boss_agirat.png', 'bosses/skin_agirat.png'
      ],
      leviathan: [
        'bosses/leviathan_sheet.webp', 'bosses/leviathan_sheet.png',
        'bosses/leviathan.webp', 'bosses/leviathan.png', 'bosses/boss_leviathan.png', 'bosses/skin_leviathan.png'
      ],
      ziz: [
        'bosses/ziz_sheet.webp', 'bosses/ziz_sheet.png',
        'bosses/ziz.webp', 'bosses/ziz.png', 'bosses/boss_ziz.png', 'bosses/skin_ziz.png'
      ]
    };

    (Object.keys(imageCandidates) as BossId[]).forEach((id) => {
      this.bossTextures[id] = null;
      this.bossTextureStatus[id] = 'idle';
      this.bossSprites[id] = null;
      this.bossTextureMode[id] = 'static';
      this.bossSheetMeta[id] = undefined;
      this.bossSheetCanvas[id] = null;
      this.bossSheetFrameCache[id] = null;
      this.loadBossTextureWithFallback(id, imageCandidates[id]);
    });
  }

  private getBossSheetFrameIndex(frames: number, fps: number): number {
    const t = (this.boss && typeof this.boss.frame === 'number') ? this.boss.frame : this.gameFrame;
    const speed = fps / 60;
    const idx = Math.floor(t * speed) % frames;
    return idx < 0 ? idx + frames : idx;
  }

  private drawBossFromSpriteSheet(id: BossId): boolean {
    const img = this.bossTextures[id];
    if (!img || !img.complete || img.naturalWidth <= 0) return false;

    const meta = this.bossSheetMeta[id] || this.inferBossSheetMeta(img);
    const frames = Math.max(1, Math.min(60, Math.floor(meta.frames || 4)));
    const fps = Math.max(1, Math.min(60, Number(meta.fps || 8)));

    const frameIndex = this.getBossSheetFrameIndex(frames, fps);

    const source: CanvasImageSource = this.bossSheetCanvas[id] || img;
    const cache = this.bossSheetFrameCache[id];

    let sx = 0, sy = 0, frameW = 0, frameH = 0;
    let cx = 0, cy = 0, cw = 0, ch = 0;

    if (cache && cache.length >= frames) {
      const r = cache[frameIndex];
      sx = r.sx; sy = r.sy; frameW = r.sw; frameH = r.sh;
      cx = r.cx; cy = r.cy; cw = r.cw; ch = r.ch;
    } else {
      // Fallback: compute frame rects (no cropping)
      const srcW = (this.bossSheetCanvas[id]?.width) || (img.naturalWidth || img.width || 1);
      const srcH = (this.bossSheetCanvas[id]?.height) || (img.naturalHeight || img.height || 1);
      const cols = meta.cols && meta.cols > 1 ? Math.floor(meta.cols) : 0;
      if (cols > 1) {
        const rows = meta.rows && meta.rows > 0 ? Math.floor(meta.rows) : Math.ceil(frames / cols);
        frameW = Math.floor(srcW / cols);
        frameH = Math.floor(srcH / rows);
        sx = (frameIndex % cols) * frameW;
        sy = Math.floor(frameIndex / cols) * frameH;
      } else {
        frameW = Math.floor(srcW / frames);
        frameH = srcH;
        sx = frameIndex * frameW;
        sy = 0;
      }
      cx = 0; cy = 0; cw = frameW; ch = frameH;
    }

    if (frameW <= 0 || frameH <= 0 || cw <= 0 || ch <= 0) return false;

    const box = this.getBossTextureDrawBox(id);
    const pad = Math.round(Math.min(box.w, box.h) * 0.05);
    const availW = Math.max(1, box.w - pad * 2);
    const availH = Math.max(1, box.h - pad * 2);

    const scale = Math.min(availW / cw, availH / ch);
    const w = cw * scale;
    const h = ch * scale;

    const dx = -box.w / 2 + (box.w - w) / 2;
    const dy = -box.h / 2 + box.offsetY + (box.h - h) / 2;

    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    (this.ctx as any).imageSmoothingQuality = 'high';
    // Similar to buildBossSprite() baked shadow, but per-frame
    this.ctx.shadowBlur = 18;
    this.ctx.shadowColor = 'rgba(0,0,0,0.25)';
    this.ctx.drawImage(source as any, sx + cx, sy + cy, cw, ch, dx, dy, w, h);
    this.ctx.restore();
    return true;
  }

  private drawBossFromTexture(id: BossId): boolean {
    const mode: BossTextureMode = this.bossTextureMode[id] || 'static';
    if (mode === 'sheet') {
      return this.drawBossFromSpriteSheet(id);
    }

    const sprite = this.bossSprites[id];
    if (sprite) {
      const box = this.getBossTextureDrawBox(id);
      this.ctx.save();
      this.ctx.imageSmoothingEnabled = true;
      (this.ctx as any).imageSmoothingQuality = 'high';
      this.ctx.drawImage(sprite, -box.w / 2, -box.h / 2 + box.offsetY);
      this.ctx.restore();
      return true;
    }

    const img = this.bossTextures[id];
    if (!img || !img.complete || img.naturalWidth <= 0) return false;

    const box = this.getBossTextureDrawBox(id);
    const pad = Math.round(Math.min(box.w, box.h) * 0.05);
    const availW = Math.max(1, box.w - pad * 2);
    const availH = Math.max(1, box.h - pad * 2);
    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const scale = Math.min(availW / srcW, availH / srcH);
    const w = srcW * scale;
    const h = srcH * scale;

    const dx = -box.w / 2 + (box.w - w) / 2;
    const dy = -box.h / 2 + box.offsetY + (box.h - h) / 2;

    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    (this.ctx as any).imageSmoothingQuality = 'high';
    this.ctx.drawImage(img, dx, dy, w, h);
    this.ctx.restore();
    return true;
  }

  applySkinWeapon() {
    if (this.config.skin === 'skin_torah') { this.weaponType = 'fire'; this.weaponAmmo = 9999; }
    else if (this.config.skin === 'skin_gold') { this.weaponType = 'beam'; this.weaponAmmo = 9999; }
    else if (this.config.skin === 'skin_butzina') { this.weaponType = 'laser'; this.weaponAmmo = 9999; }
    else if (this.config.skin === 'skin_choshen') { this.weaponType = 'electric'; this.weaponAmmo = 9999; }
    else { this.weaponType = 'normal'; this.weaponAmmo = 0; }
  }

  resize(w: number, h: number) {
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    this.initParallax();
    const isMobile = this.width < 600;
    this.player.y = Math.max(this.height * 0.3, Math.min(this.player.y, this.height - (isMobile ? 120 : 100)));
  }

  togglePause() { this.isPaused = !this.isPaused; return this.isPaused; }

  initParallax() {
    this.starLayers = [[], [], []];
    const isMobile = this.width < 600;
    const layerConfigs = [
        { count: isMobile ? 70 : 120, speed: 0.1, size: 1, alpha: 0.2 },
        { count: isMobile ? 50 : 80, speed: 0.8, size: 1.2, alpha: 0.4 },
        { count: isMobile ? 32 : 50, speed: 3.0, size: 1.8, alpha: 0.6 }
    ];
    layerConfigs.forEach((lc, i) => {
        for(let j=0; j<lc.count; j++) {
            this.starLayers[i].push({ x: Math.random() * this.width, y: Math.random() * this.height, size: lc.size, speed: lc.speed, alpha: lc.alpha });
        }
    });
  }

  updateParallax(dt: number) {
      for (let i = 0; i < this.starLayers.length; i++) {
          const layer = this.starLayers[i];
          for (let j = 0; j < layer.length; j++) {
              const star = layer[j];
              star.y += star.speed * (this.boss ? 1.7 : 1) * (this.timeSlowTimer > 0 ? 0.3 : 1) * dt;
              if (star.y > this.height) { star.y = -10; star.x = Math.random() * this.width; }
          }
      }
  }

  startRound() {
    this.isTransitioning = false;
    if (this.enemyPool.some(e => e.active) || this.boss || this.playerExploding) return;

    if (this.subLevel === 9 && !this.boss) { this.startBossFight(); return; }
    
    const currentSugia = SUGIOT.slice().reverse().find(s => this.level >= s.requiredLevel) || SUGIOT[0];
    this.config.modifier = currentSugia.modifier;
    this.config.sugiaTitle = currentSugia.title;
    this.config.location = currentSugia.location;

    let wordObj = this.getUniqueWord();
    this.onStatsUpdate({ 
      currentWord: wordObj.aramaic, 
      level: this.level, 
      subLevel: this.subLevel,
      weaponAmmo: this.weaponAmmo,
      sugiaTitle: this.config.isTeacherPractice ? 'תרגול מורה' : currentSugia.title
    });

    const isMobile = this.width < 600;
    let count = (this.config.difficulty === 'easy' ? 3 : this.config.difficulty === 'medium' ? 4 : 5);
    if (isMobile && count > 4) count = 4;
    
    if (this.config.modifier === 'density' || this.config.modifier === 'final') count += 1;

    let speed = (this.config.difficulty === 'easy' ? 1.4 : this.config.difficulty === 'medium' ? 2.0 : 3.0) + (this.level * 0.08);
    // האטה משמעותית למובייל כפי שביקשת
    if (isMobile) speed *= 0.60; 

    let answers = [{ text: wordObj.hebrew, correct: true }];
    let distractors = this.activeDictionary.filter(w => w.hebrew !== wordObj.hebrew);
    while (answers.length < count && distractors.length > 0) {
        let randIdx = Math.floor(Math.random() * distractors.length);
        if (!answers.some(a => a.text === distractors[randIdx].hebrew)) {
             answers.push({ text: distractors[randIdx].hebrew, correct: false });
        }
        distractors.splice(randIdx, 1);
    }
    answers.sort(() => Math.random() - 0.5);

    let spacing = this.width / (count + 1);
    answers.forEach((ans, i) => {
        const enemy = this.enemyPool.find(e => !e.active);
        if (enemy) {
            enemy.x = spacing * (i+1); enemy.baseX = enemy.x; enemy.y = -100;
            enemy.text = ans.text; enemy.isCorrect = ans.correct;
            let baseRadius = isMobile ? 22 : 35;
            enemy.radius = (this.config.modifier === 'sharpness' || this.config.modifier === 'final') ? baseRadius * 0.7 : baseRadius; 
            enemy.speed = Math.max(0.7, speed + (Math.random() * 0.4));
            enemy.rotation = 0; enemy.rotationSpeed = (Math.random() - 0.5) * 0.08;
            enemy.waveOffset = Math.random() * Math.PI * 2;
            enemy.active = true;
        }
    });
  }

  getUniqueWord() {
    if (this.currentDeck.length === 0) this.currentDeck = [...this.activeDictionary];
    return this.currentDeck.splice(Math.floor(Math.random() * this.currentDeck.length), 1)[0];
  }

  triggerShake(intensity: number) { this.shakeAmount = intensity; }

  update(dt: number = 1.0) {
    if (this.isPaused || this.isTransitioning) return;
    this.gameFrame += dt;
    if (this.shakeAmount > 0.1) this.shakeAmount *= Math.pow(0.88, dt); else this.shakeAmount = 0;

    this.updateParallax(dt);

    if (this.playerExploding) {
        this.explosionTimer -= dt;
        if (this.explosionTimer <= 0) this.onGameOver(this.score);
    } else {
        if (Math.random() < 0.004 * dt) this.spawnBonus();
        
        if (this.config.modifier === 'drift' || this.config.modifier === 'storm') {
          this.player.x += Math.sin(this.gameFrame * 0.03) * 1.5 * dt;
        }

        if ((this.config.modifier === 'hazards' || this.config.modifier === 'storm' || this.config.modifier === 'final') && Math.random() < 0.015 * dt) this.spawnHazard();
        
        if (this.timeSlowTimer > 0) this.timeSlowTimer -= dt;
        if (this.boss) this.updateBoss(dt);
        this.updateProjectiles(dt);
        this.updateEnemies(dt);
        this.updateHazards(dt);
        this.updateBonuses(dt);
    }

    // Smooth banking/tilt back to neutral over time (works for mouse + touch)
    const velDecay = Math.pow(0.85, dt);
    this.player.velocityX *= velDecay;
    const maxBank = Math.PI / 6; // ~30deg
    const targetBankAngle = Math.max(-maxBank, Math.min(maxBank, this.player.velocityX * 0.08));
    const bankEase = 1 - Math.pow(0.85, dt);
    this.player.bankAngle += (targetBankAngle - this.player.bankAngle) * bankEase;
    
    this.particlePool.forEach(p => { if(p.active) p.update(dt); });
    if (!this.enemyPool.some(e => e.active) && !this.boss && !this.playerExploding && !this.isTransitioning && Math.random() < 0.1 * dt) this.startRound();
  }

  spawnHazard() {
    this.hazards.push({ x: Math.random() * this.width, y: -50, vy: 5 + Math.random() * 3, text: '🔥' });
  }

  updateHazards(dt: number) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      let h = this.hazards[i]; 
      if (!h) continue; 
      h.y += h.vy * dt;
      if (Math.hypot(h.x - this.player.x, h.y - this.player.y) < 32) {
        this.handleMiss();
        if (this.hazards[i]) this.hazards.splice(i, 1);
      } else if (h.y > this.height + 50) {
        this.hazards.splice(i, 1);
      }
    }
  }

  updateProjectiles(dt: number) {
      this.projectilePool.forEach(p => {
          if (!p.active) return;
          if (p.type === 'beam') { 
              p.life -= dt; 
              p.x = this.player.x; 
              if (p.life <= 0) p.active = false; 
          }
          else { p.x += p.vx * dt; p.y += p.vy * dt; }
          
          if (p.type === 'missile') this.applyHoming(p, dt);
          
          if (this.boss && p.active && !p.hasHit) {
              const isMobile = this.width < 600;
              const hitRadius = isMobile ? 100 : 140;
              let isHit = p.type === 'beam' ? (Math.abs(p.x - this.boss.x) < hitRadius && this.boss.y < p.y) : (Math.hypot(p.x - this.boss.x, p.y - this.boss.y) < (p.type === 'fire' ? hitRadius * 1.2 : hitRadius));
              if (isHit) { 
                  const bossY = this.boss.y; // שמירת המיקום לפני שהבוס עשוי להיעלם
                  this.damageBoss(p); 
                  p.hasHit = true;
                  if (p.type === 'beam') {
                      p.targetY = bossY + 100;
                      p.life = Math.min(p.life, 5); // השארת הקרן גלויה לרגע
                  } else {
                      p.active = false; 
                  }
              }
          }
          if (p.y < -400 || p.y > this.height + 400) p.active = false;
      });
  }

  damageBoss(p: any) {
      if (!this.boss) return;
      let dmg = p.type === 'missile' ? 12 : p.type === 'beam' ? 6 : p.type === 'fire' ? 15 : p.type === 'electric' ? 8 : p.type === 'laser' ? 7 : 4;
      this.boss.hp -= dmg;
      Sound.play('boss_hit');
      if (this.gameFrame % 4 === 0) this.spawnExplosion(p.x, this.boss.y + 50, p.type === 'fire' ? '#f97316' : '#fbbf24', 1);
      this.onStatsUpdate({ bossHpPercent: Math.max(0, (this.boss.hp / this.boss.maxHp) * 100) });
      if (this.boss.hp <= 0) this.endBossFight();
  }

  private getBossIdForLevel(level: number): BossId {
      if (level === 1) return 'tannina';
      if (level === 8) return 'koy';
      if (level === 15) return 'shed';
      if (level === 22) return 'ashmedai';
      if (level === 29) return 'agirat';
      if (level === 36) return 'leviathan';
      return 'ziz';
  }

  private getBossDifficultyMult(id: BossId): number {
      // Slightly increasing base difficulty across the sequence
      if (id === 'tannina') return 1.0;
      if (id === 'koy') return 1.05;
      if (id === 'shed') return 1.10;
      if (id === 'ashmedai') return 1.15;
      if (id === 'agirat') return 1.18;
      if (id === 'leviathan') return 1.22;
      return 1.28; // ziz
  }

  private getBossThemeColor(id: BossId): string {
      if (id === 'tannina') return '#60a5fa';
      if (id === 'koy') return '#fbbf24';
      if (id === 'shed') return '#a855f7';
      if (id === 'ashmedai') return '#ef4444';
      if (id === 'agirat') return '#ec4899';
      if (id === 'leviathan') return '#22d3ee';
      return '#e2e8f0'; // ziz
  }

  private getBossAuraSprite(id: BossId): HTMLCanvasElement {
      const existing = this.bossAuraSprites[id];
      if (existing) return existing;
      const sprite = this.buildAuraSprite(this.getBossThemeColor(id));
      this.bossAuraSprites[id] = sprite;
      return sprite;
  }

  private drawBossVfx(id: BossId, loop: number) {
      const color = this.getBossThemeColor(id);
      const aura = this.getBossAuraSprite(id);
      const t = this.gameFrame * 0.02;
      const pulse = 0.88 + Math.sin(t * 2) * 0.12;
      const loopBoost = 1 + Math.min(0.6, loop * 0.08);

      // Big aura ring
      const size = 560 * pulse * loopBoost;
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = 0.22;
      this.ctx.rotate(t * 0.5);
      this.ctx.drawImage(aura, -size / 2, -size / 2, size, size);
      this.ctx.restore();

      // Secondary counter-rotation ring
      const size2 = size * 0.78;
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = 0.14;
      this.ctx.rotate(-t * 0.85 + 0.8);
      this.ctx.drawImage(aura, -size2 / 2, -size2 / 2, size2, size2);
      this.ctx.restore();

      // Arc shards (dynamic, very cheap)
      const rgb = this.hexToRgb(color) || { r: 226, g: 232, b: 240 };
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.lineCap = 'round';
      this.ctx.lineWidth = 6;
      this.ctx.shadowBlur = 18;
      this.ctx.shadowColor = color;
      this.ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`;
      const r = 270 * loopBoost;
      for (let i = 0; i < 3; i++) {
          const a0 = t * 0.9 + i * 2.1;
          const span = 0.9 + Math.sin(t * 1.6 + i) * 0.25;
          this.ctx.globalAlpha = 0.12 + 0.10 * (0.5 + 0.5 * Math.sin(t * 1.8 + i));
          this.ctx.beginPath();
          this.ctx.arc(0, 20, r, a0, a0 + span);
          this.ctx.stroke();
      }
      this.ctx.restore();

      // Floating spark particles
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`;
      const pCount = 10;
      for (let i = 0; i < pCount; i++) {
          const a = t * 1.7 + (i / pCount) * Math.PI * 2;
          const rr = 190 * loopBoost + Math.sin(t * 0.9 + i) * 35;
          const x = Math.cos(a) * rr;
          const y = 20 + Math.sin(a) * rr * 0.65;
          this.ctx.globalAlpha = 0.06 + 0.10 * (0.5 + 0.5 * Math.sin(t * 2.2 + i));
          this.ctx.beginPath();
          this.ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          this.ctx.fill();
      }
      this.ctx.restore();
  }

  applyHoming(p: any, dt: number) {
      const target = this.enemyPool.find(e => e.active && e.isCorrect) || this.boss;
      if (target) {
          const angle = Math.atan2(target.y - p.y, target.x - p.x);
          p.vx += Math.cos(angle) * 2.2 * dt; p.vy += Math.sin(angle) * 2.2 * dt;
          const speed = Math.hypot(p.vx, p.vy);
          if(speed > 16) { p.vx *= 16/speed; p.vy *= 16/speed; }
          p.angle = Math.atan2(p.vy, p.vx) + Math.PI/2;
      }
  }

  updateEnemies(dt: number) {
      if (this.isTransitioning) return;
      const isMobile = this.width < 600;
      
      for (let i = 0; i < this.enemyPool.length; i++) {
          let e = this.enemyPool[i];
          if (!e || !e.active) continue;

          let currentSpeed = e.speed;
          if ((this.config.modifier === 'accelerate' || this.config.modifier === 'final') && e.y > this.height * 0.3) currentSpeed *= 1.4;
          e.y += (this.timeSlowTimer > 0 ? currentSpeed * 0.35 : currentSpeed) * dt;

          if (this.config.modifier === 'wave' || this.config.modifier === 'final') {
            const waveWidth = isMobile ? 30 : 50;
            e.x = e.baseX + Math.sin(this.gameFrame * 0.04 + e.waveOffset) * waveWidth;
          }
          
          if (this.config.modifier === 'chaos' || this.config.modifier === 'final') {
            e.x += (Math.random() - 0.5) * 5 * dt;
            e.y += (Math.random() - 0.5) * 2 * dt;
          }

          if (this.config.modifier === 'vortex' || this.config.modifier === 'final') {
            const centerX = this.width / 2;
            const dist = centerX - e.x;
            e.x += dist * 0.01 * dt;
          }

          if (e.y > this.height + 100) { e.active = false; if(e.isCorrect) this.handleMiss('fail'); continue; }

          let hit = false;
          for (let j = 0; j < this.projectilePool.length; j++) {
              let p = this.projectilePool[j];
              if (!p || !p.active || p.hasHit) continue; // אם כבר פגע, לא פוגע שוב
              
              const hitTolerance = isMobile ? 2.2 : 1.6;
              const beamWidth = isMobile ? e.radius * 2.5 : e.radius * 2;
              
              let isColliding = false;
              if (p.type === 'beam') {
                  // בדיקת קרן: האם האויב בטור של השחקן ומעליו
                  isColliding = Math.abs(p.x - e.x) < beamWidth && e.y < p.y;
              } else {
                  isColliding = Math.hypot(p.x - e.x, p.y - e.y) < (p.type === 'fire' ? e.radius*2.5 : e.radius*hitTolerance);
              }

              if (isColliding) {
                  hit = true; 
                  p.hasHit = true; // סימון שפגע
                  if (p.type === 'beam') {
                      p.targetY = e.y; // הקרן נעצרת באויב
                      p.life = 6; // הקרן נשארת גלויה ל-6 פריימים כדי שיראו את הפגיעה
                  } else {
                      p.active = false; 
                  }
                  break;
              }
          }
          if (hit) { e.active = false; this.handleHit(e.isCorrect, e.x, e.y); }
      }
  }

  handleHit(isCorrect: boolean, x: number, y: number) {
      if (isCorrect) {
          this.isTransitioning = true;
          Sound.play('coin');
          this.score += (this.config.difficulty === 'easy' ? 100 : this.config.difficulty === 'medium' ? 200 : 400) * (this.combo + 1);
          this.combo++;
          this.spawnExplosion(x, y, '#4ade80', 25);
          if (this.combo >= 10) this.onAchievement('zurba');
          this.enemyPool.forEach(e => e.active = false);
          this.hazards = [];
          
          this.onStatsUpdate({ score: this.score, combo: this.combo });
          
          setTimeout(() => {
            this.subLevel++;
            this.isTransitioning = false;
            this.startRound();
          }, 50); 
      } else {
          this.triggerShake(12); this.spawnExplosion(x, y, '#ef4444', 20); this.handleMiss('fail');
      }
  }

  handleMiss(reason: 'fail' | 'damage' = 'damage') {
      if (this.playerExploding) return;
      if (reason === 'fail') Sound.play('fail');
      else Sound.play('hit');
      if (this.boss) this.bossDamageTaken = true; 
      this.enemyPool.forEach(e => e.active = false);
      this.hazards = [];
      this.bossProjectiles = [];
      this.projectilePool.forEach(p => { if (p.type !== 'beam') p.active = false; });
      if (this.shieldStrength > 0) {
          this.shieldStrength--; this.triggerShake(10);
          this.onFeedback(this.shieldStrength === 1 ? "מגן נסדק!" : "מגן נשבר!", false);
          this.onStatsUpdate({ hasShield: this.shieldStrength > 0 });
          setTimeout(() => this.startRound(), 1000);
      } else {
          this.lives--; this.combo = 0; this.triggerShake(20); this.onFeedback("נפגעת!", false);
          this.spawnExplosion(this.player.x, this.player.y, '#ef4444', 40);
          this.onStatsUpdate({ lives: this.lives, combo: 0 });
          if (this.lives <= 0) { this.playerExploding = true; this.explosionTimer = 90; this.onStatsUpdate({ bossActive: false, bossHpPercent: 0 }); Sound.play('explosion'); }
          else { setTimeout(() => this.startRound(), 1200); }
      }
  }

  spawnExplosion(x: number, y: number, color: string, count: number) {
      let spawned = 0;
      for (const p of this.particlePool) { if (!p.active) { p.init(x, y, color); spawned++; if (spawned >= count) break; } }
  }

  draw() {
    // Clear canvas first to prevent seeing previous frame during shake
    this.ctx.fillStyle = '#020617'; 
    this.ctx.fillRect(0, 0, this.width, this.height);
    
    this.ctx.save();
    if (this.shakeAmount > 0.1) this.ctx.translate((Math.random()-0.5)*this.shakeAmount, (Math.random()-0.5)*this.shakeAmount);
    this.drawBackgroundTheme();
    this.starLayers.forEach(layer => {
        layer.forEach(s => {
            this.ctx.globalAlpha = s.alpha; this.ctx.fillStyle = 'white';
            this.ctx.beginPath(); this.ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); this.ctx.fill();
        });
    });
    this.ctx.globalAlpha = 1;
    this.drawEntities();
    this.ctx.restore();
    if (this.config.modifier === 'darkness' || (this.config.modifier === 'final' && this.gameFrame % 200 < 50)) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'multiply';
      const grad = this.ctx.createRadialGradient(this.player.x, this.player.y, 100, this.player.x, this.player.y, 400);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0.95)');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0,0,this.width,this.height);
      this.ctx.restore();
    }
  }

  drawBackgroundTheme() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const loc = this.config.location || 'nehardea';
    const t = this.gameFrame * 0.016;
    const subPhase = this.level % 7;
    const isMobile = w < 600;
    const scale = isMobile ? Math.min(w / 800, h / 1200, 1) : 1;

    const linear = (y0: number, y1: number, stops: Array<[number, string]>) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      stops.forEach(([p, c]) => g.addColorStop(p, c));
      return g;
    };

    const radial = (x: number, y: number, r: number, stops: Array<[number, string]>) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      stops.forEach(([p, c]) => g.addColorStop(p, c));
      return g;
    };

    const clampAlpha = (n: number) => Math.max(0, Math.min(1, n));

    ctx.save();

    switch (loc) {
      case 'nehardea': {
        ctx.fillStyle = linear(0, h, [
          [0, '#0a1224'],
          [0.55, '#0b1c34'],
          [1, '#062538']
        ]);
        ctx.fillRect(0, 0, w, h);

        const riverTop = h * 0.6;
        const riverOffset = isMobile ? 25 : 40;
        const river = linear(riverTop - riverOffset, h, [
          [0, `rgba(34, 211, 238, ${clampAlpha(0.08 + subPhase * 0.01)})`],
          [0.45, `rgba(14, 165, 233, ${clampAlpha(0.18 + subPhase * 0.015)})`],
          [1, 'rgba(6, 182, 212, 0.42)']
        ]);
        ctx.fillStyle = river;
        ctx.fillRect(0, riverTop - riverOffset, w, h);

        const waveAmp = isMobile ? (8 + subPhase * 1.5) : (10 + subPhase * 2);
        const waveStep = isMobile ? Math.max(32, w / 15) : 48;
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, riverTop);
        for (let x = 0; x <= w; x += waveStep) {
          const y =
            riverTop +
            Math.sin(x * 0.012 + t * 1.4) * waveAmp +
            Math.cos(t * 0.7 + x * 0.006) * waveAmp * 0.6;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
        ctx.fill();
        ctx.restore();

        ctx.globalCompositeOperation = 'lighter';
        const glowCount = isMobile ? 3 : 5;
        const glowRadius = isMobile ? 80 : 120;
        const glowSize = glowRadius * 2;
        for (let i = 0; i < glowCount; i++) {
          const gx = (i * (w / (glowCount - 1 || 1)) + t * (isMobile ? 80 : 110)) % (w + glowSize) - glowRadius;
          const gy = riverTop + (isMobile ? 15 : 22) + Math.sin(t + i) * (isMobile ? 10 : 16);
          ctx.fillStyle = radial(gx, gy, glowRadius, [
            [0, 'rgba(125, 211, 252, 0.55)'],
            [0.6, 'rgba(125, 211, 252, 0.12)'],
            [1, 'rgba(125, 211, 252, 0)']
          ]);
          ctx.fillRect(gx - glowRadius, gy - glowRadius, glowSize, glowSize);
        }
        break;
      }
      case 'sura': {
        ctx.fillStyle = linear(0, h, [
          [0, '#180c1f'],
          [0.55, '#230c1d'],
          [1, '#2c0f15']
        ]);
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = radial(w * 0.5, h * 0.92, h * 0.9, [
          [0, 'rgba(249, 115, 22, 0.28)'],
          [0.5, 'rgba(239, 68, 68, 0.22)'],
          [1, 'rgba(88, 28, 135, 0)']
        ]);
        ctx.fillRect(0, 0, w, h);

        const ringCount = isMobile ? 4 : 6;
        for (let i = 0; i < ringCount; i++) {
          const y = h * 0.72 + Math.sin(t * 0.7 + i) * (isMobile ? 12 : 18);
          const rx = w * (0.36 + i * 0.05);
          const ry = h * (0.10 + i * 0.03);
          ctx.save();
          ctx.translate(w / 2, y);
          ctx.rotate(Math.sin(t * 0.25 + i) * 0.08);
          ctx.strokeStyle = `rgba(248, 113, 113, ${0.14 + i * 0.03})`;
          ctx.lineWidth = (isMobile ? 1.2 : 1.5) + i * (isMobile ? 0.5 : 0.7);
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        ctx.globalCompositeOperation = 'lighter';
        const particleCount = isMobile ? 10 : 18;
        const particleRadius = isMobile ? 24 : 36;
        const particleSize = isMobile ? 80 : 120;
        for (let i = 0; i < particleCount; i++) {
          const px = (i * (w / (particleCount * 0.7)) + t * (isMobile ? 90 : 130) + i * (isMobile ? 10 : 14)) % (w + particleSize) - (particleSize / 2);
          const py = h * 0.15 + (i % (isMobile ? 3 : 4)) * h * (isMobile ? 0.22 : 0.18) + Math.sin(t * 1.4 + i) * (isMobile ? 12 : 18);
          ctx.fillStyle = radial(px, py, particleRadius + (i % 3) * (isMobile ? 5 : 8), [
            [0, 'rgba(255, 214, 102, 0.9)'],
            [0.5, 'rgba(251, 113, 133, 0.45)'],
            [1, 'rgba(251, 113, 133, 0)']
          ]);
          ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 1.3 + i);
          ctx.fillRect(px - (particleSize / 2), py - (particleSize / 2), particleSize, particleSize);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'pumbedita': {
        ctx.fillStyle = linear(0, h, [
          [0, '#1f1422'],
          [0.5, '#27151a'],
          [1, '#1d100f']
        ]);
        ctx.fillRect(0, 0, w, h);

        const haloRadius = isMobile ? Math.min(w * 0.4, h * 0.35) : 220;
        const halo = radial(w * 0.18, h * 0.32, haloRadius, [
          [0, 'rgba(250, 204, 21, 0.24)'],
          [1, 'rgba(250, 204, 21, 0)']
        ]);
        ctx.fillStyle = halo;
        ctx.fillRect(isMobile ? -20 : -40, 0, w * 0.6, h * 0.6);

        const ribbonCount = isMobile ? 3 : 4;
        const glyphs = ['א', 'ר', 'מ', 'א', 'י', 'ת', 'ב', 'ר', 'י', 'ת'];
        const ribbonHeight = isMobile ? 14 : 18;
        const ribbonPadding = isMobile ? 30 : 60;
        for (let i = 0; i < ribbonCount; i++) {
          const y = h * (0.18 + i * (isMobile ? 0.25 : 0.2)) + Math.sin(t * 0.7 + i) * (isMobile ? 9 : 14);
          const ribbon = ctx.createLinearGradient(0, y - ribbonHeight, w, y + ribbonHeight);
          ribbon.addColorStop(0, 'rgba(234, 179, 8, 0.10)');
          ribbon.addColorStop(0.5, `rgba(251, 191, 36, ${0.25 + i * 0.04})`);
          ribbon.addColorStop(1, 'rgba(217, 119, 6, 0.10)');
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = ribbon;
          ctx.fillRect(-ribbonPadding, y - ribbonHeight, w + ribbonPadding * 2, ribbonHeight * 2);

          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.font = isMobile ? `bold ${Math.max(16, w * 0.04)}px Frank Ruhl Libre` : 'bold 26px Frank Ruhl Libre';
          ctx.fillStyle = 'rgba(255, 224, 138, 0.85)';
          const glyphCount = isMobile ? 10 : 14;
          const glyphSpacing = isMobile ? (w / 8) : (w / 12);
          for (let j = 0; j < glyphCount; j++) {
            const x = (j * glyphSpacing + t * (isMobile ? 30 : 40) + i * (isMobile ? 50 : 70)) % (w + 60) - 30;
            const gy = y + (j % 2 === 0 ? (isMobile ? -4 : -6) : (isMobile ? 6 : 10));
            ctx.fillText(glyphs[(i + j) % glyphs.length], x, gy);
          }
          ctx.restore();
        }

        ctx.globalCompositeOperation = 'lighter';
        const ellipseCount = isMobile ? 2 : 3;
        for (let i = 0; i < ellipseCount; i++) {
          const gx = w * (0.35 + i * (isMobile ? 0.25 : 0.2));
          const gy = h * 0.78;
          ctx.strokeStyle = `rgba(251, 191, 36, ${0.18 + i * 0.04})`;
          ctx.lineWidth = (isMobile ? 1.5 : 2) + i * (isMobile ? 0.4 : 0.6);
          ctx.beginPath();
          const rx = isMobile ? (60 + i * 18) : (90 + i * 26);
          const ry = isMobile ? (18 + i * 5) : (26 + i * 8);
          ctx.ellipse(gx, gy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'mahoza': {
        ctx.fillStyle = linear(0, h, [
          [0, '#0b1022'],
          [0.6, '#0d1428'],
          [1, '#0a0d18']
        ]);
        ctx.fillRect(0, 0, w, h);

        const beamCount = isMobile ? 5 : 7;
        for (let i = 0; i < beamCount; i++) {
          const x = (i / (beamCount - 1 || 1)) * w + Math.sin(t * 0.45 + i) * (isMobile ? 18 : 28);
          const beam = linear(0, h, [
            [0, 'rgba(56, 189, 248, 0)'],
            [0.35, `rgba(56, 189, 248, ${0.14 + (subPhase % 3) * 0.02})`],
            [0.65, `rgba(168, 85, 247, ${0.16 + (subPhase % 4) * 0.02})`],
            [1, 'rgba(59, 130, 246, 0)']
          ]);
          ctx.save();
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = beam;
          const width = (isMobile ? 18 : 26) + Math.sin(t * 0.6 + i) * (isMobile ? 6 : 10);
          ctx.fillRect(x - width / 2, 0, width, h);
          ctx.restore();
        }

        ctx.globalCompositeOperation = 'screen';
        const circleCount = isMobile ? 3 : 4;
        for (let i = 0; i < circleCount; i++) {
          const gx = (i * (w / (circleCount - 1 || 1)) + t * (isMobile ? 24 : 32)) % (w + (isMobile ? 80 : 120)) - (isMobile ? 40 : 60);
          const gy = h * (0.32 + i * (isMobile ? 0.18 : 0.14));
          ctx.strokeStyle = `rgba(94, 234, 212, ${0.18 + i * 0.04})`;
          ctx.lineWidth = (isMobile ? 1.4 : 1.8) + i * (isMobile ? 0.3 : 0.4);
          ctx.beginPath();
          ctx.arc(gx, gy, (isMobile ? 50 : 70) + i * (isMobile ? 18 : 26), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'matamehasia': {
        ctx.fillStyle = linear(0, h, [
          [0, '#05050f'],
          [1, '#090915']
        ]);
        ctx.fillRect(0, 0, w, h);

        const cx = w * 0.5;
        const cy = h * 0.56;
        const baseR = Math.max(w, h) * (isMobile ? 0.55 : 0.6);
        ctx.globalCompositeOperation = 'screen';
        const arcCount = isMobile ? 5 : 7;
        for (let i = 0; i < arcCount; i++) {
          const angle = t * 0.4 + i * 0.65;
          const r = baseR * (1 - i * 0.08);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle * 0.12);
          ctx.strokeStyle = `rgba(148, 163, 184, ${0.10 + i * 0.03})`;
          ctx.lineWidth = (isMobile ? 1.0 : 1.2) + i * (isMobile ? 0.4 : 0.5);
          ctx.beginPath();
          ctx.arc(0, 0, r, angle, angle + Math.PI * (1.25 + i * 0.08));
          ctx.stroke();
          ctx.restore();
        }

        ctx.fillStyle = radial(cx, cy, baseR * 0.55, [
          [0, 'rgba(59, 130, 246, 0.12)'],
          [0.5, 'rgba(124, 58, 237, 0.08)'],
          [1, 'rgba(0, 0, 0, 0)']
        ]);
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        break;
      }
      case 'beiradelvat': {
        ctx.fillStyle = linear(0, h, [
          [0, '#04101f'],
          [0.5, '#06263a'],
          [1, '#041420']
        ]);
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = radial(w * 0.5, h * 0.55, Math.max(w, h) * (isMobile ? 0.65 : 0.7), [
          [0, 'rgba(34, 211, 238, 0.22)'],
          [0.4, 'rgba(59, 130, 246, 0.12)'],
          [1, 'rgba(6, 95, 70, 0)']
        ]);
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'screen';
        const arcCount = isMobile ? 4 : 5;
        for (let i = 0; i < arcCount; i++) {
          const r = Math.max(w, h) * (0.32 + i * 0.08);
          const start = t * 0.9 + i * 0.7;
          ctx.strokeStyle = `rgba(125, 211, 252, ${0.14 + i * 0.03})`;
          ctx.lineWidth = (isMobile ? 1.3 : 1.6) + i * (isMobile ? 0.3 : 0.4);
          ctx.beginPath();
          ctx.arc(w / 2, h * 0.52, r, start, start + Math.PI * 1.35);
          ctx.stroke();
        }

        if (this.gameFrame % 120 < 16) {
          const seed = this.gameFrame;
          const baseX = (seed * 47) % w;
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.9)';
          ctx.lineWidth = isMobile ? 1.8 : 2.2;
          ctx.beginPath();
          ctx.moveTo(baseX, -20);
          const lightningPoints = isMobile ? 5 : 6;
          for (let i = 0; i < lightningPoints; i++) {
            const y = (i + 1) * (h / (lightningPoints + 1));
            const x = baseX + Math.sin(seed * 0.2 + i) * (isMobile ? 40 : 60);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
        const lineCount = isMobile ? 10 : 14;
        const lineSpacing = w / (isMobile ? 8 : 12);
        const lineOffset = isMobile ? 20 : 28;
        for (let i = 0; i < lineCount; i++) {
          const x = (i * lineSpacing + t * (isMobile ? 65 : 90)) % (w + 60) - 30;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + lineOffset, h);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      default: {
        ctx.fillStyle = linear(0, h, [
          [0, '#0b1324'],
          [1, '#0a0f1f']
        ]);
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#e2e8f0';
        const fontSize = isMobile ? Math.max(24, w * 0.06) : 42;
        ctx.font = `bold ${fontSize}px Frank Ruhl Libre`;
        const letters = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י"];
        const letterCount = isMobile ? 7 : 10;
        const letterSpacingX = isMobile ? (w / 4) : 180;
        const letterSpacingY = isMobile ? (h / 5) : 140;
        for(let i=0; i<letterCount; i++) {
          const x = (i * letterSpacingX + this.gameFrame * 0.3) % w;
          const y = (i * letterSpacingY + this.gameFrame * 0.2) % h;
          ctx.fillText(letters[i % letters.length], x, y);
        }
        ctx.restore();
        break;
      }
    }

    ctx.restore();
  }


  drawEntities() {
      this.particlePool.forEach(p => { if (p.active) { this.ctx.globalAlpha = p.alpha; this.ctx.fillStyle = p.color; this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); this.ctx.fill(); } });
      this.ctx.globalAlpha = 1;
      this.enemyPool.forEach(e => { if (e.active) {
          if (this.config.modifier === 'blink' || (this.config.modifier === 'final' && this.gameFrame % 100 < 20)) {
            this.ctx.globalAlpha = 0.3 + Math.abs(Math.sin(this.gameFrame * 0.1)) * 0.7;
          }
          this.drawEnemy(e); 
          this.ctx.globalAlpha = 1;
        }
      });
      if (this.boss) this.drawBoss();
      this.bonuses.forEach(b => this.drawBonus(b));
      this.hazards.forEach(h => {
        this.ctx.save(); this.ctx.font = '30px Rubik'; this.ctx.textAlign = 'center'; this.ctx.shadowBlur = 15; this.ctx.shadowColor = 'red';
        this.ctx.fillText(h.text, h.x, h.y); this.ctx.restore();
      });
      if (!this.playerExploding) this.drawPlayer();
      this.bossProjectiles.forEach(p => {
          if (!p) return;
          this.drawBossProjectile(p);
          const hitRadius = p.radius ?? 28;
          if(Math.hypot(p.x - this.player.x, p.y - this.player.y) < hitRadius) { this.handleMiss(); p.y = this.height + hitRadius; }
      });
      this.bossProjectiles = this.bossProjectiles.filter(p => p.y < this.height + 120 && p.x > -120 && p.x < this.width + 120);
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.projectilePool.forEach(p => { if (p.active) this.drawProjectile(p); });
      this.ctx.restore();
  }

  drawPlayer() {
      this.ctx.save(); this.ctx.translate(this.player.x, this.player.y);

      // Apply banking rotation
      this.ctx.rotate(this.player.bankAngle);

      if (this.shieldStrength > 0) {
          const strong = this.shieldStrength === 2;
          const radius = this.width < 600 ? 58 : 66;
          const glow = strong ? '#7dd3fc' : '#a5b4fc';
          const core = strong ? '#38bdf8' : '#93c5fd';
          this.ctx.save();
          this.ctx.globalCompositeOperation = 'screen';

          const fillG = this.ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius);
          fillG.addColorStop(0, 'rgba(255,255,255,0.28)');
          fillG.addColorStop(0.45, strong ? 'rgba(56,189,248,0.35)' : 'rgba(147,197,253,0.28)');
          fillG.addColorStop(1, strong ? 'rgba(56,189,248,0.05)' : 'rgba(165,180,252,0.04)');

          this.ctx.shadowBlur = 28;
          this.ctx.shadowColor = glow;
          this.ctx.fillStyle = fillG;
          this.ctx.beginPath(); this.ctx.arc(0, 0, radius, 0, Math.PI*2); this.ctx.fill();

          // Outer crisp ring
          this.ctx.lineWidth = 4;
          this.ctx.strokeStyle = core;
          this.ctx.beginPath(); this.ctx.arc(0, 0, radius * 0.96, 0, Math.PI*2); this.ctx.stroke();

          // Animated dash ring
          this.ctx.lineWidth = 2;
          this.ctx.strokeStyle = 'rgba(255,255,255,0.65)';
          this.ctx.setLineDash([10, 8]);
          this.ctx.lineDashOffset = -(this.gameFrame * 0.4);
          this.ctx.beginPath(); this.ctx.arc(0, 0, radius * 0.82, 0, Math.PI*2); this.ctx.stroke();

          // Inner glow rim
          this.ctx.setLineDash([]);
          this.ctx.lineWidth = 1.5;
          this.ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          this.ctx.beginPath(); this.ctx.arc(0, 0, radius * 0.7, 0, Math.PI*2); this.ctx.stroke();

          this.ctx.restore();
      }

      // Let the ship renderer control its own shadows/glow (prevents double-blur)
      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = 'transparent';
      this.renderShip();
      this.ctx.restore();
  }

  private getShipGlowColor(skin: string): string {
      if (skin === 'skin_gold') return '#fbbf24';
      if (skin === 'skin_butzina') return '#a855f7';
      if (skin === 'skin_torah') return '#f97316';
      if (skin === 'skin_choshen') return '#fbbf24';
      return '#3b82f6';
  }

  private drawChoshenChains(w: number, h: number) {
      // PERFORMANCE-FIRST: short, fluttering golden chains (minimal draw ops)
      const isMobile = this.width < 600;
      const t = this.gameFrame * 0.065;
      const speed = Math.min(1.2, Math.abs(this.player.velocityX) * 0.03);
      const swing = 0.85 + speed * 0.65;

      const attachY = -h * 0.30;
      const attachX = w * 0.37;
      const chainLen = h * (isMobile ? 0.36 : 0.46);
      const segments = isMobile ? 4 : 6;

      const drawChain = (side: -1 | 1) => {
          const startX = side * attachX;
          const startY = attachY;
          const phase = t * 1.25 + side * 0.9;

          this.ctx.beginPath();
          let endX = startX;
          let endY = startY;
          for (let s = 0; s <= segments; s++) {
              const p = s / segments;
              const y = startY + p * chainLen;
              const amp = (isMobile ? 5.5 : 8.5) * swing * (0.22 + p * 0.78);
              const bankPull = this.player.bankAngle * 16 * p * side;
              const x = startX + Math.sin(phase + p * 3.1) * amp + bankPull;
              endX = x; endY = y;
              if (s === 0) this.ctx.moveTo(x, y);
              else this.ctx.lineTo(x, y);
          }
          this.ctx.stroke();

          // Tiny sparkle at the chain end
          this.ctx.save();
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.globalAlpha = 0.22;
          this.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.moveTo(endX - 4, endY);
          this.ctx.lineTo(endX + 4, endY);
          this.ctx.moveTo(endX, endY - 4);
          this.ctx.lineTo(endX, endY + 4);
          this.ctx.stroke();
          this.ctx.restore();
      };

      this.ctx.save();
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';

      // Base gold chain
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 0.75;
      this.ctx.strokeStyle = '#fbbf24';
      this.ctx.lineWidth = isMobile ? 2.0 : 2.6;
      drawChain(-1);
      drawChain(1);

      // Highlight pass (cheap)
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = 0.18;
      this.ctx.strokeStyle = '#fff3c4';
      this.ctx.lineWidth = isMobile ? 1.1 : 1.4;
      drawChain(-1);
      drawChain(1);

      this.ctx.restore();
  }

  private renderShipWithTexture(source: CanvasImageSource, skin: string, scale: number) {
      this.ctx.save();

      // Lightweight texture rendering (performance-first)
      this.ctx.imageSmoothingEnabled = true;
      (this.ctx as any).imageSmoothingQuality = 'medium';

      // Slight per-skin scaling for nicer silhouette match
      const effectiveScale =
          skin === 'skin_gold' ? scale * 1.22 :
          skin === 'skin_butzina' ? scale * 1.1 :
          skin === 'skin_torah' ? scale * 1.06 :
          skin === 'skin_choshen' ? scale * 1.04 :
          scale;

      this.ctx.scale(effectiveScale, effectiveScale);

      const srcSize = this.getSourceSize(source);
      const aspect = srcSize.w / Math.max(1, srcSize.h);
      let baseHeight = 92;
      if (skin === 'skin_choshen') baseHeight = 88;
      else if (skin === 'skin_torah') baseHeight = 102;
      else if (skin === 'skin_butzina') baseHeight = 100;
      else if (skin === 'skin_gold') baseHeight = 104;

      const h = baseHeight;
      const w = h * aspect;

      // Dynamic aura (cheap: pre-baked sprite + rotation/pulse)
      const auraSprite = this.shipAuraSprites[skin];
      // Torah has its own live fire VFX; skipping the generic aura also avoids any "square" feeling.
      if (auraSprite && skin !== 'skin_torah') {
          const t = this.gameFrame * 0.03;
          const pulse = 0.88 + Math.sin(t * 2) * 0.12;
          const auraSize = Math.max(w, h) * 1.85 * pulse;

          this.ctx.save();
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.globalAlpha = 0.22;
          this.ctx.rotate(t * 0.7);
          this.ctx.drawImage(auraSprite, -auraSize / 2, -auraSize / 2, auraSize, auraSize);
          this.ctx.restore();

          this.ctx.save();
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.globalAlpha = 0.14;
          this.ctx.rotate(-t * 1.05 + 0.6);
          const auraSize2 = auraSize * 0.82;
          this.ctx.drawImage(auraSprite, -auraSize2 / 2, -auraSize2 / 2, auraSize2, auraSize2);
          this.ctx.restore();

          // Orbiting sparkles (very cheap)
          const glowColor = this.getShipGlowColor(skin);
          const rgb = this.hexToRgb(glowColor) || { r: 96, g: 165, b: 250 };
          const orbCount =
              skin === 'skin_choshen' ? 5 :
              skin === 'skin_torah' ? 4 :
              skin === 'skin_butzina' ? 4 :
              skin === 'skin_gold' ? 4 : 3;
          const orbR = Math.max(w, h) * 0.70;
          this.ctx.save();
          this.ctx.globalCompositeOperation = 'lighter';
          const choshenColors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];
          for (let i = 0; i < orbCount; i++) {
              const a = t * 2.2 + (i / orbCount) * Math.PI * 2;
              const x = Math.cos(a) * orbR;
              const y = Math.sin(a) * orbR * 0.65;
              this.ctx.globalAlpha = 0.08 + 0.10 * (0.5 + 0.5 * Math.sin(t * 3 + i));
              if (skin === 'skin_choshen') {
                  const cHex = choshenColors[i % choshenColors.length];
                  const cRgb = this.hexToRgb(cHex) || rgb;
                  this.ctx.fillStyle = `rgba(${cRgb.r}, ${cRgb.g}, ${cRgb.b}, 1)`;
              } else {
                  this.ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`;
              }
              this.ctx.beginPath();
              const r = skin === 'skin_choshen' ? 2.4 : 2.1;
              this.ctx.arc(x, y, r, 0, Math.PI * 2);
              this.ctx.fill();
          }
          this.ctx.restore();
      }

      // Choshen special: short golden chains fluttering behind (drawn behind the ship)
      if (skin === 'skin_choshen') {
          this.drawChoshenChains(w, h);
      }

      // Simple shadow (no blur) for depth
      this.ctx.save();
      this.ctx.globalAlpha = 0.22;
      this.ctx.drawImage(source, -w / 2 + 2, -h / 2 + 4, w, h);
      this.ctx.restore();

      // Main ship texture
      this.ctx.drawImage(source, -w / 2, -h / 2, w, h);

      // Skin-specific “premium” micro VFX (lightweight)
      {
          const t = this.gameFrame * 0.03;
          const glowColor = this.getShipGlowColor(skin);

          if (skin === 'skin_gold') {
              // Beam emitter lens pulse near the nose
              const noseY = -h / 2 + 14;
              const pulse = 0.75 + Math.sin(t * 6) * 0.25;
              this.ctx.save();
              this.ctx.globalCompositeOperation = 'lighter';
              this.ctx.globalAlpha = 0.35 * pulse;
              const g = this.ctx.createRadialGradient(0, noseY, 0, 0, noseY, 22);
              g.addColorStop(0, 'rgba(255,255,255,0.95)');
              g.addColorStop(0.25, 'rgba(255,240,180,0.75)');
              g.addColorStop(0.6, 'rgba(251,191,36,0.25)');
              g.addColorStop(1, 'rgba(251,191,36,0)');
              this.ctx.fillStyle = g;
              this.ctx.beginPath();
              this.ctx.arc(0, noseY, 22, 0, Math.PI * 2);
              this.ctx.fill();
              this.ctx.restore();
          } else if (skin === 'skin_torah') {
              // Living fire (dynamic): flickering flames + pulsing holy orbs + rising sparks
              const isMobile = this.width < 600;
              const flameCount = isMobile ? 2 : 3;

              const flameBaseX = w * 0.40;
              const flameBaseY = h * 0.37;
              const orbX = w * 0.41;
              const orbY = -h * 0.02;

              const time = t * 1.65;
              const maxDim = Math.max(w, h);

              this.ctx.save();
              this.ctx.globalCompositeOperation = 'lighter';

              // Pulsing orbs (left + right)
              for (const side of [-1, 1] as const) {
                  const bob = Math.sin(time * 1.15 + side) * (isMobile ? 2.4 : 3.2);
                  const ox = side * orbX;
                  const oy = orbY + bob;
                  const p = 0.72 + 0.28 * Math.sin(time * 3.2 + side * 0.9);
                  const rr = (isMobile ? 14 : 18) + Math.sin(time * 2.4 + side) * (isMobile ? 2.5 : 3.5);

                  this.ctx.globalAlpha = 0.22 * p;
                  const g = this.ctx.createRadialGradient(ox, oy, 0, ox, oy, rr * 2.2);
                  g.addColorStop(0, 'rgba(255,255,255,0.95)');
                  g.addColorStop(0.18, 'rgba(251,191,36,0.78)');
                  g.addColorStop(0.45, 'rgba(249,115,22,0.55)');
                  g.addColorStop(0.75, 'rgba(220,38,38,0.22)');
                  g.addColorStop(1, 'rgba(220,38,38,0)');
                  this.ctx.fillStyle = g;
                  this.ctx.beginPath();
                  this.ctx.arc(ox, oy, rr * 2.2, 0, Math.PI * 2);
                  this.ctx.fill();

                  // Inner hot core pulse
                  this.ctx.globalAlpha = 0.16 * p;
                  const core = this.ctx.createRadialGradient(ox - rr * 0.18, oy - rr * 0.18, 0, ox, oy, rr * 1.2);
                  core.addColorStop(0, 'rgba(255,255,255,0.95)');
                  core.addColorStop(0.55, 'rgba(255,220,160,0.55)');
                  core.addColorStop(1, 'rgba(255,220,160,0)');
                  this.ctx.fillStyle = core;
                  this.ctx.beginPath();
                  this.ctx.arc(ox - rr * 0.18, oy - rr * 0.18, rr * 1.2, 0, Math.PI * 2);
                  this.ctx.fill();
              }

              // Flickering flame tongues (two clusters)
              const drawFlameTongue = (x0: number, y0: number, side: -1 | 1, idx: number) => {
                  const phase = time * 1.35 + idx * 0.95 + side * 0.8;
                  const height = (isMobile ? 26 : 34) + Math.sin(phase * 1.2) * (isMobile ? 7 : 10);
                  const width = (isMobile ? 12 : 16) + Math.sin(phase * 1.7) * (isMobile ? 4 : 6);
                  const tipX = Math.sin(phase * 1.55) * (isMobile ? 6 : 9) + side * (4 + idx * 1.5);
                  const tipY = y0 - height + Math.sin(phase * 2.3) * (isMobile ? 3 : 4);

                  // Outer flame (orange/red)
                  this.ctx.globalAlpha = 0.18 + idx * 0.04;
                  const grad = this.ctx.createRadialGradient(x0 + tipX * 0.2, tipY, 0, x0, y0 - height * 0.35, height * 1.2);
                  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
                  grad.addColorStop(0.2, 'rgba(251,191,36,0.32)');
                  grad.addColorStop(0.55, 'rgba(249,115,22,0.28)');
                  grad.addColorStop(0.8, 'rgba(220,38,38,0.16)');
                  grad.addColorStop(1, 'rgba(220,38,38,0)');
                  this.ctx.fillStyle = grad;
                  this.ctx.beginPath();
                  this.ctx.moveTo(x0 - width, y0);
                  this.ctx.quadraticCurveTo(x0 - width * 0.6, y0 - height * 0.35, x0 + tipX, tipY);
                  this.ctx.quadraticCurveTo(x0 + width * 0.6, y0 - height * 0.35, x0 + width, y0);
                  this.ctx.closePath();
                  this.ctx.fill();

                  // Inner hot core (yellow/white)
                  this.ctx.globalAlpha = 0.10 + idx * 0.03;
                  const grad2 = this.ctx.createRadialGradient(x0 + tipX * 0.15, tipY + 2, 0, x0, y0 - height * 0.3, height);
                  grad2.addColorStop(0, 'rgba(255,255,255,0.55)');
                  grad2.addColorStop(0.25, 'rgba(251,191,36,0.42)');
                  grad2.addColorStop(0.65, 'rgba(249,115,22,0.22)');
                  grad2.addColorStop(1, 'rgba(249,115,22,0)');
                  this.ctx.fillStyle = grad2;
                  this.ctx.beginPath();
                  this.ctx.moveTo(x0 - width * 0.65, y0);
                  this.ctx.quadraticCurveTo(x0 - width * 0.38, y0 - height * 0.28, x0 + tipX * 0.75, tipY + 4);
                  this.ctx.quadraticCurveTo(x0 + width * 0.38, y0 - height * 0.28, x0 + width * 0.65, y0);
                  this.ctx.closePath();
                  this.ctx.fill();
              };

              for (const side of [-1, 1] as const) {
                  for (let i = 0; i < flameCount; i++) {
                      const jitterX = Math.sin(time * 0.9 + i * 1.7 + side) * 2.2;
                      const jitterY = Math.sin(time * 1.1 + i * 1.3 + side) * 1.6;
                      drawFlameTongue(side * flameBaseX + jitterX, flameBaseY + jitterY, side, i);
                  }
              }

              // Rising sparks (cheap)
              const sparkCount = isMobile ? 5 : 8;
              for (let i = 0; i < sparkCount; i++) {
                  const seed = i * 12.9898;
                  const drift = Math.sin(seed + time * 0.9) * (maxDim * 0.16);
                  const up = ((time * 38 + i * 19) % (maxDim * 0.95));
                  const sx = drift;
                  const sy = flameBaseY - up;
                  const p = 0.55 + 0.45 * Math.sin(time * 2.2 + i);
                  this.ctx.globalAlpha = 0.05 + 0.07 * p;
                  const g = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, 10);
                  g.addColorStop(0, 'rgba(255,255,255,0.65)');
                  g.addColorStop(0.25, 'rgba(251,191,36,0.35)');
                  g.addColorStop(0.6, 'rgba(249,115,22,0.20)');
                  g.addColorStop(1, 'rgba(249,115,22,0)');
                  this.ctx.fillStyle = g;
                  this.ctx.beginPath();
                  this.ctx.arc(sx, sy, 10, 0, Math.PI * 2);
                  this.ctx.fill();
              }

              this.ctx.restore();
          } else if (skin === 'skin_butzina') {
              // Mystical energy arcs
              this.ctx.save();
              this.ctx.globalCompositeOperation = 'lighter';
              this.ctx.globalAlpha = 0.18;
              this.ctx.shadowBlur = 14;
              this.ctx.shadowColor = glowColor;
              this.ctx.strokeStyle = 'rgba(192,132,252,0.28)';
              this.ctx.lineWidth = 2.5;
              const r = Math.max(w, h) * 0.78;
              for (let i = 0; i < 2; i++) {
                  const a0 = t * 1.2 + i * 2.2;
                  const span = 0.9 + Math.sin(t * 1.8 + i) * 0.25;
                  this.ctx.beginPath();
                  this.ctx.arc(0, 0, r, a0, a0 + span);
                  this.ctx.stroke();
              }
              this.ctx.restore();
          } else if (skin === 'skin_choshen') {
              // Prismatic sparkle crosses
              const colors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4'];
              this.ctx.save();
              this.ctx.globalCompositeOperation = 'lighter';
              const r = Math.max(w, h) * 0.76;
              for (let i = 0; i < 4; i++) {
                  const a = t * 1.7 + (i / 4) * Math.PI * 2;
                  const x = Math.cos(a) * r;
                  const y = Math.sin(a) * r * 0.65;
                  const c = colors[i % colors.length];
                  this.ctx.globalAlpha = 0.10;
                  this.ctx.strokeStyle = c;
                  this.ctx.lineWidth = 2;
                  this.ctx.shadowBlur = 0;
                  this.ctx.beginPath();
                  this.ctx.moveTo(x - 5, y);
                  this.ctx.lineTo(x + 5, y);
                  this.ctx.moveTo(x, y - 5);
                  this.ctx.lineTo(x, y + 5);
                  this.ctx.stroke();
              }
              this.ctx.restore();
          }
      }

      // Engine glow (cheap: pre-baked sprite, drawn as image)
      const glowSprite = this.shipEngineGlowSprites[skin];
      // Choshen is a plate (no engines) — avoid tinting stones with a golden engine glow
      if (glowSprite && skin !== 'skin_choshen') {
          const t = this.gameFrame * 0.10;
          const pulse = 0.75 + Math.sin(t) * 0.25;
          const engineY = (h / 2) - 10;
          const gSize = 44;
          this.ctx.save();
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.globalAlpha = 0.55 * pulse;
          this.ctx.drawImage(glowSprite, -gSize / 2, engineY - gSize / 2, gSize, gSize);
          this.ctx.restore();
      }

      // Only add a single cheap glow layer when shield/special-weapon is active
      // For Choshen, this overlay would wash out the gem colors (it always has a special weapon),
      // so we skip it and rely on aura + prismatic sparkles instead.
      if ((this.weaponType !== 'normal' || this.shieldStrength > 0) && skin !== 'skin_choshen') {
          const glowColor = this.getShipGlowColor(skin);
          this.ctx.save();
          this.ctx.globalCompositeOperation = 'lighter';
          this.ctx.globalAlpha = 0.18;
          this.ctx.shadowBlur = 10;
          this.ctx.shadowColor = glowColor;
          this.ctx.drawImage(source, -w / 2, -h / 2, w, h);
          this.ctx.restore();
      }

      this.ctx.restore();
  }

  renderShip() {
      const skin = this.config.skin;
      const isMobile = this.width < 600;
      const isDesktop = this.width >= 1024;
      // Bigger ship (requested) while keeping gameplay stable
      const mobileScale = (() => {
        // Tune for phones + landscape: keep ship readable but not overwhelming.
        // ~320px => 0.85, ~600px => 0.92
        const t = Math.max(0, Math.min(1, (this.width - 320) / 280));
        return 0.85 + t * 0.07;
      })();
      const baseScale = isMobile ? mobileScale : 1.18;
      const scale = isDesktop ? baseScale * 1.25 : baseScale;

      const enhanced = this.shipEnhancedTextures[skin];
      if (enhanced) {
          this.renderShipWithTexture(enhanced, skin, scale);
          return;
      }
      const texture = this.shipTextures[skin];
      if (texture && texture.complete && texture.naturalWidth > 0) {
          this.renderShipWithTexture(texture, skin, scale);
          return;
      }

      const butzinaScale = skin === 'skin_butzina' ? scale * 1.4 : scale; // Make Butzina Kadisha bigger 
      if (skin === 'skin_choshen') {
          this.ctx.save(); this.ctx.scale(scale, scale);
          const w = 55, h = 70;

          // Enhanced golden frame with better glow
          this.ctx.shadowBlur = 25; this.ctx.shadowColor = '#fbbf24';
          this.ctx.fillStyle = '#fbbf24'; this.ctx.strokeStyle = '#92400e'; this.ctx.lineWidth = 3;
          this.ctx.beginPath(); this.ctx.roundRect(-w/2, -h/2, w, h, 8); this.ctx.fill(); this.ctx.stroke();

          // Inner shadow for depth
          this.ctx.shadowBlur = 0; this.ctx.strokeStyle = 'rgba(0,0,0,0.2)'; this.ctx.strokeRect(-w/2 + 4, -h/2 + 4, w - 8, h - 8);

          // Enhanced gems with better colors and effects
          const colors = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#64748b', '#eab308', '#d946ef', '#f43f5e'];
          const gemSize = 12; const paddingX = 16, paddingY = 16;
          for(let row=0; row<4; row++) { for(let col=0; col<3; col++) {
              const idx = row * 3 + col; const gx = -w/2 + paddingX + col * (w - 2*paddingX)/2; const gy = -h/2 + paddingY + row * (h - 2*paddingY)/3;
              this.ctx.shadowBlur = 8; this.ctx.shadowColor = colors[idx]; this.ctx.fillStyle = colors[idx];
              this.ctx.beginPath(); this.ctx.arc(gx, gy, gemSize/2, 0, Math.PI*2); this.ctx.fill();

              // Enhanced gem highlights
              this.ctx.fillStyle = 'rgba(255,255,255,0.6)'; this.ctx.beginPath(); this.ctx.arc(gx - 3, gy - 3, 2, 0, Math.PI*2); this.ctx.fill();
              this.ctx.fillStyle = 'rgba(255,255,255,0.3)'; this.ctx.beginPath(); this.ctx.arc(gx + 2, gy + 2, 1.5, 0, Math.PI*2); this.ctx.fill();
              this.ctx.shadowBlur = 0;
          } }

          // Add golden chain details
          this.ctx.strokeStyle = '#92400e'; this.ctx.lineWidth = 2;
          this.ctx.beginPath(); this.ctx.moveTo(-w/2 + 5, -h/2 + 5); this.ctx.lineTo(w/2 - 5, -h/2 + 5); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.moveTo(-w/2 + 5, h/2 - 5); this.ctx.lineTo(w/2 - 5, h/2 - 5); this.ctx.stroke();

          // Add divine light effect
          const lightG = this.ctx.createRadialGradient(0, 0, 10, 0, 0, w/2 + 10);
          lightG.addColorStop(0, 'rgba(251, 191, 36, 0.1)'); lightG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = lightG; this.ctx.beginPath(); this.ctx.arc(0, 0, w/2 + 10, 0, Math.PI*2); this.ctx.fill();

          this.ctx.restore(); return;
      }
      if (skin === 'skin_torah') {
          this.ctx.save(); this.ctx.scale(scale, scale);
          const pulse = Math.sin(this.gameFrame * 0.1) * 4;

          // Golden Torah handles (Etz Chaim) with enhanced detail
          this.ctx.shadowBlur = 25; this.ctx.shadowColor = '#fbbf24';

          // Left handle (Etz Chaim)
          this.ctx.fillStyle = '#fbbf24'; this.ctx.strokeStyle = '#d97706'; this.ctx.lineWidth = 2;
          this.ctx.beginPath(); this.ctx.roundRect(-32, -45, 16, 90, 6); this.ctx.fill(); this.ctx.stroke();

          // Right handle (Etz Chaim)
          this.ctx.beginPath(); this.ctx.roundRect(16, -45, 16, 90, 6); this.ctx.fill(); this.ctx.stroke();

          // Handle decorations - golden rings and ornaments
          this.ctx.fillStyle = '#fef3c7'; this.ctx.strokeStyle = '#d97706'; this.ctx.lineWidth = 1;
          // Top rings
          this.ctx.beginPath(); this.ctx.arc(-24, -45, 8, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.arc(24, -45, 8, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
          // Bottom rings
          this.ctx.beginPath(); this.ctx.arc(-24, 45, 8, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.arc(24, 45, 8, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();

          // Inner golden circles
          this.ctx.fillStyle = '#d97706';
          this.ctx.beginPath(); this.ctx.arc(-24, -45, 5, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.arc(24, -45, 5, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.arc(-24, 45, 5, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.arc(24, 45, 5, 0, Math.PI*2); this.ctx.fill();

          // Handle grip patterns
          this.ctx.strokeStyle = '#92400e'; this.ctx.lineWidth = 3;
          for(let i = 0; i < 6; i++) {
            const y = -35 + i * 12;
            this.ctx.beginPath(); this.ctx.moveTo(-28, y); this.ctx.lineTo(-20, y); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(20, y); this.ctx.lineTo(28, y); this.ctx.stroke();
          }

          this.ctx.shadowBlur = 0;

          // Detailed open Torah scroll (Sefer Torah)
          const scrollWidth = 50, scrollHeight = 65;

          // Parchment base with texture
          const parchmentG = this.ctx.createLinearGradient(-scrollWidth/2, -scrollHeight/2, scrollWidth/2, scrollHeight/2);
          parchmentG.addColorStop(0, '#fef7cd'); parchmentG.addColorStop(0.3, '#fde68a'); parchmentG.addColorStop(0.7, '#fcd34d'); parchmentG.addColorStop(1, '#fef7cd');
          this.ctx.fillStyle = parchmentG;
          this.ctx.beginPath(); this.ctx.roundRect(-scrollWidth/2, -scrollHeight/2, scrollWidth, scrollHeight, 4); this.ctx.fill();

          // Parchment border with aged effect
          this.ctx.strokeStyle = '#d97706'; this.ctx.lineWidth = 3;
          this.ctx.stroke();

          // Scroll edges (rolled appearance)
          this.ctx.fillStyle = '#f59e0b';
          this.ctx.beginPath(); this.ctx.ellipse(-scrollWidth/2, 0, 8, scrollHeight/2, 0, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.ellipse(scrollWidth/2, 0, 8, scrollHeight/2, 0, 0, Math.PI*2); this.ctx.fill();

          // Torah text columns with Hebrew characters (more detailed)
          this.ctx.fillStyle = '#92400e'; this.ctx.font = 'bold 7px Arial';
          this.ctx.textAlign = 'center';

          // Left column
          const leftColumn = ['בְּרֵאשִׁית', 'בָּרָא', 'אֱלֹהִים', 'אֵת', 'הַשָּׁמַיִם', 'וְאֵת', 'הָאָרֶץ'];
          for(let i=0; i<7; i++) {
            this.ctx.fillText(leftColumn[i], -15, -25 + i * 9);
          }

          // Right column
          const rightColumn = ['וְהָאָרֶץ', 'הָיְתָה', 'תֹּהוּ', 'וָבֹהוּ', 'וְחֹשֶׁךְ', 'עַל', 'פְּנֵי'];
          for(let i=0; i<7; i++) {
            this.ctx.fillText(rightColumn[i], 15, -25 + i * 9);
          }

          // Decorative ketav (crowns) on letters
          this.ctx.fillStyle = '#fbbf24';
          this.ctx.font = 'bold 3px Arial';
          for(let i=0; i<3; i++) {
            this.ctx.fillText('ׂׂ', -12 + i * 8, -28);
            this.ctx.fillText('ׂׂ', 12 + i * 8, -28);
          }

          // Holy aura/glow effect around the entire Torah
          const auraPulse = pulse * 2;
          const auraG = this.ctx.createRadialGradient(0, 0, 20, 0, 0, 70 + auraPulse);
          auraG.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
          auraG.addColorStop(0.3, 'rgba(251, 191, 36, 0.25)');
          auraG.addColorStop(0.6, 'rgba(245, 158, 11, 0.15)');
          auraG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = auraG;
          this.ctx.beginPath(); this.ctx.arc(0, 0, 70 + auraPulse, 0, Math.PI*2); this.ctx.fill();

          // Divine particles floating around
          this.ctx.fillStyle = '#fbbf24';
          this.ctx.globalAlpha = 0.6;
          for(let i=0; i<8; i++) {
            const angle = (this.gameFrame * 0.08 + i/8 * Math.PI * 2) % (Math.PI * 2);
            const distance = 45 + Math.sin(this.gameFrame * 0.12 + i) * 8;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;
            this.ctx.shadowBlur = 8; this.ctx.shadowColor = '#fbbf24';
            this.ctx.beginPath(); this.ctx.arc(x, y, 2, 0, Math.PI*2); this.ctx.fill();
          }
          this.ctx.shadowBlur = 0;
          this.ctx.globalAlpha = 1;

          // Additional golden rays emanating from the Torah
          this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)'; this.ctx.lineWidth = 2;
          for(let i=0; i<6; i++) {
            const angle = i * Math.PI / 3;
            const startRadius = 55;
            const endRadius = 75 + pulse;
            const x1 = Math.cos(angle) * startRadius;
            const y1 = Math.sin(angle) * startRadius;
            const x2 = Math.cos(angle) * endRadius;
            const y2 = Math.sin(angle) * endRadius;
            this.ctx.beginPath(); this.ctx.moveTo(x1, y1); this.ctx.lineTo(x2, y2); this.ctx.stroke();
          }

          this.ctx.restore(); return;
      }

      // Botzina Kadisha (Holy Light) - Sleek Futuristic Fighter Jet
      if (skin === 'skin_butzina') {
          this.ctx.save(); this.ctx.scale(butzinaScale, butzinaScale);

          // Royal Purple and Gold color scheme
          const royalPurple = '#7c3aed'; // Royal Purple
          const deepPurple = '#581c87'; // Deep Purple
          const gold = '#fbbf24'; // Gold
          const lightGold = '#fde68a'; // Light Gold
          const pulse = Math.sin(this.gameFrame * 0.15) * 3;

          // Holy light aura effect
          const auraG = this.ctx.createRadialGradient(0, 0, 15, 0, 0, 60 + pulse);
          auraG.addColorStop(0, 'rgba(124, 58, 237, 0.3)');
          auraG.addColorStop(0.5, 'rgba(251, 191, 36, 0.2)');
          auraG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = auraG;
          this.ctx.beginPath(); this.ctx.arc(0, 0, 60 + pulse, 0, Math.PI*2); this.ctx.fill();

          // Main fuselage - sleek triangular design
          this.ctx.shadowBlur = 20; this.ctx.shadowColor = gold;

          // Upper fuselage (triangular)
          this.ctx.fillStyle = royalPurple;
          this.ctx.strokeStyle = gold; this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.moveTo(0, -35); // Nose
          this.ctx.lineTo(-12, 15); // Left wing root
          this.ctx.lineTo(-8, 25); // Left rear
          this.ctx.lineTo(8, 25); // Right rear
          this.ctx.lineTo(12, 15); // Right wing root
          this.ctx.closePath();
          this.ctx.fill(); this.ctx.stroke();

          // Lower fuselage extension
          this.ctx.beginPath();
          this.ctx.moveTo(-8, 25);
          this.ctx.lineTo(-4, 35);
          this.ctx.lineTo(4, 35);
          this.ctx.lineTo(8, 25);
          this.ctx.closePath();
          this.ctx.fill(); this.ctx.stroke();

          // Wings - delta wing design
          this.ctx.fillStyle = deepPurple;
          this.ctx.strokeStyle = gold; this.ctx.lineWidth = 2;

          // Left wing
          this.ctx.beginPath();
          this.ctx.moveTo(-12, 15);
          this.ctx.lineTo(-35, -5);
          this.ctx.lineTo(-25, 20);
          this.ctx.lineTo(-8, 25);
          this.ctx.closePath();
          this.ctx.fill(); this.ctx.stroke();

          // Right wing
          this.ctx.beginPath();
          this.ctx.moveTo(12, 15);
          this.ctx.lineTo(35, -5);
          this.ctx.lineTo(25, 20);
          this.ctx.lineTo(8, 25);
          this.ctx.closePath();
          this.ctx.fill(); this.ctx.stroke();

          // Wing details - golden accents
          this.ctx.fillStyle = gold;
          // Left wing tip
          this.ctx.beginPath();
          this.ctx.moveTo(-35, -5);
          this.ctx.lineTo(-32, -8);
          this.ctx.lineTo(-28, -2);
          this.ctx.closePath();
          this.ctx.fill();

          // Right wing tip
          this.ctx.beginPath();
          this.ctx.moveTo(35, -5);
          this.ctx.lineTo(32, -8);
          this.ctx.lineTo(28, -2);
          this.ctx.closePath();
          this.ctx.fill();

          // Cockpit area - transparent with golden frame
          this.ctx.fillStyle = 'rgba(253, 230, 138, 0.3)';
          this.ctx.strokeStyle = gold; this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.ellipse(0, -10, 6, 12, 0, 0, Math.PI*2);
          this.ctx.fill(); this.ctx.stroke();

          // Engines - twin rear thrusters with holy energy
          this.ctx.shadowBlur = 30; this.ctx.shadowColor = gold;

          // Left engine
          const leftEngineG = this.ctx.createRadialGradient(-6, 32, 0, -6, 32, 12);
          leftEngineG.addColorStop(0, gold);
          leftEngineG.addColorStop(0.7, royalPurple);
          leftEngineG.addColorStop(1, deepPurple);
          this.ctx.fillStyle = leftEngineG;
          this.ctx.beginPath(); this.ctx.ellipse(-6, 32, 5, 15, 0, 0, Math.PI*2); this.ctx.fill();

          // Right engine
          const rightEngineG = this.ctx.createRadialGradient(6, 32, 0, 6, 32, 12);
          rightEngineG.addColorStop(0, gold);
          rightEngineG.addColorStop(0.7, royalPurple);
          rightEngineG.addColorStop(1, deepPurple);
          this.ctx.fillStyle = rightEngineG;
          this.ctx.beginPath(); this.ctx.ellipse(6, 32, 5, 15, 0, 0, Math.PI*2); this.ctx.fill();

          // Engine exhaust trails
          this.ctx.shadowBlur = 25; this.ctx.shadowColor = gold;
          this.ctx.fillStyle = gold;
          this.ctx.globalAlpha = 0.8;

          // Left exhaust
          this.ctx.beginPath();
          this.ctx.ellipse(-6, 45, 2, 8, 0, 0, Math.PI*2);
          this.ctx.fill();

          // Right exhaust
          this.ctx.beginPath();
          this.ctx.ellipse(6, 45, 2, 8, 0, 0, Math.PI*2);
          this.ctx.fill();

          this.ctx.globalAlpha = 1;
          this.ctx.shadowBlur = 0;

          // Holy light particles emanating from engines
          this.ctx.fillStyle = gold;
          for(let i=0; i<4; i++) {
            const angle = (this.gameFrame * 0.1 + i/4 * Math.PI * 2) % (Math.PI * 2);
            const x = Math.cos(angle) * 25;
            const y = Math.sin(angle) * 15 + 20;
            this.ctx.shadowBlur = 10; this.ctx.shadowColor = gold;
            this.ctx.beginPath(); this.ctx.arc(x, y, 1.5, 0, Math.PI*2); this.ctx.fill();
          }
          this.ctx.shadowBlur = 0;

          this.ctx.restore(); return;
      }

      // FUTURISTIC SPACESHIP DESIGN - METALLIC FINISH WITH GLOWING COCKPIT

      // Color scheme based on skin
      let hullColor = '#4a5568', accentColor = '#60a5fa', cockpitColor = '#00ffff', engineColor = '#ff6b35';
      if (skin === 'skin_gold') {
        hullColor = '#d97706'; accentColor = '#fbbf24'; cockpitColor = '#fef3c7'; engineColor = '#f59e0b';
      } else if (skin === 'skin_stealth') {
        hullColor = '#1e293b'; accentColor = '#475569'; cockpitColor = '#94a3b8'; engineColor = '#ef4444';
      } else if (skin === 'skin_butzina') {
        hullColor = '#581c87'; accentColor = '#a855f7'; cockpitColor = '#e9d5ff'; engineColor = '#d8b4fe';
      }

      this.ctx.save();
      this.ctx.scale(scale, scale);

      // Ship hull - sleek aerodynamic design
      this.ctx.fillStyle = hullColor;
      this.ctx.strokeStyle = accentColor;
      this.ctx.lineWidth = 2;

      // Main fuselage
      this.ctx.beginPath();
      this.ctx.moveTo(0, -50); // Nose
      this.ctx.bezierCurveTo(25, -35, 35, -10, 30, 15); // Right curve
      this.ctx.bezierCurveTo(25, 30, 15, 40, 8, 45); // Right rear
      this.ctx.lineTo(-8, 45); // Left rear
      this.ctx.bezierCurveTo(-15, 40, -25, 30, -30, 15); // Left curve
      this.ctx.bezierCurveTo(-35, -10, -25, -35, 0, -50); // Left curve back to nose
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Metallic finish - diagonal shine lines
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      this.ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        this.ctx.beginPath();
        this.ctx.moveTo(-25 + i * 8, -40 + i * 5);
        this.ctx.lineTo(-15 + i * 8, -20 + i * 5);
        this.ctx.stroke();
      }

      // Wing details - delta wing design
      this.ctx.fillStyle = hullColor;
      this.ctx.strokeStyle = accentColor;
      this.ctx.lineWidth = 1.5;

      // Left wing
      this.ctx.beginPath();
      this.ctx.moveTo(-30, 5);
      this.ctx.lineTo(-55, -15);
      this.ctx.lineTo(-45, 20);
      this.ctx.lineTo(-25, 15);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right wing
      this.ctx.beginPath();
      this.ctx.moveTo(30, 5);
      this.ctx.lineTo(55, -15);
      this.ctx.lineTo(45, 20);
      this.ctx.lineTo(25, 15);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Wing leading edges with metallic shine
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(-30, 5);
      this.ctx.lineTo(-55, -15);
      this.ctx.moveTo(30, 5);
      this.ctx.lineTo(55, -15);
      this.ctx.stroke();

      // GLOWING COCKPIT - Central feature
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = cockpitColor;

      // Cockpit glass
      const cockpitG = this.ctx.createRadialGradient(0, -25, 0, 0, -25, 15);
      cockpitG.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      cockpitG.addColorStop(0.5, cockpitColor);
      cockpitG.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
      this.ctx.fillStyle = cockpitG;
      this.ctx.beginPath();
      this.ctx.ellipse(0, -25, 12, 18, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Cockpit frame
      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = hullColor;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // Inner cockpit details
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      this.ctx.beginPath();
      this.ctx.ellipse(0, -27, 6, 10, 0, 0, Math.PI*2);
      this.ctx.fill();

      // HUD display lines in cockpit
      this.ctx.strokeStyle = cockpitColor;
      this.ctx.lineWidth = 1;
      this.ctx.globalAlpha = 0.7;
      for (let i = 0; i < 5; i++) {
        this.ctx.beginPath();
        this.ctx.moveTo(-8, -35 + i * 4);
        this.ctx.lineTo(8, -35 + i * 4);
        this.ctx.stroke();
      }
      this.ctx.globalAlpha = 1;

      // Engine nozzles - dual thrusters
      this.ctx.fillStyle = '#2d3748';
      this.ctx.strokeStyle = accentColor;
      this.ctx.lineWidth = 1;

      // Left engine
      this.ctx.beginPath();
      this.ctx.ellipse(-12, 42, 6, 12, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Right engine
      this.ctx.beginPath();
      this.ctx.ellipse(12, 42, 6, 12, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Engine glow effects
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = engineColor;
      this.ctx.fillStyle = engineColor;
      this.ctx.globalAlpha = 0.8;

      // Left engine glow
      this.ctx.beginPath();
      this.ctx.ellipse(-12, 42, 4, 8, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Right engine glow
      this.ctx.beginPath();
      this.ctx.ellipse(12, 42, 4, 8, 0, 0, Math.PI*2);
      this.ctx.fill();

      this.ctx.globalAlpha = 1;
      this.ctx.shadowBlur = 0;

      // Weapon hardpoints
      this.ctx.fillStyle = accentColor;
      this.ctx.beginPath();
      this.ctx.ellipse(-20, 10, 3, 6, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(20, 10, 3, 6, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Navigation lights
      this.ctx.fillStyle = '#ef4444'; // Red navigation light
      this.ctx.beginPath();
      this.ctx.arc(-35, -10, 2, 0, Math.PI*2);
      this.ctx.fill();

      this.ctx.fillStyle = '#22c55e'; // Green navigation light
      this.ctx.beginPath();
      this.ctx.arc(35, -10, 2, 0, Math.PI*2);
      this.ctx.fill();

      // Antenna/details on top
      this.ctx.strokeStyle = hullColor;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(-5, -55);
      this.ctx.lineTo(-5, -65);
      this.ctx.moveTo(5, -55);
      this.ctx.lineTo(5, -65);
      this.ctx.stroke();

      // Antenna tips
      this.ctx.fillStyle = accentColor;
      this.ctx.beginPath();
      this.ctx.arc(-5, -67, 1, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(5, -67, 1, 0, Math.PI*2);
      this.ctx.fill();

      // Ship-specific effects
      if (skin === 'skin_gold') {
        // Golden particle aura
        this.ctx.fillStyle = '#fbbf24';
        this.ctx.globalAlpha = 0.6;
        for (let i = 0; i < 10; i++) {
          const angle = (i / 10) * Math.PI * 2;
          const x = Math.cos(angle) * 45;
          const y = Math.sin(angle) * 35 - 15;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.5, 0, Math.PI*2);
          this.ctx.fill();
        }
        this.ctx.globalAlpha = 1;
      } else if (skin === 'skin_butzina') {
        // Purple energy field
        this.ctx.strokeStyle = '#a855f7';
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.7;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          this.ctx.beginPath();
          this.ctx.moveTo(0, -20);
          this.ctx.quadraticCurveTo(
            Math.cos(angle) * 30, Math.sin(angle) * 25 - 10,
            Math.cos(angle) * 40, Math.sin(angle) * 30 - 5
          );
          this.ctx.stroke();
        }
        this.ctx.globalAlpha = 1;
      }

      this.ctx.restore();
  }

  drawEnemy(e: any) {
      this.ctx.save(); this.ctx.translate(e.x, e.y); this.ctx.rotate(e.rotation);
      const grad = this.ctx.createRadialGradient(0, 0, 5, 0, 0, e.radius);
      grad.addColorStop(0, '#475569'); grad.addColorStop(1, '#020617');
      this.ctx.fillStyle = grad; this.ctx.beginPath(); 
      for(let i=0; i<8; i++) { const angle = (i/8) * Math.PI * 2; const r = e.radius * (i % 2 === 0 ? 1 : 0.88); this.ctx.lineTo(Math.cos(angle)*r, Math.sin(angle)*r); }
      this.ctx.closePath(); this.ctx.fill();
      this.ctx.strokeStyle = '#94a3b8'; this.ctx.lineWidth = 1.5; this.ctx.stroke();
      this.ctx.rotate(-e.rotation); this.ctx.fillStyle = 'white'; 
      this.ctx.font = `bold ${this.width < 500 ? '14px' : '18px'} Rubik`; 
      this.ctx.textAlign = 'center';
      this.ctx.fillText(e.text, 0, 8); this.ctx.restore();
  }

  drawProjectile(p: PoolableProjectile) {
      if (!p.active) return;
      const isMobile = this.width < 600;
      this.ctx.save();
      if(p.type === 'beam') {
          const scale = isMobile ? 0.5 : 1.0;
          const endY = p.targetY;

          // Outer neon-blue glow (tight and intense)
          this.ctx.shadowBlur = 30 * scale; this.ctx.shadowColor = '#00ffff';
          this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; this.ctx.lineWidth = 12 * scale;
          this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, endY); this.ctx.stroke();

          // Middle energy layer (brighter blue)
          this.ctx.shadowBlur = 20 * scale; this.ctx.shadowColor = '#60efff';
          this.ctx.strokeStyle = 'rgba(96, 239, 255, 0.9)'; this.ctx.lineWidth = 6 * scale;
          this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, endY); this.ctx.stroke();

          // White-hot center core (thicker and more concentrated)
          this.ctx.shadowBlur = 12 * scale; this.ctx.shadowColor = '#ffffff';
          this.ctx.strokeStyle = '#ffffff'; this.ctx.lineWidth = 3 * scale;
          this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, endY); this.ctx.stroke();

          // Impact point with concentrated energy
          const impactG = this.ctx.createRadialGradient(p.x, endY, 0, p.x, endY, 12 * scale);
          impactG.addColorStop(0, '#ffffff');
          impactG.addColorStop(0.5, '#60efff');
          impactG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = impactG;
          this.ctx.shadowBlur = 20 * scale; this.ctx.shadowColor = '#00ffff';
          this.ctx.beginPath(); this.ctx.arc(p.x, endY, 12 * scale, 0, Math.PI*2); this.ctx.fill();

          this.ctx.shadowBlur = 0;
      } else if (p.type === 'fire') {
          this.ctx.translate(p.x, p.y); 
          const baseSize = isMobile ? 18 : 35;
          const pulseRange = isMobile ? 6 : 12;
          const rPulse = baseSize + Math.sin(this.gameFrame * 0.4) * pulseRange;
          
          const fG = this.ctx.createRadialGradient(0,0,5,0,0,rPulse); fG.addColorStop(0, '#fff'); fG.addColorStop(0.3, '#fde68a'); fG.addColorStop(0.6, '#f97316'); fG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = fG; this.ctx.shadowBlur = 30; this.ctx.shadowColor = '#f97316';
          this.ctx.beginPath(); this.ctx.arc(0, 0, rPulse, 0, Math.PI*2); this.ctx.fill();
      } else if (p.type === 'electric') {
          // Enhanced electric bolt with multiple branching streams
          const segments = 12;
          const branchChance = 0.3;

          // Main lightning bolt
          this.ctx.strokeStyle = '#60efff'; this.ctx.lineWidth = 4; this.ctx.shadowBlur = 25; this.ctx.shadowColor = '#60efff';
          this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
          this.ctx.beginPath();
          let curX = p.x; let curY = p.y; this.ctx.moveTo(curX, curY);

          for(let i=0; i<segments; i++) {
              const nextX = curX + (Math.random() - 0.5) * 40;
              const nextY = curY - 45;
              this.ctx.lineTo(nextX, nextY);
              curX = nextX; curY = nextY;

              // Random branching
              if (Math.random() < branchChance && i > 2 && i < segments - 2) {
                  this.ctx.moveTo(curX, curY);
                  const branchX = curX + (Math.random() - 0.5) * 30;
                  const branchY = curY - 25;
                  this.ctx.lineTo(branchX, branchY);

                  // Small sub-branch
                  if (Math.random() < 0.5) {
                      this.ctx.moveTo(branchX, branchY);
                      this.ctx.lineTo(branchX + (Math.random() - 0.5) * 15, branchY - 15);
                  }

                  this.ctx.moveTo(curX, curY);
              }
          }
          this.ctx.stroke();

          // Inner bright core
          this.ctx.strokeStyle = '#ffffff'; this.ctx.lineWidth = 2; this.ctx.shadowBlur = 15; this.ctx.shadowColor = '#ffffff';
          this.ctx.beginPath();
          curX = p.x; curY = p.y; this.ctx.moveTo(curX, curY);
          for(let i=0; i<segments; i++) {
              curX += (Math.random() - 0.5) * 35;
              curY -= 40;
              this.ctx.lineTo(curX, curY);
          }
          this.ctx.stroke();
      } else if (p.type === 'laser') {
          this.ctx.translate(p.x, p.y);
          this.ctx.fillStyle = '#a855f7';
          this.ctx.shadowBlur = 15; this.ctx.shadowColor = '#a855f7';
          this.ctx.fillRect(-3, -20, 6, 40); // Long laser line
      } else {
          this.ctx.translate(p.x, p.y); if(p.angle) this.ctx.rotate(p.angle);

          // Glowing energy bolt with capsule shape
          const isMissile = p.type === 'missile';
          const boltColor = isMissile ? '#ef4444' : '#60a5fa';
          const glowColor = isMissile ? '#ff6b6b' : '#93c5fd';

          // Outer glow effect
          this.ctx.shadowBlur = 15; this.ctx.shadowColor = glowColor;
          const glowG = this.ctx.createRadialGradient(0, -7.5, 0, 0, -7.5, 20);
          glowG.addColorStop(0, boltColor);
          glowG.addColorStop(0.7, 'rgba(' + (isMissile ? '239, 68, 68' : '96, 165, 250') + ', 0.6)');
          glowG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = glowG;

          // Capsule-shaped bolt body
          this.ctx.beginPath();
          this.ctx.roundRect(-4, -20, 8, 35, 4);
          this.ctx.fill();

          // Inner bright core
          this.ctx.shadowBlur = 8; this.ctx.shadowColor = '#ffffff';
          this.ctx.fillStyle = '#ffffff';
          this.ctx.beginPath();
          this.ctx.roundRect(-2, -18, 4, 31, 2);
          this.ctx.fill();

          // Energy trail effect
          this.ctx.shadowBlur = 12; this.ctx.shadowColor = boltColor;
          this.ctx.fillStyle = boltColor;
          this.ctx.globalAlpha = 0.4;
          this.ctx.beginPath();
          this.ctx.roundRect(-3, 10, 6, 15, 3);
          this.ctx.fill();

          this.ctx.globalAlpha = 1;
          this.ctx.shadowBlur = 0;
      }
      this.ctx.restore();
  }

  private getBossProjectileSprite(owner: BossId): HTMLCanvasElement {
      const cached = this.bossProjectileSprites[owner];
      if (cached) return cached;

      const size = 120;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) return c;

      const center = size / 2;
      const baseR = 24;
      ctx.translate(center, center);

      const drawTannina = () => {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, baseR * 1.45);
          g.addColorStop(0, '#fdf4ff');
          g.addColorStop(0.35, '#e9d5ff');
          g.addColorStop(1, 'rgba(216,180,254,0)');
          ctx.fillStyle = g;
          ctx.shadowBlur = 22;
          ctx.shadowColor = '#d8b4fe';
          ctx.beginPath();
          ctx.arc(0, 0, baseR, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.arc(0, 0, baseR * 0.7, 0, Math.PI * 2);
          ctx.stroke();
      };

      const drawKoy = () => {
          const r = baseR * 1.05;
          ctx.shadowBlur = 8;
          ctx.shadowColor = '#4b5563';
          ctx.fillStyle = '#9ca3af';
          ctx.beginPath();
          for (let i = 0; i < 7; i++) {
              const ang = (i / 7) * Math.PI * 2;
              const jag = 0.8 + (i % 2 === 0 ? 0.18 : -0.05);
              const rad = r * jag;
              if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
              else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#1f2937';
          ctx.lineWidth = 1.4;
          ctx.stroke();
      };

      const drawShed = () => {
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#7c3aed';
          const spike = baseR * 1.5;
          ctx.fillStyle = '#4c1d95';
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
              const ang = (i / 10) * Math.PI * 2;
              const rad = i % 2 === 0 ? spike : baseR * 0.7;
              if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
              else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
          }
          ctx.closePath();
          ctx.fill();
          const innerG = ctx.createRadialGradient(0, 0, 0, 0, 0, baseR);
          innerG.addColorStop(0, '#c084fc');
          innerG.addColorStop(1, 'rgba(124,58,237,0)');
          ctx.fillStyle = innerG;
          ctx.beginPath();
          ctx.arc(0, 0, baseR * 0.9, 0, Math.PI * 2);
          ctx.fill();
      };

      const drawAshmedai = () => {
          ctx.rotate(Math.PI / 2);
          const flameG = ctx.createLinearGradient(0, -baseR * 1.6, 0, baseR * 1.2);
          flameG.addColorStop(0, '#fff7ed');
          flameG.addColorStop(0.35, '#f97316');
          flameG.addColorStop(1, 'rgba(239,68,68,0.15)');
          ctx.fillStyle = flameG;
          ctx.shadowBlur = 18;
          ctx.shadowColor = '#f97316';
          ctx.beginPath();
          ctx.moveTo(0, -baseR * 1.5);
          ctx.quadraticCurveTo(baseR * 0.95, baseR * 0.2, 0, baseR * 1.2);
          ctx.quadraticCurveTo(-baseR * 0.95, baseR * 0.2, 0, -baseR * 1.5);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(0, -baseR * 0.2, baseR * 0.35, baseR * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
      };

      const drawAgirat = () => {
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#f472b6';
          const r2 = baseR * 1.05;
          ctx.fillStyle = '#ec4899';
          ctx.beginPath();
          ctx.moveTo(0, -r2);
          ctx.quadraticCurveTo(r2 * 0.95, -r2 * 0.2, 0, r2);
          ctx.quadraticCurveTo(-r2 * 0.95, -r2 * 0.2, 0, -r2);
          ctx.fill();
          const swirl = ctx.createRadialGradient(0, 0, 0, 0, 0, baseR);
          swirl.addColorStop(0, '#ffe4f3');
          swirl.addColorStop(1, 'rgba(244,114,182,0)');
          ctx.fillStyle = swirl;
          ctx.beginPath();
          ctx.arc(0, 0, baseR * 0.85, 0, Math.PI * 2);
          ctx.fill();
      };

      const drawLeviathan = () => {
          const shardLen = baseR * 1.7;
          ctx.rotate(Math.PI / 2);
          const g = ctx.createLinearGradient(0, -shardLen, 0, shardLen * 0.25);
          g.addColorStop(0, '#e0f2fe');
          g.addColorStop(0.4, '#22d3ee');
          g.addColorStop(1, 'rgba(14,165,233,0.1)');
          ctx.fillStyle = g;
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#22d3ee';
          ctx.beginPath();
          ctx.moveTo(0, -shardLen);
          ctx.lineTo(baseR * 0.9, shardLen * 0.2);
          ctx.lineTo(0, shardLen * 0.55);
          ctx.lineTo(-baseR * 0.9, shardLen * 0.2);
          ctx.closePath();
          ctx.fill();
      };

      const drawZiz = () => {
          ctx.rotate(Math.PI / 2);
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#fbbf24';
          const g = ctx.createLinearGradient(-baseR, -baseR * 1.3, baseR, baseR * 0.8);
          g.addColorStop(0, '#fff7d6');
          g.addColorStop(0.5, '#facc15');
          g.addColorStop(1, 'rgba(250,204,21,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, -baseR * 1.3);
          ctx.bezierCurveTo(baseR * 0.9, -baseR * 0.9, baseR * 0.9, baseR * 0.5, 0, baseR * 0.9);
          ctx.bezierCurveTo(-baseR * 0.9, baseR * 0.5, -baseR * 0.9, -baseR * 0.9, 0, -baseR * 1.3);
          ctx.fill();
      };

      const drawDefault = () => {
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#ef4444';
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(0, 0, baseR, 0, Math.PI * 2);
          ctx.fill();
      };

      if (owner === 'tannina') drawTannina();
      else if (owner === 'koy') drawKoy();
      else if (owner === 'shed') drawShed();
      else if (owner === 'ashmedai') drawAshmedai();
      else if (owner === 'agirat') drawAgirat();
      else if (owner === 'leviathan') drawLeviathan();
      else if (owner === 'ziz') drawZiz();
      else drawDefault();

      this.bossProjectileSprites[owner] = c;
      return c;
  }

  private drawBossProjectile(p: BossProjectile) {
      if (!p) return;
      const owner: BossId = p.owner || 'tannina';
      const radius = p.radius ?? 18;
      const sprite = this.getBossProjectileSprite(owner);
      const baseRadius = 24;
      const scalePulse = owner === 'tannina' ? 1 + Math.sin((p.tick || 0) * 0.08) * 0.05 : 1;
      const scale = (radius / baseRadius) * scalePulse;

      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      let rot = p.spin || 0;
      if (owner === 'ashmedai' || owner === 'leviathan' || owner === 'ziz') {
          rot += Math.atan2(p.vy || 1, p.vx || 0) + Math.PI / 2;
      }
      if (rot) this.ctx.rotate(rot);
      if (owner === 'tannina' || owner === 'shed' || owner === 'agirat') {
          this.ctx.globalCompositeOperation = 'lighter';
      }
      this.ctx.scale(scale, scale);
      this.ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      this.ctx.restore();
  }

  private spawnBossProjectile(
      bossId: BossId,
      x: number,
      y: number,
      vx: number,
      vy: number,
      extras: Partial<BossProjectile> = {}
  ) {
      this.bossProjectiles.push({
          x,
          y,
          vx,
          vy,
          owner: bossId,
          radius: extras.radius ?? 24,
          spin: extras.spin,
          variant: extras.variant,
          tick: 0,
          seed: extras.seed ?? Math.random()
      });
      if (this.bossProjectiles.length > this.maxBossProjectiles) {
          this.bossProjectiles.splice(0, this.bossProjectiles.length - this.maxBossProjectiles);
      }
  }

  updateBoss(dt: number) {
      const b = this.boss; if (!b) return;
      b.frame += dt; b.x = (this.width/2) + Math.sin(b.frame*0.012)*(this.width/4.5);
      if(b.y < b.targetY) b.y += 0.9 * dt;

      b.timer = (b.timer || 0) + dt;
      if(b.timer >= b.attackRate) {
          b.timer = 0;

          const bossId: BossId = (b.id as BossId) || this.getBossIdForLevel(this.level);
          const spd: number = typeof b.speedMult === 'number' ? b.speedMult : 1;

          // Attack patterns by boss (independent of level once bossCycleMode is enabled)
          if (bossId === 'tannina') {
              this.spawnBossProjectile(bossId, b.x - 120, b.y + 100, 0, 4.0 * spd, { radius: 16, variant: 'pulse' });
              this.spawnBossProjectile(bossId, b.x + 120, b.y + 100, 0, 4.0 * spd, { radius: 16, variant: 'pulse' });
          } else if (bossId === 'koy') {
              for(let i=-2; i<=2; i++) {
                  this.spawnBossProjectile(
                      bossId,
                      b.x,
                      b.y + 100,
                      i * 1.8 * spd,
                      3.5 * spd,
                      { radius: 18, spin: Math.random() * Math.PI * 2, seed: Math.random(), variant: 'rock' }
                  );
              }
          } else if (bossId === 'shed') {
              for(let i=0; i<12; i++) { 
                  const angle = (i/12) * Math.PI * 2; 
                  this.spawnBossProjectile(
                      bossId,
                      b.x,
                      b.y + 100,
                      Math.cos(angle)*4.5*spd,
                      Math.sin(angle)*4.5*spd,
                      { radius: 15, variant: 'void', spin: Math.random() * 0.6 }
                  ); 
              }
          } else if (bossId === 'ashmedai') {
              // Targeted shots (5)
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              for(let i=-2; i<=2; i++) this.spawnBossProjectile(
                  bossId,
                  b.x,
                  b.y+100,
                  Math.cos(ang+i*0.2)*5*spd,
                  Math.sin(ang+i*0.2)*5*spd,
                  { radius: 18, variant: 'fire' }
              );

              // Radial shots (8)
              for(let i=0; i<8; i++) { 
                  const angle = (i/8) * Math.PI * 2; 
                  this.spawnBossProjectile(
                      bossId,
                      b.x,
                      b.y + 100,
                      Math.cos(angle)*5*spd,
                      Math.sin(angle)*5*spd,
                      { radius: 16, variant: 'ember' }
                  ); 
              }

              // Side spread (4)
              for(let i=-1; i<=2; i++) this.spawnBossProjectile(
                  bossId,
                  b.x + i*80,
                  b.y + 100,
                  i * 0.3 * spd,
                  4.5*spd,
                  { radius: 14, variant: 'ember' }
              );
          } else if (bossId === 'agirat') {
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              for(let i=-1; i<=1; i++) this.spawnBossProjectile(
                  bossId,
                  b.x,
                  b.y+100,
                  Math.cos(ang+i*0.2)*5*spd,
                  Math.sin(ang+i*0.2)*5*spd,
                  { radius: 15, variant: 'hex' }
              );
          } else if (bossId === 'leviathan') {
              for(let i=0; i<10; i++) { 
                  const ang = (this.gameFrame*0.1) + (i/10)*Math.PI*2; 
                  this.spawnBossProjectile(
                      bossId,
                      b.x,
                      b.y+100,
                      Math.cos(ang)*4.5*spd,
                      Math.sin(ang)*4.5*spd,
                      { radius: 17, variant: 'tide', spin: Math.random() * 0.3 }
                  ); 
              }
          } else { // ziz
              for(let i=0; i<8; i++) { 
                  const ang = (this.gameFrame*0.1) + (i/8)*Math.PI*2; 
                  this.spawnBossProjectile(
                      bossId,
                      b.x,
                      b.y+100,
                      Math.cos(ang)*4*spd,
                      Math.sin(ang)*4*spd,
                      { radius: 16, variant: 'feather', spin: Math.random() * Math.PI * 2 }
                  ); 
              }
          }
          Sound.play('boss_shoot');
      }

      for (let i = this.bossProjectiles.length - 1; i >= 0; i--) {
        let p = this.bossProjectiles[i];
        if (!p) continue;
        p.tick = (p.tick || 0) + dt;
        if (p.spin !== undefined) p.spin += (p.owner === 'koy' ? 0.025 : 0.012) * dt;
        if (p.owner === 'tannina') p.x += Math.sin((p.tick || 0) * 0.09) * 0.7;
        if (p.owner === 'leviathan') p.x += Math.sin((p.tick || 0) * 0.07) * 0.8;
        if (p.owner === 'ziz') p.x += Math.cos((p.tick || 0) * 0.05) * 0.45;
        p.y += p.vy * dt;
        if (p.vx) p.x += p.vx * dt;
        const hitRadius = p.radius ?? 28;
        if(Math.hypot(p.x - this.player.x, p.y - this.player.y) < hitRadius) { this.handleMiss(); this.bossProjectiles.splice(i, 1); }
      }
  }

  drawBoss() {
      const b = this.boss; if (!b) return;
      const isMobile = this.width < 600;
      this.ctx.save(); this.ctx.translate(b.x, b.y);
      if (isMobile) this.ctx.scale(0.75, 0.75);

      const bossId: BossId = (b.id as BossId) || this.getBossIdForLevel(this.level);
      const loop = typeof (b as any).loop === 'number' ? (b as any).loop : 0;

      // High-quality boss VFX layer (dynamic aura + particles)
      this.drawBossVfx(bossId, loop);

      // Subtle “camera light” from above for depth (masked by boss body because we only draw under it)
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = 0.12;
      const light = this.ctx.createRadialGradient(0, -120, 20, 0, -120, 260);
      light.addColorStop(0, 'rgba(255,255,255,0.35)');
      light.addColorStop(0.4, 'rgba(255,255,255,0.10)');
      light.addColorStop(1, 'rgba(255,255,255,0)');
      this.ctx.fillStyle = light;
      this.ctx.beginPath();
      this.ctx.arc(0, 20, 320, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      // Prefer user-provided boss image (public/bosses/...) with safe fallback to procedural bosses
      if (!this.drawBossFromTexture(bossId)) {
          if (bossId === 'tannina') this.drawTannina();
          else if (bossId === 'koy') this.drawKoy();
          else if (bossId === 'shed') this.drawShed();
          else if (bossId === 'ashmedai') this.drawAshmedai();
          else if (bossId === 'agirat') this.drawAgirat();
          else if (bossId === 'leviathan') this.drawLeviathan();
          else this.drawZiz();
      }
      this.ctx.restore();
  }

  drawTannina() {
      const pulse = Math.sin(this.gameFrame * 0.08) * 5;

      // Massive serpentine body with scales
      this.ctx.fillStyle = '#1e3a8a';
      this.ctx.strokeStyle = '#3b82f6';
      this.ctx.lineWidth = 4;

      // Main body - long and serpentine
      this.ctx.beginPath();
      this.ctx.ellipse(0, 30, 140, 50, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Scale pattern on body
      this.ctx.fillStyle = '#1d4ed8';
      for (let i = 0; i < 20; i++) {
          const x = (i - 10) * 12;
          const y = 20 + Math.sin(i * 0.5) * 10;
          this.ctx.beginPath();
          this.ctx.ellipse(x, y, 6, 12, Math.PI/4, 0, Math.PI*2);
          this.ctx.fill();
      }

      // Seven terrifying heads
      for (let i = 0; i < 7; i++) {
          const angle = (i / 6) * Math.PI - Math.PI;
          const headX = Math.cos(angle) * 120;
          const headY = Math.sin(angle) * 100;

          // Head base
          this.ctx.fillStyle = '#1e40af';
          this.ctx.strokeStyle = '#3b82f6';
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.ellipse(headX, headY, 25, 20, angle + Math.PI/2, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();

          // Horns
          this.ctx.fillStyle = '#fbbf24';
          this.ctx.beginPath();
          this.ctx.moveTo(headX - 15, headY - 15);
          this.ctx.lineTo(headX - 25, headY - 25);
          this.ctx.lineTo(headX - 20, headY - 20);
          this.ctx.closePath();
          this.ctx.fill();

          this.ctx.beginPath();
          this.ctx.moveTo(headX + 15, headY - 15);
          this.ctx.lineTo(headX + 25, headY - 25);
          this.ctx.lineTo(headX + 20, headY - 20);
          this.ctx.closePath();
          this.ctx.fill();

          // Glowing red eyes
          this.ctx.shadowBlur = 15;
          this.ctx.shadowColor = '#ef4444';
          this.ctx.fillStyle = '#ef4444';
          this.ctx.beginPath();
          this.ctx.arc(headX - 8, headY - 5, 4, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.beginPath();
          this.ctx.arc(headX + 8, headY - 5, 4, 0, Math.PI*2);
          this.ctx.fill();

          // Fangs
          this.ctx.shadowBlur = 0;
          this.ctx.fillStyle = '#ffffff';
          this.ctx.beginPath();
          this.ctx.moveTo(headX - 3, headY + 5);
          this.ctx.lineTo(headX - 6, headY + 15);
          this.ctx.lineTo(headX, headY + 8);
          this.ctx.closePath();
          this.ctx.fill();

          this.ctx.beginPath();
          this.ctx.moveTo(headX + 3, headY + 5);
          this.ctx.lineTo(headX + 6, headY + 15);
          this.ctx.lineTo(headX, headY + 8);
          this.ctx.closePath();
          this.ctx.fill();

          // Fire breath from mouths
          this.ctx.fillStyle = '#f97316';
          this.ctx.globalAlpha = 0.7;
          this.ctx.beginPath();
          this.ctx.ellipse(headX, headY + 20, 8, 15, 0, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.globalAlpha = 1;
      }

      // Massive tail
      this.ctx.fillStyle = '#1e3a8a';
      this.ctx.strokeStyle = '#3b82f6';
      this.ctx.beginPath();
      this.ctx.moveTo(-140, 30);
      this.ctx.quadraticCurveTo(-180, 50, -200, 20);
      this.ctx.quadraticCurveTo(-180, -10, -140, 10);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Spiked tail end
      this.ctx.fillStyle = '#fbbf24';
      for (let i = 0; i < 5; i++) {
          const spikeX = -170 - i * 8;
          const spikeY = 5 + Math.sin(i) * 5;
          this.ctx.beginPath();
          this.ctx.moveTo(spikeX, spikeY);
          this.ctx.lineTo(spikeX - 5, spikeY - 10);
          this.ctx.lineTo(spikeX + 5, spikeY - 10);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Dark aura around the beast
      const auraG = this.ctx.createRadialGradient(0, 0, 50, 0, 0, 200 + pulse);
      auraG.addColorStop(0, 'rgba(30, 58, 138, 0.3)');
      auraG.addColorStop(0.5, 'rgba(59, 130, 246, 0.2)');
      auraG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = auraG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 200 + pulse, 0, Math.PI*2);
      this.ctx.fill();
  }

  drawKoy() {
      const pulse = Math.sin(this.gameFrame * 0.1) * 3;

      // Massive hybrid body - combination of different beasts
      this.ctx.fillStyle = '#92400e';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 5;

      // Main body - lion-like
      this.ctx.beginPath();
      this.ctx.ellipse(0, 20, 120, 60, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Bull-like head with massive horns
      this.ctx.fillStyle = '#7c2d12';
      this.ctx.strokeStyle = '#a16207';
      this.ctx.beginPath();
      this.ctx.ellipse(0, -60, 45, 35, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Massive curved horns
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 4;

      // Left horn
      this.ctx.beginPath();
      this.ctx.moveTo(-25, -70);
      this.ctx.quadraticCurveTo(-60, -90, -45, -110);
      this.ctx.quadraticCurveTo(-30, -95, -20, -75);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right horn
      this.ctx.beginPath();
      this.ctx.moveTo(25, -70);
      this.ctx.quadraticCurveTo(60, -90, 45, -110);
      this.ctx.quadraticCurveTo(30, -95, 20, -75);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Horn spikes
      this.ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 6; i++) {
          const angle = Math.PI * 0.3 + (i * Math.PI * 0.4 / 5);
          const x = Math.cos(angle) * 35;
          const y = Math.sin(angle) * 35 - 60;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x - 3, y - 8);
          this.ctx.lineTo(x + 3, y - 8);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Menacing eyes with glowing red pupils
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = '#ef4444';
      this.ctx.fillStyle = '#1f2937';
      this.ctx.beginPath();
      this.ctx.ellipse(-15, -65, 8, 6, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(15, -65, 8, 6, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Glowing red pupils
      this.ctx.fillStyle = '#ef4444';
      this.ctx.beginPath();
      this.ctx.arc(-15, -65, 3, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(15, -65, 3, 0, Math.PI*2);
      this.ctx.fill();

      // Sharp fangs
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.moveTo(-8, -45);
      this.ctx.lineTo(-12, -35);
      this.ctx.lineTo(-4, -40);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.moveTo(8, -45);
      this.ctx.lineTo(12, -35);
      this.ctx.lineTo(4, -40);
      this.ctx.closePath();
      this.ctx.fill();

      // Eagle-like wings
      this.ctx.fillStyle = '#4c1d95';
      this.ctx.strokeStyle = '#7c3aed';
      this.ctx.lineWidth = 3;

      // Left wing
      this.ctx.beginPath();
      this.ctx.moveTo(-80, 10);
      this.ctx.quadraticCurveTo(-140, -20, -120, 40);
      this.ctx.quadraticCurveTo(-100, 60, -80, 30);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right wing
      this.ctx.beginPath();
      this.ctx.moveTo(80, 10);
      this.ctx.quadraticCurveTo(140, -20, 120, 40);
      this.ctx.quadraticCurveTo(100, 60, 80, 30);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Wing feathers
      this.ctx.fillStyle = '#6d28d9';
      for (let i = 0; i < 8; i++) {
          const leftX = -90 - i * 5;
          const rightX = 90 + i * 5;
          const y = 5 + i * 3;
          this.ctx.beginPath();
          this.ctx.ellipse(leftX, y, 4, 12, -Math.PI/6, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.beginPath();
          this.ctx.ellipse(rightX, y, 4, 12, Math.PI/6, 0, Math.PI*2);
          this.ctx.fill();
      }

      // Scorpion-like tail
      this.ctx.fillStyle = '#7c2d12';
      this.ctx.strokeStyle = '#a16207';
      this.ctx.lineWidth = 4;

      // Tail segments
      for (let i = 0; i < 5; i++) {
          const tailX = 40 + i * 25;
          const tailY = 50 + Math.sin(i * 0.5) * 15;
          this.ctx.beginPath();
          this.ctx.ellipse(tailX, tailY, 8 - i * 0.5, 15 - i, Math.PI/4 + i * 0.2, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();
      }

      // Deadly stinger
      this.ctx.fillStyle = '#ef4444';
      this.ctx.beginPath();
      this.ctx.moveTo(150, 55);
      this.ctx.lineTo(165, 45);
      this.ctx.lineTo(160, 60);
      this.ctx.closePath();
      this.ctx.fill();

      // Spiked legs - lion-like
      this.ctx.fillStyle = '#92400e';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 3;

      // Four legs with spikes
      const legPositions = [-60, -20, 20, 60];
      for (let i = 0; i < 4; i++) {
          const legX = legPositions[i];
          const legY = 70;

          // Leg
          this.ctx.beginPath();
          this.ctx.ellipse(legX, legY, 12, 25, 0, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();

          // Spiked paw
          this.ctx.fillStyle = '#fbbf24';
          this.ctx.beginPath();
          this.ctx.moveTo(legX, legY + 25);
          this.ctx.lineTo(legX - 8, legY + 35);
          this.ctx.lineTo(legX + 8, legY + 35);
          this.ctx.closePath();
          this.ctx.fill();

          // Claws
          this.ctx.fillStyle = '#ffffff';
          for (let j = 0; j < 3; j++) {
              const clawX = legX - 4 + j * 4;
              this.ctx.beginPath();
              this.ctx.moveTo(clawX, legY + 35);
              this.ctx.lineTo(clawX, legY + 42);
              this.ctx.lineTo(clawX + 1, legY + 40);
              this.ctx.closePath();
              this.ctx.fill();
          }
      }

      // Dark chaotic aura
      const auraG = this.ctx.createRadialGradient(0, 0, 60, 0, 0, 180 + pulse);
      auraG.addColorStop(0, 'rgba(146, 64, 14, 0.4)');
      auraG.addColorStop(0.5, 'rgba(217, 119, 6, 0.2)');
      auraG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = auraG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 180 + pulse, 0, Math.PI*2);
      this.ctx.fill();

      this.ctx.shadowBlur = 0;
  }

  drawShed() {
      const pulse = Math.sin(this.gameFrame * 0.15) * 8;

      // Dark, shadowy demonic form
      this.ctx.fillStyle = '#0f0a0a';
      this.ctx.strokeStyle = '#450a0a';
      this.ctx.lineWidth = 6;

      // Twisted demonic body
      this.ctx.beginPath();
      this.ctx.moveTo(0, -80);
      this.ctx.quadraticCurveTo(-60, -40, -80, 20);
      this.ctx.quadraticCurveTo(-60, 80, 0, 60);
      this.ctx.quadraticCurveTo(60, 80, 80, 20);
      this.ctx.quadraticCurveTo(60, -40, 0, -80);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Sharp, jagged edges around the body
      this.ctx.fillStyle = '#7f1d1d';
      for (let i = 0; i < 16; i++) {
          const angle = (i / 16) * Math.PI * 2;
          const r = 85 + Math.sin(i * 2) * 15;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x + Math.cos(angle) * 15, y + Math.sin(angle) * 15);
          this.ctx.lineTo(x + Math.cos(angle + Math.PI/8) * 8, y + Math.sin(angle + Math.PI/8) * 8);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Horrifying demonic face
      this.ctx.fillStyle = '#1c1917';
      this.ctx.strokeStyle = '#7f1d1d';
      this.ctx.lineWidth = 4;

      // Face outline
      this.ctx.beginPath();
      this.ctx.ellipse(0, -30, 50, 40, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Massive, glowing red eyes
      this.ctx.shadowBlur = 25;
      this.ctx.shadowColor = '#dc2626';
      this.ctx.fillStyle = '#dc2626';
      this.ctx.beginPath();
      this.ctx.ellipse(-18, -35, 12, 8, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(18, -35, 12, 8, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Inner glowing cores
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(-18, -35, 4, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(18, -35, 4, 0, Math.PI*2);
      this.ctx.fill();

      // Sharp demonic horns
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = '#2d1b69';
      this.ctx.strokeStyle = '#4c1d95';
      this.ctx.lineWidth = 3;

      // Left horn
      this.ctx.beginPath();
      this.ctx.moveTo(-35, -60);
      this.ctx.quadraticCurveTo(-50, -80, -45, -95);
      this.ctx.quadraticCurveTo(-40, -85, -30, -70);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right horn
      this.ctx.beginPath();
      this.ctx.moveTo(35, -60);
      this.ctx.quadraticCurveTo(50, -80, 45, -95);
      this.ctx.quadraticCurveTo(40, -85, 30, -70);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Horn spikes
      this.ctx.fillStyle = '#dc2626';
      for (let i = 0; i < 8; i++) {
          const angle = Math.PI * 0.2 + (i * Math.PI * 0.6 / 7);
          const x = Math.cos(angle) * 40;
          const y = Math.sin(angle) * 40 - 30;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x - 2, y - 8);
          this.ctx.lineTo(x + 2, y - 8);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Sharp, menacing mouth with fangs
      this.ctx.fillStyle = '#1c1917';
      this.ctx.beginPath();
      this.ctx.moveTo(-15, -10);
      this.ctx.lineTo(15, -10);
      this.ctx.lineTo(10, 10);
      this.ctx.lineTo(-10, 10);
      this.ctx.closePath();
      this.ctx.fill();

      // Massive fangs
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.moveTo(-8, -5);
      this.ctx.lineTo(-12, 8);
      this.ctx.lineTo(-4, 2);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.moveTo(8, -5);
      this.ctx.lineTo(12, 8);
      this.ctx.lineTo(4, 2);
      this.ctx.closePath();
      this.ctx.fill();

      // Smaller fangs
      this.ctx.fillStyle = '#f3f4f6';
      for (let i = 0; i < 6; i++) {
          const fangX = -20 + i * 8;
          const fangY = 5;
          this.ctx.beginPath();
          this.ctx.moveTo(fangX, fangY);
          this.ctx.lineTo(fangX, fangY + 6);
          this.ctx.lineTo(fangX + 2, fangY + 4);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Demonic wings - torn and tattered
      this.ctx.fillStyle = '#1e1b4b';
      this.ctx.strokeStyle = '#312e81';
      this.ctx.lineWidth = 2;

      // Left wing
      this.ctx.beginPath();
      this.ctx.moveTo(-70, -20);
      this.ctx.quadraticCurveTo(-120, -40, -100, 30);
      this.ctx.quadraticCurveTo(-80, 50, -60, 10);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right wing
      this.ctx.beginPath();
      this.ctx.moveTo(70, -20);
      this.ctx.quadraticCurveTo(120, -40, 100, 30);
      this.ctx.quadraticCurveTo(80, 50, 60, 10);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Tattered wing edges
      this.ctx.fillStyle = '#4c1d95';
      for (let i = 0; i < 12; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const x = side * (75 + Math.sin(i) * 10);
          const y = -15 + i * 4;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x + side * 15, y + 10);
          this.ctx.lineTo(x + side * 8, y + 15);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Multiple demonic arms with claws
      for (let arm = 0; arm < 4; arm++) {
          const armAngle = (arm * Math.PI / 2) + Math.PI / 4;
          const armX = Math.cos(armAngle) * 60;
          const armY = Math.sin(armAngle) * 40;

          // Arm
          this.ctx.fillStyle = '#0f0a0a';
          this.ctx.strokeStyle = '#450a0a';
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.ellipse(armX, armY, 8, 25, armAngle, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();

          // Clawed hand
          this.ctx.fillStyle = '#2d1b69';
          this.ctx.beginPath();
          this.ctx.arc(armX + Math.cos(armAngle) * 25, armY + Math.sin(armAngle) * 25, 12, 0, Math.PI*2);
          this.ctx.fill();

          // Sharp claws
          this.ctx.fillStyle = '#ffffff';
          for (let claw = 0; claw < 3; claw++) {
              const clawAngle = armAngle + (claw - 1) * Math.PI / 6;
              const clawX = armX + Math.cos(armAngle) * 25 + Math.cos(clawAngle) * 12;
              const clawY = armY + Math.sin(armAngle) * 25 + Math.sin(clawAngle) * 12;
              this.ctx.beginPath();
              this.ctx.moveTo(clawX, clawY);
              this.ctx.lineTo(clawX + Math.cos(clawAngle) * 8, clawY + Math.sin(clawAngle) * 8);
              this.ctx.lineTo(clawX + Math.cos(clawAngle) * 6, clawY + Math.sin(clawAngle) * 6);
              this.ctx.closePath();
              this.ctx.fill();
          }
      }

      // Dark, terrifying aura
      const auraG = this.ctx.createRadialGradient(0, 0, 40, 0, 0, 150 + pulse);
      auraG.addColorStop(0, 'rgba(15, 10, 10, 0.6)');
      auraG.addColorStop(0.4, 'rgba(69, 10, 10, 0.4)');
      auraG.addColorStop(0.7, 'rgba(127, 29, 29, 0.2)');
      auraG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = auraG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 150 + pulse, 0, Math.PI*2);
      this.ctx.fill();

      // Floating dark particles - optimized for performance
      this.ctx.fillStyle = '#450a0a';
      this.ctx.globalAlpha = 0.6;
      for (let i = 0; i < 6; i++) {
          const angle = (this.gameFrame * 0.03 + i / 6 * Math.PI * 2) % (Math.PI * 2);
          const distance = 120 + Math.sin(this.gameFrame * 0.05 + i) * 15;
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 2, 0, Math.PI*2);
          this.ctx.fill();
      }
      this.ctx.globalAlpha = 1;

      this.ctx.shadowBlur = 0;
  }

  drawAgirat() {
      const pulse = Math.sin(this.gameFrame * 0.08) * 6;

      // Massive terrifying bird body
      this.ctx.fillStyle = '#1e293b';
      this.ctx.strokeStyle = '#334155';
      this.ctx.lineWidth = 6;

      // Main body - large and menacing
      this.ctx.beginPath();
      this.ctx.ellipse(0, 20, 120, 70, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Dark feathers covering the body
      this.ctx.fillStyle = '#0f172a';
      for (let i = 0; i < 25; i++) {
          const angle = (i / 25) * Math.PI * 2;
          const r = 110 + Math.sin(i * 3) * 10;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r * 0.8 + 20;
          this.ctx.beginPath();
          this.ctx.ellipse(x, y, 4, 12, angle + Math.PI/2, 0, Math.PI*2);
          this.ctx.fill();
      }

      // Massive wings
      this.ctx.fillStyle = '#1e293b';
      this.ctx.strokeStyle = '#334155';
      this.ctx.lineWidth = 4;

      // Left wing
      this.ctx.beginPath();
      this.ctx.moveTo(-90, -10);
      this.ctx.quadraticCurveTo(-180, -50, -160, 60);
      this.ctx.quadraticCurveTo(-120, 80, -70, 40);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right wing
      this.ctx.beginPath();
      this.ctx.moveTo(90, -10);
      this.ctx.quadraticCurveTo(180, -50, 160, 60);
      this.ctx.quadraticCurveTo(120, 80, 70, 40);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Wing feathers - sharp and menacing
      this.ctx.fillStyle = '#0f172a';
      for (let i = 0; i < 20; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const x = side * (100 + Math.sin(i * 0.7) * 20);
          const y = -5 + i * 4;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x + side * 25, y + 20);
          this.ctx.lineTo(x + side * 15, y + 25);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Wing claws/hooks
      this.ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 8; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const wingIndex = Math.floor(i / 2);
          const x = side * (120 + wingIndex * 15);
          const y = 20 + wingIndex * 8;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x + side * 12, y + 8);
          this.ctx.lineTo(x + side * 8, y + 12);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Terrifying eagle-like head
      this.ctx.fillStyle = '#2d3748';
      this.ctx.strokeStyle = '#4a5568';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.ellipse(0, -80, 45, 40, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Massive curved beak
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 3;

      // Upper beak
      this.ctx.beginPath();
      this.ctx.moveTo(-20, -65);
      this.ctx.lineTo(0, -95);
      this.ctx.lineTo(20, -65);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Lower beak
      this.ctx.beginPath();
      this.ctx.moveTo(-15, -55);
      this.ctx.lineTo(0, -75);
      this.ctx.lineTo(15, -55);
      this.ctx.lineTo(0, -65);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Sharp beak tip
      this.ctx.fillStyle = '#f59e0b';
      this.ctx.beginPath();
      this.ctx.moveTo(-5, -75);
      this.ctx.lineTo(0, -85);
      this.ctx.lineTo(5, -75);
      this.ctx.closePath();
      this.ctx.fill();

      // Piercing yellow eyes
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = '#fbbf24';
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.beginPath();
      this.ctx.ellipse(-12, -85, 8, 6, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(12, -85, 8, 6, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Black pupils
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = '#000000';
      this.ctx.beginPath();
      this.ctx.ellipse(-12, -85, 3, 4, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(12, -85, 3, 4, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Crest of feathers on head
      this.ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 7; i++) {
          const crestX = -15 + i * 5;
          const crestY = -105 - Math.abs(i - 3) * 3;
          this.ctx.beginPath();
          this.ctx.moveTo(crestX, crestY);
          this.ctx.lineTo(crestX + 2, crestY - 8);
          this.ctx.lineTo(crestX + 4, crestY);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Powerful talons
      this.ctx.fillStyle = '#4a5568';
      this.ctx.strokeStyle = '#2d3748';
      this.ctx.lineWidth = 3;

      // Four talons
      const talonPositions = [-40, -10, 10, 40];
      for (let i = 0; i < 4; i++) {
          const talonX = talonPositions[i];
          const talonY = 80;

          // Talon base
          this.ctx.beginPath();
          this.ctx.ellipse(talonX, talonY, 10, 20, 0, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();

          // Sharp claws
          this.ctx.fillStyle = '#ffffff';
          for (let claw = 0; claw < 3; claw++) {
              const clawX = talonX - 5 + claw * 5;
              this.ctx.beginPath();
              this.ctx.moveTo(clawX, talonY + 20);
              this.ctx.lineTo(clawX, talonY + 30);
              this.ctx.lineTo(clawX + 1, talonY + 28);
              this.ctx.closePath();
              this.ctx.fill();
          }
      }

      // Massive tail feathers
      this.ctx.fillStyle = '#1e293b';
      this.ctx.strokeStyle = '#334155';
      this.ctx.lineWidth = 3;

      for (let i = 0; i < 12; i++) {
          const tailAngle = Math.PI + (i - 5.5) * Math.PI / 8;
          const tailX = Math.cos(tailAngle) * 100;
          const tailY = Math.sin(tailAngle) * 80 + 20;
          this.ctx.beginPath();
          this.ctx.ellipse(tailX, tailY, 6, 25, tailAngle + Math.PI/2, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();
      }

      // Dark, ominous aura
      const auraG = this.ctx.createRadialGradient(0, 0, 70, 0, 0, 180 + pulse);
      auraG.addColorStop(0, 'rgba(30, 41, 59, 0.4)');
      auraG.addColorStop(0.5, 'rgba(51, 65, 85, 0.2)');
      auraG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = auraG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 180 + pulse, 0, Math.PI*2);
      this.ctx.fill();

      // Floating dark feathers
      this.ctx.fillStyle = '#0f172a';
      this.ctx.globalAlpha = 0.6;
      for (let i = 0; i < 8; i++) {
          const angle = (this.gameFrame * 0.04 + i / 8 * Math.PI * 2) % (Math.PI * 2);
          const distance = 150 + Math.sin(this.gameFrame * 0.06 + i) * 20;
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 2, 0, Math.PI*2);
          this.ctx.fill();
      }
      this.ctx.globalAlpha = 1;

      this.ctx.shadowBlur = 0;
  }

  drawLeviathan() {
      const pulse = Math.sin(this.gameFrame * 0.06) * 8;

      // Massive sea monster body
      this.ctx.fillStyle = '#1e3a8a';
      this.ctx.strokeStyle = '#3b82f6';
      this.ctx.lineWidth = 6;

      // Main serpentine body
      this.ctx.beginPath();
      this.ctx.ellipse(0, 20, 160, 50, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Scale pattern on body
      this.ctx.fillStyle = '#1d4ed8';
      for (let i = 0; i < 30; i++) {
          const x = (i - 15) * 9;
          const y = 10 + Math.sin(i * 0.4) * 15;
          this.ctx.beginPath();
          this.ctx.ellipse(x, y, 5, 10, Math.PI/6, 0, Math.PI*2);
          this.ctx.fill();
      }

      // Massive tail fin
      this.ctx.fillStyle = '#1e40af';
      this.ctx.strokeStyle = '#3b82f6';
      this.ctx.lineWidth = 4;

      this.ctx.beginPath();
      this.ctx.moveTo(160, 20);
      this.ctx.quadraticCurveTo(220, -20, 200, 60);
      this.ctx.quadraticCurveTo(180, 80, 160, 20);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Dorsal fins
      this.ctx.fillStyle = '#3b82f6';
      for (let i = 0; i < 8; i++) {
          const finX = -120 + i * 35;
          const finY = -30 - Math.sin(i * 0.8) * 8;
          this.ctx.beginPath();
          this.ctx.moveTo(finX, finY);
          this.ctx.lineTo(finX + 15, finY - 25);
          this.ctx.lineTo(finX + 30, finY);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Side fins
      this.ctx.fillStyle = '#60a5fa';
      // Left fins
      for (let i = 0; i < 6; i++) {
          const finX = -100 + i * 30;
          const finY = 40 + Math.sin(i * 0.6) * 5;
          this.ctx.beginPath();
          this.ctx.moveTo(finX, finY);
          this.ctx.lineTo(finX - 20, finY + 15);
          this.ctx.lineTo(finX - 10, finY + 25);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Right fins
      for (let i = 0; i < 6; i++) {
          const finX = -70 + i * 30;
          const finY = 40 + Math.sin(i * 0.6 + Math.PI) * 5;
          this.ctx.beginPath();
          this.ctx.moveTo(finX, finY);
          this.ctx.lineTo(finX + 20, finY + 15);
          this.ctx.lineTo(finX + 10, finY + 25);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Terrifying head
      this.ctx.fillStyle = '#1e293b';
      this.ctx.strokeStyle = '#475569';
      this.ctx.lineWidth = 5;

      this.ctx.beginPath();
      this.ctx.ellipse(-140, -10, 40, 35, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Massive jaws
      this.ctx.fillStyle = '#374151';
      this.ctx.strokeStyle = '#6b7280';
      this.ctx.lineWidth = 3;

      // Upper jaw with teeth
      this.ctx.beginPath();
      this.ctx.moveTo(-180, -20);
      this.ctx.lineTo(-140, -35);
      this.ctx.lineTo(-100, -20);
      this.ctx.lineTo(-140, -10);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Lower jaw
      this.ctx.beginPath();
      this.ctx.moveTo(-180, 0);
      this.ctx.lineTo(-140, 15);
      this.ctx.lineTo(-100, 0);
      this.ctx.lineTo(-140, -10);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Sharp teeth
      this.ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 12; i++) {
          const toothX = -170 + i * 6;
          const toothY = -15 + (i % 2) * 15;
          this.ctx.beginPath();
          this.ctx.moveTo(toothX, toothY);
          this.ctx.lineTo(toothX, toothY + 8);
          this.ctx.lineTo(toothX + 2, toothY + 6);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Glowing eyes
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = '#fbbf24';
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.beginPath();
      this.ctx.arc(-155, -15, 6, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(-125, -15, 6, 0, Math.PI*2);
      this.ctx.fill();

      // Black pupils
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = '#000000';
      this.ctx.beginPath();
      this.ctx.arc(-155, -15, 2, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(-125, -15, 2, 0, Math.PI*2);
      this.ctx.fill();

      // Horns/spines on head
      this.ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 6; i++) {
          const hornX = -160 + i * 8;
          const hornY = -35 - Math.abs(i - 2.5) * 3;
          this.ctx.beginPath();
          this.ctx.moveTo(hornX, hornY);
          this.ctx.lineTo(hornX + 2, hornY - 8);
          this.ctx.lineTo(hornX + 4, hornY);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Water aura effect
      const waterG = this.ctx.createRadialGradient(0, 0, 80, 0, 0, 200 + pulse);
      waterG.addColorStop(0, 'rgba(30, 58, 138, 0.3)');
      waterG.addColorStop(0.5, 'rgba(59, 130, 246, 0.2)');
      waterG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = waterG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 200 + pulse, 0, Math.PI*2);
      this.ctx.fill();

      // Water droplets - optimized
      this.ctx.fillStyle = '#3b82f6';
      this.ctx.globalAlpha = 0.6;
      for (let i = 0; i < 6; i++) {
          const angle = (this.gameFrame * 0.03 + i / 6 * Math.PI * 2) % (Math.PI * 2);
          const distance = 170 + Math.sin(this.gameFrame * 0.05 + i) * 15;
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.5, 0, Math.PI*2);
          this.ctx.fill();
      }
      this.ctx.globalAlpha = 1;

      this.ctx.shadowBlur = 0;
  }

  drawZiz() {
      const pulse = Math.sin(this.gameFrame * 0.07) * 10;

      // Massive legendary bird that blocks the sun
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 8;

      // Main body - enormous and golden
      this.ctx.beginPath();
      this.ctx.ellipse(0, 20, 140, 80, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Golden feathers radiating from body
      this.ctx.fillStyle = '#f59e0b';
      for (let i = 0; i < 32; i++) {
          const angle = (i / 32) * Math.PI * 2;
          const r = 130 + Math.sin(i * 2) * 15;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r * 0.9 + 20;
          this.ctx.beginPath();
          this.ctx.ellipse(x, y, 5, 15, angle + Math.PI/2, 0, Math.PI*2);
          this.ctx.fill();
      }

      // Enormous wings that blot out the sky
      this.ctx.fillStyle = '#d97706';
      this.ctx.strokeStyle = '#92400e';
      this.ctx.lineWidth = 5;

      // Left wing
      this.ctx.beginPath();
      this.ctx.moveTo(-140, -20);
      this.ctx.quadraticCurveTo(-250, -80, -220, 80);
      this.ctx.quadraticCurveTo(-180, 120, -120, 60);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right wing
      this.ctx.beginPath();
      this.ctx.moveTo(140, -20);
      this.ctx.quadraticCurveTo(250, -80, 220, 80);
      this.ctx.quadraticCurveTo(180, 120, 120, 60);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Wing feathers - massive and golden
      this.ctx.fillStyle = '#fbbf24';
      for (let i = 0; i < 24; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const wingIndex = Math.floor(i / 2);
          const x = side * (160 + Math.sin(wingIndex * 0.5) * 25);
          const y = -10 + wingIndex * 6;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x + side * 30, y + 25);
          this.ctx.lineTo(x + side * 18, y + 32);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Wing tips with divine light
      this.ctx.fillStyle = '#fef3c7';
      for (let i = 0; i < 6; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const tipX = side * (200 + i * 10);
          const tipY = 20 + i * 8;
          this.ctx.beginPath();
          this.ctx.arc(tipX, tipY, 8, 0, Math.PI*2);
          this.ctx.fill();
      }

      // Majestic head
      this.ctx.fillStyle = '#f59e0b';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 5;

      this.ctx.beginPath();
      this.ctx.ellipse(0, -70, 50, 45, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Noble beak
      this.ctx.fillStyle = '#92400e';
      this.ctx.strokeStyle = '#78350f';
      this.ctx.lineWidth = 3;

      // Upper beak
      this.ctx.beginPath();
      this.ctx.moveTo(-20, -55);
      this.ctx.lineTo(0, -85);
      this.ctx.lineTo(20, -55);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Lower beak
      this.ctx.beginPath();
      this.ctx.moveTo(-15, -45);
      this.ctx.lineTo(0, -65);
      this.ctx.lineTo(15, -45);
      this.ctx.lineTo(0, -55);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Golden eyes with divine light
      this.ctx.shadowBlur = 25;
      this.ctx.shadowColor = '#fbbf24';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(-15, -75, 10, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(15, -75, 10, 0, Math.PI*2);
      this.ctx.fill();

      // Golden pupils
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.beginPath();
      this.ctx.arc(-15, -75, 5, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(15, -75, 5, 0, Math.PI*2);
      this.ctx.fill();

      // Black centers
      this.ctx.fillStyle = '#000000';
      this.ctx.beginPath();
      this.ctx.arc(-15, -75, 2, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(15, -75, 2, 0, Math.PI*2);
      this.ctx.fill();

      // Crown-like head feathers
      this.ctx.fillStyle = '#fef3c7';
      for (let i = 0; i < 9; i++) {
          const featherX = -25 + i * 6;
          const featherY = -105 - Math.sin(i * 0.7) * 8;
          this.ctx.beginPath();
          this.ctx.moveTo(featherX, featherY);
          this.ctx.lineTo(featherX + 2, featherY - 12);
          this.ctx.lineTo(featherX + 4, featherY);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Powerful talons
      this.ctx.fillStyle = '#92400e';
      this.ctx.strokeStyle = '#78350f';
      this.ctx.lineWidth = 4;

      const talonPositions = [-50, -15, 15, 50];
      for (let i = 0; i < 4; i++) {
          const talonX = talonPositions[i];
          const talonY = 90;

          this.ctx.beginPath();
          this.ctx.ellipse(talonX, talonY, 12, 25, 0, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();

          // Sharp golden claws
          this.ctx.fillStyle = '#fbbf24';
          for (let claw = 0; claw < 3; claw++) {
              const clawX = talonX - 6 + claw * 6;
              this.ctx.beginPath();
              this.ctx.moveTo(clawX, talonY + 25);
              this.ctx.lineTo(clawX, talonY + 35);
              this.ctx.lineTo(clawX + 2, talonY + 33);
              this.ctx.closePath();
              this.ctx.fill();
          }
      }

      // Tail feathers - magnificent and golden
      this.ctx.fillStyle = '#d97706';
      this.ctx.strokeStyle = '#92400e';
      this.ctx.lineWidth = 3;

      for (let i = 0; i < 14; i++) {
          const tailAngle = Math.PI + (i - 6.5) * Math.PI / 10;
          const tailX = Math.cos(tailAngle) * 120;
          const tailY = Math.sin(tailAngle) * 90 + 20;
          this.ctx.beginPath();
          this.ctx.ellipse(tailX, tailY, 8, 30, tailAngle + Math.PI/2, 0, Math.PI*2);
          this.ctx.fill();
          this.ctx.stroke();
      }

      // Divine golden aura
      const auraG = this.ctx.createRadialGradient(0, 0, 80, 0, 0, 220 + pulse);
      auraG.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
      auraG.addColorStop(0.4, 'rgba(245, 158, 11, 0.3)');
      auraG.addColorStop(0.7, 'rgba(217, 119, 6, 0.2)');
      auraG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = auraG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 220 + pulse, 0, Math.PI*2);
      this.ctx.fill();

      // Floating golden particles - optimized
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.globalAlpha = 0.7;
      for (let i = 0; i < 8; i++) {
          const angle = (this.gameFrame * 0.03 + i / 8 * Math.PI * 2) % (Math.PI * 2);
          const distance = 180 + Math.sin(this.gameFrame * 0.04 + i) * 20;
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          this.ctx.shadowBlur = 8;
          this.ctx.shadowColor = '#fbbf24';
          this.ctx.beginPath();
          this.ctx.arc(x, y, 2, 0, Math.PI*2);
          this.ctx.fill();
      }
      this.ctx.shadowBlur = 0;
      this.ctx.globalAlpha = 1;
  }

  drawAshmedai() {
      const pulse = Math.sin(this.gameFrame * 0.12) * 10;

      // Regal demonic king figure
      this.ctx.fillStyle = '#1a0a1e';
      this.ctx.strokeStyle = '#7c2d12';
      this.ctx.lineWidth = 6;

      // Majestic royal body
      this.ctx.beginPath();
      this.ctx.ellipse(0, 30, 100, 70, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Royal purple and gold robe
      this.ctx.fillStyle = '#581c87';
      this.ctx.strokeStyle = '#a855f7';
      this.ctx.lineWidth = 4;

      // Upper robe
      this.ctx.beginPath();
      this.ctx.moveTo(-80, 20);
      this.ctx.lineTo(80, 20);
      this.ctx.lineTo(70, 80);
      this.ctx.lineTo(-70, 80);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Gold trim on robe
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(-75, 25);
      this.ctx.lineTo(75, 25);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(-65, 40);
      this.ctx.lineTo(65, 40);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(-55, 55);
      this.ctx.lineTo(55, 55);
      this.ctx.stroke();

      // Kingly head with demonic features
      this.ctx.fillStyle = '#2d1b69';
      this.ctx.strokeStyle = '#4c1d95';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.ellipse(0, -40, 50, 45, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Majestic crown with spikes
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 3;

      // Crown base
      this.ctx.beginPath();
      this.ctx.moveTo(-45, -75);
      this.ctx.lineTo(45, -75);
      this.ctx.lineTo(40, -85);
      this.ctx.lineTo(-40, -85);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Crown spikes
      this.ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 7; i++) {
          const spikeX = -35 + i * 10;
          this.ctx.beginPath();
          this.ctx.moveTo(spikeX, -85);
          this.ctx.lineTo(spikeX + 2, -95);
          this.ctx.lineTo(spikeX + 4, -85);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Crown jewels
      this.ctx.fillStyle = '#dc2626';
      this.ctx.beginPath();
      this.ctx.arc(-20, -80, 4, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(0, -80, 4, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(20, -80, 4, 0, Math.PI*2);
      this.ctx.fill();

      // Piercing yellow eyes
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = '#fbbf24';
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.beginPath();
      this.ctx.ellipse(-15, -45, 10, 8, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(15, -45, 10, 8, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Black slit pupils
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = '#000000';
      this.ctx.beginPath();
      this.ctx.ellipse(-15, -45, 3, 6, 0, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(15, -45, 3, 6, 0, 0, Math.PI*2);
      this.ctx.fill();

      // Sharp demonic horns
      this.ctx.fillStyle = '#4c1d95';
      this.ctx.strokeStyle = '#7c3aed';
      this.ctx.lineWidth = 3;

      // Left horn
      this.ctx.beginPath();
      this.ctx.moveTo(-35, -60);
      this.ctx.quadraticCurveTo(-55, -75, -50, -90);
      this.ctx.quadraticCurveTo(-45, -80, -35, -65);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right horn
      this.ctx.beginPath();
      this.ctx.moveTo(35, -60);
      this.ctx.quadraticCurveTo(55, -75, 50, -90);
      this.ctx.quadraticCurveTo(45, -80, 35, -65);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Regal beard
      this.ctx.fillStyle = '#2d1b69';
      this.ctx.strokeStyle = '#4c1d95';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(-20, -20);
      this.ctx.quadraticCurveTo(0, 0, 20, -20);
      this.ctx.quadraticCurveTo(0, 20, -20, -20);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Sharp fangs
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.moveTo(-8, -25);
      this.ctx.lineTo(-12, -15);
      this.ctx.lineTo(-4, -20);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.moveTo(8, -25);
      this.ctx.lineTo(12, -15);
      this.ctx.lineTo(4, -20);
      this.ctx.closePath();
      this.ctx.fill();

      // Royal scepter in right hand
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 3;

      // Scepter shaft
      this.ctx.beginPath();
      this.ctx.moveTo(70, 10);
      this.ctx.lineTo(70, -20);
      this.ctx.stroke();

      // Scepter orb
      this.ctx.beginPath();
      this.ctx.arc(70, -25, 8, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Scepter spikes
      this.ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          const spikeX = 70 + Math.cos(angle) * 8;
          const spikeY = -25 + Math.sin(angle) * 8;
          this.ctx.beginPath();
          this.ctx.moveTo(spikeX, spikeY);
          this.ctx.lineTo(spikeX + Math.cos(angle) * 5, spikeY + Math.sin(angle) * 5);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Left hand holding royal seal
      this.ctx.fillStyle = '#2d1b69';
      this.ctx.beginPath();
      this.ctx.arc(-70, 15, 12, 0, Math.PI*2);
      this.ctx.fill();

      // Royal seal
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.strokeStyle = '#d97706';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(-70, 15, 6, 0, Math.PI*2);
      this.ctx.fill();
      this.ctx.stroke();

      // Seal symbol (crown)
      this.ctx.fillStyle = '#dc2626';
      this.ctx.beginPath();
      this.ctx.moveTo(-73, 12);
      this.ctx.lineTo(-67, 12);
      this.ctx.lineTo(-70, 8);
      this.ctx.closePath();
      this.ctx.fill();

      // Demonic wings
      this.ctx.fillStyle = '#581c87';
      this.ctx.strokeStyle = '#7c3aed';
      this.ctx.lineWidth = 2;

      // Left wing
      this.ctx.beginPath();
      this.ctx.moveTo(-90, -10);
      this.ctx.quadraticCurveTo(-140, -30, -120, 40);
      this.ctx.quadraticCurveTo(-100, 60, -80, 20);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Right wing
      this.ctx.beginPath();
      this.ctx.moveTo(90, -10);
      this.ctx.quadraticCurveTo(140, -30, 120, 40);
      this.ctx.quadraticCurveTo(100, 60, 80, 20);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Wing membranes with demonic patterns
      this.ctx.fillStyle = '#7c3aed';
      for (let i = 0; i < 12; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const x = side * (95 + Math.sin(i * 0.8) * 15);
          const y = -5 + i * 3;
          this.ctx.beginPath();
          this.ctx.moveTo(x, y);
          this.ctx.lineTo(x + side * 20, y + 15);
          this.ctx.lineTo(x + side * 12, y + 20);
          this.ctx.closePath();
          this.ctx.fill();
      }

      // Royal demonic aura
      const auraG = this.ctx.createRadialGradient(0, 0, 60, 0, 0, 160 + pulse);
      auraG.addColorStop(0, 'rgba(88, 28, 135, 0.5)');
      auraG.addColorStop(0.4, 'rgba(168, 85, 247, 0.3)');
      auraG.addColorStop(0.7, 'rgba(251, 191, 36, 0.2)');
      auraG.addColorStop(1, 'transparent');
      this.ctx.fillStyle = auraG;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 160 + pulse, 0, Math.PI*2);
      this.ctx.fill();

      // Floating royal particles - optimized
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.globalAlpha = 0.7;
      for (let i = 0; i < 6; i++) {
          const angle = (this.gameFrame * 0.04 + i / 6 * Math.PI * 2) % (Math.PI * 2);
          const distance = 130 + Math.sin(this.gameFrame * 0.06 + i) * 12;
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          this.ctx.shadowBlur = 8;
          this.ctx.shadowColor = '#fbbf24';
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.5, 0, Math.PI*2);
          this.ctx.fill();
      }
      this.ctx.shadowBlur = 0;
      this.ctx.globalAlpha = 1;
  }

  updateJetParticles(dt: number) {
      const isMobile = this.width < 600;
      // Create smooth continuous contrail - short and tapered trail
      const trailLength = isMobile ? 8 : 12;
      const spawnInterval = isMobile ? 3 : 2; // frames
      const spawnAlpha = isMobile ? 0.75 : 0.9;
      const spawnSize = isMobile ? 3.0 : 3.5;

      // Spawn new segments at a steady rate (and rotate engine offsets with banking)
      if (this.gameFrame - this.lastJetSpawnFrame >= spawnInterval) {
          this.lastJetSpawnFrame = this.gameFrame;

          const cos = Math.cos(this.player.bankAngle);
          const sin = Math.sin(this.player.bankAngle);
          const localY = 38;

          const leftLocalX = -18;
          const rightLocalX = 18;

          const leftX = this.player.x + leftLocalX * cos - localY * sin;
          const leftY = this.player.y + leftLocalX * sin + localY * cos;

          const rightX = this.player.x + rightLocalX * cos - localY * sin;
          const rightY = this.player.y + rightLocalX * sin + localY * cos;

          // Left engine trail
          this.jetParticles.push({
              x: leftX,
              y: leftY,
              vx: 0,
              vy: 0,
              alpha: spawnAlpha,
              size: spawnSize,
              life: trailLength
          });

          // Right engine trail
          this.jetParticles.push({
              x: rightX,
              y: rightY,
              vx: 0,
              vy: 0,
              alpha: spawnAlpha,
              size: spawnSize,
              life: trailLength
          });
      }

      // Update trail segments - smooth constant movement
      for (let i = this.jetParticles.length - 1; i >= 0; i--) {
          const p = this.jetParticles[i];
          p.life -= dt * 0.5; // Faster fade for shorter trail
          p.alpha = Math.max(0, p.alpha - (isMobile ? 0.007 : 0.005) * dt); // Slightly faster fade on mobile

          // Constant downward movement for smooth trail
          p.y += (isMobile ? 2.0 : 2.5) * dt; // Slower, more consistent movement

          // Minimal horizontal drift for stability
          p.x += (this.player.x - p.x) * 0.02 * dt;

          if (p.life <= 0 || p.alpha <= 0) {
              this.jetParticles.splice(i, 1);
          }
      }

      // Maintain trail length - prevent buildup
      if (this.jetParticles.length > trailLength * 2) { // *2 for both engines
          this.jetParticles.splice(0, this.jetParticles.length - trailLength * 2);
      }
  }

  drawJetParticles() {
      if (this.jetParticles.length < 2) return;

      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';

      // Engine color based on skin
      const engineColor = this.config.skin === 'skin_gold' ? '#fbbf24' :
                         this.config.skin === 'skin_butzina' ? '#d8b4fe' :
                         this.config.skin === 'skin_torah' ? '#f97316' :
                         this.config.skin === 'skin_choshen' ? '#a855f7' :
                         this.config.skin === 'skin_default' ? '#60a5fa' : '#00ff88';

      // Draw smooth contrail streams - thick at start, thin at end
      const leftTrail = this.jetParticles.filter((_, i) => i % 2 === 0).reverse();
      const rightTrail = this.jetParticles.filter((_, i) => i % 2 === 1).reverse();

      // Draw left engine contrail with tapered thickness
      if (leftTrail.length > 1) {
          for (let i = 0; i < leftTrail.length - 1; i++) {
              const p1 = leftTrail[i];
              const p2 = leftTrail[i + 1];

              // Calculate thickness based on position (thicker at start)
              const thicknessRatio = 1 - (i / leftTrail.length);
              const thickness = 8 * thicknessRatio + 1; // 8px at start, 1px at end

              this.ctx.strokeStyle = engineColor;
              this.ctx.lineWidth = thickness;
              this.ctx.lineCap = 'round';
              this.ctx.globalAlpha = p1.alpha * 0.8;

              this.ctx.beginPath();
              this.ctx.moveTo(p1.x, p1.y);
              this.ctx.lineTo(p2.x, p2.y);
              this.ctx.stroke();

              // Add glow effect
              this.ctx.shadowBlur = 15 * thicknessRatio;
              this.ctx.shadowColor = engineColor;
              this.ctx.stroke();
              this.ctx.shadowBlur = 0;
          }
      }

      // Draw right engine contrail with tapered thickness
      if (rightTrail.length > 1) {
          for (let i = 0; i < rightTrail.length - 1; i++) {
              const p1 = rightTrail[i];
              const p2 = rightTrail[i + 1];

              // Calculate thickness based on position (thicker at start)
              const thicknessRatio = 1 - (i / rightTrail.length);
              const thickness = 8 * thicknessRatio + 1; // 8px at start, 1px at end

              this.ctx.strokeStyle = engineColor;
              this.ctx.lineWidth = thickness;
              this.ctx.lineCap = 'round';
              this.ctx.globalAlpha = p1.alpha * 0.8;

              this.ctx.beginPath();
              this.ctx.moveTo(p1.x, p1.y);
              this.ctx.lineTo(p2.x, p2.y);
              this.ctx.stroke();

              // Add glow effect
              this.ctx.shadowBlur = 15 * thicknessRatio;
              this.ctx.shadowColor = engineColor;
              this.ctx.stroke();
              this.ctx.shadowBlur = 0;
          }
      }

      // Add bright glow effect at engine exits
      this.ctx.shadowBlur = 25;
      this.ctx.shadowColor = engineColor;
      this.jetParticles.slice(-2).forEach(p => { // Glow the newest segments
          this.ctx.globalAlpha = p.alpha;
          this.ctx.fillStyle = engineColor;
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI*2);
          this.ctx.fill();
      });

      this.ctx.restore();
  }

  drawBonus(b: any) { 
      this.ctx.save(); this.ctx.translate(b.x, b.y); const rot = this.gameFrame * 0.05; this.ctx.rotate(rot);
      const isMobile = this.width < 600;
      const scale = isMobile ? 0.65 : 1.0;
      this.ctx.scale(scale, scale);

      let color = '#fbbf24', icon = '💎';
      if(b.type === 'fire') { color = '#f97316'; icon = '🔥'; }
      else if(b.type === 'electric') { color = '#a855f7'; icon = '⚡'; }
      else if(b.type === 'beam') { color = '#38bdf8'; icon = '☀️'; }
      else if(b.type === 'life') { color = '#22c55e'; icon = '❤️'; }
      else if(b.type === 'missile') { color = '#ef4444'; icon = '🚀'; }
      else if(b.type === 'time_potion') { color = '#a855f7'; icon = '⏳'; }
      else if(b.type === 'bomb') { color = '#ef4444'; icon = '💣'; }
      else if(b.type === 'shield_item') { color = '#3b82f6'; icon = '🛡️'; }
      else if(b.type === 'points_star') { color = '#eab308'; icon = '⭐'; }
      else if(b.type === 'laser') { color = '#a855f7'; icon = '🟣'; }

      this.ctx.fillStyle = color; this.ctx.shadowBlur = 25; this.ctx.shadowColor = color;
      this.ctx.beginPath(); this.ctx.roundRect(-24, -24, 48, 48, 12); this.ctx.fill();
      this.ctx.rotate(-rot); this.ctx.fillStyle = 'white'; this.ctx.font = 'bold 24px Rubik'; this.ctx.textAlign = 'center';
      this.ctx.fillText(icon, 0, 8); this.ctx.restore();
  }

  spawnBonus() { 
      const types = ['coin', 'life', 'shield_item', 'points_star', 'time_potion', 'bomb', 'fire', 'electric', 'beam', 'missile'];
      this.bonuses.push({x: Math.random()*this.width, y: -50, type: types[Math.floor(Math.random() * types.length)]}); 
  }

  updateBonuses(dt: number) { 
      for (let i = this.bonuses.length - 1; i >= 0; i--) {
          let b = this.bonuses[i]; 
          if (!b) continue;
          b.y += 3.5 * dt;
          if (Math.hypot(b.x - this.player.x, b.y - this.player.y) < 68) {
              if (b.type === 'coin') { this.score += 250; Sound.play('coin'); this.onFeedback("+250!", true); }
              else if (b.type === 'points_star') { this.score += 2000; Sound.play('coin'); this.onFeedback("+2000!", true); }
              else if (b.type === 'life') { this.lives = Math.min(this.lives + 1, 5); Sound.play('powerup'); this.onFeedback("+חיים!", true); }
              else if (b.type === 'shield_item') { this.shields++; Sound.play('powerup'); this.onFeedback("+מגן!", true); }
              else if (b.type === 'bomb') { this.bombs++; Sound.play('powerup'); this.onFeedback("+פצצה!", true); }
              else if (b.type === 'time_potion') { this.potions++; Sound.play('powerup'); this.onFeedback("+שיקוי!", true); }
              else if (['fire', 'electric', 'beam', 'missile'].includes(b.type)) {
                this.weaponType = b.type;
                this.weaponAmmo = 30;
                Sound.play('powerup');
                const labels: any = { fire: "אש!", electric: "חשמל!", beam: "קרן!", missile: "טילים!", laser: "לייזר!" };
                this.onFeedback(labels[b.type] || b.type, true);
              } else { this.weaponType = b.type; this.weaponAmmo = 30; Sound.play('powerup'); this.onFeedback(`${b.type}!`, true); }
              
              this.onStatsUpdate({ 
                  score: this.score, 
                  weaponAmmo: this.weaponAmmo, 
                  potions: this.potions, 
                  shields: this.shields, 
                  bombs: this.bombs,
                  lives: this.lives
              }); 
              if (this.bonuses[i]) this.bonuses.splice(i, 1);
          } else if (b.y > this.height + 100) { this.bonuses.splice(i, 1); }
      }
  }

  fire() {
      if (this.isPaused || this.playerExploding || this.isTransitioning) return;
      const shootSfx =
        this.weaponType === 'fire' ? 'shoot_fire' :
        this.weaponType === 'beam' ? 'shoot_beam' :
        this.weaponType === 'electric' ? 'shoot_electric' :
        this.weaponType === 'missile' ? 'shoot_missile' :
        this.weaponType === 'laser' ? 'shoot_laser' :
        'shoot_normal';
      Sound.play(shootSfx);
      const p = this.projectilePool.find(pr => !pr.active);
      if (p) {
          p.x = this.player.x; p.y = this.player.y - 35; p.vx = 0; p.vy = -20; p.type = this.weaponType; p.active = true; p.angle = 0;
          p.targetY = -100; // איפוס גובה הקרן
          p.hasHit = false; // איפוס סטטוס פגיעה
          if (p.type === 'fire') { p.vy = -16; p.life = 45; }
          if (p.type === 'beam') p.life = 30; // הגדלת זמן חיים בסיסי כדי שיראו
          if (p.type === 'electric') p.life = 25;
          if (p.type === 'missile') { p.vy = -10; p.vx = (Math.random()-0.5)*10; }
          if (p.type === 'laser') { p.vy = -25; p.life = 60; } // Very fast
          
          if (this.config.skin === 'skin_default' || this.weaponAmmo < 9000) { if (this.weaponAmmo > 0) { this.weaponAmmo--; if (this.weaponAmmo === 0) { this.onFeedback("תחמושת נגמרה", false); this.applySkinWeapon(); } } }
          this.onStatsUpdate({ weaponAmmo: this.weaponAmmo });
      }
  }

  useBomb() { if(this.bombs > 0 && !this.isPaused) { this.bombs--; Sound.play('bomb'); this.enemyPool.forEach(e => { if (e.active) this.spawnExplosion(e.x, e.y, 'orange', 15); e.active = false; }); this.bossProjectiles = []; this.triggerShake(40); this.onStatsUpdate({bombs: this.bombs}); this.onFeedback("פיצוץ!", true); } }
  useShield() { if(this.shields > 0 && this.shieldStrength < 2) { this.shields--; Sound.play('powerup'); this.shieldStrength = 2; this.onStatsUpdate({shields: this.shields, hasShield: true}); this.onFeedback("מגן!", true); } }
  usePotion() { if(this.potions > 0) { this.potions--; Sound.play('powerup'); this.timeSlowTimer = 450; this.onStatsUpdate({potions: this.potions}); this.onFeedback("זמן איטי!", true); } }

  movePlayer(dx: number, dy: number) {
      if (!this.isPaused && !this.isTransitioning) {
          const oldX = this.player.x;
          this.player.x = Math.max(20, Math.min(this.width - 20, this.player.x + dx));
          this.player.y = Math.max(this.height * 0.4, Math.min(this.height - 100, this.player.y + dy));

          // Update velocity for banking animation
          const actualDx = this.player.x - oldX;
          this.player.velocityX = this.player.velocityX * 0.8 + actualDx * 0.2; // Smooth velocity

          // Update bank angle based on velocity (-30 to +30 degrees)
          const targetBankAngle = Math.max(-Math.PI/6, Math.min(Math.PI/6, this.player.velocityX * 0.1));
          this.player.bankAngle = this.player.bankAngle * 0.9 + targetBankAngle * 0.1; // Smooth banking
      }
  }

  setPlayerPos(x: number, y: number) { 
      if (!this.isPaused && !this.isTransitioning) { 
          const oldX = this.player.x;
          this.player.x = Math.max(20, Math.min(this.width - 20, x));
          this.player.y = Math.max(this.height * 0.4, Math.min(y, this.height - 100));

          // Update velocity + bank angle for mouse movement too
          const actualDx = this.player.x - oldX;
          this.player.velocityX = this.player.velocityX * 0.8 + actualDx * 0.2;
          const maxBank = Math.PI / 6;
          const targetBankAngle = Math.max(-maxBank, Math.min(maxBank, this.player.velocityX * 0.08));
          this.player.bankAngle = this.player.bankAngle * 0.85 + targetBankAngle * 0.15;
      } 
  }

  startBossFight() {
      // Prevent starting a new boss fight if one is already active
      if (this.boss) return;
      
      this.bossDamageTaken = false;
      const bossId: BossId = this.bossCycleMode
          ? (BOSS_SEQUENCE[this.bossSequenceIndex] || 'tannina')
          : this.getBossIdForLevel(this.level);

      const baseHp = 250 + (this.level * 15);
      const bossMult = this.getBossDifficultyMult(bossId);
      const loopMult = this.bossCycleMode ? (1 + this.bossLoop * 0.35) : 1;
      const hp = Math.round(baseHp * bossMult * loopMult);

      const baseAttackRate = Math.max(45, 180 - (this.level * 2));
      const attackRate = this.bossCycleMode
          ? Math.max(35, Math.round(baseAttackRate / (bossMult * (1 + this.bossLoop * 0.18))))
          : baseAttackRate;

      const speedMult = this.bossCycleMode ? (1 + this.bossLoop * 0.12) : 1;

      this.boss = {
          id: bossId,
          loop: this.bossCycleMode ? this.bossLoop : 0,
          speedMult,
          x: this.width / 2,
          y: -450,
          targetY: 220,
          maxHp: hp,
          hp,
          currentText: "",
          frame: 0,
          attackRate
      };
      this.onStatsUpdate({ bossActive: true, bossHpPercent: 100, currentWord: "", bossName: BOSS_NAMES[bossId] });
  }

  endBossFight() { 
      if (!this.boss) return;
      const defeatedId: BossId = (this.boss.id as BossId) || this.getBossIdForLevel(this.level);

      // After first Ziz defeat, start looping bosses from the beginning with stronger stats
      if (!this.bossCycleMode && defeatedId === 'ziz') {
          this.bossCycleMode = true;
          this.bossLoop = 1;
          this.bossSequenceIndex = 0; // restart from first boss
      } else if (this.bossCycleMode) {
          const idx = BOSS_SEQUENCE.indexOf(defeatedId);
          const nextIdx = idx >= 0 ? (idx + 1) % BOSS_SEQUENCE.length : 0;
          if (nextIdx === 0) this.bossLoop++;
          this.bossSequenceIndex = nextIdx;
      }

      if (!this.bossDamageTaken) this.onAchievement('sinai');
      Sound.play('explosion');
      Sound.play('boss_defeat');
      
      // Store boss position before clearing
      const bossX = this.boss.x;
      const bossY = this.boss.y;
      
      // Clear boss immediately to prevent race conditions
      this.boss = null; 
      this.bossProjectiles = []; 
      
      // Spawn explosion and trigger shake after boss is cleared
      this.spawnExplosion(bossX, bossY, 'gold', 200); 
      this.score += 10000; 
      this.triggerShake(50);
      
      this.onStatsUpdate({bossActive: false, bossHpPercent: 0, score: this.score, bossName: undefined}); 
      this.onFeedback("ניצחון!", true); 
      
      this.isTransitioning = true;
      setTimeout(() => {
        this.onUnitComplete({
            score: this.score,
            combo: this.combo,
            subLevel: this.subLevel,
            level: this.level
        });
      }, 1500);
  }

  nextUnit() {
      const nextSugia = SUGIOT.find(s => s.requiredLevel > this.level);
      if (nextSugia) {
          this.level = nextSugia.requiredLevel;
      } else {
          this.level++;
      }
      this.subLevel = 1;
      this.isTransitioning = false;
      this.startRound();
  }
}
