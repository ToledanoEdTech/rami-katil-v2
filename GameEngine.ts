
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
  
  player: { x: number; y: number; width: number; height: number; isHit: boolean; tilt: number; targetTilt: number; horizontalVelocity: number; lastX: number; lastY: number };
  
  enemyPool: PoolableEnemy[] = Array.from({length: 15}, () => new PoolableEnemy()); // Reduced for performance
  projectilePool: PoolableProjectile[] = Array.from({length: 60}, () => new PoolableProjectile()); // Reduced for performance
  particlePool: Particle[] = Array.from({length: 500}, () => new Particle());
  
  bossProjectiles: any[] = [];
  bonuses: any[] = [];
  hazards: any[] = [];
  boss: any = null;
  bossDamageTaken: boolean = false;

  starLayers: {x: number, y: number, size: number, speed: number, alpha: number}[][] = [[], [], []];
  jetParticles: {x: number, y: number, vx: number, vy: number, alpha: number, size: number, life: number}[] = [];
  shakeAmount: number = 0;

  // Cached gradients for performance
  shipGradients: any = null;
  cachedEngineColor: any = null;

  // Texture system for spaceship sprites
  shipTextures: { [key: string]: HTMLImageElement | null } = {};
  texturesLoaded: boolean = false;

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
    this.player = { x: this.width / 2, y: this.height - (isMobile ? 180 : 150), width: pW, height: pH, isHit: false, tilt: 0, targetTilt: 0, horizontalVelocity: 0, lastX: this.width / 2, lastY: this.height - (isMobile ? 180 : 150) };
    
    if (config.customDictionary && config.customDictionary.length > 0) {
      this.activeDictionary = config.customDictionary;
    } else {
      this.activeDictionary = DICTIONARY.filter(w => w.cat === config.category);
    }
    
    if (this.activeDictionary.length === 0) this.activeDictionary = [...DICTIONARY];
    
    this.currentDeck = [...this.activeDictionary];

    this.initParallax();
    this.loadShipTextures();
    this.startRound();
  }

  loadShipTextures() {
    const skinTextureMap: { [key: string]: string } = {
      'skin_default': '/ships/default.png',
      'skin_gold': '/ships/gold.png', // אור החמה
      'skin_butzina': '/ships/butzina.png', // בוצינא קדישא
      'skin_torah': '/ships/torah.png', // אש התורה
      'skin_choshen': '/ships/choshen.png', // חושן המשפט
      'skin_stealth': '/ships/stealth.png'
    };

    const skinsToLoad = Object.keys(skinTextureMap);
    let loadedCount = 0;

    skinsToLoad.forEach(skin => {
      const texturePath = skinTextureMap[skin];
      const img = new Image();

      img.onload = () => {
        this.shipTextures[skin] = img;
        loadedCount++;
        if (loadedCount === skinsToLoad.length) {
          this.texturesLoaded = true;
          console.log('All ship textures loaded successfully!');
        }
      };

      img.onerror = () => {
        console.warn(`Failed to load texture: ${texturePath}`);
        this.shipTextures[skin] = null;
        loadedCount++;
        if (loadedCount === skinsToLoad.length) {
          this.texturesLoaded = true;
        }
      };

      img.src = texturePath;
    });
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
    // Update last position tracking after resize
    this.player.lastX = this.player.x;
    this.player.lastY = this.player.y;
  }

  togglePause() { this.isPaused = !this.isPaused; return this.isPaused; }

  initParallax() {
    this.starLayers = [[], [], []];
    const isHighRes = this.width > 1200; // מחשבים עם רזולוציה גבוהה
    const starMultiplier = isHighRes ? 0.5 : 1; // הפחת מספר כוכבים ברזולוציות גבוהות

    const layerConfigs = [
        { count: Math.floor(120 * starMultiplier), speed: 0.1, size: 1, alpha: 0.2 },
        { count: Math.floor(80 * starMultiplier), speed: 0.8, size: 1.2, alpha: 0.4 },
        { count: Math.floor(50 * starMultiplier), speed: 3.0, size: 1.8, alpha: 0.6 }
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

  updateJetParticles(dt: number) {
      // Drastically reduced particle count for performance
      const streamLength = 4; // Reduced from 12 to 4
      const segmentSpacing = 15; // Less frequent updates (increased from 8)

      // Engine color based on skin - cached
      if (!this.cachedEngineColor || this.cachedEngineColor.skin !== this.config.skin) {
          this.cachedEngineColor = {
              skin: this.config.skin,
              color: this.config.skin === 'skin_gold' ? '#fbbf24' :
                     this.config.skin === 'skin_butzina' ? '#a855f7' :
                     this.config.skin === 'skin_stealth' ? '#64748b' :
                     this.config.skin === 'skin_default' ? '#3b82f6' : '#00ffff'
          };
      }

      // Add new plasma segments much less frequently
      if (this.jetParticles.length < streamLength * 2 &&
          (!this.jetParticles.length || this.jetParticles[this.jetParticles.length - 1].y - this.player.y > segmentSpacing)) {

          this.jetParticles.push({
              x: this.player.x - 17,
              y: this.player.y + 37,
              vx: 0,
              vy: 0,
              alpha: 0.4, // Slightly increased for visibility
              size: 1.2, // Smaller size
              life: streamLength
          });

          this.jetParticles.push({
              x: this.player.x + 17,
              y: this.player.y + 37,
              vx: 0,
              vy: 0,
              alpha: 0.4,
              size: 1.2,
              life: streamLength
          });
      }

      // Update plasma segments - simplified
      for (let i = this.jetParticles.length - 1; i >= 0; i--) {
          const p = this.jetParticles[i];
          p.life -= dt * 0.6; // Faster decay
          p.alpha -= 0.005 * dt;

          p.y += 4.0 * dt; // Faster movement
          // Removed complex x movement for performance

          if (p.life <= 0 || p.alpha <= 0) {
              this.jetParticles.splice(i, 1);
          }
      }

      // Limit total particles
      if (this.jetParticles.length > streamLength * 2) {
          this.jetParticles.splice(0, this.jetParticles.length - streamLength * 2);
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

    // Performance optimization: reduce enemy count on high-res displays
    if (!isMobile && this.width > 1200) {
      count = Math.max(3, count - 1); // Reduce by 1 enemy on high-res desktops
    }

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

    // Dramatic banking tilt interpolation - fast and responsive
    const tiltLerpSpeed = 25.0; // Much faster for immediate response
    const tiltDifference = this.player.targetTilt - this.player.tilt;
    // Direct lerp without easing for snappy response
    this.player.tilt += tiltDifference * Math.min(1, tiltLerpSpeed * dt);

    // Quick return to center when not moving
    if (Math.abs(this.player.horizontalVelocity) < 0.5) {
      this.player.targetTilt *= 0.85; // Faster decay for snappy feel
    }

    // Add subtle banking shake for intense maneuvers
    if (Math.abs(this.player.tilt) > 0.4) {
      this.shakeAmount = Math.min(3, Math.abs(this.player.tilt) * 2);
    }

    this.updateParallax(dt);
    // this.updateJetParticles(dt); // Disabled - no trail effect

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

    // אופטימיזציה: צייר רקע מורכב רק כל כמה פרימים ברזולוציות גבוהות
    const isHighRes = this.width > 1200;
    const shouldDrawComplexBg = !isHighRes || (this.gameFrame % 2 === 0); // כל פריים ברזולוציה נמוכה, כל שני פרימים בגבוהה

    if (shouldDrawComplexBg) {
      this.drawBackgroundTheme();
      this.starLayers.forEach(layer => {
          layer.forEach(s => {
              this.ctx.globalAlpha = s.alpha; this.ctx.fillStyle = 'white';
              this.ctx.beginPath(); this.ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); this.ctx.fill();
          });
      });
    } else {
      // רקע פשוט כשלא מציירים את הרקע המורכב
      this.ctx.globalAlpha = 0.1;
      this.ctx.fillStyle = '#1e293b';
      this.ctx.fillRect(0, this.height - 200, this.width, 200);
    }

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

  drawJetParticles() {
      if (this.jetParticles.length < 2) return;

      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';

      // Use cached color - no shadows for performance
      const plasmaColor = this.cachedEngineColor.color;

      // Simplified drawing - no shadows, reduced operations
      this.ctx.strokeStyle = plasmaColor;
      this.ctx.lineCap = 'round';
      this.ctx.lineWidth = 1.5; // Thinner lines

      // Draw all segments in one go - left engine
      const leftParticles = this.jetParticles.filter((_, i) => i % 2 === 0);
      if (leftParticles.length > 1) {
          for (let i = 0; i < leftParticles.length - 1; i++) {
              const p1 = leftParticles[i];
              const p2 = leftParticles[i + 1];

              this.ctx.globalAlpha = p1.alpha * 0.6;
              this.ctx.beginPath();
              this.ctx.moveTo(p1.x, p1.y);
              this.ctx.lineTo(p2.x, p2.y);
              this.ctx.stroke();
          }
      }

      // Draw all segments - right engine
      const rightParticles = this.jetParticles.filter((_, i) => i % 2 === 1);
      if (rightParticles.length > 1) {
          for (let i = 0; i < rightParticles.length - 1; i++) {
              const p1 = rightParticles[i];
              const p2 = rightParticles[i + 1];

              this.ctx.globalAlpha = p1.alpha * 0.6;
              this.ctx.beginPath();
              this.ctx.moveTo(p1.x, p1.y);
              this.ctx.lineTo(p2.x, p2.y);
              this.ctx.stroke();
          }
      }

      // Simple glow effect - no shadows
      this.ctx.globalAlpha = 0.3;
      this.ctx.fillStyle = plasmaColor;

      // Only draw the last particle of each engine
      if (leftParticles.length > 0) {
          const p = leftParticles[leftParticles.length - 1];
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI*2);
          this.ctx.fill();
      }
      if (rightParticles.length > 0) {
          const p = rightParticles[rightParticles.length - 1];
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI*2);
          this.ctx.fill();
      }

      this.ctx.restore();
  }

  drawEntities() {
      // Performance optimization: draw particles less frequently on high-res displays
      const isHighRes = this.width > 1200;
      if (!isHighRes || this.gameFrame % 2 === 0) { // Draw every frame on low-res, every 2nd frame on high-res
        this.particlePool.forEach(p => { if (p.active) { this.ctx.globalAlpha = p.alpha; this.ctx.fillStyle = p.color; this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); this.ctx.fill(); } });
      }
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
      // Draw jet particles after player
      // this.drawJetParticles(); // Disabled - no trail effect
      this.bossProjectiles.forEach(p => {
          if (!p) return;
          this.ctx.save();
          this.ctx.fillStyle = '#ef4444';
          // Performance optimization: reduce shadow on high-res displays
          if (this.width <= 1200) {
            this.ctx.shadowBlur = 20; this.ctx.shadowColor = '#ef4444';
          }
          this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 15, 0, Math.PI*2); this.ctx.fill(); this.ctx.restore();
          if(Math.hypot(p.x - this.player.x, p.y - this.player.y) < 32) { this.handleMiss(); p.y = 5000; }
      });
      this.bossProjectiles = this.bossProjectiles.filter(p => p.y < this.height + 50);
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';
      // Performance optimization: draw projectiles less frequently on high-res
      const shouldDrawProjectiles = !isHighRes || this.gameFrame % 2 === 0;
      if (shouldDrawProjectiles) {
        this.projectilePool.forEach(p => { if (p.active) this.drawProjectile(p); });
      }
      this.ctx.restore();
  }

  drawPlayer() {
      this.ctx.save();
      // Add DRAMATIC horizontal offset based on tilt for enhanced 3D effect
      const tiltOffset = this.player.tilt * 20; // Large horizontal shift for visibility
      this.ctx.translate(this.player.x + tiltOffset, this.player.y);
      // Apply tilt rotation for dramatic banking effect
      this.ctx.rotate(this.player.tilt * 1.2); // Slight amplification for more visible banking

      // Add DRAMATIC shadow effect for depth when tilted
      if (Math.abs(this.player.tilt) > 0.05) {
        this.ctx.save();
        this.ctx.translate(-tiltOffset * 0.8, 4); // More pronounced shadow offset
        this.ctx.globalAlpha = 0.4 + Math.abs(this.player.tilt) * 0.3; // Shadow opacity based on tilt
        this.ctx.fillStyle = '#000000';
        this.ctx.beginPath();
        this.ctx.ellipse(0, 0, 35 + Math.abs(this.player.tilt) * 10, 18, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
      }

      if (this.shieldStrength > 0) {
          const color = this.shieldStrength === 2 ? '#3b82f6' : '#93c5fd';
          this.ctx.strokeStyle = color; this.ctx.lineWidth = 4;
          // Performance optimization: reduce shadow on high-res displays
          if (this.width <= 1200) {
            this.ctx.shadowBlur = 25; this.ctx.shadowColor = color;
          }
          this.ctx.beginPath(); this.ctx.arc(0, 0, 45, 0, Math.PI*2); this.ctx.stroke();
          this.ctx.globalAlpha = 0.1; this.ctx.fillStyle = color; this.ctx.fill(); this.ctx.globalAlpha = 1;
      }
      this.renderShip();
      this.ctx.restore();
  }

  renderShip() {
      const skin = this.config.skin;
      const isMobile = this.width < 600;
      const isHighRes = this.width > 1200;
      const scale = isMobile ? 0.55 : 0.75;
      const time = this.gameFrame * 0.02; // Animation time
      const pulse = isHighRes ? 1.0 : Math.sin(time) * 0.2 + 0.8; // No pulsing on high-res for performance

      // Try to use texture first, fallback to vector graphics
      const shipTexture = this.shipTextures[skin];
      if (shipTexture && this.texturesLoaded) {
        this.renderShipWithTexture(shipTexture, scale);
        return;
      }

      // Fallback to vector graphics if texture not available
      this.renderShipVector(skin, isMobile, isHighRes, scale, time, pulse);
  }

  hexToRgb(hex: string): number[] {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? [
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16)
      ] : [255, 255, 255];
  }

  drawEnemy(e: any) {
      this.ctx.save(); this.ctx.translate(e.x, e.y);

      // Performance optimization: simplified enemy drawing for high-res displays
      const isHighRes = this.width > 1200;
      if (isHighRes) {
        // Simple rectangle for high-res performance
        this.ctx.fillStyle = '#475569';
        this.ctx.fillRect(-e.radius, -e.radius, e.radius * 2, e.radius * 2);
        this.ctx.strokeStyle = '#94a3b8';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(-e.radius, -e.radius, e.radius * 2, e.radius * 2);
      } else {
        // Full star drawing for mobile/low-res
        this.ctx.rotate(e.rotation);
        const grad = this.ctx.createRadialGradient(0, 0, 5, 0, 0, e.radius);
        grad.addColorStop(0, '#475569'); grad.addColorStop(1, '#020617');
        this.ctx.fillStyle = grad; this.ctx.beginPath();
        for(let i=0; i<8; i++) { const angle = (i/8) * Math.PI * 2; const r = e.radius * (i % 2 === 0 ? 1 : 0.88); this.ctx.lineTo(Math.cos(angle)*r, Math.sin(angle)*r); }
        this.ctx.closePath(); this.ctx.fill();
        this.ctx.strokeStyle = '#94a3b8'; this.ctx.lineWidth = 1.5; this.ctx.stroke();
        this.ctx.rotate(-e.rotation);
      }

      this.ctx.fillStyle = 'white';
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

          // ישיר מיפוי של רמות לבוסים - יריות
          if (this.level === 1) { // Tannina
              this.bossProjectiles.push({x: b.x - 120, y: b.y + 100, vy: 4.0, vx: 0});
              this.bossProjectiles.push({x: b.x + 120, y: b.y + 100, vy: 4.0, vx: 0});
          } else if (this.level === 8) { // Koy
              for(let i=-2; i<=2; i++) this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: 3.5, vx: i * 1.8});
          } else if (this.level === 15) { // Shed
              const isHighRes = this.width > 1200;
              const count = isHighRes ? 8 : 12; // Reduce from 12 to 8 on high-res
              for(let i=0; i<count; i++) { const angle = (i/count) * Math.PI * 2; this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: Math.sin(angle)*4.5, vx: Math.cos(angle)*4.5}); }
          } else if (this.level === 22) { // Ashmedai - בוס קשה עם יריות מרובות
              const isHighRes = this.width > 1200;
              const projectileCount = isHighRes ? 0.6 : 1; // Reduce projectiles on high-res

              // יריות מכוונות לשחקן (5 יריות -> 3 on high-res)
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              const aimedCount = Math.floor(5 * projectileCount);
              for(let i=0; i<aimedCount; i++) {
                const offset = aimedCount > 1 ? (i - (aimedCount-1)/2) * 0.4 : 0;
                this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang+offset)*5, vx: Math.cos(ang+offset)*5});
              }

              // יריות מעגליות (8 יריות -> 5 on high-res)
              const circleCount = Math.floor(8 * projectileCount);
              for(let i=0; i<circleCount; i++) {
                const angle = (i/circleCount) * Math.PI * 2;
                this.bossProjectiles.push({x: b.x, y: b.y + 100, vy: Math.sin(angle)*5, vx: Math.cos(angle)*5});
              }

              // יריות מתפזרות לצדדים (4 יריות -> 2 on high-res)
              const spreadCount = Math.floor(4 * projectileCount);
              for(let i=0; i<spreadCount; i++) {
                const side = i % 2 === 0 ? -1 : 1;
                this.bossProjectiles.push({x: b.x + side*80, y: b.y + 100, vy: 4.5, vx: side * 0.3});
              }
          } else if (this.level === 29) { // Agirat
              const ang = Math.atan2(this.player.y - (b.y+100), this.player.x - b.x);
              for(let i=-1; i<=1; i++) this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang+i*0.2)*5, vx: Math.cos(ang+i*0.2)*5});
          } else if (this.level === 36) { // Leviathan
              for(let i=0; i<10; i++) { const ang = (this.gameFrame*0.1) + (i/10)*Math.PI*2; this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang)*4.5, vx: Math.cos(ang)*4.5}); }
          } else { // Ziz
              const isHighRes = this.width > 1200;
              const count = isHighRes ? 5 : 8; // Reduce from 8 to 5 on high-res
              for(let i=0; i<count; i++) { const ang = (this.gameFrame*0.1) + (i/count)*Math.PI*2; this.bossProjectiles.push({x: b.x, y: b.y+100, vy: Math.sin(ang)*4, vx: Math.cos(ang)*4}); }
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
      else if (typeIdx === 4) this.drawAshmedai();
      else if (typeIdx === 5) this.drawAgirat();
      else if (typeIdx === 6) this.drawLeviathan();
      else this.drawZiz();
      const names = ["", "תנינא", "כוי", "שד", "אשמדאי", "אגירת", "לויתן", "זיז שדי"];
      const bName = names[typeIdx] || "מזיק";
      this.ctx.fillStyle = 'white';
      // Performance optimization: reduce shadow on high-res displays
      if (this.width <= 1200) {
        this.ctx.shadowBlur = 20; this.ctx.shadowColor = 'cyan';
      }
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

          // Update tilt based on horizontal movement - DRAMATIC banking effect
          this.player.horizontalVelocity = dx;
          // Set target tilt based on movement direction (-45 to +45 degrees for VISIBLE banking)
          this.player.targetTilt = Math.max(-0.8, Math.min(0.8, dx * 0.12));

          // Update last position for consistent tracking
          this.player.lastX = this.player.x;
          this.player.lastY = this.player.y;
      }
  }

  setPlayerPos(x: number, y: number) {
      if (!this.isPaused && !this.isTransitioning) {
          // Calculate movement delta based on last position for accurate tilt
          const dx = x - this.player.lastX;
          const dy = y - this.player.lastY;

          // Update tilt based on horizontal movement - DRAMATIC banking effect
          this.player.horizontalVelocity = dx;
          // Set target tilt based on movement direction (-45 to +45 degrees for VISIBLE banking)
          this.player.targetTilt = Math.max(-0.8, Math.min(0.8, dx * 0.12));

          // Update last position
          this.player.lastX = x;
          this.player.lastY = y;

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

  renderShipWithTexture(texture: HTMLImageElement, scale: number) {
    this.ctx.save();
    this.ctx.scale(scale, scale);

    // Calculate texture dimensions (assuming texture is designed for the ship size)
    const textureWidth = 80; // Adjust based on your texture size
    const textureHeight = 60; // Adjust based on your texture size

    // Apply banking effects to texture rendering
    const tiltOffset = this.player.tilt * 20;
    this.ctx.translate(textureWidth / 2 + tiltOffset, textureHeight / 2);

    // Apply rotation for banking effect
    this.ctx.rotate(this.player.tilt * 1.2);

    // Draw shadow if banking
    if (Math.abs(this.player.tilt) > 0.05) {
      this.ctx.save();
      this.ctx.translate(-tiltOffset * 0.8, 4);
      this.ctx.globalAlpha = 0.4 + Math.abs(this.player.tilt) * 0.3;
      this.ctx.fillStyle = '#000000';
      this.ctx.beginPath();
      this.ctx.ellipse(0, 0, 35 + Math.abs(this.player.tilt) * 10, 18, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // Draw the texture
    this.ctx.globalAlpha = 1.0;
    this.ctx.drawImage(texture, -textureWidth / 2, -textureHeight / 2, textureWidth, textureHeight);

    // Add glow effect for special weapons
    if (this.weaponType !== 'normal') {
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = 0.3;
      this.ctx.drawImage(texture, -textureWidth / 2, -textureHeight / 2, textureWidth, textureHeight);
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1.0;
    }

    this.ctx.restore();
  }

  renderShipVector(skin: string, isMobile: boolean, isHighRes: boolean, scale: number, time: number, pulse: number) {
    // Define futuristic color schemes for each skin
    let primary = '#00ffff', secondary = '#0088aa', accent = '#ff00ff', engine = '#00aaff', metallic = '#e0e0ff', glow = '#00ffff';
    if (skin === 'skin_default') {
        primary = '#3b82f6'; secondary = '#1e3a8a'; accent = '#60a5fa'; engine = '#0ea5e9'; metallic = '#cbd5e1'; glow = '#3b82f6';
    } else if (skin === 'skin_gold') {
        primary = '#fbbf24'; secondary = '#92400e'; accent = '#f59e0b'; engine = '#eab308'; metallic = '#fef3c7'; glow = '#fbbf24';
    } else if (skin === 'skin_stealth') {
        primary = '#334155'; secondary = '#1e293b'; accent = '#64748b'; engine = '#475569'; metallic = '#94a3b8'; glow = '#64748b';
    } else if (skin === 'skin_butzina') {
        primary = '#a855f7'; secondary = '#6b21a8'; accent = '#c084fc'; engine = '#8b5cf6'; metallic = '#d8b4fe'; glow = '#a855f7';
    }

    this.ctx.save();
    this.ctx.scale(scale, scale);

    // Cache gradients to avoid recreating them every frame
    if (!this.shipGradients || this.shipGradients.skin !== skin) {
        this.shipGradients = {
            skin: skin,
            hull: this.ctx.createLinearGradient(-35, -60, 35, 40),
            reflection: this.ctx.createLinearGradient(-20, -50, 20, -20),
            canopy: this.ctx.createLinearGradient(0, -45, 0, -25),
            core: this.ctx.createRadialGradient(0, 37, 0, 0, 37, 6),
            aura: this.ctx.createRadialGradient(0, -20, 40, 0, -20, 80),
            pulse: this.ctx.createRadialGradient(0, -20, 30, 0, -20, 60)
        };

        // Setup gradients once
        const g = this.shipGradients;
        g.hull.addColorStop(0, metallic);
        g.hull.addColorStop(0.2, secondary);
        g.hull.addColorStop(0.5, primary);
        g.hull.addColorStop(0.8, secondary);
        g.hull.addColorStop(1, metallic);

        g.reflection.addColorStop(0, 'rgba(255,255,255,0.6)');
        g.reflection.addColorStop(0.3, 'rgba(255,255,255,0.2)');
        g.reflection.addColorStop(0.7, 'rgba(255,255,255,0.1)');
        g.reflection.addColorStop(1, 'rgba(255,255,255,0.4)');

        g.canopy.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.canopy.addColorStop(0.2, 'rgba(200,255,255,0.8)');
        g.canopy.addColorStop(0.5, `rgba(${this.hexToRgb(primary).join(',')}, 0.6)`);
        g.canopy.addColorStop(0.8, 'rgba(100,200,255,0.4)');
        g.canopy.addColorStop(1, 'rgba(0,0,0,0.7)');

        g.core.addColorStop(0, engine);
        g.core.addColorStop(0.7, `rgba(${this.hexToRgb(engine).join(',')}, 0.6)`);
        g.core.addColorStop(1, 'transparent');

        g.aura.addColorStop(0, `rgba(${this.hexToRgb(primary).join(',')}, 0.08)`);
        g.aura.addColorStop(0.3, `rgba(${this.hexToRgb(accent).join(',')}, 0.05)`);
        g.aura.addColorStop(0.6, `rgba(${this.hexToRgb(glow).join(',')}, 0.03)`);
        g.aura.addColorStop(1, 'transparent');

        g.pulse.addColorStop(0, `rgba(${this.hexToRgb(glow).join(',')}, ${0.03 * pulse})`);
        g.pulse.addColorStop(0.5, `rgba(${this.hexToRgb(primary).join(',')}, ${0.02 * pulse})`);
        g.pulse.addColorStop(1, 'transparent');
    }

    // === OPTIMIZED SPACECRAFT DESIGN ===
    // Main hull - simplified paths
    this.ctx.fillStyle = this.shipGradients.hull;

    // Upper hull - single optimized path
    this.ctx.beginPath();
    this.ctx.moveTo(0, -70);
    this.ctx.lineTo(12, -55);
    this.ctx.lineTo(25, -35);
    this.ctx.lineTo(20, -10);
    this.ctx.lineTo(15, 15);
    this.ctx.lineTo(8, 25);
    this.ctx.lineTo(-8, 25);
    this.ctx.lineTo(-15, 15);
    this.ctx.lineTo(-20, -10);
    this.ctx.lineTo(-25, -35);
    this.ctx.lineTo(-12, -55);
    this.ctx.closePath();
    this.ctx.fill();

    // Lower hull - simplified
    this.ctx.fillStyle = secondary;
    this.ctx.beginPath();
    this.ctx.moveTo(8, 25);
    this.ctx.lineTo(15, 35);
    this.ctx.lineTo(10, 45);
    this.ctx.lineTo(-10, 45);
    this.ctx.lineTo(-15, 35);
    this.ctx.lineTo(-8, 25);
    this.ctx.closePath();
    this.ctx.fill();

    // Simplified metallic highlights
    this.ctx.fillStyle = this.shipGradients.reflection;
    this.ctx.beginPath();
    this.ctx.ellipse(0, -35, 12, 30, 0, 0, Math.PI*2);
    this.ctx.fill();

    // === FORWARD-SWEPT WINGS WITH TILT ANIMATION ===
    this.ctx.fillStyle = this.shipGradients.hull;

    // Left wing - DRAMATIC tilt effect and wing flex
    this.ctx.save();
    const leftWingFlex = this.player.tilt * 25; // Extreme wing flex for visibility
    this.ctx.rotate(this.player.tilt * 0.8); // Wings tilt dramatically with body
    this.ctx.beginPath();
    this.ctx.moveTo(25, -35);
    this.ctx.lineTo(55 + leftWingFlex, -45); // Wing tip moves with tilt
    this.ctx.lineTo(45 + leftWingFlex * 0.7, -25);
    this.ctx.lineTo(35, -15);
    this.ctx.lineTo(20, -10);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();

    // Right wing - DRAMATIC tilt effect and wing flex
    this.ctx.save();
    const rightWingFlex = this.player.tilt * 25; // Extreme wing flex for visibility
    this.ctx.rotate(this.player.tilt * 0.8); // Wings tilt dramatically with body
    this.ctx.beginPath();
    this.ctx.moveTo(-25, -35);
    this.ctx.lineTo(-55 + rightWingFlex, -45); // Wing tip moves with tilt
    this.ctx.lineTo(-45 + rightWingFlex * 0.7, -25);
    this.ctx.lineTo(-35, -15);
    this.ctx.lineTo(-20, -10);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();

    // Wing reinforcements - single stroke call
    this.ctx.strokeStyle = metallic;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(25, -35);
    this.ctx.lineTo(35, -40);
    this.ctx.moveTo(-25, -35);
    this.ctx.lineTo(-35, -40);
    this.ctx.stroke();

    // === OPTIMIZED NEON TRIM ===
    // Reduced shadow operations, single pass for all trim
    this.ctx.shadowBlur = 8 * pulse;
    this.ctx.shadowColor = glow;
    this.ctx.strokeStyle = glow;
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';

    this.ctx.beginPath();
    // Hull edge
    this.ctx.moveTo(12, -55);
    this.ctx.lineTo(0, -70);
    this.ctx.lineTo(-12, -55);
    // Wing edges
    this.ctx.moveTo(25, -35);
    this.ctx.lineTo(55, -45);
    this.ctx.moveTo(-25, -35);
    this.ctx.lineTo(-55, -45);
    // Engine housing
    this.ctx.moveTo(10, 45);
    this.ctx.lineTo(15, 35);
    this.ctx.lineTo(-15, 35);
    this.ctx.lineTo(-10, 45);
    this.ctx.stroke();

    this.ctx.shadowBlur = 0;

    // === ADVANCED COCKPIT ===
    this.ctx.fillStyle = this.shipGradients.canopy;
    this.ctx.beginPath();
    this.ctx.moveTo(-10, -45);
    this.ctx.lineTo(0, -60);
    this.ctx.lineTo(10, -45);
    this.ctx.lineTo(12, -30);
    this.ctx.lineTo(-12, -30);
    this.ctx.closePath();
    this.ctx.fill();

    // Canopy frame
    this.ctx.strokeStyle = metallic;
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // Energy conduits - simplified
    this.ctx.shadowBlur = 6 * pulse;
    this.ctx.shadowColor = accent;
    this.ctx.strokeStyle = accent;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(-8, -40);
    this.ctx.lineTo(8, -40);
    this.ctx.moveTo(-6, -35);
    this.ctx.lineTo(6, -35);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;

    // === ION ENGINES ===
    this.ctx.fillStyle = secondary;

    // Engine housings - simplified paths
    this.ctx.beginPath();
    this.ctx.moveTo(8, 25);
    this.ctx.lineTo(18, 30);
    this.ctx.lineTo(22, 40);
    this.ctx.lineTo(15, 50);
    this.ctx.lineTo(8, 45);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.beginPath();
    this.ctx.moveTo(-8, 25);
    this.ctx.lineTo(-18, 30);
    this.ctx.lineTo(-22, 40);
    this.ctx.lineTo(-15, 50);
    this.ctx.lineTo(-8, 45);
    this.ctx.closePath();
    this.ctx.fill();

    // Plasma cores - DRAMATICALLY enhanced with tilt effect
    const tiltBoost = 1 + Math.abs(this.player.tilt) * 2.0; // Engines glow MUCH more when tilting
    this.ctx.shadowBlur = 25 * pulse * tiltBoost; // Increased base blur
    this.ctx.shadowColor = engine;
    this.ctx.fillStyle = this.shipGradients.core;

    this.ctx.beginPath();
    this.ctx.ellipse(17, 37, 6, 4, 0, 0, Math.PI*2);
    this.ctx.fill();

    this.ctx.beginPath();
    this.ctx.ellipse(-17, 37, 6, 4, 0, 0, Math.PI*2);
    this.ctx.fill();

    this.ctx.shadowBlur = 0;

    // Engine vents - simplified
    this.ctx.strokeStyle = metallic;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(12, 50);
    this.ctx.lineTo(18, 55);
    this.ctx.moveTo(-12, 50);
    this.ctx.lineTo(-18, 55);
    this.ctx.stroke();

    // === ENERGY FIELD AURA ===
    // Reduced complexity, single aura pass
    this.ctx.fillStyle = this.shipGradients.aura;
    this.ctx.beginPath();
    this.ctx.ellipse(0, -20, 75, 50, 0, 0, Math.PI*2);
    this.ctx.fill();

    // === MINIMAL FLOATING PARTICLES ===
    // Skip particles on high-res for performance
    if (!isHighRes) {
      this.ctx.fillStyle = glow;
      this.ctx.globalAlpha = 0.5;
      for(let i=0; i<2; i++) { // Reduced from 4 to 2
          const angle = (time * 0.4 + i/2 * Math.PI * 2) % (Math.PI * 2);
          const distance = 45; // Fixed distance for performance
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance - 15;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 0.8, 0, Math.PI*2); // Smaller size
          this.ctx.fill();
      }
      this.ctx.globalAlpha = 1;
    }

    // === REDUCED ENERGY PULSE ===
    // Skip on high-res for performance
    if (!isHighRes && this.gameFrame % 5 === 0) { // Skip on high-res, every 5th frame on low-res
        this.ctx.globalCompositeOperation = 'lighter';
        this.ctx.fillStyle = this.shipGradients.pulse;
        this.ctx.beginPath();
        this.ctx.ellipse(0, -20, 50, 35, 0, 0, Math.PI*2); // Smaller pulse
        this.ctx.fill();
        this.ctx.globalCompositeOperation = 'source-over';
    }

    this.ctx.restore();
  }
