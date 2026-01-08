
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
  
  bossProjectiles: any[] = [];
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
    this.startRound();
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
    const layerConfigs = [
        { count: 120, speed: 0.1, size: 1, alpha: 0.2 },
        { count: 80, speed: 0.8, size: 1.2, alpha: 0.4 },
        { count: 50, speed: 3.0, size: 1.8, alpha: 0.6 }
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
      sugiaTitle: this.config.customDictionary ? 'תרגול מורה' : currentSugia.title
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
        this.updateJetParticles(dt);
    }
    
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

          if (e.y > this.height + 100) { e.active = false; if(e.isCorrect) this.handleMiss(); continue; }

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
          this.triggerShake(12); this.spawnExplosion(x, y, '#ef4444', 20); this.handleMiss();
      }
  }

  handleMiss() {
      if (this.playerExploding) return;
      if (this.boss) this.bossDamageTaken = true; 
      this.enemyPool.forEach(e => e.active = false);
      this.hazards = [];
      this.bossProjectiles = [];
      this.projectilePool.forEach(p => { if (p.type !== 'beam') p.active = false; });
      if (this.shieldStrength > 0) {
          this.shieldStrength--; this.triggerShake(10); Sound.play('hit');
          this.onFeedback(this.shieldStrength === 1 ? "מגן נסדק!" : "מגן נשבר!", false);
          this.onStatsUpdate({ hasShield: this.shieldStrength > 0 });
          setTimeout(() => this.startRound(), 1000);
      } else {
          this.lives--; this.combo = 0; this.triggerShake(20); Sound.play('hit'); this.onFeedback("נפגעת!", false);
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
    this.ctx.fillStyle = '#020617'; this.ctx.fillRect(0, 0, this.width, this.height);
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
    const loc = this.config.location || 'nehardea';
    const subPhase = this.level % 7;
    if (loc === 'nehardea') {
        const blueVal = 138 + (subPhase * 15);
        const grad = this.ctx.createLinearGradient(0, this.height - 200, 0, this.height);
        grad.addColorStop(0, 'rgba(30, 58, 138, 0)'); grad.addColorStop(1, `rgba(30, 58, ${blueVal}, 0.5)`);
        this.ctx.fillStyle = grad; this.ctx.fillRect(0, this.height - 200, this.width, 200);
    } else if (loc === 'sura') {
        const pillarAlpha = 0.15 + (subPhase * 0.04);
        this.ctx.fillStyle = `rgba(239, 68, 68, ${pillarAlpha})`;
        for(let i=0; i<4; i++) {
            const x = (i * this.width / 3 + this.gameFrame * 0.5) % (this.width + 100) - 50;
            this.ctx.fillRect(x, 0, 3, this.height);
        }
    } else if (loc === 'pumbedita') {
        const scrollAlpha = 0.15 + (subPhase * 0.03);
        this.ctx.fillStyle = `rgba(251, 191, 36, ${scrollAlpha})`;
        this.ctx.font = 'bold 30px serif';
        for(let i=0; i<6; i++) {
            const x = (i * 300 + this.gameFrame * 0.4) % (this.width + 200) - 100;
            const y = 100 + (i * 150) % (this.height - 200);
            this.ctx.fillText("📜", x, y);
        }
    } else {
        this.ctx.save();
        this.ctx.globalAlpha = 0.08;
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 45px Frank Ruhl Libre';
        const letters = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י"];
        for(let i=0; i<10; i++) {
          const x = (i * 180 + this.gameFrame * 0.2) % this.width;
          const y = (i * 140 + this.gameFrame * 0.15) % this.height;
          this.ctx.fillText(letters[i % letters.length], x, y);
        }
        this.ctx.restore();
    }
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
          this.ctx.save(); this.ctx.fillStyle = '#ef4444'; this.ctx.shadowBlur = 20; this.ctx.shadowColor = '#ef4444';
          this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 15, 0, Math.PI*2); this.ctx.fill(); this.ctx.restore();
          if(Math.hypot(p.x - this.player.x, p.y - this.player.y) < 32) { this.handleMiss(); p.y = 5000; }
      });
      this.bossProjectiles = this.bossProjectiles.filter(p => p.y < this.height + 50);
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      this.projectilePool.forEach(p => { if (p.active) this.drawProjectile(p); });
      this.ctx.restore();
  }

  drawPlayer() {
      // Draw engine particles first (behind the ship)
      this.drawJetParticles();

      this.ctx.save(); this.ctx.translate(this.player.x, this.player.y);

      // Apply banking rotation
      this.ctx.rotate(this.player.bankAngle);

      // Ship glow effect
      this.ctx.shadowBlur = 30;
      this.ctx.shadowColor = 'rgba(100, 200, 255, 0.6)';

      if (this.shieldStrength > 0) {
          const color = this.shieldStrength === 2 ? '#3b82f6' : '#93c5fd';
          this.ctx.strokeStyle = color; this.ctx.lineWidth = 4; this.ctx.shadowBlur = 25; this.ctx.shadowColor = color;
          this.ctx.beginPath(); this.ctx.arc(0, 0, 45, 0, Math.PI*2); this.ctx.stroke();
          this.ctx.globalAlpha = 0.1; this.ctx.fillStyle = color; this.ctx.fill(); this.ctx.globalAlpha = 1;
      }
      this.renderShip();
      this.ctx.restore();
  }

  renderShip() {
      const skin = this.config.skin;
      const isMobile = this.width < 600;
      const isDesktop = this.width >= 1024;
      const baseScale = isMobile ? 0.55 : 0.75;
      const scale = isDesktop ? baseScale * 1.25 : baseScale;
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

  updateBoss(dt: number) {
      const b = this.boss; if (!b) return;
      b.frame += dt; b.x = (this.width/2) + Math.sin(b.frame*0.012)*(this.width/4.5);
      if(b.y < b.targetY) b.y += 0.9 * dt;

      b.timer = (b.timer || 0) + dt;
      if(b.timer >= b.attackRate) {
          b.timer = 0;

          // ישיר מיפוי של רמות לבוסים - יריות
          if (this.level === 1) { // Tannina
              this.bossProjectiles.push({x: b.x - 120, y: b.y + 100, vy: 4.0, vx: 0});
              this.bossProjectiles.push({x: b.x + 120, y: b.y + 100, vy: 4.0, vx: 0});
          } else if (this.level === 8) { // Koy
              for(let i=-2; i<=2; i++) this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: 3.5, vx: i * 1.8});
          } else if (this.level === 15) { // Shed
              for(let i=0; i<12; i++) { const angle = (i/12) * Math.PI * 2; this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: Math.sin(angle)*4.5, vx: Math.cos(angle)*4.5}); }
          } else if (this.level === 22) { // Ashmedai - בוס קשה עם יריות מרובות
              // יריות מכוונות לשחקן (5 יריות)
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              for(let i=-2; i<=2; i++) this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang+i*0.2)*5, vx: Math.cos(ang+i*0.2)*5});

              // יריות מעגליות (8 יריות)
              for(let i=0; i<8; i++) { const angle = (i/8) * Math.PI * 2; this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: Math.sin(angle)*5, vx: Math.cos(angle)*5}); }

              // יריות מתפזרות לצדדים (4 יריות)
              for(let i=-1; i<=2; i++) this.bossProjectiles.push({x: b.x + i*80, y: b.y + 100, vy: 4.5, vx: i * 0.3});
          } else if (this.level === 29) { // Agirat
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              for(let i=-1; i<=1; i++) this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang+i*0.2)*5, vx: Math.cos(ang+i*0.2)*5});
          } else if (this.level === 36) { // Leviathan
              for(let i=0; i<10; i++) { const ang = (this.gameFrame*0.1) + (i/10)*Math.PI*2; this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang)*4.5, vx: Math.cos(ang)*4.5}); }
          } else { // Ziz
              for(let i=0; i<8; i++) { const ang = (this.gameFrame*0.1) + (i/8)*Math.PI*2; this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang)*4, vx: Math.cos(ang)*4}); }
          }
          Sound.play('shoot');
      }

      for (let i = this.bossProjectiles.length - 1; i >= 0; i--) {
        let p = this.bossProjectiles[i];
        if (!p) continue;
        p.y += p.vy * dt;
        if (p.vx) p.x += p.vx * dt;
        if(Math.hypot(p.x - this.player.x, p.y - this.player.y) < 32) { this.handleMiss(); this.bossProjectiles.splice(i, 1); }
      }
  }

  drawBoss() {
      const b = this.boss; if (!b) return;
      const isMobile = this.width < 600;
      this.ctx.save(); this.ctx.translate(b.x, b.y);
      if (isMobile) this.ctx.scale(0.75, 0.75);

      // ישיר מיפוי של רמות לבוסים
      let bName = "";
      if (this.level === 1) {
        this.drawTannina();
        bName = "תנינא";
      } else if (this.level === 8) {
        this.drawKoy();
        bName = "כוי";
      } else if (this.level === 15) {
        this.drawShed();
        bName = "שד";
      } else if (this.level === 22) {
        this.drawAshmedai();
        bName = "אשמדאי";
      } else if (this.level === 29) {
        this.drawAgirat();
        bName = "אגירת";
      } else if (this.level === 36) {
        this.drawLeviathan();
        bName = "לויתן";
      } else {
        this.drawZiz();
        bName = "זיז שדי";
      }

      this.ctx.fillStyle = 'white'; this.ctx.shadowBlur = 20; this.ctx.shadowColor = 'cyan';
      this.ctx.font = 'bold 46px Frank Ruhl Libre'; this.ctx.textAlign = 'center'; this.ctx.fillText(bName, 0, 30);
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
      // Create smooth continuous contrail - short and tapered trail
      const trailLength = 12; // Short trail
      const segmentSpacing = 10; // Larger spacing for shorter trail

      // Engine color based on skin
      const engineColor = this.config.skin === 'skin_gold' ? '#fbbf24' :
                         this.config.skin === 'skin_butzina' ? '#d8b4fe' :
                         this.config.skin === 'skin_stealth' ? '#ef4444' :
                         this.config.skin === 'skin_default' ? '#fb7185' : '#00ff88';

      // Add new trail segments less frequently for smooth constant trail
      if (this.jetParticles.length === 0 || this.jetParticles[this.jetParticles.length - 1].y - this.player.y > segmentSpacing) {
          // Left engine trail - constant smooth trail
          this.jetParticles.push({
              x: this.player.x - 18,
              y: this.player.y + 38,
              vx: 0,
              vy: 0,
              alpha: 0.9, // High opacity for visibility
              size: 3.5,
              life: trailLength
          });

          // Right engine trail - constant smooth trail
          this.jetParticles.push({
              x: this.player.x + 18,
              y: this.player.y + 38,
              vx: 0,
              vy: 0,
              alpha: 0.9, // High opacity for visibility
              size: 3.5,
              life: trailLength
          });
      }

      // Update trail segments - smooth constant movement
      for (let i = this.jetParticles.length - 1; i >= 0; i--) {
          const p = this.jetParticles[i];
          p.life -= dt * 0.5; // Faster fade for shorter trail
          p.alpha = Math.max(0, p.alpha - 0.005 * dt); // Consistent fade

          // Constant downward movement for smooth trail
          p.y += 2.5 * dt; // Slower, more consistent movement

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
                         this.config.skin === 'skin_stealth' ? '#ef4444' :
                         this.config.skin === 'skin_default' ? '#fb7185' : '#00ff88';

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
      Sound.play('shoot');
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
          this.player.x = x; 
          this.player.y = Math.max(this.height * 0.4, Math.min(y, this.height - 100)); 
      } 
  }

  startBossFight() {
      this.bossDamageTaken = false;
      this.boss = { x: this.width / 2, y: -450, targetY: 220, maxHp: 250 + (this.level * 15), hp: 250 + (this.level * 15), currentText: "", frame: 0, attackRate: Math.max(45, 180 - (this.level * 2)) };
      this.onStatsUpdate({ bossActive: true, bossHpPercent: 100, currentWord: "" });
  }

  endBossFight() { 
      if (!this.boss) return;
      if (!this.bossDamageTaken) this.onAchievement('sinai');
      Sound.play('explosion');
      this.spawnExplosion(this.boss.x, this.boss.y, 'gold', 200); 
      this.score += 10000; 
      this.boss = null; 
      this.bossProjectiles = []; 
      this.triggerShake(50);
      
      this.onStatsUpdate({bossActive: false, bossHpPercent: 0, score: this.score}); 
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
