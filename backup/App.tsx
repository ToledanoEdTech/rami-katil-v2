
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameState, GameStats, LeaderboardEntry, ShopItem, Achievement, Sugia, Word } from './types';
import { SHOP_ITEMS, SCRIPT_URL, ACHIEVEMENTS, SUGIOT, DICTIONARY } from './constants';
import { Sound } from './utils/sound';
import { GameEngine, GameConfig } from './game/GameEngine';

const safeParse = (key: string, fallback: any) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    return fallback;
  }
};

const safeInt = (key: string, fallback: number) => {
  const val = localStorage.getItem(key);
  return val ? parseInt(val, 10) : fallback;
};

const removeNiqqud = (str: string) => {
  return str.replace(/[\u0591-\u05C7]/g, '');
};

const GoldCoin = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block align-middle">
    <circle cx="12" cy="12" r="10" fill="#FBBF24" stroke="#B45309" strokeWidth="2"/>
    <circle cx="12" cy="12" r="7" stroke="#D97706" strokeWidth="1" strokeDasharray="2 2"/>
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="900" fill="#92400E" fontFamily="Arial">$</text>
  </svg>
);

function App() {
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [coins, setCoins] = useState(safeInt('coins', 0));
  const [isPaused, setIsPaused] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>(() => safeParse('achievements', []));
  const [unlockNotification, setUnlockNotification] = useState<Achievement | null>(null);
  const [maxLevelReached, setMaxLevelReached] = useState(() => safeInt('maxLevel', 1));
  const [selectedSugia, setSelectedSugia] = useState<Sugia | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [customWordList, setCustomWordList] = useState<Word[] | null>(null);
  const [dynamicWords, setDynamicWords] = useState<Word[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  
  // Teacher Mode State
  const [teacherSelectedIndices, setTeacherSelectedIndices] = useState<number[]>([]);
  const [teacherSearchTerm, setTeacherSearchTerm] = useState('');
  const [teacherSelectedCategory, setTeacherSelectedCategory] = useState<'all' | 'berachot' | 'bava_kamma' | 'common'>('all');
  const [teacherAuthPass, setTeacherAuthPass] = useState('');
  const [isTeacherAuthenticated, setIsTeacherAuthenticated] = useState(false);
  
  // Add Word Form State
  const [newWordAramaic, setNewWordAramaic] = useState('');
  const [newWordHebrew, setNewWordHebrew] = useState('');
  const [newWordCategory, setNewWordCategory] = useState<'common' | 'berachot' | 'bava_kamma'>('common');
  const [isAddingWord, setIsAddingWord] = useState(false);

  const [inventory, setInventory] = useState(() => ({
    bombs: safeInt('bombs', 1),
    shields: safeInt('shields', 0),
    potions: safeInt('potions', 0),
    skins: safeParse('skins', ["skin_default"]),
    currentSkin: localStorage.getItem('currentSkin') || 'skin_default'
  }));
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const animationFrameId = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastTouchRef = useRef<{x: number, y: number} | null>(null);
  const isInputOnUI = useRef(false);
  
  const [stats, setStats] = useState<GameStats>({
    score: 0, level: 1, subLevel: 1, lives: 3, combo: 0, coins: 0, bombs: 0, shields: 0, potions: 0,
    hasShield: false, bossActive: false, bossHpPercent: 0, currentWord: 'טוען...', weaponAmmo: 0, sugiaTitle: ''
  });

  const [feedback, setFeedback] = useState<{msg: string, isGood: boolean} | null>(null);
  const [config, setConfig] = useState<GameConfig>({
      difficulty: 'medium',
      category: 'common',
      skin: inventory.currentSkin
  });
  
  const [isUnitComplete, setIsUnitComplete] = useState(false);
  const [transitionStats, setTransitionStats] = useState<any>(null);
  
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [playerClass, setPlayerClass] = useState('');

  // Combined Dictionary: Static + Dynamic (Important: this is re-calculated every render)
  const fullDictionary = [...DICTIONARY, ...dynamicWords];

  // Fetch Data (Leaderboard + Dynamic Words)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // הוספת פרמטר זמן למניעת שמירת נתונים ישנים במטמון הדפדפן
      const response = await fetch(`${SCRIPT_URL}?t=${new Date().getTime()}`);
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      
      // טיפול גמיש במבנה הנתונים שהתקבל
      let leaderboardData: LeaderboardEntry[] = [];
      
      if (data.leaderboard && Array.isArray(data.leaderboard)) {
        leaderboardData = data.leaderboard;
      } else if (Array.isArray(data)) {
        // במקרה שהסקריפט מחזיר מערך ישיר
        leaderboardData = data as LeaderboardEntry[];
      }
      
      setLeaderboard(leaderboardData);
      
      if (data.dynamicWords && Array.isArray(data.dynamicWords)) {
          setDynamicWords(data.dynamicWords);
      }
      setHasFetched(true);
    } catch (error) {
      console.error('Error fetching data:', error);
      setHasFetched(true); 
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
    Sound.init();
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(checkMobile);
    
    // התחלת מוזיקת תפריט בטעינה ראשונית
    if (gameState === 'MENU') {
      Sound.playMenuMusic();
    }

    // הוספת האזנה לכל אינטראקציה כדי לשחרר את חסימת האודיו של הדפדפן
    const unlockAudio = () => {
      // ניסיון לחדש את הניגון אם הוא נחסם
      Sound.resume();
      
      // הסרת המאזינים רק אם הצלחנו לנגן
      if (!Sound.menuTrack.paused || !Sound.gameTrack.paused || (Sound.ctx && Sound.ctx.state === 'running')) {
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      }
    };
    
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, [fetchData]);

  // Handle URL Parameter after data is fetched
  useEffect(() => {
    if (hasFetched) {
      const params = new URLSearchParams(window.location.search);
      const wordParam = params.get('w');
      if (wordParam) {
        const indices = wordParam.split(',').map(Number).filter(n => !isNaN(n));
        // Use the current fullDictionary which now contains dynamic words
        const filtered = indices.map(i => fullDictionary[i]).filter(Boolean);
        if (filtered.length > 0) {
          setCustomWordList(filtered);
          setFeedback({ msg: "נבחר מילון מורה!", isGood: true });
          setTimeout(() => setFeedback(null), 3000);
        }
      }
    }
  }, [hasFetched, dynamicWords.length]); // Re-run when fetch is done or dynamic words count changes

  const handleAddNewWord = async () => {
    if (!newWordAramaic || !newWordHebrew) return alert('נא למלא את כל השדות');
    setIsAddingWord(true);
    
    const payload = {
        action: 'addWord',
        word: {
            aramaic: newWordAramaic,
            hebrew: newWordHebrew,
            cat: newWordCategory
        }
    };

    try {
      await fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(payload)
      });
      
      setFeedback({ msg: "המילה נוספה בהצלחה!", isGood: true });
      setNewWordAramaic('');
      setNewWordHebrew('');
      
      // Refresh to show the new word in the list immediately
      setTimeout(() => {
          fetchData();
          setFeedback(null);
      }, 2000);
      
    } catch (err) {
      alert('שגיאה בתקשורת עם השרת');
    } finally {
      setIsAddingWord(false);
    }
  };

  useEffect(() => {
    if (displayScore < stats.score) {
      const diff = stats.score - displayScore;
      const step = Math.ceil(diff / 10);
      const timer = setTimeout(() => setDisplayScore(displayScore + step), 30);
      return () => clearTimeout(timer);
    }
  }, [stats.score, displayScore]);

  const unlockAchievement = useCallback((id: string) => {
    setUnlockedAchievements(prev => {
      if (prev.includes(id)) return prev;
      const newUnlocked = [...prev, id];
      localStorage.setItem('achievements', JSON.stringify(newUnlocked));
      const ach = ACHIEVEMENTS.find(a => a.id === id);
      if (ach) {
        setUnlockNotification(ach);
        Sound.play('powerup');
        setTimeout(() => setUnlockNotification(null), 4000);
      }
      return newUnlocked;
    });
  }, []);

  const gameLoop = useCallback((time: number) => {
    if (engineRef.current) {
        const deltaTime = lastTimeRef.current ? (time - lastTimeRef.current) / (1000 / 60) : 1;
        lastTimeRef.current = time;
        engineRef.current.update(Math.min(deltaTime, 2.0)); 
        engineRef.current.draw();
        animationFrameId.current = requestAnimationFrame(gameLoop);
    }
  }, []);

  const startGame = (sugia?: Sugia) => {
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    engineRef.current = null;
    lastTimeRef.current = 0;
    setDisplayScore(0);
    setIsUnitComplete(false);
    
    // Choose the dictionary to pass to the engine
    const dictionaryToUse = customWordList || fullDictionary.filter(w => w.cat === config.category);

    setStats({
        score: 0, level: sugia ? sugia.requiredLevel : 1, subLevel: 1, lives: 3, combo: 0, coins: 0, 
        bombs: inventory.bombs, shields: inventory.shields, potions: inventory.potions,
        hasShield: false, bossActive: false, bossHpPercent: 0, currentWord: 'מתחיל...', weaponAmmo: 0,
        sugiaTitle: sugia?.title || (customWordList ? 'תרגול מורה' : 'פתיחת הסוגיא')
    });
    
    Sound.resume();
    Sound.play('ui_click');
    Sound.playGameMusic(); // שימוש בפונקציה החדשה
    setGameState('PLAYING');
    setIsPaused(false);
    
    requestAnimationFrame((time) => {
        if(canvasRef.current) {
            canvasRef.current.width = window.innerWidth;
            canvasRef.current.height = window.innerHeight;
            
            engineRef.current = new GameEngine(
                canvasRef.current,
                { 
                  ...config, 
                  skin: inventory.currentSkin, 
                  location: sugia?.location || 'nehardea',
                  modifier: sugia?.modifier || 'wave',
                  sugiaTitle: sugia?.title || (customWordList ? 'תרגול מורה' : 'פתיחת הסוגיא'),
                  customDictionary: dictionaryToUse
                },
                { bombs: inventory.bombs, shields: inventory.shields, potions: inventory.potions },
                {
                    onStatsUpdate: (s: any) => {
                        setStats(prev => {
                            const newStats = {...prev, ...s};
                            if (newStats.level > maxLevelReached) {
                              setMaxLevelReached(newStats.level);
                              localStorage.setItem('maxLevel', newStats.level.toString());
                            }
                            return newStats;
                        });
                    },
                    onGameOver: (finalScore: number) => {
                        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
                        setGameState('GAMEOVER');
                        Sound.playMenuMusic(); // חזרה למוזיקת תפריט
                        const earned = Math.floor(finalScore / 20);
                        const newCoins = coins + earned;
                        setCoins(newCoins);
                        localStorage.setItem('coins', newCoins.toString());
                    },
                    onFeedback: (msg: string, isGood: boolean) => {
                        setFeedback({msg, isGood});
                        setTimeout(() => setFeedback(null), 1200);
                    },
                    onAchievement: (id: string) => {
                        unlockAchievement(id);
                    },
                    onUnitComplete: (s: any) => {
                        setTransitionStats(s);
                        setIsUnitComplete(true);
                        Sound.play('powerup');
                    }
                }
            );
            lastTimeRef.current = time;
            animationFrameId.current = requestAnimationFrame(gameLoop);
        }
    });
  };

  const proceedToNextSugia = () => {
    if (engineRef.current) {
      setIsUnitComplete(false);
      engineRef.current.nextUnit();
      Sound.play('ui_click');
    }
  };

  const handleReturnToMenu = () => {
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    engineRef.current = null;
    Sound.play('ui_click');
    Sound.playMenuMusic(); // חזרה למוזיקת תפריט
    setIsTeacherAuthenticated(false);
    setTeacherAuthPass('');
    setTeacherSearchTerm('');
    setGameState('MENU');
  };

  const navigateTo = (state: GameState) => {
    Sound.play('ui_click');
    if (state === 'LEADERBOARD') fetchData();
    setGameState(state);
  };

  // Teacher Mode Helpers
  const generateTeacherLink = () => {
    if (teacherSelectedIndices.length === 0) {
      alert("נא לבחור לפחות מילה אחת לשיעור");
      return;
    }
    const baseUrl = window.location.origin + window.location.pathname;
    const link = `${baseUrl}?w=${teacherSelectedIndices.join(',')}`;
    
    navigator.clipboard.writeText(link).then(() => {
      alert("הקישור הועתק ללוח! שתף אותו עם התלמידים.");
      handleReturnToMenu();
    }).catch(err => {
      prompt("העתק את הקישור לשיעור:", link);
    });
  };

  const toggleTeacherWordSelection = (idx: number) => {
    setTeacherSelectedIndices(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
    Sound.play('ui_click');
  };

  useEffect(() => {
      const handleResize = () => { if(engineRef.current) engineRef.current.resize(window.innerWidth, window.innerHeight); };
      
      const handleMove = (e: any) => {
          if(!engineRef.current || gameState !== 'PLAYING' || isInputOnUI.current || isUnitComplete) return;
          if (e.touches) {
              const touch = e.touches[0];
              if (lastTouchRef.current) {
                  const dx = touch.clientX - lastTouchRef.current.x;
                  const dy = touch.clientY - lastTouchRef.current.y;
                  engineRef.current.movePlayer(dx, dy);
              }
              lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
              if (e.cancelable) e.preventDefault();
          } else {
              engineRef.current.setPlayerPos(e.clientX, e.clientY);
          }
      };

      const handleTouchStart = (e: TouchEvent) => {
          if(!engineRef.current || gameState !== 'PLAYING' || isUnitComplete) return;
          const target = e.target as HTMLElement;
          if (target.closest('[data-ui="true"]')) {
            isInputOnUI.current = true;
            return;
          }
          isInputOnUI.current = false;
          lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      };

      const handleTouchEnd = (e: TouchEvent) => {
          lastTouchRef.current = null;
          isInputOnUI.current = false;
      };

      const handleInput = (e: any) => { 
          if(!engineRef.current || isPaused || gameState !== 'PLAYING' || isUnitComplete) return; 
          const target = e.target as HTMLElement;
          if (target.closest('[data-ui="true"]')) return;
          if (!isMobile) {
            engineRef.current.fire(); 
          }
      };
      
      const handleKey = (e: KeyboardEvent) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
          if (e.code === 'Escape' && gameState === 'PLAYING') {
              if (engineRef.current) { const paused = engineRef.current.togglePause(); setIsPaused(paused); Sound.play('ui_click'); }
              return;
          }
          if(!engineRef.current || isPaused || gameState !== 'PLAYING' || isUnitComplete) return;
          if(e.code === 'KeyA') engineRef.current.useBomb();
          if(e.code === 'KeyS') engineRef.current.useShield();
          if(e.code === 'KeyD') engineRef.current.usePotion();
          if(e.code === 'Space') engineRef.current.fire();
      };

      window.addEventListener('resize', handleResize);
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('touchmove', handleMove, {passive: false});
      window.addEventListener('touchstart', handleTouchStart, {passive: true});
      window.addEventListener('touchend', handleTouchEnd);
      window.addEventListener('mousedown', handleInput);
      window.addEventListener('keydown', handleKey);
      
      return () => {
          window.removeEventListener('resize', handleResize);
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('touchmove', handleMove);
          window.removeEventListener('touchstart', handleTouchStart);
          window.removeEventListener('touchend', handleTouchEnd);
          window.removeEventListener('mousedown', handleInput);
          window.removeEventListener('keydown', handleKey);
      };
  }, [gameLoop, isPaused, gameState, isMobile, isUnitComplete]);

  // Render logic... (no changes needed in JSX, logic is mainly in hooks)
  
  const buyItem = (item: ShopItem) => {
    if (item.requiredAchievement && !unlockedAchievements.includes(item.requiredAchievement)) {
      const achName = ACHIEVEMENTS.find(a => a.id === item.requiredAchievement)?.title;
      alert(`פריט זה נעול! עליך להשיג את ההישג "${achName}" כדי לקנות אותו.`);
      return;
    }
    
    // Check item limits
    if (item.type === 'consumable') {
        const key = item.id.includes('shield') ? 'shields' : item.id.includes('freeze') ? 'potions' : 'bombs';
        if ((key === 'shields' || key === 'potions') && inventory[key] >= 3) {
            alert('ניתן להחזיק עד 3 פריטים מסוג זה בלבד!');
            return;
        }
    }

    if (coins >= item.price) {
        const newCoins = coins - item.price;
        setCoins(newCoins);
        localStorage.setItem('coins', newCoins.toString());
        if(item.type === 'skin') {
            const newSkins = [...inventory.skins, item.id];
            setInventory(prev => ({...prev, skins: newSkins}));
            localStorage.setItem('skins', JSON.stringify(newSkins));
            const allSkins = SHOP_ITEMS.filter(i => i.type === 'skin').map(i => i.id);
            if (allSkins.every(sId => newSkins.includes(sId))) { unlockAchievement('gamir'); }
        } else {
            let key: 'bombs'|'shields'|'potions' = item.id.includes('bomb') ? 'bombs' : item.id.includes('shield') ? 'shields' : 'potions';
            const newVal = (inventory[key] as number) + 1;
            setInventory(prev => ({...prev, [key]: newVal}));
            localStorage.setItem(key, newVal.toString());
        }
        Sound.play('powerup');
    } else { alert('אין לך מספיק מטבעות!'); }
};

const equipSkin = (id: string) => {
    Sound.play('ui_click');
    setInventory(prev => ({...prev, currentSkin: id}));
    localStorage.setItem('currentSkin', id);
    setConfig(prev => ({...prev, skin: id}));
};

  const ControlsDisplay = () => (
    <div className="mt-4 md:mt-8 bg-slate-900/60 p-4 rounded-xl border border-slate-700 text-sm text-slate-300 backdrop-blur-sm shadow-2xl">
      <h3 className="font-bold mb-2 text-white border-b border-slate-700/50 pb-1">מקשי המשחק:</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-right">
        <div className="flex justify-between gap-4"><span>תנועה:</span> <span className="text-amber-400 font-bold">עכבר / מגע</span></div>
        <div className="flex justify-between gap-4"><span>ירי:</span> <span className="text-amber-400 font-bold">{isMobile ? "כפתור 🔥" : "קליק / רווח"}</span></div>
        <div className="flex justify-between gap-4"><span>פצצה:</span> <span className="text-amber-400 font-bold">A</span></div>
        <div className="flex justify-between gap-4"><span>מגן:</span> <span className="text-amber-400 font-bold">S</span></div>
        <div className="flex justify-between gap-4"><span>שיקוי זמן:</span> <span className="text-amber-400 font-bold">D</span></div>
        <div className="flex justify-between gap-4"><span>עצירה:</span> <span className="text-amber-400 font-bold">Esc</span></div>
      </div>
    </div>
  );

  const nextSugia = transitionStats ? SUGIOT.find(s => s.requiredLevel > transitionStats.level) : null;
  const currentSugia = transitionStats ? SUGIOT.find(s => s.requiredLevel === transitionStats.level) : null;

  // Filter combined dictionary for teacher mode
  const filteredTeacherDictionary = fullDictionary.map((word, originalIndex) => ({ ...word, originalIndex }))
    .filter(w => {
      const search = teacherSearchTerm.toLowerCase();
      const normalizedAramaic = removeNiqqud(w.aramaic).toLowerCase();
      const rawAramaic = w.aramaic.toLowerCase();
      const hebrew = w.hebrew.toLowerCase();
      const matchesSearch = normalizedAramaic.includes(search) || rawAramaic.includes(search) || hebrew.includes(search);
      const matchesCategory = teacherSelectedCategory === 'all' || w.cat === teacherSelectedCategory;
      return matchesSearch && matchesCategory;
    });

  return (
    <div className="fixed inset-0 w-full bg-slate-950 text-white overflow-hidden select-none font-rubik" dir="rtl" style={{ touchAction: 'none' }}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {unlockNotification && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-bounce-slow pointer-events-none w-full max-w-sm px-4">
          <div className="bg-gradient-to-r from-amber-600 to-yellow-400 p-1 rounded-2xl shadow-2xl">
            <div className="bg-slate-900 rounded-xl px-4 py-3 md:px-8 md:py-4 flex items-center gap-4 md:gap-6 border border-amber-400/30">
              <span className="text-3xl md:text-5xl">{unlockNotification.icon}</span>
              <div className="text-right">
                <div className="text-amber-400 font-black text-xs md:text-sm uppercase tracking-widest">הישג חדש!</div>
                <div className="text-white font-black text-lg md:text-2xl">{unlockNotification.title}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'PLAYING' && (
        <div className="absolute inset-0 pointer-events-none p-3 md:p-6 flex flex-col justify-between">
            <div className="flex justify-between items-start gap-2" data-ui="true">
                <div className="bg-slate-900/80 backdrop-blur-md rounded-xl md:rounded-2xl p-2 md:p-4 border border-slate-700 shadow-2xl min-w-[100px] md:min-w-[140px]">
                    <div className="text-amber-400 font-black text-lg md:text-2xl flex items-center gap-1 md:gap-2">
                      <GoldCoin size={18} /> {displayScore.toLocaleString()}
                    </div>
                    <div className="text-slate-400 text-[10px] md:text-xs font-bold mt-1 uppercase truncate max-w-[80px] md:max-w-none">{stats.sugiaTitle}</div>
                    <div className="text-slate-500 text-[8px] md:text-[10px] font-bold uppercase">יחידה {stats.level} | שלב {stats.subLevel}/9</div>
                    {stats.weaponAmmo && stats.weaponAmmo > 0 && stats.weaponAmmo < 9000 && (
                        <div className="text-red-400 text-[10px] font-black mt-1">תחמושת: {stats.weaponAmmo}</div>
                    )}
                </div>
                
                <div className="text-center absolute left-1/2 -translate-x-1/2 top-4 md:top-6 w-full max-w-[200px] md:max-w-lg z-10">
                    <div className="font-aramaic text-3xl md:text-6xl text-white drop-shadow-[0_0_15px_rgba(251,191,36,0.6)] md:drop-shadow-[0_0_25px_rgba(251,191,36,0.6)]"
                         style={{ textShadow: '2px 2px 0 #000, -1px -1px 0 #000' }}>
                        {stats.currentWord}
                    </div>
                    {stats.bossActive && (
                        <div className="w-32 md:w-64 h-2 md:h-4 bg-slate-800 rounded-full mt-3 md:mt-6 overflow-hidden border border-red-900/50 shadow-inner mx-auto">
                            <div className="h-full bg-gradient-to-l from-red-600 to-red-400 transition-all duration-300" style={{width: `${stats.bossHpPercent}%`}}></div>
                        </div>
                    )}
                </div>

                <div className="bg-slate-900/80 backdrop-blur-md rounded-xl md:rounded-2xl p-2 md:p-4 border border-slate-700 shadow-2xl text-left min-w-[80px] md:min-w-[120px]">
                    <div className="text-red-500 text-lg md:text-2xl">{"❤️".repeat(Math.max(0, stats.lives))}</div>
                </div>
            </div>

            <div className="flex justify-between items-end w-full pb-10 md:pb-0">
                <div className="flex flex-col gap-4 md:gap-6 pointer-events-auto" data-ui="true">
                    <AbilityButton icon="💣" count={stats.bombs} color="red" onClick={() => engineRef.current?.useBomb()} label="פצצה" shortcut="A" />
                    <AbilityButton icon="🛡️" count={stats.shields} color="blue" onClick={() => engineRef.current?.useShield()} label="מגן" shortcut="S" />
                    <AbilityButton icon="⏳" count={stats.potions} color="purple" onClick={() => engineRef.current?.usePotion()} label="זמן" shortcut="D" />
                </div>
                
                <div className="flex flex-col gap-4 items-center pointer-events-auto" data-ui="true">
                    {isMobile && (
                      <button 
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); isInputOnUI.current = true; engineRef.current?.fire(); }}
                        onPointerUp={(e) => { isInputOnUI.current = false; }}
                        className="w-16 h-16 bg-red-600/30 rounded-full border-4 border-white/30 flex items-center justify-center text-3xl shadow-2xl active:scale-90 active:bg-red-600/50 backdrop-blur-sm"
                      >
                        🔥
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); if (engineRef.current) { const paused = engineRef.current.togglePause(); setIsPaused(paused); Sound.play('ui_click'); } }}
                       className="pointer-events-auto w-14 h-14 bg-slate-800/80 rounded-full flex items-center justify-center text-2xl border border-slate-600 active:scale-90 mb-2 md:mb-0">
                       ⏸️
                    </button>
                </div>
            </div>

            {isPaused && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md pointer-events-auto flex flex-col items-center justify-center z-[100] p-6">
                    <h2 className="text-5xl md:text-7xl font-black mb-6 drop-shadow-2xl text-white">הפסקה</h2>
                    <div className="flex flex-col gap-4 md:gap-6 w-full max-w-xs">
                        <button onClick={() => { engineRef.current?.togglePause(); setIsPaused(false); Sound.play('ui_click'); }} className="bg-blue-600 p-4 md:p-5 rounded-2xl text-xl md:text-2xl font-black shadow-xl active:scale-95 border-b-4 border-blue-900">המשך</button>
                        <button onClick={handleReturnToMenu} className="bg-slate-700 p-4 md:p-5 rounded-2xl text-xl md:text-2xl font-black shadow-xl active:scale-95 border-b-4 border-slate-900">תפריט ראשי</button>
                        <ControlsDisplay />
                    </div>
                </div>
            )}

            {isUnitComplete && transitionStats && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl pointer-events-auto flex flex-col items-center justify-center z-[150] p-6 animate-fade-in">
                    <div className="bg-slate-900/50 border-2 border-amber-500/30 p-6 md:p-12 rounded-[2rem] shadow-[0_0_50px_rgba(245,158,11,0.2)] text-center max-w-lg w-full">
                        <h2 className="text-3xl md:text-6xl font-aramaic text-amber-500 mb-2">סיום יחידה!</h2>
                        <p className="text-slate-400 text-sm md:text-2xl mb-6 md:mb-8 font-bold">ניצחת את הבוס של {currentSugia?.title || `יחידה ${transitionStats.level}`}</p>
                        
                        <div className="grid grid-cols-2 gap-3 mb-6 md:mb-8">
                            <div className="bg-slate-800/50 p-3 md:p-4 rounded-2xl border border-slate-700">
                                <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase mb-1">ניקוד מצטבר</div>
                                <div className="text-lg md:text-2xl font-black text-amber-400">{transitionStats.score.toLocaleString()}</div>
                            </div>
                            <div className="bg-slate-800/50 p-3 md:p-4 rounded-2xl border border-slate-700">
                                <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase mb-1">רצף (Combo)</div>
                                <div className="text-lg md:text-2xl font-black text-blue-400">{transitionStats.combo}</div>
                            </div>
                        </div>

                        <button onClick={proceedToNextSugia} className="w-full bg-gradient-to-r from-amber-600 to-yellow-500 p-4 md:p-5 rounded-2xl text-xl md:text-2xl font-black shadow-xl hover:scale-105 active:scale-95 transition-all border-b-4 border-amber-900 text-slate-950">
                            עבור לסוגיא הבאה
                        </button>
                    </div>
                </div>
            )}
        </div>
      )}

      {feedback && (
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl md:text-4xl font-black drop-shadow-2xl transition-all transform scale-110 duration-300 z-50 text-center
            ${feedback.isGood ? 'text-amber-400' : 'text-red-500'}`}>
              <div className="font-aramaic mb-1">{feedback.msg}</div>
          </div>
      )}

      {gameState === 'MENU' && (
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000')] bg-cover bg-center flex items-center justify-center h-full">
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"></div>
              <div className="relative z-10 flex flex-col items-center p-4 md:p-8 w-full max-w-xl text-center overflow-y-auto max-h-full scrollbar-hide">
                  <h1 className="font-aramaic text-5xl md:text-9xl bg-gradient-to-b from-amber-200 via-yellow-400 to-amber-700 bg-clip-text text-transparent drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)] mb-1 md:mb-4 animate-bounce-slow">
                      רמי וקטיל
                  </h1>
                  <p className="text-slate-300 mb-4 md:mb-8 text-sm md:text-2xl font-light tracking-widest border-b border-amber-500/30 pb-2 uppercase">אלוף הארמית - גרסת הקרב</p>
                  
                  <div className="flex flex-col gap-4 md:gap-6 w-full px-2 md:px-4 mb-4">
                      {customWordList ? (
                        <div className="bg-amber-600/20 border border-amber-500 p-3 rounded-xl mb-2">
                           <p className="text-amber-400 font-bold text-sm md:text-lg">נבחר שיעור מורה ({customWordList.length} מילים)</p>
                           <button onClick={() => { setCustomWordList(null); window.history.replaceState({}, '', window.location.pathname); }} className="text-xs text-white underline mt-1">חזור למילון רגיל</button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 md:gap-4">
                          <div className="flex flex-col gap-1 text-right">
                            <label className="text-slate-500 text-[10px] md:text-xs font-bold mr-2">רמת קושי</label>
                            <select className="bg-slate-900 border border-slate-700 p-2 md:p-3 rounded-xl text-xs md:text-lg text-white outline-none"
                              value={config.difficulty} onChange={e => { setConfig({...config, difficulty: e.target.value as any}); Sound.play('ui_click'); }}>
                                <option value="easy">🌟 קל</option>
                                <option value="medium">🔥🔥 בינוני</option>
                                <option value="hard">⚡⚡⚡ קשה</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-1 text-right">
                            <label className="text-slate-500 text-[10px] md:text-xs font-bold mr-2">קטגוריית מילים</label>
                            <select className="bg-slate-900 border border-slate-700 p-2 md:p-3 rounded-xl text-xs md:text-lg text-white outline-none"
                              value={config.category} onChange={e => { setConfig({...config, category: e.target.value as any}); Sound.play('ui_click'); }}>
                                <option value="common">📖 מילים נפוצות</option>
                                <option value="berachot">🍷 מסכת ברכות</option>
                                <option value="bava_kamma">⚖️ מסכת בבא קמא</option>
                            </select>
                          </div>
                        </div>
                      )}

                      <button onClick={() => navigateTo('MAP')} className="group relative bg-gradient-to-r from-amber-700 to-amber-500 p-4 md:p-6 rounded-2xl text-xl md:text-4xl font-black shadow-[0_0_30px_rgba(251,191,36,0.4)] hover:scale-105 transition-all border-b-4 border-amber-900 active:translate-y-1 active:border-b-0 overflow-hidden text-white">
                          נתיב הסוגיות
                      </button>
                      <div className="grid grid-cols-2 gap-2 md:gap-4 text-white">
                          <button onClick={() => navigateTo('SHOP')} className="bg-slate-800/80 p-2 md:p-5 rounded-xl border border-slate-700 text-xs md:text-xl font-bold transition-all shadow-lg hover:scale-105 hover:border-amber-500/50 hover:shadow-amber-500/20 active:scale-95 active:translate-y-1">🛒 חנות</button>
                          <button onClick={() => navigateTo('LEADERBOARD')} className="bg-amber-800/80 p-2 md:p-5 rounded-xl border border-amber-700 text-xs md:text-xl font-bold transition-all shadow-lg hover:scale-105 hover:border-amber-400/50 hover:shadow-amber-400/20 active:scale-95 active:translate-y-1">🏆 אלופים</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:gap-4 text-white">
                          <button onClick={() => navigateTo('ACHIEVEMENTS')} className="bg-purple-800/80 p-2 md:p-5 rounded-xl border border-purple-700 text-xs md:text-xl font-bold transition-all shadow-lg hover:scale-105 hover:border-purple-400/50 hover:shadow-purple-400/20 active:scale-95 active:translate-y-1">📜 הישגים</button>
                          <button onClick={() => navigateTo('TEACHER')} className="bg-blue-800/80 p-2 md:p-5 rounded-xl border border-blue-700 text-xs md:text-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 hover:scale-105 hover:border-blue-400/50 hover:shadow-blue-400/20 active:scale-95 active:translate-y-1">🎓 מצב מורה</button>
                      </div>
                      <button onClick={() => navigateTo('INSTRUCTIONS')} className="bg-slate-800 p-2 md:p-4 rounded-xl border border-slate-700 text-xs md:text-lg font-bold transition-all shadow-lg hover:scale-105 hover:border-slate-500 active:scale-95 text-slate-300 w-full">📖 מדריך ועזרה</button>
                  </div>
                  
                  {/* Credit Section */}
                  <div className="mt-4 flex flex-col items-center justify-center opacity-80 hover:opacity-100 transition-opacity pb-8">
                      <span className="text-amber-500/80 text-[10px] md:text-xs font-bold tracking-widest mb-1">נוצר ע"י יוסף טולידנו</span>
                      <img 
                          src="https://drive.google.com/thumbnail?id=13maxgzwHxpq9fS3sPR50AKYo-8nz1xZQ&sz=w200" 
                          alt="Yosef Toledano Logo" 
                          className="h-12 md:h-16 w-auto object-contain drop-shadow-lg"
                      />
                  </div>
              </div>
          </div>
      )}

      {/* Instructions Screen */}
      {gameState === 'INSTRUCTIONS' && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full text-white">
              <div className="w-full max-w-4xl pb-10">
                  <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                      <button onClick={handleReturnToMenu} className="bg-slate-800 px-4 py-2 md:px-8 md:py-3 rounded-xl font-bold text-xs md:text-lg shadow-lg">חזור</button>
                      <h2 className="text-2xl md:text-5xl font-aramaic text-amber-500 font-black">מדריך למשחק</h2>
                  </div>

                  <div className="space-y-6 md:space-y-8">
                      {/* Section 1: How to Play */}
                      <section className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
                          <h3 className="text-xl md:text-3xl font-aramaic text-blue-400 mb-4 font-bold border-b border-blue-900/30 pb-2">🎯 איך משחקים?</h3>
                          <p className="text-sm md:text-lg text-slate-300 leading-relaxed">
                              במרכז המסך מופיעה מילה בארמית (למשל: "רַחֲמָנָא"). <br/>
                              חלליות אויב יורדות מלמעלה ונושאות תרגומים אפשריים בעברית. <br/>
                              המטרה שלך היא לירות רק על החללית עם התרגום הנכון! פגיעה נכונה מזכה בניקוד, פגיעה שגויה מורידה חיים.
                          </p>
                      </section>

                      {/* Section 2: Controls */}
                      <section className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
                          <h3 className="text-xl md:text-3xl font-aramaic text-green-400 mb-4 font-bold border-b border-green-900/30 pb-2">🎮 מקשים ושליטה</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div className="bg-slate-800/50 p-4 rounded-xl">
                                  <h4 className="font-bold text-white mb-2 flex items-center gap-2"><span className="text-xl">💻</span> מחשב</h4>
                                  <ul className="text-sm md:text-base text-slate-300 space-y-2">
                                      <li><span className="text-amber-400 font-bold">עכבר:</span> הזזת המטוס</li>
                                      <li><span className="text-amber-400 font-bold">קליק / רווח:</span> ירי</li>
                                      <li><span className="text-amber-400 font-bold">A:</span> שימוש בפצצה</li>
                                      <li><span className="text-amber-400 font-bold">S:</span> הפעלת מגן</li>
                                      <li><span className="text-amber-400 font-bold">D:</span> שיקוי זמן</li>
                                      <li><span className="text-amber-400 font-bold">Esc:</span> עצירה</li>
                                  </ul>
                              </div>
                              <div className="bg-slate-800/50 p-4 rounded-xl">
                                  <h4 className="font-bold text-white mb-2 flex items-center gap-2"><span className="text-xl">📱</span> טלפון / טאבלט</h4>
                                  <ul className="text-sm md:text-base text-slate-300 space-y-2">
                                      <li><span className="text-amber-400 font-bold">גרירה:</span> הזזת המטוס</li>
                                      <li><span className="text-amber-400 font-bold">כפתור 🔥:</span> ירי (בצד שמאל)</li>
                                      <li><span className="text-amber-400 font-bold">כפתורים למטה:</span> שימוש בכוחות מיוחדים</li>
                                  </ul>
                              </div>
                          </div>
                      </section>

                      {/* Section 3: Scoring */}
                      <section className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
                          <h3 className="text-xl md:text-3xl font-aramaic text-amber-400 mb-4 font-bold border-b border-amber-900/30 pb-2">🏆 שיטת הניקוד</h3>
                          <div className="text-sm md:text-lg text-slate-300 space-y-3">
                              <p>הניקוד בסיס לכל פגיעה תלוי ברמת הקושי:</p>
                              <div className="flex gap-4 mb-2">
                                  <span className="bg-slate-800 px-3 py-1 rounded text-green-400">קל: 100</span>
                                  <span className="bg-slate-800 px-3 py-1 rounded text-orange-400">בינוני: 200</span>
                                  <span className="bg-slate-800 px-3 py-1 rounded text-red-500">קשה: 400</span>
                              </div>
                              <p><span className="text-amber-400 font-bold">בונוס רצף (Combo):</span> כל פגיעה רצופה מכפילה את הניקוד! רצף של 10 פגיעות ומעלה מזכה בתואר "צורבא מרבנן".</p>
                              <p><span className="text-amber-400 font-bold">בוס:</span> ניצחון על הבוס מעניק 10,000 נקודות. ניצחון ללא פגיעה מעניק הישג מיוחד.</p>
                          </div>
                      </section>

                      {/* Section 4: Stages */}
                      <section className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
                          <h3 className="text-xl md:text-3xl font-aramaic text-purple-400 mb-4 font-bold border-b border-purple-900/30 pb-2">🌍 סוגי השלבים (סוגיות)</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs md:text-sm text-slate-300">
                              <div className="bg-slate-800 p-2 rounded">🌊 <span className="font-bold">נהרדעא:</span> אויבים נעים בגל</div>
                              <div className="bg-slate-800 p-2 rounded">🔥 <span className="font-bold">סורא:</span> אותיות אש נופלות</div>
                              <div className="bg-slate-800 p-2 rounded">📜 <span className="font-bold">פומבדיתא:</span> מילים קטנות ומהירות</div>
                              <div className="bg-slate-800 p-2 rounded">💨 <span className="font-bold">בירא דלוות:</span> רוח סוחפת את המטוס</div>
                              <div className="bg-slate-800 p-2 rounded">👁️ <span className="font-bold">מחוזא:</span> אויבים נעלמים ומופיעים</div>
                              <div className="bg-slate-800 p-2 rounded">🌑 <span className="font-bold">מתא מחסיא:</span> חושך, רואים רק קרוב</div>
                          </div>
                      </section>
                  </div>
                  <button onClick={handleReturnToMenu} className="bg-slate-700 px-10 md:px-16 py-3 md:py-4 rounded-xl md:rounded-2xl text-lg md:text-2xl font-black mx-auto block mt-10 shadow-xl border-b-4 border-slate-900 active:border-b-0 active:translate-y-1 transition-all">הבנתי, בוא נתחיל!</button>
              </div>
          </div>
      )}

      {/* שאר הקוד נשאר זהה... */}
      {gameState === 'TEACHER' && !isTeacherAuthenticated && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 z-[100] h-full">
              <div className="bg-slate-900 p-8 rounded-3xl border border-slate-700 shadow-2xl max-w-sm w-full text-center">
                  <h2 className="text-3xl font-aramaic text-blue-400 mb-6">כניסת מורה</h2>
                  <input type="password" placeholder="הכנס קוד גישה" value={teacherAuthPass} onChange={e => setTeacherAuthPass(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-center text-white mb-6 outline-none focus:border-blue-500 transition-colors" />
                  <div className="flex gap-4">
                      <button onClick={() => { if(teacherAuthPass === '123123') { setIsTeacherAuthenticated(true); Sound.play('powerup'); fetchData(); } else { alert('קוד שגוי!'); setTeacherAuthPass(''); } }} className="flex-1 bg-blue-600 p-4 rounded-xl font-black text-white">כניסה</button>
                      <button onClick={handleReturnToMenu} className="flex-1 bg-slate-800 p-4 rounded-xl font-black text-white">ביטול</button>
                  </div>
              </div>
          </div>
      )}

      {gameState === 'TEACHER' && isTeacherAuthenticated && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col z-[100] p-4 md:p-8 overflow-y-auto md:overflow-hidden h-full">
              <div className="max-w-4xl w-full mx-auto flex flex-col h-full text-white">
                  <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                      <button onClick={handleReturnToMenu} className="bg-slate-800 px-4 py-2 md:px-8 md:py-3 rounded-xl font-bold text-xs md:text-lg">חזור</button>
                      <h2 className="text-2xl md:text-6xl font-aramaic text-blue-400 font-black">ממשק מורה</h2>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-auto md:h-full overflow-visible md:overflow-hidden pb-10 md:pb-0">
                    {/* Left Side: Word Selector */}
                    <div className="flex flex-col h-[55vh] md:h-full overflow-hidden bg-slate-900/40 p-4 rounded-3xl border border-slate-800">
                        <h3 className="text-white font-bold mb-4 text-center">בניית שיעור מתוך המילון</h3>
                        
                        <div className="space-y-3 mb-4">
                          <input type="text" placeholder="🔍 חפש מילה..." value={teacherSearchTerm} onChange={e => setTeacherSearchTerm(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white outline-none focus:border-blue-500" />
                          
                          <div className="flex flex-wrap gap-2 justify-center">
                              {[
                                  { id: 'all', label: 'הכל' },
                                  { id: 'berachot', label: 'ברכות' },
                                  { id: 'bava_kamma', label: 'בבא קמא' },
                                  { id: 'common', label: 'נפוצות' }
                              ].map(cat => (
                                  <button 
                                      key={cat.id}
                                      onClick={() => { setTeacherSelectedCategory(cat.id as any); Sound.play('ui_click'); }}
                                      className={`px-3 py-1.5 rounded-full text-[10px] md:text-xs font-bold border transition-all ${teacherSelectedCategory === cat.id ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                  >
                                      {cat.label}
                                  </button>
                              ))}
                          </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto space-y-2 mb-4 scrollbar-hide">
                            {filteredTeacherDictionary.length === 0 ? (
                                <div className="text-center text-slate-500 py-10">אין מילים בקטגוריה זו</div>
                            ) : filteredTeacherDictionary.map((word) => {
                                const isSelected = teacherSelectedIndices.includes(word.originalIndex);
                                return (
                                    <div key={word.originalIndex} onClick={() => toggleTeacherWordSelection(word.originalIndex)}
                                      className={`p-3 rounded-xl border-2 flex justify-between items-center transition-all cursor-pointer group
                                          ${isSelected ? 'border-blue-500 bg-blue-900/30' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'}`}>
                                        <div className="text-right">
                                            <div className="font-aramaic text-lg text-white">{word.aramaic}</div>
                                            <div className="text-[10px] text-slate-500 font-bold">{word.hebrew}</div>
                                        </div>
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-700'}`}>
                                            {isSelected && <span className="text-white text-xs">✓</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button onClick={generateTeacherLink} className="bg-blue-600 py-4 rounded-xl font-black text-lg active:scale-95 transition-all text-white">צור קישור לשיעור ({teacherSelectedIndices.length})</button>
                    </div>

                    {/* Right Side: Add New Word */}
                    <div className="bg-slate-900/80 p-6 rounded-3xl border border-blue-500/30 flex flex-col h-auto md:h-auto">
                        <h3 className="text-blue-400 font-black text-xl mb-6 text-center">הוספת מילה קבועה למילון</h3>
                        <div className="space-y-4 flex-1">
                            <div>
                                <label className="text-slate-400 text-xs block mb-1">מילה בארמית (עם ניקוד)</label>
                                <input type="text" value={newWordAramaic} onChange={e => setNewWordAramaic(e.target.value)} placeholder="לדוגמא: תַּנְיָא"
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-right text-white outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-slate-400 text-xs block mb-1">תרגום לעברית</label>
                                <input type="text" value={newWordHebrew} onChange={e => setNewWordHebrew(e.target.value)} placeholder="לדוגמא: שנויה בברייתא"
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-right text-white outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-slate-400 text-xs block mb-1">קטגוריה</label>
                                <select value={newWordCategory} onChange={e => setNewWordCategory(e.target.value as any)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white outline-none focus:border-blue-500">
                                    <option value="common">מילים נפוצות</option>
                                    <option value="berachot">מסכת ברכות</option>
                                    <option value="bava_kamma">מסכת בבא קמא</option>
                                </select>
                            </div>
                            <div className="p-4 bg-blue-900/20 rounded-xl border border-blue-800 text-xs text-blue-300">
                                * המילים שתספו יישמרו בגוגל שיטס ויופיעו מיד ברשימה לבחירה.
                            </div>
                        </div>
                        <button onClick={handleAddNewWord} disabled={isAddingWord}
                            className="mt-6 w-full bg-blue-500 hover:bg-blue-400 py-5 rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-all disabled:opacity-50 text-white">
                            {isAddingWord ? 'מוסיף...' : 'הוסף למילון הקבוע'}
                        </button>
                    </div>
                  </div>
              </div>
          </div>
      )}

      {gameState === 'MAP' && (
          <div className="absolute inset-0 bg-[#fbf3db] flex flex-col z-[50] overflow-hidden h-full">
              <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')]"></div>
              <div className="absolute inset-0 border-[10px] md:border-[30px] border-amber-900/10 pointer-events-none"></div>

              <div className="relative z-10 p-3 md:p-8 flex justify-between items-center bg-amber-900/10 border-b-4 border-amber-900/30 backdrop-blur-sm">
                <button onClick={handleReturnToMenu} className="bg-amber-800 text-white px-4 py-2 md:px-8 md:py-3 rounded-xl font-bold text-xs md:text-lg shadow-lg">חזור</button>
                <h2 className="text-2xl md:text-6xl font-aramaic text-amber-900 font-black tracking-tighter">דף הסוגיות</h2>
                <div className="bg-white/60 px-3 py-1 md:px-6 md:py-2 rounded-full border-2 border-amber-900/30 font-black text-amber-900 text-[10px] md:text-base">רמה: {maxLevelReached}</div>
              </div>
              
              <div className="flex-1 relative flex items-center justify-start p-4 md:p-12 overflow-x-auto overflow-y-hidden scrollbar-hide">
                  <div className="flex gap-8 md:gap-20 px-8 md:px-24 relative min-w-max pb-8">
                      {SUGIOT.map((sugia, idx) => {
                          const isUnlocked = customWordList ? true : (maxLevelReached >= sugia.requiredLevel);
                          const isSelected = selectedSugia?.id === sugia.id;
                          const dafLabel = sugia.title.split(' ')[0] + ' ' + sugia.title.split(' ')[1];
                          return (
                              <div key={sugia.id} className="relative group flex flex-col items-center">
                                  {idx < SUGIOT.length - 1 && (
                                    <div className={`absolute top-12 md:top-24 left-[5rem] md:left-[10rem] w-8 md:w-20 h-1 ${customWordList || maxLevelReached >= SUGIOT[idx+1].requiredLevel ? 'bg-amber-600' : 'bg-amber-900/10'}`}></div>
                                  )}
                                  <div onClick={() => { if(isUnlocked) { Sound.play('ui_click'); setSelectedSugia(sugia); } }}
                                      className={`w-20 h-24 md:w-36 md:h-48 rounded-lg border-2 flex flex-col items-center justify-center text-xl md:text-4xl font-aramaic transition-all cursor-pointer relative shadow-2xl
                                          ${isUnlocked ? (isSelected ? 'border-amber-600 bg-amber-50 scale-110 -translate-y-2 md:-translate-y-4 ring-4 ring-amber-400/20 shadow-amber-900/30' : 'border-amber-900/30 bg-white hover:border-amber-700 hover:scale-105') : 'border-slate-300 bg-slate-100 grayscale opacity-40 cursor-not-allowed'}`}>
                                      <div className="text-amber-900/30 absolute top-1 right-1 text-[8px] md:text-[10px] font-bold">סוגיא {idx+1}</div>
                                      <div className="text-amber-900 font-black mb-1 md:mb-2">{isUnlocked ? String.fromCharCode(0x5D0 + (idx % 22)) : '🔒'}</div>
                                      <div className="text-amber-800/50 text-[8px] md:text-[10px] font-bold">{dafLabel}</div>
                                  </div>
                                  <div className={`mt-2 md:mt-6 font-black text-[10px] md:text-base text-center leading-tight max-w-[80px] md:max-w-140px] ${isUnlocked ? 'text-amber-950' : 'text-slate-400'}`}>{sugia.title}</div>
                              </div>
                          );
                      })}
                  </div>
              </div>

              {selectedSugia && (
                  <div className="bg-white/95 backdrop-blur-lg p-3 md:p-10 border-t-4 md:border-t-8 border-amber-900/40 flex flex-col md:flex-row items-center justify-between z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.15)] animate-slide-up gap-2 md:gap-4 pb-10 md:pb-10">
                      <div className="text-right w-full md:w-auto">
                          <h3 className="text-lg md:text-4xl font-black text-amber-900 mb-0 font-aramaic">{selectedSugia.title}</h3>
                          <p className="text-xs md:text-xl text-amber-800/70 italic max-w-2xl line-clamp-1 md:line-clamp-none">{selectedSugia.description}</p>
                      </div>
                      <button onClick={() => startGame(selectedSugia)} className="w-full md:w-auto bg-gradient-to-r from-blue-700 to-blue-500 text-white px-6 md:px-20 py-3 md:py-6 rounded-xl md:rounded-2xl text-lg md:text-4xl font-black shadow-2xl active:scale-95 border-b-4 md:border-b-8 border-blue-900">התחל בסוגיא</button>
                  </div>
              )}
          </div>
      )}

      {gameState === 'SHOP' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full">
              <div className="w-full max-w-5xl text-white">
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-12 border-b border-slate-800 pb-4 md:pb-6 gap-4">
                  <h2 className="text-3xl md:text-6xl font-aramaic text-amber-500 drop-shadow-lg">חנות הציוד</h2>
                  <div className="text-xl md:text-4xl font-black text-white bg-slate-900 px-6 py-2 md:px-8 md:py-3 rounded-full border border-slate-700 shadow-inner flex items-center gap-3">
                    {coins.toLocaleString()} <GoldCoin size={24} />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-8 mb-8 md:mb-12">
                    {SHOP_ITEMS.map(item => {
                        const owned = item.type === 'skin' ? inventory.skins.includes(item.id) : false;
                        const equipped = inventory.currentSkin === item.id;
                        const locked = item.requiredAchievement && !unlockedAchievements.includes(item.requiredAchievement);
                        return (
                            <div key={item.id} onClick={() => owned && item.type === 'skin' ? equipSkin(item.id) : buyItem(item)}
                              className={`relative p-3 md:p-6 rounded-xl md:rounded-3xl border-2 flex flex-col items-center text-center cursor-pointer transition-all duration-300 group
                                  ${equipped ? 'border-amber-400 bg-amber-900/20 shadow-lg' : 'border-slate-800 bg-slate-900/50'}
                                  ${locked ? 'opacity-60 grayscale cursor-not-allowed' : 'hover:scale-105 hover:border-amber-500/30'}
                              `}>
                                <div className="text-3xl md:text-7xl mb-2 md:mb-6 transform group-hover:scale-110 transition-transform">{item.icon}</div>
                                <h3 className="font-black text-white text-[11px] md:text-2xl mb-1 md:mb-2">{item.name}</h3>
                                <p className="text-[8px] md:text-sm text-slate-400 mb-2 md:mb-6 flex-1 line-clamp-2">{item.desc}</p>
                                <div className={`w-full py-1.5 md:py-3 rounded-lg md:rounded-xl font-black text-[10px] md:text-base flex items-center justify-center gap-1 md:gap-2 ${owned && item.type === 'skin' ? (equipped ? 'bg-green-600' : 'bg-slate-700') : 'bg-amber-600'}`}>
                                  {locked ? '🔒 נעול' : (owned && item.type === 'skin' ? (equipped ? 'בשימוש' : 'בחר') : <>{item.price} <GoldCoin size={14} /></>)}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <button onClick={handleReturnToMenu} className="bg-slate-700 px-10 md:px-16 py-3 md:py-4 rounded-xl md:rounded-2xl text-lg md:text-2xl font-black mx-auto block mb-12">חזור</button>
              </div>
          </div>
      )}

      {gameState === 'LEADERBOARD' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full text-white">
              <div className="w-full max-w-4xl">
                  <h2 className="text-3xl md:text-7xl font-aramaic text-amber-500 text-center mb-6 md:mb-12">טבלת האלופים</h2>
                  {loading ? (
                      <div className="text-lg md:text-3xl text-center text-slate-400 animate-pulse">טוען נתונים...</div>
                  ) : (
                      <div className="bg-slate-900/50 rounded-xl md:rounded-3xl border border-slate-800 overflow-hidden mb-6 md:mb-12">
                          {leaderboard.length === 0 ? (
                            <div className="text-center p-10 text-slate-500 text-xl font-bold">
                                אין עדיין תוצאות בטבלה. היה הראשון לכבוש את הפסגה!
                            </div>
                          ) : (
                              <table className="w-full text-right border-collapse text-xs md:text-base">
                                  <thead className="bg-slate-800 text-slate-400 uppercase tracking-widest font-black">
                                      <tr>
                                          <th className="p-3 md:p-6">מיקום</th>
                                          <th className="p-3 md:p-6">שם התלמיד</th>
                                          <th className="p-3 md:p-6">כיתה</th>
                                          <th className="p-3 md:p-6">ניקוד</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      {leaderboard.map((entry, idx) => {
                                          let rank: React.ReactNode = idx + 1;
                                          if (idx === 0) rank = "🥇";
                                          else if (idx === 1) rank = "🥈";
                                          else if (idx === 2) rank = "🥉";

                                          return (
                                              <tr key={idx} className={`border-b border-slate-800 ${idx < 3 ? 'bg-amber-900/10' : ''}`}>
                                                  <td className="p-3 md:p-6 text-sm md:text-3xl font-black text-slate-500 text-center">{rank}</td>
                                                  <td className="p-3 md:p-6 text-xs md:text-xl font-bold text-white truncate max-w-[150px]">{entry.name}</td>
                                                  <td className="p-3 md:p-6 text-[10px] md:text-lg text-slate-400 truncate max-w-[100px]">{entry.class}</td>
                                                  <td className="p-3 md:p-6 text-xs md:text-2xl font-black text-amber-400 flex items-center gap-1">
                                                    {entry.score.toLocaleString()} <GoldCoin size={14} />
                                                  </td>
                                              </tr>
                                          );
                                      })}
                                  </tbody>
                              </table>
                          )}
                      </div>
                  )}
                  <button onClick={handleReturnToMenu} className="bg-slate-700 px-10 md:px-16 py-3 md:py-4 rounded-xl md:rounded-2xl text-lg md:text-2xl font-black mx-auto block mb-12">חזור</button>
              </div>
          </div>
      )}

      {gameState === 'ACHIEVEMENTS' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full text-white">
              <div className="w-full max-w-4xl">
                  <h2 className="text-3xl md:text-7xl font-aramaic text-purple-400 text-center mb-6 md:mb-12">הישגים תורניים</h2>
                  <div className="space-y-3 md:space-y-6 mb-8 md:mb-12">
                      {ACHIEVEMENTS.map(ach => {
                          const unlocked = unlockedAchievements.includes(ach.id);
                          return (
                              <div key={ach.id} className={`flex items-center gap-3 md:gap-8 p-3 md:p-8 rounded-xl md:rounded-3xl border-2 transition-all ${unlocked ? 'border-purple-500 bg-purple-900/20' : 'border-slate-800 bg-slate-900/30 grayscale opacity-40'}`}>
                                  <div className="text-3xl md:text-8xl">{ach.icon}</div>
                                  <div className="text-right flex-1">
                                      <h3 className="text-sm md:text-4xl font-black text-white mb-0.5 md:mb-1">{ach.title}</h3>
                                      <p className="text-[10px] md:text-xl text-slate-400 line-clamp-2 md:line-clamp-none">{ach.desc}</p>
                                  </div>
                                  {unlocked && <div className="text-green-400 font-black text-[10px] md:text-lg">הושלם!</div>}
                              </div>
                          );
                      })}
                  </div>
                  <button onClick={handleReturnToMenu} className="bg-slate-700 px-10 md:px-16 py-3 md:py-4 rounded-xl md:rounded-2xl text-lg md:text-2xl font-black mx-auto block mb-12">חזור</button>
              </div>
          </div>
      )}

      {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-start pt-10 md:justify-center p-4 md:p-8 z-30 overflow-y-auto scrollbar-hide h-full text-white">
              <h2 className="text-4xl md:text-8xl text-red-600 font-black mb-3 md:mb-4 font-aramaic drop-shadow-[0_0_20px_rgba(220,38,38,0.3)]">המשחק נגמר</h2>
              <div className="text-xl md:text-4xl text-amber-500 font-black mb-6 md:mb-12 bg-slate-900 px-6 py-2 md:px-12 md:py-5 rounded-2xl md:rounded-3xl border-2 border-amber-600/30 shadow-2xl flex items-center gap-2 md:gap-4">
                ניקוד: {stats.score.toLocaleString()} <GoldCoin size={24} />
              </div>
              <div className="bg-slate-900/80 p-5 md:p-8 rounded-2xl md:rounded-3xl w-full max-w-md mb-6 md:mb-12 border border-slate-800">
                  <h3 className="text-lg md:text-2xl text-white font-black mb-3 md:mb-6 text-center">שמור תוצאה</h3>
                  <div className="space-y-2 md:space-y-4">
                    <input type="text" placeholder="שם מלא" value={playerName} onChange={e => setPlayerName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg md:rounded-xl p-2.5 md:p-4 text-center text-white text-base md:text-xl font-bold outline-none" />
                    <input type="text" placeholder="כיתה / קבוצה" value={playerClass} onChange={e => setPlayerClass(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg md:rounded-xl p-2.5 md:p-4 text-center text-white text-base md:text-xl font-bold outline-none" />
                    <button onClick={() => {
                        if(!playerName || !playerClass) return alert('נא למלא פרטים');
                        setLoading(true);
                        fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ name: playerName, class: playerClass, score: stats.score }) })
                          .then(() => { setLoading(false); alert('הציון נשמר!'); handleReturnToMenu(); })
                          .catch(() => { setLoading(false); alert('שגיאה בשמירה'); });
                    }} disabled={loading} className="w-full bg-green-600 hover:bg-green-500 py-3 md:py-4 rounded-lg md:rounded-xl font-black text-white text-lg md:text-2xl shadow-xl transition-all disabled:opacity-50 hover:scale-[1.05] active:scale-95 border-b-4 border-green-900">
                        {loading ? 'שומר...' : 'שמור בטבלה'}
                    </button>
                  </div>
              </div>
              <div className="flex gap-2 md:gap-4 w-full max-w-md pb-12 md:pb-0">
                  <button onClick={() => startGame(selectedSugia || undefined)} className="flex-1 bg-blue-600 px-3 py-3 md:px-8 md:py-5 rounded-xl md:rounded-2xl font-black text-sm md:text-xl transition-all shadow-lg hover:scale-[1.05] hover:bg-blue-500 hover:shadow-blue-500/20 active:scale-95 border-b-4 border-blue-900 text-white">שוב</button>
                  <button onClick={() => { if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); engineRef.current = null; Sound.play('ui_click'); setGameState('MAP'); }} className="flex-1 bg-amber-700 px-3 py-3 md:px-8 md:py-5 rounded-xl md:rounded-2xl font-black text-sm md:text-xl transition-all shadow-lg hover:scale-[1.05] hover:bg-amber-600 hover:shadow-amber-500/20 active:scale-95 border-b-4 border-amber-900 text-white">מפה</button>
                  <button onClick={handleReturnToMenu} className="flex-1 bg-slate-800 px-3 py-3 md:px-8 md:py-5 rounded-xl md:rounded-2xl font-black text-sm md:text-xl transition-all shadow-lg hover:scale-[1.05] hover:bg-slate-700 hover:shadow-slate-500/20 active:scale-95 border-b-4 border-slate-900 text-white">תפריט</button>
              </div>
          </div>
      )}
    </div>
  );
}

const AbilityButton = ({icon, count, color, onClick, label, shortcut}: {icon:string, count:number, color:string, onClick: () => void, label: string, shortcut: string}) => {
    const bg = color === 'red' ? 'bg-red-600 active:bg-red-700' : color === 'blue' ? 'bg-blue-600 active:bg-blue-700' : 'bg-purple-600 active:bg-purple-700';
    return (
        <div className="flex flex-col items-center gap-1 group pointer-events-auto">
          <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); Sound.play('ui_click'); if (count > 0) onClick(); }} disabled={count <= 0}
              className={`w-12 h-12 md:w-20 md:h-20 rounded-2xl flex items-center justify-center text-xl md:text-4xl relative shadow-2xl border-b-4 active:border-b-0 active:translate-y-1 transition-all text-white
              ${count > 0 ? bg : 'bg-slate-800 grayscale opacity-40 cursor-not-allowed'}`}>
              {icon}
              <span className="absolute -top-1 -right-1 md:-top-2 md:-right-2 bg-white text-slate-950 font-black text-[8px] md:text-sm px-1 md:px-2 py-0.5 rounded-full shadow-lg border border-slate-950">{count}</span>
          </button>
          <div className="hidden md:flex flex-col items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-[10px] font-black tracking-widest uppercase">{label} ({shortcut})</span>
          </div>
        </div>
    )
}

export default App;
