
export interface Word {
  aramaic: string;
  hebrew: string;
  cat: string;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
}

export type SugiaModifier = 'wave' | 'density' | 'hazards' | 'accelerate' | 'sharpness' | 'drift' | 'blink' | 'chaos' | 'darkness' | 'vortex' | 'storm' | 'final';

export interface Sugia {
  id: number;
  title: string;
  location: 'nehardea' | 'sura' | 'pumbedita' | 'mahoza' | 'matamehasia' | 'beiradelvat';
  description: string;
  requiredLevel: number;
  modifier: SugiaModifier;
}

export interface ShopItem {
  id: string;
  name: string;
  type: 'skin' | 'consumable';
  price: number;
  desc: string;
  icon: string;
  requiredAchievement?: string;
}

export interface LeaderboardEntry {
  name: string;
  class?: string;
  score: number;
}

export type GameState = 'MENU' | 'MAP' | 'PLAYING' | 'PAUSED' | 'SHOP' | 'LEADERBOARD' | 'GAMEOVER' | 'ACHIEVEMENTS' | 'TEACHER' | 'INSTRUCTIONS';

export interface GameStats {
  score: number;
  level: number;
  subLevel: number;
  lives: number;
  combo: number;
  coins: number;
  bombs: number;
  shields: number;
  potions: number;
  hasShield: boolean;
  bossActive: boolean;
  bossHpPercent: number;
  bossName?: string;
  currentWord: string;
  weaponAmmo?: number;
  sugiaTitle?: string;
}
