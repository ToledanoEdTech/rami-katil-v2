
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

// Intro Images - תמונות שרצות בפתיחה
const INTRO_IMAGES: string[] = [
  '/intro/1.png',
  '/intro/2.png',
  '/intro/3.png',
  '/intro/4.png',
  '/intro/5.png',
];

// Intro Texts - כיתובים לכל תמונה
const INTRO_TEXTS: string[] = [
  'בימים ההם, בזמן הזה... מלכות יוון הרשעה גזרה על ישראל להשכיחם תורתך.',
  'הגווילים נשרפים והאותיות פורחות... שפת חכמינו בסכנת הכחדה.',
  'אך במחשכים הוכן נשק המגן האחרון: מטוס קרב המונע בכוחה של תורה.',
  'היכנס לתא הטייס! התחמושת שלך היא הידע. זהה את התרגום הנכון – ופגע.',
  'הילחם בצבאות האויב, הבס את האויבים, והפוך ל\'רמי וקטיל\' – אלוף הארמית!',
];

function App() {
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showIntroBeforeGame, setShowIntroBeforeGame] = useState(false);
  const [preloadedIntroImages, setPreloadedIntroImages] = useState<HTMLImageElement[]>([]);
  const [preloadedShopImages, setPreloadedShopImages] = useState<Record<string, HTMLImageElement>>({});
  const [isLoadingGame, setIsLoadingGame] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('טוען...');
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

  const getViewportSize = useCallback(() => {
    const vv = window.visualViewport;
    const w = Math.floor((vv?.width ?? window.innerWidth) || 0);
    const h = Math.floor((vv?.height ?? window.innerHeight) || 0);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }, []);

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

  // Preload intro images immediately on mount for instant display
  useEffect(() => {
    const rawBase = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
    const base = rawBase.replace(/\/$/, '');
    const url = (p: string) => `${base}/${p.replace(/^\//, '')}`;
    
    // Preload all intro images immediately and store them as Image objects
    // Start loading all images in parallel for maximum speed
    const images: HTMLImageElement[] = new Array(INTRO_IMAGES.length);
    
    INTRO_IMAGES.forEach((imgPath, index) => {
      const img = new Image();
      img.loading = 'eager';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onload = () => {
        // Update the specific image in the array
        setPreloadedIntroImages(prev => {
          const newImages = [...prev];
          newImages[index] = img;
          return newImages;
        });
      };
      img.onerror = () => {
        // Still store the image even on error, so we can fallback to src
        setPreloadedIntroImages(prev => {
          const newImages = [...prev];
          newImages[index] = img;
          return newImages;
        });
      };
      img.src = url(imgPath.replace(/^\//, ''));
      images[index] = img;
    });
    
    // Set initial array so we have the structure ready
    setPreloadedIntroImages(images);
  }, []);

  // Preload shop images immediately on mount for instant display
  useEffect(() => {
    const rawBase = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
    const base = rawBase.replace(/\/$/, '');
    const url = (p: string) => `${base}/${p.replace(/^\//, '')}`;
    
    // Shop images mapping
    const shopImageMap: Record<string, string> = {
      'skin_default': 'ships/default.png',
      'skin_gold': 'ships/gold.png',
      'skin_torah': 'ships/torah.png',
      'skin_butzina': 'ships/butzina.png',
      'skin_choshen': 'ships/choshen.png',
      'upgrade_bomb': 'ships/bomb.png',
      'item_shield': 'ships/shield.png',
      'item_freeze': 'ships/freeze.png'
    };
    
    // Preload all shop images immediately and store them right away
    const images: Record<string, HTMLImageElement> = {};
    
    Object.entries(shopImageMap).forEach(([key, imgPath]) => {
      const img = new Image();
      img.loading = 'eager';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onload = () => {
        // Update when loaded to mark as complete
        setPreloadedShopImages(prev => ({
          ...prev,
          [key]: img
        }));
      };
      img.onerror = () => {
        // Still store the image even on error
        setPreloadedShopImages(prev => ({
          ...prev,
          [key]: img
        }));
      };
      img.src = url(imgPath);
      images[key] = img;
    });
    
    // Set all images immediately so they're available right away
    setPreloadedShopImages(images);
    
    // Set initial object so we have the structure ready
    setPreloadedShopImages(images);
  }, []);

  // Initial load - Load all resources on app start
  useEffect(() => {
    const loadInitialResources = async () => {
      setIsLoadingGame(true);
      setLoadingProgress(0);
      setLoadingStatus('טוען משחק...');
      
      const rawBase = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
      const base = rawBase.replace(/\/$/, '');
      const url = (p: string) => `${base}/${p.replace(/^\//, '')}`;
      
      // List of all game images that need to be loaded
      const gameImages = [
        'ships/skin_default.png', 'ships/default.png',
        'ships/skin_gold.png', 'ships/gold.png',
        'ships/skin_butzina.png', 'ships/butzina.png',
        'ships/torah.png', 'ships/choshen.png',
        'ships/bomb.png', 'ships/shield.png', 'ships/freeze.png',
        'logo.png',
        // Intro images
        ...INTRO_IMAGES.map(img => img.replace(/^\//, ''))
      ];
      
      const totalResources = gameImages.length + 3; // Images + 3 audio files
      let loaded = 0;
      
      const updateProgress = (increment: number = 1) => {
        loaded += increment;
        const progress = Math.min(100, Math.round((loaded / totalResources) * 100));
        setLoadingProgress(progress);
      };
      
      // Load all images
      const imagePromises = gameImages.map((imgPath) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            updateProgress();
            resolve();
          };
          img.onerror = () => {
            updateProgress(); // Still count as loaded even if error
            resolve();
          };
          img.src = url(imgPath);
        });
      });
      
      await Promise.all(imagePromises);
      
      // Initialize sound (this loads audio files)
      Sound.init();
      updateProgress(); // Audio context
      
      // Wait a bit for audio files to start loading
      await new Promise(resolve => setTimeout(resolve, 100));
      updateProgress(); // Menu music
      await new Promise(resolve => setTimeout(resolve, 100));
      updateProgress(); // Game music
      
      await new Promise(resolve => setTimeout(resolve, 200));
      setLoadingProgress(100);
      
      setIsLoadingGame(false);
      
      // After loading, initialize the app
      fetchData();
      const checkMobileByUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const checkMobileByWidth = window.innerWidth < 768;
      setIsMobile(checkMobileByUA || checkMobileByWidth);
      
      // התחלת מוזיקת תפריט אחרי הטעינה
      if (gameState === 'MENU') {
        Sound.playMenuMusic();
      }
    };
    
    loadInitialResources();
    
    // עדכון דינמי כשהחלון משנה גודל
    const handleResize = () => {
      const isMobileNow = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
      setIsMobile(isMobileNow);
    };
    
    window.addEventListener('resize', handleResize);

    // הוספת האזנה לכל אינטראקציה כדי לשחרר את חסימת האודיו של הדפדפן
    const unlockAudio = () => {
      // ניסיון לחדש את הניגון אם הוא נחסם
      Sound.resume();
      
      // הסרת המאזינים רק אם הצלחנו לנגן
      const menuPaused = Sound.menuTrack?.paused ?? true;
      const gamePaused = Sound.gameTrack?.paused ?? true;
      if (!menuPaused || !gamePaused || (Sound.ctx && Sound.ctx.state === 'running')) {
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      }
    };
    
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

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


  const startGame = (sugia?: Sugia, skipIntro: boolean = false) => {
    Sound.play('ui_click');
    
    // Store game config
    const dictionaryToUse = customWordList || fullDictionary.filter(w => w.cat === config.category);
    (window as any).pendingGameConfig = { sugia, dictionaryToUse };
    
    if (skipIntro) {
      // Skip intro and start game directly
      actuallyStartGame(sugia);
    } else {
      // Show intro before starting the game
      setShowIntroBeforeGame(true);
      setCurrentImageIndex(0);
      setGameState('INTRO');
    }
  };

  const actuallyStartGame = (sugia?: Sugia) => {
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    engineRef.current = null;
    lastTimeRef.current = 0;
    setDisplayScore(0);
    setIsUnitComplete(false);
    
    // Get stored config or use defaults
    const storedConfig = (window as any).pendingGameConfig;
    const dictionaryToUse = storedConfig?.dictionaryToUse || customWordList || fullDictionary.filter(w => w.cat === config.category);
    const actualSugia = storedConfig?.sugia || sugia;

    setStats({
        score: 0, level: actualSugia ? actualSugia.requiredLevel : 1, subLevel: 1, lives: 3, combo: 0, coins: 0, 
        bombs: inventory.bombs, shields: inventory.shields, potions: inventory.potions,
        hasShield: false, bossActive: false, bossHpPercent: 0, currentWord: 'מתחיל...', weaponAmmo: 0,
        sugiaTitle: actualSugia?.title || (customWordList ? 'תרגול מורה' : 'פתיחת הסוגיא')
    });
    
    Sound.resume();
    Sound.playGameMusic();
    setGameState('PLAYING');
    setIsPaused(false);
    setShowIntroBeforeGame(false);

    if (canvasRef.current) {
      const vp = getViewportSize();
      // הגבל רזולוציה למניעת ביצועים איטיים במחשבים עם מסכים גדולים
      const maxCanvasWidth = isMobile ? vp.w : Math.min(vp.w, 1920);
      const maxCanvasHeight = isMobile ? vp.h : Math.min(vp.h, 1080);

      canvasRef.current.width = maxCanvasWidth;
      canvasRef.current.height = maxCanvasHeight;

      // התאם את גודל הקנבס ב-CSS להצגה מלאה
      canvasRef.current.style.width = vp.w + 'px';
      canvasRef.current.style.height = vp.h + 'px';

      // Clear stale frame immediately (prevents "previous ship for a moment")
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }

      engineRef.current = new GameEngine(
          canvasRef.current,
          { 
            ...config, 
            skin: inventory.currentSkin, 
            location: actualSugia?.location || 'nehardea',
            modifier: actualSugia?.modifier || 'wave',
            sugiaTitle: actualSugia?.title || (customWordList ? 'תרגול מורה' : 'פתיחת הסוגיא'),
            customDictionary: dictionaryToUse,
            isTeacherPractice: !!customWordList
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
      lastTimeRef.current = performance.now();
      animationFrameId.current = requestAnimationFrame(gameLoop);
    }
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

  // Intro functions
  const skipIntro = () => {
    // Stop intro music
    if (Sound.introTrack) {
      Sound.introTrack.pause();
      Sound.introTrack.currentTime = 0;
    }
    Sound.play('ui_click');
    
    if (showIntroBeforeGame) {
      // If intro was shown before game, start the game
      const storedConfig = (window as any).pendingGameConfig;
      actuallyStartGame(storedConfig?.sugia);
    } else {
      // Otherwise go back to menu
      Sound.playMenuMusic();
      setGameState('MENU');
    }
  };

  // Auto-advance intro images
  useEffect(() => {
    if (gameState !== 'INTRO' || INTRO_IMAGES.length === 0) return;

    // Preload next image if available
    if (currentImageIndex < INTRO_IMAGES.length - 1 && !preloadedIntroImages[currentImageIndex + 1]) {
      const rawBase = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
      const base = rawBase.replace(/\/$/, '');
      const url = (p: string) => `${base}/${p.replace(/^\//, '')}`;
      
      const img = new Image();
      img.loading = 'eager';
      img.decoding = 'async';
      img.src = url(INTRO_IMAGES[currentImageIndex + 1].replace(/^\//, ''));
      setPreloadedIntroImages(prev => {
        const newImages = [...prev];
        newImages[currentImageIndex + 1] = img;
        return newImages;
      });
    }

    const timer = setTimeout(() => {
      if (currentImageIndex < INTRO_IMAGES.length - 1) {
        setCurrentImageIndex(currentImageIndex + 1);
      } else {
        // Finished all images
        // Stop intro music
        if (Sound.introTrack) {
          Sound.introTrack.pause();
          Sound.introTrack.currentTime = 0;
        }
        
        if (showIntroBeforeGame) {
          // If intro was shown before game, start the game
          const storedConfig = (window as any).pendingGameConfig;
          actuallyStartGame(storedConfig?.sugia);
        } else {
          // Otherwise go back to menu
          Sound.playMenuMusic();
          setGameState('MENU');
        }
      }
    }, 5000); // 5 seconds per image

    return () => clearTimeout(timer);
  }, [gameState, currentImageIndex, preloadedIntroImages]);

  // Play intro music when intro starts
  useEffect(() => {
    if (gameState === 'INTRO') {
      Sound.playIntroMusic();
    }
  }, [gameState]);

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
      const handleResize = () => {
        const vp = getViewportSize();
        const maxCanvasWidth = isMobile ? vp.w : Math.min(vp.w, 1920);
        const maxCanvasHeight = isMobile ? vp.h : Math.min(vp.h, 1080);

        // Keep CSS size in sync (important on mobile: address bar + orientation changes)
        if (canvasRef.current) {
          canvasRef.current.style.width = vp.w + 'px';
          canvasRef.current.style.height = vp.h + 'px';
        }

        if(engineRef.current) {
          engineRef.current.resize(maxCanvasWidth, maxCanvasHeight);
        }
      };
      
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
      const vv = window.visualViewport;
      vv?.addEventListener('resize', handleResize);
      vv?.addEventListener('scroll', handleResize);
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('touchmove', handleMove, {passive: false});
      window.addEventListener('touchstart', handleTouchStart, {passive: true});
      window.addEventListener('touchend', handleTouchEnd);
      window.addEventListener('mousedown', handleInput);
      window.addEventListener('keydown', handleKey);
      
      return () => {
          window.removeEventListener('resize', handleResize);
          vv?.removeEventListener('resize', handleResize);
          vv?.removeEventListener('scroll', handleResize);
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('touchmove', handleMove);
          window.removeEventListener('touchstart', handleTouchStart);
          window.removeEventListener('touchend', handleTouchEnd);
          window.removeEventListener('mousedown', handleInput);
          window.removeEventListener('keydown', handleKey);
      };
  }, [gameLoop, isPaused, gameState, isMobile, isUnitComplete, getViewportSize]);

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
    <div className="mt-4 md:mt-8 rk-glass p-4 rounded-xl border border-slate-700/60 text-sm text-slate-300 shadow-2xl">
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

  const menuDifficultyDecor: Record<GameConfig['difficulty'], { accent: string }> = {
    easy: { accent: 'var(--rk-blue)' },
    medium: { accent: 'var(--rk-gold)' },
    hard: { accent: 'var(--rk-purple)' }
  };

  const menuCategoryDecor: Record<GameConfig['category'], { accent: string }> = {
    common: { accent: 'var(--rk-blue)' },
    berachot: { accent: 'var(--rk-gold)' },
    bava_kamma: { accent: 'var(--rk-purple)' }
  };

  const difficultyDecor = menuDifficultyDecor[config.difficulty];
  const categoryDecor = menuCategoryDecor[config.category];

  return (
    <div
      className="fixed inset-0 w-full bg-slate-950 text-white overflow-hidden select-none font-rubik"
      dir="rtl"
      style={{ touchAction: gameState === 'PLAYING' ? 'none' : 'auto' }}
    >
      {/* Loading Screen */}
      {isLoadingGame && (
        <div className="absolute inset-0 z-[300] bg-slate-950 flex flex-col items-center justify-center">
          <div className="text-center px-4">
            <h2 className="text-3xl md:text-6xl font-aramaic mb-8 md:mb-12 text-amber-400 drop-shadow-2xl">
              {loadingStatus}
            </h2>
            
            {/* Progress Bar Container */}
            <div className="w-full max-w-md mx-auto mb-4">
              <div className="rk-glass rounded-full border border-slate-700/60 overflow-hidden" style={{ height: isMobile ? '24px' : '32px' }}>
                <div 
                  className="h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 transition-all duration-300 ease-out flex items-center justify-end pr-2"
                  style={{ width: `${loadingProgress}%` }}
                >
                  {loadingProgress > 15 && (
                    <span className="text-xs md:text-sm font-black text-slate-900 tabular-nums">
                      {loadingProgress}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Loading Animation */}
            <div className="flex gap-2 justify-center mt-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-3 h-3 bg-amber-400 rounded-full animate-pulse"
                  style={{
                    animationDelay: `${i * 0.2}s`,
                    animationDuration: '1s'
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Animated menu/backdrop (CSS) - Only show after loading is complete */}
      {!isLoadingGame && gameState !== 'PLAYING' && gameState !== 'INTRO' && (
        <Backdrop mode={gameState === 'MENU' ? 'menu' : 'default'} showShips={gameState === 'MENU'} />
      )}

      {/* Intro Images - Auto-playing slideshow */}
      {gameState === 'INTRO' && INTRO_IMAGES.length > 0 && (
        <div className="absolute inset-0 z-[200] bg-black flex items-center justify-center">
          {/* Skip Button - Top Right */}
          <button
            onClick={skipIntro}
            className="absolute top-4 right-4 md:top-8 md:right-8 rk-glass border border-slate-700/60 rounded-xl px-4 py-2 text-sm md:text-base text-slate-300 hover:text-white hover:border-slate-500 transition-all z-10"
          >
            דלג
          </button>

          {/* Image Container */}
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Current Image - Use preloaded image if available for instant display */}
            <img
              key={currentImageIndex}
              src={preloadedIntroImages[currentImageIndex]?.src || INTRO_IMAGES[currentImageIndex]}
              alt={`Intro ${currentImageIndex + 1}`}
              className={`w-full h-full ${isMobile ? 'object-contain' : (currentImageIndex === 4 ? 'object-cover' : 'object-cover')}`}
              style={{ 
                animation: preloadedIntroImages[currentImageIndex]?.complete ? 'fadeIn 0.2s ease-in' : 'fadeIn 0.5s ease-in',
                display: 'block',
                opacity: preloadedIntroImages[currentImageIndex]?.complete ? 1 : undefined,
                ...(currentImageIndex === 4 && !isMobile ? {
                  objectPosition: 'center',
                  minWidth: '100%',
                  minHeight: '100%',
                  width: '100%',
                  height: '100%'
                } : {})
              }}
              loading="eager"
              fetchpriority="high"
              onLoad={() => {
                // Image loaded successfully
              }}
              onError={(e) => {
                // If image doesn't exist, skip to next or finish
                console.warn(`Failed to load image: ${INTRO_IMAGES[currentImageIndex]}`);
                if (currentImageIndex < INTRO_IMAGES.length - 1) {
                  setTimeout(() => setCurrentImageIndex(currentImageIndex + 1), 100);
                } else {
                  skipIntro();
                }
              }}
            />

            {/* Text Overlay - Subtitle style with black background */}
            {INTRO_TEXTS[currentImageIndex] && (
              <div 
                key={`text-${currentImageIndex}`}
                className="absolute bottom-0 left-0 right-0 flex items-center justify-center p-4 md:p-8 pb-8 md:pb-12"
                style={{ 
                  opacity: 1,
                  transition: 'opacity 0.3s ease-in'
                }}
              >
                <div className="bg-black/85 border-2 border-amber-400/40 rounded-xl md:rounded-2xl px-6 py-4 md:px-10 md:py-6 max-w-4xl mx-auto shadow-2xl">
                  <p className="text-center text-white font-aramaic text-lg md:text-3xl leading-relaxed">
                    {INTRO_TEXTS[currentImageIndex]}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {unlockNotification && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-[200] pointer-events-none w-full ${
            isMobile 
              ? 'bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] animate-fade-in max-w-[16rem] px-3' 
              : 'bottom-10 animate-bounce-slow max-w-sm px-4'
          }`}
        >
          <div className="rk-glass-strong rk-glow border border-amber-400/20 rounded-xl overflow-hidden">
            <div className={`flex items-center gap-2 md:gap-6 ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2 md:px-8 md:py-4'}`}>
              <span className={`${isMobile ? 'text-base' : 'text-3xl md:text-5xl'}`}>{unlockNotification.icon}</span>
              <div className="text-right flex-1">
                <div className={`text-amber-400 font-black uppercase tracking-widest ${isMobile ? 'text-[8px]' : 'text-xs md:text-sm'}`}>הישג חדש!</div>
                <div className={`text-white font-black leading-tight ${isMobile ? 'text-[11px]' : 'text-lg md:text-2xl'}`}>{unlockNotification.title}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'PLAYING' && (
        <div className="absolute inset-0 pointer-events-none rk-safe-overlay flex flex-col justify-between">
            <div className="flex justify-between items-start gap-2" data-ui="true">
                <div className="rk-hud-panel rounded-2xl md:rounded-3xl p-1.5 md:p-4 min-w-[96px] sm:min-w-[120px] md:min-w-[220px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className={`text-amber-400 font-black flex items-center gap-1 md:gap-2 leading-none tabular-nums ${isMobile ? 'text-[14px]' : 'text-lg md:text-2xl'}`}>
                        {!isMobile && <GoldCoin size={18} />} {displayScore.toLocaleString()}
                      </div>
                      <div className="text-right">
                        {isMobile ? (
                          <div className="rk-hud-label text-[8px]">יחידה {stats.level} • {stats.subLevel}/9</div>
                        ) : (
                          <>
                            <div className="rk-hud-label">יחידה {stats.level}</div>
                            <div className="rk-hud-label">שלב {stats.subLevel}/9</div>
                          </>
                        )}
                      </div>
                    </div>
                    {!isMobile && (
                      <div className="mt-2 text-slate-200 text-[10px] md:text-xs font-bold uppercase tracking-widest truncate">{stats.sugiaTitle}</div>
                    )}

                    {stats.weaponAmmo && stats.weaponAmmo > 0 && stats.weaponAmmo < 9000 && (
                      isMobile ? (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="rk-hud-label text-[8px]">Ammo</span>
                          <span className="text-blue-200 font-black text-[11px] tabular-nums">{stats.weaponAmmo}</span>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <div className="flex items-center justify-between">
                            <span className="rk-hud-label">Ammo</span>
                            <span className="text-blue-200 font-black text-xs md:text-sm">{stats.weaponAmmo}/30</span>
                          </div>
                          <div className="rk-ammo-bar mt-1">
                            <div className="rk-ammo-fill" style={{ ['--pct' as any]: `${Math.max(0, Math.min(100, Math.round((stats.weaponAmmo / 30) * 100)))}%` } as any} />
                          </div>
                        </div>
                      )
                    )}
                </div>
                
                <div className="text-center absolute left-1/2 -translate-x-1/2 top-4 md:top-6 w-full max-w-[200px] md:max-w-lg z-10">
                    <div className="font-aramaic text-3xl md:text-6xl text-white drop-shadow-[0_0_15px_rgba(251,191,36,0.6)] md:drop-shadow-[0_0_25px_rgba(251,191,36,0.6)]"
                         style={{ textShadow: '2px 2px 0 #000, -1px -1px 0 #000' }}>
                        {stats.currentWord}
                    </div>
                    {stats.bossActive && (
                        <div className="mt-3 md:mt-6 mx-auto flex flex-col items-center gap-1 md:gap-2">
                            <div
                              className="font-aramaic text-lg md:text-3xl tracking-wide text-white"
                              style={{
                                textShadow:
                                  '0 0 10px rgba(168,85,247,0.85), 0 0 18px rgba(59,130,246,0.55), 2px 2px 0 #000, -1px -1px 0 #000'
                              }}
                            >
                              {stats.bossName || 'בוס'}
                            </div>
                            <div className="w-32 md:w-64 h-2 md:h-4 bg-slate-800 rounded-full overflow-hidden border border-red-900/50 shadow-inner">
                                <div className="h-full bg-gradient-to-l from-red-600 to-red-400 transition-all duration-300" style={{width: `${stats.bossHpPercent}%`}}></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex flex-col md:flex-row items-end md:items-start gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); if (engineRef.current) { const paused = engineRef.current.togglePause(); setIsPaused(paused); Sound.play('ui_click'); } }}
                    className="pointer-events-auto rk-hud-panel w-11 h-11 md:w-14 md:h-14 rounded-full flex items-center justify-center border border-blue-400/25 active:scale-90"
                    aria-label="עצור/המשך"
                    data-ui="true"
                  >
                    <PauseBarsIcon className="w-5 h-5 md:w-6 md:h-6 text-slate-100" />
                  </button>
                  <div className="rk-hud-panel rounded-2xl md:rounded-3xl p-1.5 md:p-4 min-w-[104px] md:min-w-[220px]">
                      <div className="flex items-center justify-between">
                        <div className="rk-hud-label">Hull</div>
                        <div className="text-slate-200 font-black text-[11px] md:text-sm tabular-nums">{Math.max(0, stats.lives)}/5</div>
                      </div>
                      <div className="mt-2 rk-segbar" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className={`rk-seg ${i < Math.max(0, stats.lives) ? 'is-on' : ''}`} />
                        ))}
                      </div>
                  </div>
                </div>
            </div>

            <div className="flex justify-between items-end w-full rk-hud-bottom">
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
                        className="relative w-20 h-20 rounded-full flex items-center justify-center active:scale-95 transition-transform duration-150"
                        style={{
                          background: 'radial-gradient(circle, rgba(251,146,60,0.9) 0%, rgba(239,68,68,0.85) 40%, rgba(185,28,28,0.8) 100%)',
                          boxShadow: `
                            0 0 20px rgba(251,146,60,0.6),
                            0 0 40px rgba(239,68,68,0.4),
                            0 0 60px rgba(185,28,28,0.3),
                            inset 0 0 20px rgba(255,255,255,0.1)
                          `,
                          border: '2px solid rgba(251,191,36,0.5)'
                        }}
                      >
                        <div 
                          className="absolute inset-0 rounded-full"
                          style={{
                            background: 'radial-gradient(circle, rgba(251,146,60,0.4) 0%, transparent 70%)',
                            animation: 'rk-flame-flicker 1.2s ease-in-out infinite'
                          }}
                        />
                        <FlameIcon 
                          className="relative z-10 w-12 h-12" 
                          style={{ 
                            color: '#FEF3C7', 
                            filter: 'drop-shadow(0 0 8px rgba(251,146,60,0.8))',
                            animation: 'rk-flame-flicker 1.5s ease-in-out infinite'
                          }} 
                        />
                      </button>
                    )}
                </div>
            </div>

            {isPaused && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md pointer-events-auto flex flex-col items-center justify-center z-[100] p-6">
                    <h2 className="text-5xl md:text-7xl font-black mb-6 rk-neon-subtitle">הפסקה</h2>
                    <div className="flex flex-col gap-4 md:gap-6 w-full max-w-xs">
                        <button onClick={() => { engineRef.current?.togglePause(); setIsPaused(false); Sound.play('ui_click'); }} className="rk-btn rk-btn-primary text-xl md:text-2xl">המשך</button>
                        <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted text-xl md:text-2xl">תפריט ראשי</button>
                        <ControlsDisplay />
                    </div>
                </div>
            )}

            {isUnitComplete && transitionStats && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-xl pointer-events-auto flex flex-col items-center justify-center z-[150] p-6 animate-fade-in">
                    <div className="rk-glass-strong rk-glow border border-amber-400/20 p-6 md:p-12 rounded-[2rem] text-center max-w-lg w-full">
                        <h2 className="text-3xl md:text-6xl font-aramaic rk-neon-title mb-2">סיום יחידה!</h2>
                        <p className="text-slate-400 text-sm md:text-2xl mb-6 md:mb-8 font-bold">ניצחת את הבוס של {currentSugia?.title || `יחידה ${transitionStats.level}`}</p>
                        
                        <div className="grid grid-cols-2 gap-3 mb-6 md:mb-8">
                            <div className="rk-glass rounded-2xl border border-slate-700/60 p-3 md:p-4">
                                <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase mb-1">ניקוד מצטבר</div>
                                <div className="text-lg md:text-2xl font-black text-amber-400">{transitionStats.score.toLocaleString()}</div>
                            </div>
                            <div className="rk-glass rounded-2xl border border-slate-700/60 p-3 md:p-4">
                                <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase mb-1">רצף (Combo)</div>
                                <div className="text-lg md:text-2xl font-black text-blue-400">{transitionStats.combo}</div>
                            </div>
                        </div>

                        <button onClick={proceedToNextSugia} className="rk-btn rk-btn-primary w-full text-xl md:text-2xl">
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

      {!isLoadingGame && gameState === 'MENU' && (
          <div className="absolute inset-0 flex items-center justify-center h-full">
              <div className="relative z-20 flex flex-col items-center p-4 md:p-8 w-[min(92vw,40rem)] text-center overflow-y-auto max-h-[92vh] scrollbar-hide rk-glass-strong rk-glow rounded-[2rem] md:rounded-[2.5rem]">
                  <h1 className="font-aramaic text-5xl md:text-9xl rk-neon-title mb-1 md:mb-4 animate-bounce-slow tracking-tight">
                      רמי וקטיל
                  </h1>
                  <p className="rk-neon-subtitle mb-4 md:mb-8 text-[11px] md:text-2xl font-light tracking-[0.28em] border-b border-blue-500/20 pb-2 uppercase">
                    אלוף הארמית - גרסת הקרב
                  </p>
                  
                  <div className="flex flex-col gap-4 md:gap-6 w-full px-1 md:px-2 mb-4">
                      {customWordList ? (
                        <div className="rk-glass rounded-2xl border border-amber-400/30 p-3 md:p-4 mb-2 text-right">
                           <p className="text-amber-400 font-bold text-sm md:text-lg">נבחר שיעור מורה ({customWordList.length} מילים)</p>
                           <button onClick={() => { setCustomWordList(null); window.history.replaceState({}, '', window.location.pathname); }} className="text-xs text-slate-200 underline mt-1">חזור למילון רגיל</button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 md:gap-4">
                          <div className="flex flex-col gap-1 text-right">
                            <label className="rk-hud-label mr-2">רמת קושי</label>
                            <div className="rk-select-wrap" style={{ ['--accent' as any]: difficultyDecor.accent } as any}>
                              <select
                                className="rk-select text-xs md:text-lg"
                                value={config.difficulty}
                                onChange={e => { setConfig({...config, difficulty: e.target.value as any}); Sound.play('ui_click'); }}
                              >
                                  <option value="easy">קל</option>
                                  <option value="medium">בינוני</option>
                                  <option value="hard">קשה</option>
                              </select>
                              <span className="rk-select-caret">▾</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 text-right">
                            <label className="rk-hud-label mr-2">קטגוריית מילים</label>
                            <div className="rk-select-wrap" style={{ ['--accent' as any]: categoryDecor.accent } as any}>
                              <select
                                className="rk-select text-xs md:text-lg"
                                value={config.category}
                                onChange={e => { setConfig({...config, category: e.target.value as any}); Sound.play('ui_click'); }}
                              >
                                  <option value="common">מילים נפוצות</option>
                                  <option value="berachot">מסכת ברכות</option>
                                  <option value="bava_kamma">מסכת בבא קמא</option>
                              </select>
                              <span className="rk-select-caret">▾</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <button onClick={() => navigateTo('MAP')} className="rk-btn rk-btn-primary w-full text-xl md:text-4xl flex items-center justify-center gap-3">
                          <MenuIcon name="map" />
                          <span>נתיב הסוגיות</span>
                      </button>
                      <div className="grid grid-cols-2 gap-2 md:gap-4 text-white">
                          <button onClick={() => navigateTo('SHOP')} className="rk-btn rk-btn-muted text-xs md:text-xl flex items-center justify-center gap-2">
                            <MenuIcon name="shop" />
                            <span>חנות</span>
                          </button>
                          <button onClick={() => navigateTo('LEADERBOARD')} className="rk-btn rk-btn-muted text-xs md:text-xl flex items-center justify-center gap-2">
                            <MenuIcon name="leaderboard" />
                            <span>אלופים</span>
                          </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:gap-4 text-white">
                          <button onClick={() => navigateTo('ACHIEVEMENTS')} className="rk-btn rk-btn-muted text-xs md:text-xl flex items-center justify-center gap-2">
                            <MenuIcon name="achievements" />
                            <span>הישגים</span>
                          </button>
                          <button onClick={() => navigateTo('TEACHER')} className="rk-btn rk-btn-muted text-xs md:text-xl flex items-center justify-center gap-2">
                            <MenuIcon name="teacher" />
                            <span>מצב מורה</span>
                          </button>
                      </div>
                      <button onClick={() => navigateTo('INSTRUCTIONS')} className="rk-btn rk-btn-muted w-full text-xs md:text-lg flex items-center justify-center gap-2">
                        <MenuIcon name="instructions" />
                        <span>מדריך ועזרה</span>
                      </button>
                  </div>
                  
                  {/* Credit Section */}
                  <div className="mt-4 flex flex-col items-center justify-center opacity-80 hover:opacity-100 transition-opacity pb-8">
                      <span className="text-amber-400/80 text-[10px] md:text-xs font-bold tracking-widest mb-1">נוצר ע"י יוסף טולידנו</span>
                      <img
                          src="/logo.png"
                          alt="Yosef Toledano Logo"
                          className="h-12 md:h-16 w-auto object-contain drop-shadow-lg"
                          loading="eager"
                          onError={(e) => {
                            // Fallback to Google Drive if local file doesn't exist
                            const target = e.target as HTMLImageElement;
                            if (target.src !== "https://drive.google.com/thumbnail?id=1Tu5_e7jgTsQHCr0yV_8d-9CbWwOwL7UM&sz=w1000") {
                              target.src = "https://drive.google.com/thumbnail?id=1Tu5_e7jgTsQHCr0yV_8d-9CbWwOwL7UM&sz=w1000";
                            }
                          }}
                      />
                  </div>
              </div>
          </div>
      )}

      {/* Instructions Screen */}
      {gameState === 'INSTRUCTIONS' && (
          <div className="absolute inset-0 bg-transparent flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full text-white">
              <div className="w-full max-w-4xl pb-10">
                  <div className="rk-glass-strong rounded-3xl px-4 py-4 md:px-8 md:py-6 mb-6 flex justify-between items-center gap-4">
                      <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted px-4 py-2 md:px-8 md:py-3 text-xs md:text-lg">חזור</button>
                      <h2 className="text-2xl md:text-6xl font-aramaic rk-neon-title font-black">מדריך למשחק</h2>
                      <div className="hidden md:block rk-hud-label">Controls • HUD • Shop</div>
                  </div>

                  <div className="space-y-6 md:space-y-8">
                      {/* Section 1: How to Play */}
                      <section className="rk-glass p-6 rounded-3xl border border-slate-800/60">
                          <h3 className="text-xl md:text-3xl font-aramaic text-blue-400 mb-4 font-bold border-b border-blue-900/30 pb-2">🎯 איך משחקים?</h3>
                          <p className="text-sm md:text-lg text-slate-300 leading-relaxed">
                              במרכז המסך מופיעה מילה בארמית (למשל: "רַחֲמָנָא"). <br/>
                              חלליות אויב יורדות מלמעלה ונושאות תרגומים אפשריים בעברית. <br/>
                              המטרה שלך היא לירות רק על החללית עם התרגום הנכון! פגיעה נכונה מזכה בניקוד, פגיעה שגויה מורידה חיים.
                          </p>
                      </section>

                      {/* Section 2: Controls */}
                      <section className="rk-glass p-6 rounded-3xl border border-slate-800/60">
                          <h3 className="text-xl md:text-3xl font-aramaic text-green-400 mb-4 font-bold border-b border-green-900/30 pb-2">🎮 מקשים ושליטה</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div className="rk-glass p-4 rounded-2xl border border-slate-800/60">
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
                              <div className="rk-glass p-4 rounded-2xl border border-slate-800/60">
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
                      <section className="rk-glass p-6 rounded-3xl border border-slate-800/60">
                          <h3 className="text-xl md:text-3xl font-aramaic text-amber-400 mb-4 font-bold border-b border-amber-900/30 pb-2">🏆 שיטת הניקוד</h3>
                          <div className="text-sm md:text-lg text-slate-300 space-y-3">
                              <p>הניקוד בסיס לכל פגיעה תלוי ברמת הקושי:</p>
                              <div className="flex gap-4 mb-2">
                                  <span className="rk-glass px-3 py-1 rounded text-green-400 border border-slate-800/60">קל: 100</span>
                                  <span className="rk-glass px-3 py-1 rounded text-orange-400 border border-slate-800/60">בינוני: 200</span>
                                  <span className="rk-glass px-3 py-1 rounded text-red-500 border border-slate-800/60">קשה: 400</span>
                              </div>
                              <p><span className="text-amber-400 font-bold">בונוס רצף (Combo):</span> כל פגיעה רצופה מכפילה את הניקוד! רצף של 10 פגיעות ומעלה מזכה בתואר "צורבא מרבנן".</p>
                              <p><span className="text-amber-400 font-bold">בוס:</span> ניצחון על הבוס מעניק 10,000 נקודות. ניצחון ללא פגיעה מעניק הישג מיוחד.</p>
                          </div>
                      </section>

                      {/* Section 4: Stages */}
                      <section className="rk-glass p-6 rounded-3xl border border-slate-800/60">
                          <h3 className="text-xl md:text-3xl font-aramaic text-purple-400 mb-4 font-bold border-b border-purple-900/30 pb-2">🌍 סוגי השלבים (סוגיות)</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs md:text-sm text-slate-300">
                              <div className="rk-glass p-2 rounded border border-slate-800/60">🌊 <span className="font-bold">נהרדעא:</span> אויבים נעים בגל</div>
                              <div className="rk-glass p-2 rounded border border-slate-800/60">🔥 <span className="font-bold">סורא:</span> אותיות אש נופלות</div>
                              <div className="rk-glass p-2 rounded border border-slate-800/60">📜 <span className="font-bold">פומבדיתא:</span> מילים קטנות ומהירות</div>
                              <div className="rk-glass p-2 rounded border border-slate-800/60">💨 <span className="font-bold">בירא דלוות:</span> רוח סוחפת את המטוס</div>
                              <div className="rk-glass p-2 rounded border border-slate-800/60">👁️ <span className="font-bold">מחוזא:</span> אויבים נעלמים ומופיעים</div>
                              <div className="rk-glass p-2 rounded border border-slate-800/60">🌑 <span className="font-bold">מתא מחסיא:</span> חושך, רואים רק קרוב</div>
                          </div>
                      </section>
                  </div>
                  <button onClick={handleReturnToMenu} className="rk-btn rk-btn-primary mx-auto block mt-10 text-lg md:text-2xl">הבנתי, בוא נתחיל!</button>
              </div>
          </div>
      )}

      {/* שאר הקוד נשאר זהה... */}
      {gameState === 'TEACHER' && !isTeacherAuthenticated && (
          <div className="absolute inset-0 bg-transparent flex flex-col items-center justify-center p-6 z-[100] h-full">
              <div className="rk-glass-strong rk-glow p-8 rounded-3xl border border-blue-500/20 max-w-sm w-full text-center">
                  <h2 className="text-3xl font-aramaic rk-neon-subtitle mb-6">כניסת מורה</h2>
                  <input type="password" placeholder="הכנס קוד גישה" value={teacherAuthPass} onChange={e => setTeacherAuthPass(e.target.value)}
                      className="w-full rk-glass border border-slate-700/60 rounded-xl p-4 text-center text-white mb-6 outline-none focus:border-blue-500 transition-colors" />
                  <div className="flex gap-4">
                      <button onClick={() => { if(teacherAuthPass === '123123') { setIsTeacherAuthenticated(true); Sound.play('powerup'); fetchData(); } else { alert('קוד שגוי!'); setTeacherAuthPass(''); } }} className="rk-btn rk-btn-primary flex-1">כניסה</button>
                      <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted flex-1">ביטול</button>
                  </div>
              </div>
          </div>
      )}

      {gameState === 'TEACHER' && isTeacherAuthenticated && (
          <div className="absolute inset-0 bg-transparent flex flex-col z-[100] p-4 md:p-8 overflow-y-auto md:overflow-hidden h-full">
              <div className="max-w-4xl w-full mx-auto flex flex-col h-full text-white">
                  <div className="rk-glass-strong rounded-3xl px-4 py-4 md:px-8 md:py-6 mb-6 flex justify-between items-center gap-4">
                      <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted px-4 py-2 md:px-8 md:py-3 text-xs md:text-lg">חזור</button>
                      <h2 className="text-2xl md:text-6xl font-aramaic rk-neon-subtitle font-black">ממשק מורה</h2>
                      <div className="hidden md:block rk-hud-label">Teacher Mode</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-auto md:h-full overflow-visible md:overflow-hidden pb-10 md:pb-0">
                    {/* Left Side: Word Selector */}
                    <div className="flex flex-col h-[55vh] md:h-full overflow-hidden rk-glass p-4 rounded-3xl border border-slate-800/60">
                        <h3 className="text-white font-bold mb-4 text-center">בניית שיעור מתוך המילון</h3>
                        
                        <div className="space-y-3 mb-4">
                          <input type="text" placeholder="🔍 חפש מילה..." value={teacherSearchTerm} onChange={e => setTeacherSearchTerm(e.target.value)}
                              className="w-full rk-glass border border-slate-700/60 rounded-xl p-3 text-white outline-none focus:border-blue-500" />
                          
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
                        <button onClick={generateTeacherLink} className="rk-btn rk-btn-primary py-4 rounded-xl font-black text-lg text-white">צור קישור לשיעור ({teacherSelectedIndices.length})</button>
                    </div>

                    {/* Right Side: Add New Word */}
                    <div className="rk-glass-strong p-6 rounded-3xl border border-blue-500/20 flex flex-col h-auto md:h-auto">
                        <h3 className="rk-neon-subtitle font-black text-xl mb-6 text-center">הוספת מילה קבועה למילון</h3>
                        <div className="space-y-4 flex-1">
                            <div>
                                <label className="text-slate-400 text-xs block mb-1">מילה בארמית (עם ניקוד)</label>
                                <input type="text" value={newWordAramaic} onChange={e => setNewWordAramaic(e.target.value)} placeholder="לדוגמא: תַּנְיָא"
                                    className="w-full rk-glass border border-slate-700/60 rounded-xl p-4 text-right text-white outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-slate-400 text-xs block mb-1">תרגום לעברית</label>
                                <input type="text" value={newWordHebrew} onChange={e => setNewWordHebrew(e.target.value)} placeholder="לדוגמא: שנויה בברייתא"
                                    className="w-full rk-glass border border-slate-700/60 rounded-xl p-4 text-right text-white outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="text-slate-400 text-xs block mb-1">קטגוריה</label>
                                <select value={newWordCategory} onChange={e => setNewWordCategory(e.target.value as any)}
                                    className="w-full rk-glass border border-slate-700/60 rounded-xl p-4 text-white outline-none focus:border-blue-500">
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
                            className="mt-6 w-full rk-btn rk-btn-primary py-5 rounded-2xl font-black text-xl disabled:opacity-50 text-white">
                            {isAddingWord ? 'מוסיף...' : 'הוסף למילון הקבוע'}
                        </button>
                    </div>
                  </div>
              </div>
          </div>
      )}

      {gameState === 'MAP' && (
          <div className="absolute inset-0 bg-transparent flex flex-col z-[50] overflow-hidden h-full text-white">
              <div className="relative z-10 p-3 md:p-6 flex justify-between items-center rk-glass-strong border-b border-blue-500/10">
                <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted px-4 py-2 md:px-8 md:py-3 text-xs md:text-lg">חזור</button>
                <h2 className="text-2xl md:text-6xl font-aramaic rk-neon-title font-black tracking-tighter">דף הסוגיות</h2>
                <div className="rk-glass rounded-full border border-slate-700/60 font-black text-[10px] md:text-base px-3 py-1 md:px-6 md:py-2">
                  רמה: <span className="text-amber-300">{maxLevelReached}</span>
                </div>
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
                                    <div className={`absolute top-14 md:top-24 left-[5rem] md:left-[10rem] w-8 md:w-20 h-1 rounded-full
                                      ${customWordList || maxLevelReached >= SUGIOT[idx+1].requiredLevel ? 'bg-gradient-to-r from-blue-500/70 to-amber-400/70' : 'bg-slate-700/30'}
                                    `}></div>
                                  )}
                                  <div onClick={() => { if(isUnlocked) { Sound.play('ui_click'); setSelectedSugia(sugia); } }}
                                      className={`w-24 h-28 md:w-36 md:h-48 rounded-2xl border flex flex-col items-center justify-center font-aramaic transition-all cursor-pointer relative
                                          ${isUnlocked ? (isSelected ? 'rk-glass-strong border-amber-400/40 scale-110 -translate-y-2 md:-translate-y-4 ring-4 ring-amber-400/15' : 'rk-glass border-blue-400/20 hover:border-amber-400/25 hover:scale-105') : 'rk-glass border-slate-700/30 grayscale opacity-40 cursor-not-allowed'}`}>
                                      <div className="rk-hud-label absolute top-2 right-2 text-[8px] md:text-[10px]">סוגיא {idx+1}</div>
                                      <div className={`font-aramaic font-black leading-none mb-1 md:mb-2 ${isUnlocked ? 'rk-neon-title' : 'text-slate-300/70'} text-4xl md:text-6xl`}>
                                        {isUnlocked ? (
                                          <span>{String.fromCharCode(0x5D0 + (idx % 22))}</span>
                                        ) : (
                                          <LockIcon className="w-9 h-9 md:w-12 md:h-12" />
                                        )}
                                      </div>
                                      <div className="text-slate-300/80 text-[8px] md:text-[10px] font-bold tracking-widest uppercase">{dafLabel}</div>
                                  </div>
                                  <div className={`mt-2 md:mt-6 font-black text-[10px] md:text-base text-center leading-tight max-w-[80px] md:max-w-[140px] ${isUnlocked ? 'text-slate-100' : 'text-slate-500'}`}>{sugia.title}</div>
                              </div>
                          );
                      })}
                  </div>
              </div>

              {selectedSugia && (
                  <div className="rk-glass-strong p-3 md:p-8 border-t border-blue-500/15 flex flex-col md:flex-row items-center justify-between z-20 animate-slide-up gap-3 md:gap-6 pb-10 md:pb-10">
                      <div className="text-right w-full md:w-auto">
                          <h3 className="text-lg md:text-5xl font-black rk-neon-title mb-0 font-aramaic">{selectedSugia.title}</h3>
                          <p className="text-xs md:text-xl text-slate-200/75 italic max-w-2xl line-clamp-2 md:line-clamp-none">{selectedSugia.description}</p>
                      </div>
                      <button onClick={() => startGame(selectedSugia)} className="rk-btn rk-btn-primary w-full md:w-auto text-lg md:text-4xl px-6 md:px-20 py-3 md:py-6">התחל בסוגיא</button>
                  </div>
              )}
          </div>
      )}

      {gameState === 'SHOP' && (
          <div className="absolute inset-0 bg-transparent flex flex-col z-20 overflow-hidden h-full text-white">
            {/* Sticky Header - Always visible */}
            <div className={`rk-glass-strong ${isMobile ? 'sticky top-0 z-30 backdrop-blur-md bg-slate-950/95' : ''} rounded-b-3xl md:rounded-3xl px-4 py-3 md:px-8 md:py-6 ${isMobile ? 'mb-4' : 'mb-6 md:mb-10'} flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4 border-b border-slate-800/60`}>
              <div className={`flex items-center ${isMobile ? 'justify-center relative w-full' : 'justify-between w-full md:w-auto'} gap-3`}>
                <button onClick={handleReturnToMenu} className={`rk-btn rk-btn-muted ${isMobile ? 'absolute right-0 px-3 py-1.5 text-xs' : 'px-4 py-2 md:px-8 md:py-3 text-xs md:text-lg'} flex-shrink-0`}>
                  {isMobile ? '←' : 'חזור'}
                </button>
                <div className={`${isMobile ? 'text-center w-full' : 'text-right'} md:text-right flex-1 md:flex-none`}>
                  <h2 className={`${isMobile ? 'text-xl' : 'text-3xl md:text-7xl'} font-aramaic rk-neon-title leading-none`}>חנות הציוד</h2>
                  {!isMobile && <div className="rk-hud-label mt-2">שדרוגים וסקינים</div>}
                </div>
              </div>
              <div className={`rk-glass rounded-full border border-slate-700/60 ${isMobile ? 'px-4 py-1.5' : 'px-6 py-2 md:px-8 md:py-3'} shadow-inner flex items-center gap-2 md:gap-3 flex-shrink-0`}>
                <span className={`${isMobile ? 'text-base' : 'text-xl md:text-4xl'} font-black text-white`}>{coins.toLocaleString()}</span> <GoldCoin size={isMobile ? 18 : 24} />
              </div>
            </div>

            {/* Scrollable Content */}
            <div className={`flex-1 overflow-y-auto scrollbar-hide ${isMobile ? 'px-2' : 'px-4 md:px-8'} pb-4 md:pb-8`}>
              <div className="w-full max-w-6xl mx-auto">
                {isMobile && (
                  <div className="rk-hud-label text-center mb-2 text-xs">שדרוגים וסקינים</div>
                )}

                <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'} ${isMobile ? 'gap-1' : 'gap-4 md:gap-8'} ${isMobile ? 'mb-4' : 'mb-10'}`}>
                    {SHOP_ITEMS.map(item => {
                        const owned = item.type === 'skin' ? inventory.skins.includes(item.id) : false;
                        const equipped = inventory.currentSkin === item.id;
                        const locked = item.requiredAchievement && !unlockedAchievements.includes(item.requiredAchievement);
                        const requiredTitle = item.requiredAchievement
                          ? (ACHIEVEMENTS.find(a => a.id === item.requiredAchievement)?.title || null)
                          : null;

                        const badge = (() => {
                          if (locked) return { kind: 'locked' as const, node: <>🔒</> };
                          if (item.type === 'skin' && equipped) return { kind: 'equipped' as const, node: <>✅</> };
                          if (item.type === 'skin' && owned) return { kind: 'owned' as const, node: <>בבעלותך</> };
                          return { kind: 'price' as const, node: <>{item.price} <GoldCoin size={14} /></> };
                        })();

                        const cta = (() => {
                          if (locked) return { kind: 'locked' as const, text: 'נדרש הישג' };
                          if (item.type === 'skin' && equipped) return { kind: 'equipped' as const, text: 'בשימוש' };
                          if (item.type === 'skin' && owned) return { kind: 'select' as const, text: 'בחר סקין' };
                          return { kind: 'buy' as const, text: 'קנה' };
                        })();

                        return (
                          <TiltCard
                            key={item.id}
                            onClick={() => {
                              return owned && item.type === 'skin' ? equipSkin(item.id) : buyItem(item);
                            }}
                            className={`${equipped ? 'ring-2 ring-amber-400/40' : ''} ${locked ? 'ring-2 ring-red-500/15 opacity-90' : ''} cursor-pointer`}
                          >
                            <div className={`${isMobile ? 'p-1' : 'p-4 md:p-6'} flex flex-col h-full`}>
                              <div className={`flex items-center justify-between ${isMobile ? 'gap-0.5 mb-0.5' : 'gap-3'}`}>
                                <div className={`rk-hud-label ${isMobile ? 'text-[6px]' : ''}`}>{item.type === 'skin' ? 'Skin' : 'Module'}</div>
                                <div className={`rk-shop-badge ${isMobile ? 'text-[9px] px-1.5 py-0.5' : ''} ${
                                  badge.kind === 'price' ? 'is-price' :
                                  badge.kind === 'owned' ? 'is-owned' :
                                  badge.kind === 'equipped' ? 'is-equipped' : 'is-locked'
                                }`}>
                                  {badge.node}
                                </div>
                              </div>

                              <div className={`${isMobile ? 'mt-0.5' : 'mt-4'} rk-item-frame rk-tilt-layer`} style={{ ['--z' as any]: '34px' } as any}>
                                <div className="rk-item-frame-inner">
                                  {(() => {
                                    // Get image source - use preloaded image if available for instant display
                                    const getImageSrc = () => {
                                      if (preloadedShopImages[item.id]?.src) {
                                        return preloadedShopImages[item.id].src;
                                      }
                                      if (item.type === 'skin') {
                                        if (item.id === 'skin_default') return '/ships/default.png';
                                        if (item.id === 'skin_gold') return '/ships/gold.png';
                                        if (item.id === 'skin_torah') return '/ships/torah.png';
                                        if (item.id === 'skin_butzina') return '/ships/butzina.png';
                                        if (item.id === 'skin_choshen') return '/ships/choshen.png';
                                      }
                                      if (item.id === 'upgrade_bomb') return '/ships/bomb.png';
                                      if (item.id === 'item_shield') return '/ships/shield.png';
                                      if (item.id === 'item_freeze') return '/ships/freeze.png';
                                      return undefined;
                                    };

                                    const imageSrc = getImageSrc();
                                    
                                    if (imageSrc) {
                                      const isPreloaded = preloadedShopImages[item.id]?.complete;
                                      return (
                                        <img
                                          src={imageSrc}
                                          alt={item.name}
                                          draggable={false}
                                          className={`${isMobile ? (item.type === 'skin' ? 'w-32 h-32' : 'w-28 h-28') : (item.type === 'skin' ? 'w-32 h-32 md:w-56 md:h-56' : 'w-28 h-28 md:w-52 md:h-52')} object-contain drop-shadow-2xl`}
                                          style={{ 
                                            imageRendering: 'auto', 
                                            objectFit: 'contain',
                                            opacity: isPreloaded ? 1 : undefined,
                                            transition: isPreloaded ? 'opacity 0.2s ease-in' : undefined
                                          }}
                                          loading="eager"
                                          fetchpriority="high"
                                        />
                                      );
                                    }
                                    return <div className={`${isMobile ? 'text-2xl' : 'text-6xl md:text-8xl'} drop-shadow-2xl`}>{item.icon}</div>;
                                  })()}
                                </div>
                              </div>

                              <h3 className={`${isMobile ? 'mt-0.5 text-sm' : 'mt-4 text-lg md:text-3xl'} font-black text-white leading-tight`}>{item.name}</h3>
                              <p className={`${isMobile ? 'mt-0 text-xs line-clamp-2' : 'mt-1 text-sm md:text-base line-clamp-3'} text-slate-300/85 leading-tight flex-1`}>{item.desc}</p>

                              <div className={`${isMobile ? 'mt-0.5' : 'mt-5'}`}>
                                <div className={`rk-shop-cta ${isMobile ? 'text-xs py-2 px-3' : ''} ${
                                  cta.kind === 'buy' ? 'is-buy' :
                                  cta.kind === 'select' ? 'is-select' :
                                  cta.kind === 'equipped' ? 'is-equipped' : 'is-locked'
                                }`}>
                                  {cta.text}
                                </div>
                                {locked && requiredTitle && (
                                  <div className={`${isMobile ? 'mt-0 text-[9px]' : 'mt-2 text-xs md:text-sm'} text-center font-bold text-slate-200/80`}>
                                    דרוש: <span className="text-amber-300">{requiredTitle}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </TiltCard>
                        );
                    })}
                </div>
              </div>
            </div>
          </div>
      )}

      {gameState === 'LEADERBOARD' && (
          <div className="absolute inset-0 bg-transparent flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full text-white">
              <div className="w-full max-w-4xl">
                  <h2 className="text-3xl md:text-7xl font-aramaic rk-neon-title text-center mb-6 md:mb-12">טבלת האלופים</h2>
                  {loading ? (
                      <div className="text-lg md:text-3xl text-center text-slate-400 animate-pulse">טוען נתונים...</div>
                  ) : (
                      <div className="rk-glass rounded-xl md:rounded-3xl border border-slate-800/60 overflow-hidden mb-6 md:mb-12">
                          {leaderboard.length === 0 ? (
                            <div className="text-center p-10 text-slate-500 text-xl font-bold">
                                אין עדיין תוצאות בטבלה. היה הראשון לכבוש את הפסגה!
                            </div>
                          ) : (
                              <table className="w-full text-right border-collapse text-xs md:text-base">
                                  <thead className="bg-slate-900/60 text-slate-300 uppercase tracking-widest font-black">
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
                                              <tr key={idx} className={`border-b border-slate-800/60 ${idx < 3 ? 'bg-amber-500/10' : ''}`}>
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
                  <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted mx-auto block mb-12 text-lg md:text-2xl">חזור</button>
              </div>
          </div>
      )}

      {gameState === 'ACHIEVEMENTS' && (
          <div className="absolute inset-0 bg-transparent flex flex-col items-center p-4 md:p-8 z-20 overflow-y-auto scrollbar-hide h-full text-white">
              <div className="w-full max-w-4xl">
                  <h2 className="text-3xl md:text-7xl font-aramaic text-purple-300 text-center mb-6 md:mb-12 drop-shadow-[0_0_24px_rgba(88,28,135,0.35)]">הישגים תורניים</h2>
                  <div className="space-y-3 md:space-y-6 mb-8 md:mb-12">
                      {ACHIEVEMENTS.map(ach => {
                          const unlocked = unlockedAchievements.includes(ach.id);
                          return (
                              <div key={ach.id} className={`flex items-center gap-3 md:gap-8 p-3 md:p-8 rounded-xl md:rounded-3xl border transition-all rk-glass ${unlocked ? 'border-purple-400/30' : 'border-slate-800/50 grayscale opacity-40'}`}>
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
                  <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted mx-auto block mb-12 text-lg md:text-2xl">חזור</button>
              </div>
          </div>
      )}

      {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-transparent flex flex-col items-center justify-start pt-10 md:justify-center p-4 md:p-8 z-30 overflow-y-auto scrollbar-hide h-full text-white">
              <h2 className="text-4xl md:text-8xl text-red-600 font-black mb-3 md:mb-4 font-aramaic drop-shadow-[0_0_20px_rgba(220,38,38,0.3)]">המשחק נגמר</h2>
              <div className="rk-glass-strong rk-glow text-xl md:text-4xl text-amber-300 font-black mb-6 md:mb-12 px-6 py-2 md:px-12 md:py-5 rounded-2xl md:rounded-3xl border border-amber-400/20 flex items-center gap-2 md:gap-4">
                ניקוד: {stats.score.toLocaleString()} <GoldCoin size={24} />
              </div>
              <div className="rk-glass-strong p-5 md:p-8 rounded-2xl md:rounded-3xl w-full max-w-md mb-6 md:mb-12 border border-slate-800/60">
                  <h3 className="text-lg md:text-2xl text-white font-black mb-3 md:mb-6 text-center">שמור תוצאה</h3>
                  <div className="space-y-2 md:space-y-4">
                    <input type="text" placeholder="שם מלא" value={playerName} onChange={e => setPlayerName(e.target.value)} className="w-full rk-glass border border-slate-700/60 rounded-lg md:rounded-xl p-2.5 md:p-4 text-center text-white text-base md:text-xl font-bold outline-none" />
                    <input type="text" placeholder="כיתה / קבוצה" value={playerClass} onChange={e => setPlayerClass(e.target.value)} className="w-full rk-glass border border-slate-700/60 rounded-lg md:rounded-xl p-2.5 md:p-4 text-center text-white text-base md:text-xl font-bold outline-none" />
                    <button onClick={() => {
                        if(!playerName || !playerClass) return alert('נא למלא פרטים');
                        setLoading(true);
                        fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ name: playerName, class: playerClass, score: stats.score }) })
                          .then(() => { setLoading(false); alert('הציון נשמר!'); handleReturnToMenu(); })
                          .catch(() => { setLoading(false); alert('שגיאה בשמירה'); });
                    }} disabled={loading} className="w-full rk-btn rk-btn-primary py-3 md:py-4 rounded-lg md:rounded-xl font-black text-white text-lg md:text-2xl disabled:opacity-50">
                        {loading ? 'שומר...' : 'שמור בטבלה'}
                    </button>
                  </div>
              </div>
              <div className="flex gap-2 md:gap-4 w-full max-w-md pb-12 md:pb-0">
                  <button onClick={() => startGame(selectedSugia || undefined, true)} className="rk-btn rk-btn-primary flex-1 text-sm md:text-xl">שוב</button>
                  <button onClick={() => { if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); engineRef.current = null; Sound.play('ui_click'); setGameState('MAP'); }} className="rk-btn rk-btn-muted flex-1 text-sm md:text-xl">מפה</button>
                  <button onClick={handleReturnToMenu} className="rk-btn rk-btn-muted flex-1 text-sm md:text-xl">תפריט</button>
              </div>
          </div>
      )}
    </div>
  );
}

type MenuIconName = 'map' | 'shop' | 'leaderboard' | 'achievements' | 'teacher' | 'instructions';

const MenuIcon = ({ name, className = '' }: { name: MenuIconName; className?: string }) => {
  const baseProps = {
    className: `rk-menu-icon ${className}`.trim(),
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg'
  } as const;

  const common = {
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };

  switch (name) {
    case 'map':
      return (
        <svg {...baseProps}>
          <path {...common} d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" />
          <path {...common} d="M9 4v14" />
          <path {...common} d="M15 6v14" />
        </svg>
      );
    case 'shop':
      return (
        <svg {...baseProps}>
          <path {...common} d="M7 7h10l1 14H6L7 7z" />
          <path {...common} d="M9 7V6a3 3 0 0 1 6 0v1" />
          <path {...common} d="M9 11h6" />
        </svg>
      );
    case 'leaderboard':
      return (
        <svg {...baseProps}>
          <path {...common} d="M8 4h8v4a4 4 0 0 1-8 0V4z" />
          <path {...common} d="M6 4H4v2a4 4 0 0 0 4 4" />
          <path {...common} d="M18 4h2v2a4 4 0 0 1-4 4" />
          <path {...common} d="M12 12v4" />
          <path {...common} d="M9 20h6" />
          <path {...common} d="M10 16h4" />
        </svg>
      );
    case 'achievements':
      return (
        <svg {...baseProps}>
          <path {...common} d="M12 2l2.2 5.2 5.6.5-4.3 3.7 1.3 5.5L12 14.9 7.2 17.4 8.5 12 4.2 8.2l5.6-.5L12 2z" />
        </svg>
      );
    case 'teacher':
      return (
        <svg {...baseProps}>
          <path {...common} d="M12 3l10 5-10 5L2 8l10-5z" />
          <path {...common} d="M6 10v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
          <path {...common} d="M22 8v6" />
        </svg>
      );
    case 'instructions':
      return (
        <svg {...baseProps}>
          <path {...common} d="M7 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2z" />
          <path {...common} d="M7 20h12" />
          <path {...common} d="M9 8h6" />
          <path {...common} d="M9 12h6" />
        </svg>
      );
    default:
      return null;
  }
};

const LockIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M7 11V8a5 5 0 0 1 10 0v3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect
      x="6"
      y="11"
      width="12"
      height="10"
      rx="2"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M12 15v3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const PauseBarsIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M9 6v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M15 6v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const FlameIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      {/* Main flame gradient - vibrant orange to deep red */}
      <linearGradient id="flameGradMain" x1="12" y1="0" x2="12" y2="24">
        <stop offset="0%" stopColor="#FFF9C4" />
        <stop offset="15%" stopColor="#FFE082" />
        <stop offset="35%" stopColor="#FFB74D" />
        <stop offset="55%" stopColor="#FF8A65" />
        <stop offset="75%" stopColor="#FF6B35" />
        <stop offset="100%" stopColor="#E53935" />
      </linearGradient>
      {/* Inner bright core */}
      <radialGradient id="flameCore" cx="12" cy="8" r="4">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
        <stop offset="50%" stopColor="#FFE082" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#FFB74D" stopOpacity="0.6" />
      </radialGradient>
      {/* Outer glow */}
      <radialGradient id="flameGlow" cx="12" cy="10" r="8">
        <stop offset="0%" stopColor="#FFE082" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#E53935" stopOpacity="0" />
      </radialGradient>
    </defs>
    
    {/* Outer glow effect */}
    <ellipse cx="12" cy="10" rx="7" ry="9" fill="url(#flameGlow)" />
    
    {/* Left flame tongue - dynamic and wavy */}
    <path
      d="M9 3 
         Q7 6, 7.5 9
         Q7 12, 8 15
         Q8.5 17, 10 18.5
         Q11 19.5, 12 20
         L12 22
         Q11.5 20.5, 10.5 19
         Q9.5 17, 9 14.5
         Q8.5 11, 9 8
         Q9.5 5, 10 3.5
         Z"
      fill="url(#flameGradMain)"
      opacity="0.95"
    />
    
    {/* Right flame tongue */}
    <path
      d="M15 3 
         Q17 6, 16.5 9
         Q17 12, 16 15
         Q15.5 17, 14 18.5
         Q13 19.5, 12 20
         L12 22
         Q12.5 20.5, 13.5 19
         Q14.5 17, 15 14.5
         Q15.5 11, 15 8
         Q14.5 5, 14 3.5
         Z"
      fill="url(#flameGradMain)"
      opacity="0.95"
    />
    
    {/* Center main flame body - tallest and most prominent */}
    <path
      d="M12 1
         Q11 4, 11.2 7
         Q11.5 10, 11.8 13
         Q12 16, 12 19
         Q12 21, 12 22
         L12 20
         Q12 18, 12.2 15
         Q12.5 12, 12.8 9
         Q13 6, 13 3.5
         Q12.5 2, 12 1
         Z"
      fill="url(#flameGradMain)"
      opacity="1"
    />
    
    {/* Bright inner core */}
    <ellipse cx="12" cy="7" rx="2.5" ry="5" fill="url(#flameCore)" />
    
    {/* Small flickering flames on the sides for detail */}
    <path
      d="M8.5 6 Q8 7.5 8.5 9 Q9 10.5 9.5 9 Q10 7.5 9.5 6 Q9 4.5 8.5 6 Z"
      fill="#FFE082"
      opacity="0.8"
    />
    <path
      d="M15.5 6 Q15 7.5 15.5 9 Q16 10.5 16.5 9 Q17 7.5 16.5 6 Q16 4.5 15.5 6 Z"
      fill="#FFE082"
      opacity="0.8"
    />
    
    {/* Extra small sparks */}
    <circle cx="10" cy="5" r="0.8" fill="#FFFFFF" opacity="0.9" />
    <circle cx="14" cy="5" r="0.8" fill="#FFFFFF" opacity="0.9" />
    <circle cx="11.5" cy="4" r="0.6" fill="#FFE082" opacity="0.8" />
    <circle cx="12.5" cy="4" r="0.6" fill="#FFE082" opacity="0.8" />
  </svg>
);

type BackdropMode = 'menu' | 'default';

const Backdrop = ({ mode, showShips }: { mode: BackdropMode; showShips: boolean }) => {
  const glyphs = useMemo(() => {
    const chars = [
      'א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת',
      'תּ','נְ','יָ','א','רַ','חֲ','מָ','נָ','א','תֵּ','יקוּ','קָ','טַל'
    ];
    const palette = [
      'rgba(251, 191, 36, 0.42)',
      'rgba(59, 130, 246, 0.45)',
      'rgba(88, 28, 135, 0.48)'
    ];
    const count = mode === 'menu' ? 56 : 34;
    return Array.from({ length: count }).map((_, i) => {
      const dur = (mode === 'menu' ? 12 : 16) + Math.random() * (mode === 'menu' ? 10 : 14);
      const size = (mode === 'menu' ? 14 : 12) + Math.random() * (mode === 'menu' ? 30 : 22);
      const opacity = (mode === 'menu' ? 0.20 : 0.14) + Math.random() * 0.22;
      const blur = Math.random() < 0.65 ? 0 : Math.round((Math.random() * 14)) / 10;
      const x = Math.random() * 100;
      const delay = -Math.random() * dur; // start mid‑animation for variety
      const color = palette[Math.floor(Math.random() * palette.length)];
      const char = chars[Math.floor(Math.random() * chars.length)];

      return {
        id: `g-${i}`,
        char,
        style: {
          ['--x' as any]: `${x.toFixed(2)}%`,
          ['--size' as any]: `${size.toFixed(0)}px`,
          ['--dur' as any]: `${dur.toFixed(2)}s`,
          ['--delay' as any]: `${delay.toFixed(2)}s`,
          ['--opacity' as any]: `${opacity.toFixed(2)}`,
          ['--blur' as any]: `${blur.toFixed(1)}px`,
          ['--color' as any]: color
        } as React.CSSProperties
      };
    });
  }, [mode]);

  const ships = useMemo(() => {
    if (!showShips) return [];
    const sources = ['/ships/skin_default.png', '/ships/skin_gold.png', '/ships/skin_butzina.png'];
    return Array.from({ length: 10 }).map((_, i) => {
      const dur = 14 + Math.random() * 12;
      const w = 56 + Math.random() * 62;
      const opacity = 0.10 + Math.random() * 0.20;
      const scale = 0.85 + Math.random() * 0.55;
      const rot = (-14 + Math.random() * 18);
      const x = Math.random() * 100;
      const delay = -Math.random() * dur;
      const src = sources[Math.floor(Math.random() * sources.length)];
      return {
        id: `s-${i}`,
        src,
        style: {
          ['--x' as any]: `${x.toFixed(2)}%`,
          ['--dur' as any]: `${dur.toFixed(2)}s`,
          ['--delay' as any]: `${delay.toFixed(2)}s`,
          ['--w' as any]: `${w.toFixed(0)}px`,
          ['--opacity' as any]: `${opacity.toFixed(2)}`,
          ['--scale' as any]: `${scale.toFixed(2)}`,
          ['--rot' as any]: `${rot.toFixed(2)}deg`
        } as React.CSSProperties
      };
    });
  }, [showShips]);

  return (
    <div className="rk-backdrop z-0" aria-hidden="true">
      <div className="rk-glyph-layer">
        {glyphs.map(g => (
          <span key={g.id} className="rk-glyph" style={g.style}>{g.char}</span>
        ))}
      </div>
      {showShips && (
        <div className="rk-ship-layer">
          {ships.map(s => (
            <img key={s.id} className="rk-bg-ship" src={s.src} alt="" style={s.style} draggable={false} />
          ))}
        </div>
      )}
    </div>
  );
};

const TiltCard = ({
  className = '',
  onClick,
  children
}: {
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLButtonElement | null>(null);

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--sx', '50%');
    el.style.setProperty('--sy', '30%');
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / Math.max(1, r.width);
    const py = (e.clientY - r.top) / Math.max(1, r.height);
    const ry = (px - 0.5) * 12; // rotateY
    const rx = (0.5 - py) * 10; // rotateX
    el.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
    el.style.setProperty('--sx', `${Math.round(px * 100)}%`);
    el.style.setProperty('--sy', `${Math.round(py * 100)}%`);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
      className={`rk-tilt rk-tilt-card text-right ${className}`}
      style={{
        transform: 'perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) translateZ(0)',
        transition: 'transform 140ms ease'
      }}
    >
      {children}
    </button>
  );
};

const AbilityButton = ({icon, count, color, onClick, label, shortcut}: {icon:string, count:number, color:string, onClick: () => void, label: string, shortcut: string}) => {
    const accent =
      color === 'red'
        ? { border: 'border-red-400/35', glow: 'shadow-[0_0_34px_rgba(239,68,68,0.14)]' }
        : color === 'blue'
          ? { border: 'border-blue-400/35', glow: 'shadow-[0_0_34px_rgba(59,130,246,0.14)]' }
          : { border: 'border-purple-400/35', glow: 'shadow-[0_0_34px_rgba(168,85,247,0.14)]' };
    return (
        <div className="flex flex-col items-center gap-1 group pointer-events-auto">
          <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); Sound.play('ui_click'); if (count > 0) onClick(); }} disabled={count <= 0}
              className={`rk-hud-panel ${accent.glow} ${accent.border} border w-12 h-12 md:w-20 md:h-20 rounded-2xl flex items-center justify-center text-xl md:text-4xl relative transition-all text-white
              ${count > 0 ? 'hover:scale-[1.03] active:scale-95' : 'grayscale opacity-40 cursor-not-allowed'}`}>
              {icon}
              <span className="absolute -top-1 -right-1 md:-top-2 md:-right-2 rk-glass text-slate-100 font-black text-[8px] md:text-sm px-1 md:px-2 py-0.5 rounded-full shadow-lg border border-slate-700/60">{count}</span>
          </button>
          <div className="hidden md:flex flex-col items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-[10px] font-black tracking-widest uppercase">{label} ({shortcut})</span>
          </div>
        </div>
    )
}

export default App;
