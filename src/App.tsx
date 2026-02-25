/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Shield, 
  Zap, 
  Trophy, 
  Info, 
  Gamepad2, 
  Skull, 
  Target, 
  Timer,
  ChevronRight,
  ChevronLeft,
  X,
  Volume2,
  VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types & Constants ---

type GameState = 'START' | 'PLAYING' | 'PAUSED' | 'GAMEOVER';
type Difficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXPERT' | 'INSANE';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  unlocked: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Entity extends Point {
  width: number;
  height: number;
  speed: number;
  color: string;
}

interface Bullet extends Entity {
  damage: number;
  angle: number;
}

interface Enemy extends Entity {
  hp: number;
  maxHp: number;
  type: 'BASIC' | 'FAST' | 'HEAVY';
  scoreValue: number;
}

interface PowerUp extends Entity {
  type: 'TRIPLE_SHOT' | 'SHIELD';
}

interface Particle extends Point {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const DIFFICULTIES: Record<Difficulty, { spawnRate: number; speedMult: number; label: string }> = {
  EASY: { spawnRate: 0.01, speedMult: 0.7, label: '简单' },
  NORMAL: { spawnRate: 0.02, speedMult: 1.0, label: '普通' },
  HARD: { spawnRate: 0.035, speedMult: 1.3, label: '困难' },
  EXPERT: { spawnRate: 0.05, speedMult: 1.6, label: '专家' },
  INSANE: { spawnRate: 0.08, speedMult: 2.0, label: '疯狂' },
};

// --- Audio Manager ---
class AudioManager {
  private ctx: AudioContext | null = null;
  private masterVolume: GainNode | null = null;
  private isMuted: boolean = false;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterVolume = this.ctx.createGain();
      this.masterVolume.connect(this.ctx.destination);
      this.masterVolume.gain.value = 0.3;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMute(mute: boolean) {
    this.isMuted = mute;
    if (this.masterVolume) {
      this.masterVolume.gain.value = mute ? 0 : 0.3;
    }
  }

  playShoot() {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterVolume) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.masterVolume);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playExplosion() {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterVolume) return;
    const noise = this.ctx.createBufferSource();
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterVolume);
    noise.start();
    noise.stop(this.ctx.currentTime + 0.2);
  }

  playPowerUp() {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterVolume) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.masterVolume);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playHit() {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterVolume) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.masterVolume);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }
}

const audioManager = new AudioManager();

// --- Game Logic ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [difficulty, setDifficulty] = useState<Difficulty>('NORMAL');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(3);
  const [isMuted, setIsMuted] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>([
    { id: 'first_blood', name: '第一滴血', description: '击毁第一架敌机', icon: <Skull size={16} />, unlocked: false },
    { id: 'survivor', name: '生存者', description: '达到第5关', icon: <Timer size={16} />, unlocked: false },
    { id: 'power_up', name: '全副武装', description: '拾取一个道具', icon: <Zap size={16} />, unlocked: false },
    { id: 'ace', name: '王牌飞行员', description: '分数超过10000', icon: <Target size={16} />, unlocked: false },
    { id: 'untouchable', name: '不可触碰', description: '使用护盾抵挡一次攻击', icon: <Shield size={16} />, unlocked: false },
  ]);
  const [activeAchievement, setActiveAchievement] = useState<Achievement | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  // Game Engine Refs
  const engineRef = useRef<{
    player: Entity & { invulnerable: number; shield: boolean; tripleShot: number; image?: HTMLImageElement };
    bullets: Bullet[];
    enemies: Enemy[];
    powerUps: PowerUp[];
    particles: Particle[];
    stars: { x: number; y: number; size: number; speed: number }[];
    keys: Record<string, boolean>;
    lastShot: number;
    frameCount: number;
    images: {
      player?: HTMLImageElement;
      enemyBasic?: HTMLImageElement;
      enemyFast?: HTMLImageElement;
      enemyHeavy?: HTMLImageElement;
    };
  }>({
    player: { x: 0, y: 0, width: 50, height: 50, speed: 6, color: '#00ffff', invulnerable: 0, shield: false, tripleShot: 0 },
    bullets: [],
    enemies: [],
    powerUps: [],
    particles: [],
    stars: [],
    keys: {},
    lastShot: 0,
    frameCount: 0,
    images: {},
  });

  // Load Images
  useEffect(() => {
    const loadImage = (src: string) => {
      const img = new Image();
      img.src = src;
      return img;
    };

    // Note: When running locally, place images in the 'public' folder
    const playerImg = loadImage('https://raw.githubusercontent.com/lucide-react/lucide/main/icons/rocket.svg');
    const enemyBasicImg = loadImage('https://raw.githubusercontent.com/lucide-react/lucide/main/icons/target.svg');
    const enemyFastImg = loadImage('https://raw.githubusercontent.com/lucide-react/lucide/main/icons/zap.svg');
    const enemyHeavyImg = loadImage('https://raw.githubusercontent.com/lucide-react/lucide/main/icons/shield-alert.svg');

    playerImg.onload = () => { engineRef.current.player.image = playerImg; engineRef.current.images.player = playerImg; };
    enemyBasicImg.onload = () => { engineRef.current.images.enemyBasic = enemyBasicImg; };
    enemyFastImg.onload = () => { engineRef.current.images.enemyFast = enemyFastImg; };
    enemyHeavyImg.onload = () => { engineRef.current.images.enemyHeavy = enemyHeavyImg; };
  }, []);

  const unlockAchievement = useCallback((id: string) => {
    setAchievements(prev => {
      const achievement = prev.find(a => a.id === id);
      if (achievement && !achievement.unlocked) {
        setActiveAchievement(achievement);
        setTimeout(() => setActiveAchievement(null), 3000);
        return prev.map(a => a.id === id ? { ...a, unlocked: true } : a);
      }
      return prev;
    });
  }, []);

  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = engineRef.current;
    engine.player.x = canvas.width / 2;
    engine.player.y = canvas.height - 100;
    engine.player.invulnerable = 60;
    engine.player.shield = false;
    engine.player.tripleShot = 0;
    engine.bullets = [];
    engine.enemies = [];
    engine.powerUps = [];
    engine.particles = [];
    engine.stars = Array.from({ length: 100 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2,
      speed: Math.random() * 2 + 0.5
    }));
    
    setScore(0);
    setLevel(1);
    setLives(3);
  }, []);

  const spawnEnemy = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = engineRef.current;
    const diff = DIFFICULTIES[difficulty];
    
    if (Math.random() < diff.spawnRate * (1 + level * 0.1)) {
      const typeRand = Math.random();
      let type: Enemy['type'] = 'BASIC';
      let width = 30, height = 30, hp = 1, speed = 2, color = '#ff4444', scoreValue = 100;

      if (typeRand > 0.85) {
        type = 'HEAVY';
        width = 50; height = 50; hp = 5; speed = 1; color = '#ff00ff'; scoreValue = 500;
      } else if (typeRand > 0.65) {
        type = 'FAST';
        width = 25; height = 25; hp = 1; speed = 4; color = '#ffff00'; scoreValue = 200;
      }

      engine.enemies.push({
        x: Math.random() * (canvas.width - width),
        y: -height,
        width,
        height,
        speed: speed * diff.speedMult,
        color,
        hp,
        maxHp: hp,
        type,
        scoreValue
      });
    }
  }, [difficulty, level]);

  const spawnPowerUp = useCallback((x: number, y: number) => {
    if (Math.random() < 0.1) {
      const engine = engineRef.current;
      engine.powerUps.push({
        x,
        y,
        width: 20,
        height: 20,
        speed: 1.5,
        color: Math.random() > 0.5 ? '#00ff00' : '#0088ff',
        type: Math.random() > 0.5 ? 'TRIPLE_SHOT' : 'SHIELD'
      });
    }
  }, []);

  const createExplosion = useCallback((x: number, y: number, color: string, count = 10) => {
    const engine = engineRef.current;
    for (let i = 0; i < count; i++) {
      engine.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 1,
        maxLife: 0.5 + Math.random() * 0.5,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }, []);

  const update = useCallback(() => {
    if (gameState !== 'PLAYING') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = engineRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    engine.frameCount++;

    // Stars
    engine.stars.forEach(star => {
      star.y += star.speed;
      if (star.y > canvas.height) {
        star.y = 0;
        star.x = Math.random() * canvas.width;
      }
    });

    // Player Movement
    if (engine.keys['ArrowLeft'] || engine.keys['a']) engine.player.x -= engine.player.speed;
    if (engine.keys['ArrowRight'] || engine.keys['d']) engine.player.x += engine.player.speed;
    if (engine.keys['ArrowUp'] || engine.keys['w']) engine.player.y -= engine.player.speed;
    if (engine.keys['ArrowDown'] || engine.keys['s']) engine.player.y += engine.player.speed;

    // Boundary
    engine.player.x = Math.max(0, Math.min(canvas.width - engine.player.width, engine.player.x));
    engine.player.y = Math.max(0, Math.min(canvas.height - engine.player.height, engine.player.y));

    if (engine.player.invulnerable > 0) engine.player.invulnerable--;
    if (engine.player.tripleShot > 0) engine.player.tripleShot--;

    // Shooting
    if (engine.keys[' '] && Date.now() - engine.lastShot > 150) {
      const p = engine.player;
      audioManager.playShoot();
      if (p.tripleShot > 0) {
        engine.bullets.push({ x: p.x + p.width/2 - 2, y: p.y, width: 4, height: 15, speed: 10, color: '#00ffff', damage: 1, angle: 0 });
        engine.bullets.push({ x: p.x + p.width/2 - 2, y: p.y, width: 4, height: 15, speed: 10, color: '#00ffff', damage: 1, angle: -0.2 });
        engine.bullets.push({ x: p.x + p.width/2 - 2, y: p.y, width: 4, height: 15, speed: 10, color: '#00ffff', damage: 1, angle: 0.2 });
      } else {
        engine.bullets.push({ x: p.x + p.width/2 - 2, y: p.y, width: 4, height: 15, speed: 10, color: '#00ffff', damage: 1, angle: 0 });
      }
      engine.lastShot = Date.now();
    }

    // Bullets
    engine.bullets.forEach((b, i) => {
      b.x += Math.sin(b.angle) * b.speed;
      b.y -= Math.cos(b.angle) * b.speed;
      if (b.y < -20) engine.bullets.splice(i, 1);
    });

    // Enemies
    spawnEnemy();
    engine.enemies.forEach((e, i) => {
      e.y += e.speed;
      
      // Collision with player
      if (engine.player.invulnerable === 0 && 
          e.x < engine.player.x + engine.player.width &&
          e.x + e.width > engine.player.x &&
          e.y < engine.player.y + engine.player.height &&
          e.y + e.height > engine.player.y) {
        
        if (engine.player.shield) {
          engine.player.shield = false;
          unlockAchievement('untouchable');
          audioManager.playPowerUp();
        } else {
          audioManager.playHit();
          setLives(l => {
            if (l <= 1) setGameState('GAMEOVER');
            return l - 1;
          });
        }
        
        createExplosion(e.x + e.width/2, e.y + e.height/2, e.color, 20);
        engine.enemies.splice(i, 1);
        engine.player.invulnerable = 60;
        return;
      }

      // Collision with bullets
      engine.bullets.forEach((b, bi) => {
        if (b.x < e.x + e.width &&
            b.x + b.width > e.x &&
            b.y < e.y + e.height &&
            b.y + b.height > e.y) {
          
          e.hp -= b.damage;
          engine.bullets.splice(bi, 1);
          createExplosion(b.x, b.y, '#00ffff', 3);

          if (e.hp <= 0) {
            audioManager.playExplosion();
            setScore(s => {
              const newScore = s + e.scoreValue;
              if (newScore >= 10000) unlockAchievement('ace');
              return newScore;
            });
            unlockAchievement('first_blood');
            spawnPowerUp(e.x, e.y);
            createExplosion(e.x + e.width/2, e.y + e.height/2, e.color, 15);
            engine.enemies.splice(i, 1);
          }
        }
      });

      if (e.y > canvas.height) {
        engine.enemies.splice(i, 1);
        setScore(s => Math.max(0, s - 50));
      }
    });

    // PowerUps
    engine.powerUps.forEach((p, i) => {
      p.y += p.speed;
      if (p.x < engine.player.x + engine.player.width &&
          p.x + p.width > engine.player.x &&
          p.y < engine.player.y + engine.player.height &&
          p.y + p.height > engine.player.y) {
        
        audioManager.playPowerUp();
        unlockAchievement('power_up');
        if (p.type === 'TRIPLE_SHOT') engine.player.tripleShot = 600;
        if (p.type === 'SHIELD') engine.player.shield = true;
        
        engine.powerUps.splice(i, 1);
      }
      if (p.y > canvas.height) engine.powerUps.splice(i, 1);
    });

    // Particles
    engine.particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      if (p.life <= 0) engine.particles.splice(i, 1);
    });

    // Leveling
    if (score > level * 2000) {
      setLevel(l => {
        const next = l + 1;
        if (next === 5) unlockAchievement('survivor');
        return next;
      });
      engine.enemies = [];
    }

  }, [gameState, difficulty, score, level, spawnEnemy, spawnPowerUp, createExplosion, unlockAchievement]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const engine = engineRef.current;

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars
    ctx.fillStyle = '#ffffff';
    engine.stars.forEach(star => {
      ctx.globalAlpha = Math.random() * 0.5 + 0.5;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    });
    ctx.globalAlpha = 1.0;

    // Particles
    engine.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // PowerUps
    engine.powerUps.forEach(p => {
      ctx.shadowBlur = 15;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.type === 'TRIPLE_SHOT') {
        ctx.moveTo(p.x + p.width/2, p.y);
        ctx.lineTo(p.x + p.width, p.y + p.height);
        ctx.lineTo(p.x, p.y + p.height);
      } else {
        ctx.arc(p.x + p.width/2, p.y + p.height/2, p.width/2, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Bullets
    engine.bullets.forEach(b => {
      ctx.shadowBlur = 10;
      ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.save();
      ctx.translate(b.x + b.width/2, b.y + b.height/2);
      ctx.rotate(b.angle);
      ctx.fillRect(-b.width/2, -b.height/2, b.width, b.height);
      ctx.restore();
      ctx.shadowBlur = 0;
    });

    // Enemies
    engine.enemies.forEach(e => {
      ctx.shadowBlur = 15;
      ctx.shadowColor = e.color;
      
      let enemyImg = null;
      if (e.type === 'BASIC') enemyImg = engine.images.enemyBasic;
      if (e.type === 'FAST') enemyImg = engine.images.enemyFast;
      if (e.type === 'HEAVY') enemyImg = engine.images.enemyHeavy;

      if (enemyImg) {
        ctx.drawImage(enemyImg, e.x, e.y, e.width, e.height);
      } else {
        ctx.save();
        ctx.translate(e.x + e.width / 2, e.y + e.height / 2);
        ctx.rotate(Math.PI); // Enemies face down

        if (e.type === 'HEAVY') {
          // Realistic Heavy Cruiser
          ctx.fillStyle = '#444';
          ctx.fillRect(-e.width/2, -e.height/2, e.width, e.height);
          ctx.fillStyle = e.color;
          ctx.fillRect(-e.width/2 + 5, -e.height/2 + 5, e.width - 10, e.height - 10);
          // Cockpit/Bridge
          ctx.fillStyle = '#00ffff';
          ctx.fillRect(-5, -e.height/2 + 10, 10, 15);
          // Side pods
          ctx.fillStyle = '#333';
          ctx.fillRect(-e.width/2 - 10, -10, 10, 20);
          ctx.fillRect(e.width/2, -10, 10, 20);
        } else if (e.type === 'FAST') {
          // Sleek Interceptor
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.moveTo(0, e.height/2);
          ctx.lineTo(e.width/2, -e.height/2);
          ctx.lineTo(0, -e.height/4);
          ctx.lineTo(-e.width/2, -e.height/2);
          ctx.closePath();
          ctx.fill();
          // Engine glow
          ctx.fillStyle = '#fff';
          ctx.fillRect(-2, -e.height/2, 4, 5);
        } else {
          // Basic Scout
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.moveTo(0, e.height/2);
          ctx.lineTo(e.width/2, 0);
          ctx.lineTo(e.width/4, -e.height/2);
          ctx.lineTo(-e.width/4, -e.height/2);
          ctx.lineTo(-e.width/2, 0);
          ctx.closePath();
          ctx.fill();
          // Details
          ctx.fillStyle = '#000';
          ctx.fillRect(-2, 0, 4, 10);
        }
        ctx.restore();
      }

      if (e.type === 'HEAVY') {
        ctx.fillStyle = '#333';
        ctx.fillRect(e.x, e.y - 10, e.width, 4);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(e.x, e.y - 10, (e.hp / e.maxHp) * e.width, 4);
      }
      ctx.shadowBlur = 0;
    });

    // Player
    const p = engine.player;
    if (p.invulnerable % 10 < 5) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = p.color;
      
      if (p.image) {
        ctx.drawImage(p.image, p.x, p.y, p.width, p.height);
      } else {
        // Detailed Realistic Player Ship
        ctx.save();
        ctx.translate(p.x + p.width / 2, p.y + p.height / 2);
        
        // Main Body (Fuselage)
        const grad = ctx.createLinearGradient(0, -p.height/2, 0, p.height/2);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.5, p.color);
        grad.addColorStop(1, '#008888');
        ctx.fillStyle = grad;
        
        ctx.beginPath();
        ctx.moveTo(0, -p.height/2); // Nose
        ctx.lineTo(p.width/4, p.height/4);
        ctx.lineTo(0, p.height/2);
        ctx.lineTo(-p.width/4, p.height/4);
        ctx.closePath();
        ctx.fill();

        // Wings
        ctx.fillStyle = '#444';
        ctx.beginPath();
        ctx.moveTo(-p.width/4, 0);
        ctx.lineTo(-p.width/2, p.height/2);
        ctx.lineTo(-p.width/4, p.height/3);
        ctx.closePath();
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(p.width/4, 0);
        ctx.lineTo(p.width/2, p.height/2);
        ctx.lineTo(p.width/4, p.height/3);
        ctx.closePath();
        ctx.fill();

        // Cockpit
        ctx.fillStyle = 'rgba(0, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.ellipse(0, -p.height/6, 5, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      if (p.shield) {
        ctx.strokeStyle = '#0088ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x + p.width/2, p.y + p.height/2, p.width * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#0088ff';
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      if (engine.frameCount % 4 < 2) {
        ctx.fillStyle = '#ff8800';
        ctx.beginPath();
        ctx.moveTo(p.x + p.width * 0.3, p.y + p.height);
        ctx.lineTo(p.x + p.width * 0.5, p.y + p.height + 15);
        ctx.lineTo(p.x + p.width * 0.7, p.y + p.height);
        ctx.fill();
      }
      
      ctx.shadowBlur = 0;
    }

  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      engineRef.current.keys[e.key] = true;
      if (e.key === 'p' || e.key === 'P') {
        setGameState(prev => prev === 'PLAYING' ? 'PAUSED' : prev === 'PAUSED' ? 'PLAYING' : prev);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      engineRef.current.keys[e.key] = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    let animationFrameId: number;
    const loop = () => {
      update();
      draw();
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [update, draw]);

  const startGame = (diff: Difficulty) => {
    setDifficulty(diff);
    initGame();
    setGameState('PLAYING');
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    audioManager.setMute(newMuted);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-sans text-white select-none">
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full"
        onMouseMove={(e) => {
          if (gameState === 'PLAYING') {
            engineRef.current.player.x = e.clientX - engineRef.current.player.width / 2;
            engineRef.current.player.y = e.clientY - engineRef.current.player.height / 2;
          }
        }}
        onMouseDown={() => {
          if (gameState === 'PLAYING') engineRef.current.keys[' '] = true;
        }}
        onMouseUp={() => {
          if (gameState === 'PLAYING') engineRef.current.keys[' '] = false;
        }}
        onTouchMove={(e) => {
          if (gameState === 'PLAYING') {
            const touch = e.touches[0];
            engineRef.current.player.x = touch.clientX - engineRef.current.player.width / 2;
            engineRef.current.player.y = touch.clientY - engineRef.current.player.height / 2;
          }
        }}
        onTouchStart={() => {
          if (gameState === 'PLAYING') engineRef.current.keys[' '] = true;
        }}
        onTouchEnd={() => {
          if (gameState === 'PLAYING') engineRef.current.keys[' '] = false;
        }}
      />

      <div className="absolute inset-0 pointer-events-none scanline">
        
        <AnimatePresence>
          {gameState === 'PLAYING' && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-auto"
            >
              <div className="flex flex-col gap-2">
                <div className="glass px-4 py-2 rounded-xl flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-display">Score</span>
                    <span className="text-2xl font-display font-bold tabular-nums">{score.toLocaleString()}</span>
                  </div>
                  <div className="w-px h-8 bg-white/10" />
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-widest text-purple-400 font-display">Level</span>
                    <span className="text-2xl font-display font-bold">{level}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <motion.div 
                      key={i}
                      animate={{ 
                        scale: i < lives ? 1 : 0.8,
                        opacity: i < lives ? 1 : 0.2
                      }}
                      className="w-8 h-8 glass rounded-lg flex items-center justify-center text-cyan-400"
                    >
                      <Skull size={18} />
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <button 
                    onClick={toggleMute}
                    className="glass p-3 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                  <button 
                    onClick={() => setGameState('PAUSED')}
                    className="glass p-3 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <Pause size={20} />
                  </button>
                </div>
                <div className="flex gap-2">
                  {engineRef.current.player.shield && (
                    <motion.div 
                      initial={{ scale: 0 }} animate={{ scale: 1 }}
                      className="w-10 h-10 glass rounded-full flex items-center justify-center text-blue-400 shadow-[0_0_15px_rgba(0,136,255,0.5)]"
                    >
                      <Shield size={20} />
                    </motion.div>
                  )}
                  {engineRef.current.player.tripleShot > 0 && (
                    <motion.div 
                      initial={{ scale: 0 }} animate={{ scale: 1 }}
                      className="w-10 h-10 glass rounded-full flex items-center justify-center text-yellow-400 shadow-[0_0_15px_rgba(255,255,0,0.5)]"
                    >
                      <Zap size={20} />
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {gameState === 'START' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto"
            >
              <div className="max-w-2xl w-full mx-4 flex flex-col items-center gap-8">
                <div className="text-center">
                  <motion.h1 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-6xl md:text-8xl font-display font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-cyan-500"
                  >
                    TOMMY
                  </motion.h1>
                  <motion.p 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="text-xl md:text-2xl font-display tracking-[0.5em] text-cyan-400/80 mt-[-10px]"
                  >
                    星际先锋
                  </motion.p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 w-full">
                  {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d, idx) => (
                    <motion.button
                      key={d}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.2 + idx * 0.05 }}
                      onClick={() => startGame(d)}
                      className="glass-dark p-4 rounded-2xl hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all group"
                    >
                      <div className="text-[10px] text-cyan-400/60 uppercase tracking-widest mb-1">{d}</div>
                      <div className="text-lg font-display font-bold group-hover:text-cyan-400">{DIFFICULTIES[d].label}</div>
                    </motion.button>
                  ))}
                </div>

                <div className="glass p-6 rounded-3xl w-full max-w-md">
                  <h3 className="text-sm font-display uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                    <Info size={14} /> 任务简报
                  </h3>
                  <ul className="space-y-3 text-sm text-white/70">
                    <li className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">1</div>
                      <span>控制战机消灭所有来袭敌机，保护星系安全。</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">2</div>
                      <span>收集能量核心可获得三向弹头或护盾防御。</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">3</div>
                      <span>敌机逃脱将导致指挥中心扣除你的战功积分。</span>
                    </li>
                  </ul>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {gameState === 'PAUSED' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md pointer-events-auto"
            >
              <div className="flex flex-col items-center gap-6">
                <h2 className="text-5xl font-display font-bold tracking-widest text-cyan-400">已暂停</h2>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setGameState('PLAYING')}
                    className="glass px-8 py-4 rounded-2xl flex items-center gap-3 hover:bg-cyan-500/20 transition-all text-xl font-display"
                  >
                    <Play size={24} /> 继续
                  </button>
                  <button 
                    onClick={() => setGameState('START')}
                    className="glass px-8 py-4 rounded-2xl flex items-center gap-3 hover:bg-red-500/20 transition-all text-xl font-display"
                  >
                    <X size={24} /> 退出
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {gameState === 'GAMEOVER' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-xl pointer-events-auto"
            >
              <div className="max-w-lg w-full mx-4 flex flex-col items-center gap-8">
                <div className="text-center">
                  <h2 className="text-6xl font-display font-black text-red-500 mb-2">任务失败</h2>
                  <p className="text-white/40 tracking-[0.3em] uppercase">Mission Failed</p>
                </div>

                <div className="w-full grid grid-cols-2 gap-4">
                  <div className="glass p-6 rounded-3xl text-center">
                    <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">最终得分</div>
                    <div className="text-3xl font-display font-bold text-cyan-400">{score.toLocaleString()}</div>
                  </div>
                  <div className="glass p-6 rounded-3xl text-center">
                    <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">到达关卡</div>
                    <div className="text-3xl font-display font-bold text-purple-400">{level}</div>
                  </div>
                </div>

                <div className="w-full glass p-6 rounded-3xl">
                  <h3 className="text-sm font-display uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                    <Trophy size={14} /> 获得成就
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {achievements.filter(a => a.unlocked).length > 0 ? (
                      achievements.filter(a => a.unlocked).map(a => (
                        <div key={a.id} className="flex items-center gap-3 p-2 bg-white/5 rounded-xl">
                          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                            {a.icon}
                          </div>
                          <div>
                            <div className="text-sm font-bold">{a.name}</div>
                            <div className="text-[10px] text-white/40">{a.description}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-white/20 text-sm">暂无成就</div>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => setGameState('START')}
                  className="w-full glass py-5 rounded-3xl flex items-center justify-center gap-3 hover:bg-cyan-500/20 transition-all text-xl font-display font-bold"
                >
                  <RotateCcw size={24} /> 重新开始
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeAchievement && (
            <motion.div 
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className="absolute bottom-10 right-10 glass p-4 rounded-2xl flex items-center gap-4 border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.3)]"
            >
              <div className="w-12 h-12 rounded-xl bg-cyan-500 flex items-center justify-center text-black">
                <Trophy size={24} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold">成就解锁</div>
                <div className="text-lg font-display font-bold">{activeAchievement.name}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="hidden lg:block absolute left-6 top-1/2 -translate-y-1/2 pointer-events-auto">
          <motion.div 
            animate={{ x: showSidebar ? 0 : -280 }}
            className="relative w-64 glass p-6 rounded-3xl flex flex-col gap-8"
          >
            <button 
              onClick={() => setShowSidebar(!showSidebar)}
              className="absolute -right-12 top-1/2 -translate-y-1/2 w-10 h-20 glass rounded-r-xl flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              {showSidebar ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
            </button>

            <div>
              <h3 className="text-xs font-display uppercase tracking-widest text-cyan-400 mb-4 flex items-center gap-2">
                <Gamepad2 size={14} /> 操作指南
              </h3>
              <div className="space-y-3 text-xs text-white/60">
                <div className="flex justify-between items-center">
                  <span>移动</span>
                  <span className="px-2 py-1 bg-white/10 rounded text-white">WASD / 方向键</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>射击</span>
                  <span className="px-2 py-1 bg-white/10 rounded text-white">空格键 / 点击</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>暂停</span>
                  <span className="px-2 py-1 bg-white/10 rounded text-white">P 键</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-display uppercase tracking-widest text-purple-400 mb-4 flex items-center gap-2">
                <Zap size={14} /> 道具说明
              </h3>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center text-yellow-500 shrink-0">
                    <Zap size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-bold">三向弹头</div>
                    <div className="text-[10px] text-white/40">大幅提升火力覆盖范围</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-500 shrink-0">
                    <Shield size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-bold">能量护盾</div>
                    <div className="text-[10px] text-white/40">抵挡一次致命伤害</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-display uppercase tracking-widest text-red-400 mb-4 flex items-center gap-2">
                <Skull size={14} /> 敌机情报
              </h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#ff4444]" />
                  <span className="text-[10px] text-white/60">基础型: 均衡属性</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#ffff00]" />
                  <span className="text-[10px] text-white/60">快速型: 高速移动</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#ff00ff]" />
                  <span className="text-[10px] text-white/60">重型: 高耐久度</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

      </div>
    </div>
  );
}
