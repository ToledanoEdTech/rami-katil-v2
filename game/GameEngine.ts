
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
  
  player: { x: number; y: number; width: number; height: number; isHit: boolean };
  
  enemyPool: PoolableEnemy[] = Array.from({length: 30}, () => new PoolableEnemy());
  projectilePool: PoolableProjectile[] = Array.from({length: 120}, () => new PoolableProjectile());
  particlePool: Particle[] = Array.from({length: 500}, () => new Particle());
  
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
    this.player = { x: this.width / 2, y: this.height - (isMobile ? 180 : 150), width: pW, height: pH, isHit: false };
    
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
      let dmg = p.type === 'missile' ? 10 : p.type === 'beam' ? 4.5 : p.type === 'fire' ? 12.0 : p.type === 'electric' ? 6.5 : p.type === 'laser' ? 5 : 4;
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
      this.ctx.save(); this.ctx.translate(this.player.x, this.player.y);
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
      const scale = isMobile ? 0.55 : 0.75; 
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

          // Enhanced Torah scroll handles
          this.ctx.shadowBlur = 15; this.ctx.shadowColor = '#b45309';
          this.ctx.fillStyle = '#b45309'; this.ctx.strokeStyle = '#78350f'; this.ctx.lineWidth = 3;
          this.ctx.beginPath(); this.ctx.roundRect(-28, -38, 14, 76, 5); this.ctx.fill(); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.roundRect(14, -38, 14, 76, 5); this.ctx.fill(); this.ctx.stroke();

          // Decorative rings on handles
          this.ctx.fillStyle = '#fbbf24'; this.ctx.strokeStyle = '#d97706'; this.ctx.lineWidth = 1;
          this.ctx.beginPath(); this.ctx.arc(-21, -38, 7, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.arc(-21, 38, 7, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.arc(21, -38, 7, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.arc(21, 38, 7, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();

          // Inner ring details
          this.ctx.fillStyle = '#d97706';
          this.ctx.beginPath(); this.ctx.arc(-21, -38, 4, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.arc(-21, 38, 4, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.arc(21, -38, 4, 0, Math.PI*2); this.ctx.fill();
          this.ctx.beginPath(); this.ctx.arc(21, 38, 4, 0, Math.PI*2); this.ctx.fill();

          this.ctx.shadowBlur = 0;

          // Enhanced parchment scroll
          const scrollG = this.ctx.createLinearGradient(-15, -25, 15, 25);
          scrollG.addColorStop(0, '#fef3c7'); scrollG.addColorStop(0.5, '#fde68a'); scrollG.addColorStop(1, '#fef3c7');
          this.ctx.fillStyle = scrollG; this.ctx.beginPath(); this.ctx.roundRect(-16, -26, 32, 52, 3); this.ctx.fill();

          // Scroll border
          this.ctx.strokeStyle = '#d97706'; this.ctx.lineWidth = 2; this.ctx.stroke();

          // Torah text lines with Hebrew characters
          this.ctx.fillStyle = '#92400e'; this.ctx.font = 'bold 6px Arial';
          this.ctx.textAlign = 'center';
          const torahText = ['תּוֹרָה', 'אוֹר', 'חַיִּים', 'מִצְוֹת', 'אֱמוּנָה'];
          for(let i=0; i<5; i++) {
            this.ctx.fillText(torahText[i], 0, -16 + i * 8);
          }

          // Enhanced divine light effect
          const lightPulse = pulse * 1.5;
          const lightG = this.ctx.createRadialGradient(0, 0, 15, 0, 0, 40 + lightPulse);
          lightG.addColorStop(0, 'rgba(251, 191, 36, 0.3)'); lightG.addColorStop(0.5, 'rgba(251, 191, 36, 0.15)'); lightG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = lightG; this.ctx.beginPath(); this.ctx.arc(0, 0, 40 + lightPulse, 0, Math.PI*2); this.ctx.fill();

          // Add floating particles around the Torah
          this.ctx.fillStyle = '#fbbf24';
          this.ctx.globalAlpha = 0.5;
          for(let i=0; i<6; i++) {
            const angle = (this.gameFrame * 0.05 + i/6 * Math.PI * 2) % (Math.PI * 2);
            const x = Math.cos(angle) * (35 + Math.sin(this.gameFrame * 0.1 + i) * 5);
            const y = Math.sin(angle) * (25 + Math.cos(this.gameFrame * 0.1 + i) * 3);
            this.ctx.beginPath(); this.ctx.arc(x, y, 1.5, 0, Math.PI*2); this.ctx.fill();
          }
          this.ctx.globalAlpha = 1;

          this.ctx.restore(); return;
      }
      let primary = '#3b82f6', secondary = '#1e3a8a', cockpit = '#38bdf8', engine = '#fb7185';
      if (skin === 'skin_gold') { primary = '#fbbf24'; secondary = '#d97706'; cockpit = '#fffbeb'; engine = '#fde68a'; }
      else if (skin === 'skin_stealth') { primary = '#1e293b'; secondary = '#020617'; cockpit = '#334155'; engine = '#ef4444'; }
      else if (skin === 'skin_butzina') { primary = '#7e22ce'; secondary = '#581c87'; cockpit = '#e9d5ff'; engine = '#d8b4fe'; }
      this.ctx.save(); this.ctx.scale(scale, scale);

      // Enhanced engine glow effect
      const glow = skin === 'skin_gold' ? 40 + Math.random() * 25 : skin === 'skin_butzina' ? 35 + Math.random() * 20 : 20 + Math.random() * 15;
      this.ctx.shadowBlur = glow; this.ctx.shadowColor = engine;

      // Enhanced engines with particle effect
      this.ctx.fillStyle = engine;
      this.ctx.beginPath(); this.ctx.ellipse(-14, 32, 7, 18, 0, 0, Math.PI*2); this.ctx.fill();
      this.ctx.beginPath(); this.ctx.ellipse(14, 32, 7, 18, 0, 0, Math.PI*2); this.ctx.fill();

      // Add engine particle trails
      if (skin === 'skin_gold') {
        this.ctx.shadowBlur = 20; this.ctx.shadowColor = '#fbbf24';
        this.ctx.fillStyle = '#fbbf24';
        this.ctx.globalAlpha = 0.7;
        this.ctx.beginPath(); this.ctx.ellipse(-14, 45, 3, 8, 0, 0, Math.PI*2); this.ctx.fill();
        this.ctx.beginPath(); this.ctx.ellipse(14, 45, 3, 8, 0, 0, Math.PI*2); this.ctx.fill();
        this.ctx.globalAlpha = 1;
      }

      this.ctx.shadowBlur = 0; this.ctx.fillStyle = secondary;
      this.ctx.beginPath(); this.ctx.moveTo(-10, -5); this.ctx.lineTo(-50, 25); this.ctx.lineTo(-50, 40); this.ctx.lineTo(-10, 25); this.ctx.closePath(); this.ctx.fill();
      this.ctx.beginPath(); this.ctx.moveTo(10, -5); this.ctx.lineTo(50, 25); this.ctx.lineTo(50, 40); this.ctx.lineTo(10, 25); this.ctx.closePath(); this.ctx.fill();

      // Enhanced main body with better gradient and metallic effect
      const fG = this.ctx.createLinearGradient(-25, 0, 25, 0);
      fG.addColorStop(0, secondary);
      fG.addColorStop(0.3, primary);
      fG.addColorStop(0.5, skin === 'skin_gold' ? '#f59e0b' : skin === 'skin_butzina' ? '#9333ea' : '#2563eb');
      fG.addColorStop(0.7, primary);
      fG.addColorStop(1, secondary);
      this.ctx.fillStyle = fG; this.ctx.beginPath(); this.ctx.moveTo(0, -60); this.ctx.bezierCurveTo(28, -20, 28, 25, 20, 35); this.ctx.lineTo(-20, 35); this.ctx.bezierCurveTo(-28, 25, -28, -20, 0, -60); this.ctx.fill();

      // Add metallic shine effect
      const shineG = this.ctx.createLinearGradient(-15, -40, 15, -10);
      shineG.addColorStop(0, 'rgba(255,255,255,0.3)'); shineG.addColorStop(0.5, 'rgba(255,255,255,0.1)'); shineG.addColorStop(1, 'rgba(255,255,255,0.3)');
      this.ctx.fillStyle = shineG; this.ctx.beginPath(); this.ctx.ellipse(0, -25, 8, 25, 0, 0, Math.PI*2); this.ctx.fill();

      // Enhanced cockpit with better glass effect
      const cG = this.ctx.createLinearGradient(0, -35, 0, -5);
      cG.addColorStop(0, '#fff'); cG.addColorStop(0.3, cockpit); cG.addColorStop(0.7, secondary); cG.addColorStop(1, 'rgba(0,0,0,0.3)');
      this.ctx.fillStyle = cG; this.ctx.beginPath(); this.ctx.ellipse(0, -20, 9, 20, 0, 0, Math.PI*2); this.ctx.fill();

      // Add cockpit reflection
      this.ctx.fillStyle = 'rgba(255,255,255,0.4)'; this.ctx.beginPath(); this.ctx.ellipse(0, -22, 4, 8, 0, 0, Math.PI*2); this.ctx.fill();

      // Special effects for different skins
      if (skin === 'skin_gold') {
        // Golden aura effect
        this.ctx.shadowBlur = 30; this.ctx.shadowColor = '#fbbf24';
        this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)'; this.ctx.lineWidth = 2;
        this.ctx.beginPath(); this.ctx.ellipse(0, 0, 45, 35, 0, 0, Math.PI*2); this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Golden particles around the ship
        this.ctx.fillStyle = '#fbbf24';
        this.ctx.globalAlpha = 0.6;
        for(let i=0; i<8; i++) {
          const angle = (i/8) * Math.PI * 2;
          const x = Math.cos(angle) * 40;
          const y = Math.sin(angle) * 30 - 10;
          this.ctx.beginPath(); this.ctx.arc(x, y, 1.5, 0, Math.PI*2); this.ctx.fill();
        }
        this.ctx.globalAlpha = 1;
      } else if (skin === 'skin_butzina') {
        // Purple aura effect
        this.ctx.shadowBlur = 25; this.ctx.shadowColor = '#7e22ce';
        this.ctx.strokeStyle = 'rgba(126, 34, 206, 0.4)'; this.ctx.lineWidth = 2;
        this.ctx.beginPath(); this.ctx.ellipse(0, 0, 42, 32, 0, 0, Math.PI*2); this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Purple energy tendrils
        this.ctx.strokeStyle = '#a855f7'; this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.7;
        for(let i=0; i<6; i++) {
          const angle = (i/6) * Math.PI * 2;
          this.ctx.beginPath(); this.ctx.moveTo(0, -20);
          this.ctx.quadraticCurveTo(
            Math.cos(angle) * 25, Math.sin(angle) * 20 - 10,
            Math.cos(angle) * 35, Math.sin(angle) * 25 - 5
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
          this.ctx.shadowBlur = 80 * scale; this.ctx.shadowColor = '#fbbf24';
          this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'; this.ctx.lineWidth = 70 * scale;
          this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, endY); this.ctx.stroke();
          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; this.ctx.lineWidth = 35 * scale;
          this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, endY); this.ctx.stroke();
          this.ctx.shadowBlur = 40 * scale; this.ctx.shadowColor = '#fff';
          this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 14 * scale;
          this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, endY); this.ctx.stroke();
          this.ctx.fillStyle = '#fff'; this.ctx.beginPath(); this.ctx.arc(p.x, endY, 25 * scale, 0, Math.PI*2); this.ctx.fill();
      } else if (p.type === 'fire') {
          this.ctx.translate(p.x, p.y); 
          const baseSize = isMobile ? 18 : 35;
          const pulseRange = isMobile ? 6 : 12;
          const rPulse = baseSize + Math.sin(this.gameFrame * 0.4) * pulseRange;
          
          const fG = this.ctx.createRadialGradient(0,0,5,0,0,rPulse); fG.addColorStop(0, '#fff'); fG.addColorStop(0.3, '#fde68a'); fG.addColorStop(0.6, '#f97316'); fG.addColorStop(1, 'transparent');
          this.ctx.fillStyle = fG; this.ctx.shadowBlur = 30; this.ctx.shadowColor = '#f97316';
          this.ctx.beginPath(); this.ctx.arc(0, 0, rPulse, 0, Math.PI*2); this.ctx.fill();
      } else if (p.type === 'electric') {
          this.ctx.strokeStyle = '#a855f7'; this.ctx.lineWidth = 6 + Math.random() * 5; this.ctx.shadowBlur = 30; this.ctx.shadowColor = '#a855f7';
          this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
          this.ctx.beginPath(); let curX = p.x; let curY = p.y; this.ctx.moveTo(curX, curY);
          for(let i=0; i<8; i++) { curX += (Math.random()-0.5) * 80; curY -= 60; this.ctx.lineTo(curX, curY); }
          this.ctx.stroke(); this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 2.5; this.ctx.stroke();
      } else if (p.type === 'laser') {
          this.ctx.translate(p.x, p.y);
          this.ctx.fillStyle = '#a855f7';
          this.ctx.shadowBlur = 15; this.ctx.shadowColor = '#a855f7';
          this.ctx.fillRect(-3, -20, 6, 40); // Long laser line
      } else {
          this.ctx.translate(p.x, p.y); if(p.angle) this.ctx.rotate(p.angle);
          this.ctx.fillStyle = p.type === 'missile' ? '#ef4444' : '#60a5fa'; this.ctx.shadowBlur = 10; this.ctx.shadowColor = this.ctx.fillStyle;
          this.ctx.fillRect(-6, -15, 12, 30); this.ctx.fillStyle = 'white'; this.ctx.fillRect(-3, -12, 6, 12);
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
          const sugiaIdx = SUGIOT.findIndex(s => s.requiredLevel === this.level);
          const typeIdx = (Math.max(0, sugiaIdx) % 6) + 1;
          if (typeIdx === 1) { 
              this.bossProjectiles.push({x: b.x - 120, y: b.y + 100, vy: 4.0, vx: 0});
              this.bossProjectiles.push({x: b.x + 120, y: b.y + 100, vy: 4.0, vx: 0});
          } else if (typeIdx === 2) { 
              for(let i=-2; i<=2; i++) this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: 3.5, vx: i * 1.8});
          } else if (typeIdx === 3) {
              for(let i=0; i<12; i++) { const angle = (i/12) * Math.PI * 2; this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: Math.sin(angle)*4.5, vx: Math.cos(angle)*4.5}); }
          } else if (typeIdx === 4) {
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              for(let i=-1; i<=1; i++) this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang+i*0.2)*5, vx: Math.cos(ang+i*0.2)*5});
          } else {
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
      
      const sugiaIdx = SUGIOT.findIndex(s => s.requiredLevel === this.level);
      const typeIdx = (Math.max(0, sugiaIdx) % 6) + 1;
      
      if (typeIdx === 1) this.drawTannina(); 
      else if (typeIdx === 2) this.drawKoy(); 
      else if (typeIdx === 3) this.drawShed();
      else if (typeIdx === 4) this.drawAgirat();
      else if (typeIdx === 5) this.drawLeviathan();
      else this.drawZiz();
      const names = ["", "תנינא", "כוי", "שד", "אגירת", "לויתן", "זיז שדי"]; 
      const bName = names[typeIdx] || "מזיק";
      this.ctx.fillStyle = 'white'; this.ctx.shadowBlur = 20; this.ctx.shadowColor = 'cyan';
      this.ctx.font = 'bold 46px Frank Ruhl Libre'; this.ctx.textAlign = 'center'; this.ctx.fillText(bName, 0, 30);
      this.ctx.restore();
  }

  drawTannina() {
      this.ctx.fillStyle = '#065f46'; this.ctx.strokeStyle = '#34d399'; this.ctx.lineWidth = 3;
      this.ctx.beginPath(); this.ctx.ellipse(0, 0, 110, 70, 0, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
      for (let i = 0; i < 7; i++) {
          const angle = (i / 6) * Math.PI - Math.PI; const nx = Math.cos(angle) * 90; const ny = Math.sin(angle) * 140;
          this.ctx.beginPath(); this.ctx.moveTo(Math.cos(angle)*50, Math.sin(angle)*40);
          this.ctx.quadraticCurveTo(nx*0.5, ny*0.5, nx, ny); this.ctx.stroke();
          this.ctx.beginPath(); this.ctx.arc(nx, ny, 20, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
      }
  }

  drawKoy() {
      this.ctx.fillStyle = '#78350f'; this.ctx.strokeStyle = '#f59e0b'; this.ctx.lineWidth = 4;
      this.ctx.beginPath(); this.ctx.moveTo(-100, 50); this.ctx.lineTo(100, 50); this.ctx.lineTo(80, -50); this.ctx.lineTo(-80, -50); this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
      this.ctx.strokeStyle = '#fff'; this.ctx.beginPath(); this.ctx.moveTo(-40, -50); this.ctx.lineTo(-70, -130); this.ctx.moveTo(40, -50); this.ctx.lineTo(70, -130); this.ctx.stroke();
  }

  drawShed() {
      const pulse = Math.sin(this.gameFrame * 0.1) * 0.2 + 0.6; this.ctx.globalAlpha = pulse;
      this.ctx.fillStyle = '#1e1b4b'; this.ctx.strokeStyle = '#818cf8'; this.ctx.lineWidth = 2;
      this.ctx.beginPath(); for(let i=0; i<12; i++) { const angle = (i/12) * Math.PI * 2; const r = 130 + (Math.random() * 40); this.ctx.lineTo(Math.cos(angle)*r, Math.sin(angle)*r); }
      this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke(); this.ctx.globalAlpha = 1;
      this.ctx.fillStyle = '#f43f5e'; this.ctx.beginPath(); this.ctx.arc(-35, -25, 12, 0, Math.PI*2); this.ctx.arc(35, -25, 12, 0, Math.PI*2); this.ctx.fill();
  }

  drawAgirat() {
      this.ctx.fillStyle = '#4c1d95'; this.ctx.beginPath(); this.ctx.moveTo(0, -100); this.ctx.lineTo(60, 50); this.ctx.lineTo(-60, 50); this.ctx.closePath(); this.ctx.fill();
      this.ctx.strokeStyle = '#a78bfa'; this.ctx.lineWidth = 5; this.ctx.stroke();
      this.ctx.fillStyle = '#fdf4ff'; this.ctx.beginPath(); this.ctx.arc(0, -60, 30, 0, Math.PI*2); this.ctx.fill();
  }

  drawLeviathan() {
      this.ctx.fillStyle = '#1e40af'; this.ctx.beginPath(); this.ctx.ellipse(0, 0, 150, 40, 0, 0, Math.PI*2); this.ctx.fill();
      this.ctx.fillStyle = '#60a5fa'; this.ctx.beginPath(); this.ctx.moveTo(100, 0); this.ctx.lineTo(160, -60); this.ctx.lineTo(160, 60); this.ctx.closePath(); this.ctx.fill();
  }

  drawZiz() {
      this.ctx.fillStyle = '#fbbf24'; this.ctx.beginPath(); this.ctx.moveTo(-180, 0); this.ctx.quadraticCurveTo(0, -150, 180, 0); this.ctx.lineTo(0, 50); this.ctx.closePath(); this.ctx.fill();
      this.ctx.fillStyle = '#d97706'; this.ctx.beginPath(); this.ctx.arc(0, -20, 25, 0, Math.PI*2); this.ctx.fill();
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
          this.player.x = Math.max(20, Math.min(this.width - 20, this.player.x + dx));
          this.player.y = Math.max(this.height * 0.4, Math.min(this.height - 100, this.player.y + dy));
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
