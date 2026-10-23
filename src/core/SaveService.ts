export type Quality = 'performance' | 'high' | 'ultra';
export type Difficulty = 'rookie' | 'pro' | 'expert';
export type Trophy = 0 | 1 | 2 | 3; // none, bronze, silver, gold

export interface Settings {
  master: number;
  music: number;
  engine: number;
  effects: number;
  quality: Quality;
  qualityAuto: boolean;
  resolutionScale: number;
  motionBlur: boolean;
  cameraShake: boolean;
  racingLine: boolean;
  difficulty: Difficulty;
  sensitivity: number;
  units: 'kmh' | 'mph';
}

export interface ChampionshipState {
  round: number;
  points: Record<string, number>; // driver name -> points
  active: boolean;
}

export interface SaveData {
  version: number;
  credits: number;
  selectedCar: string;
  season: string;
  unlockedCars: string[];
  trophies: Record<string, Trophy>; // trackId -> best trophy
  bestLaps: Record<string, number>;
  bestRaceTimes: Record<string, number>;
  ghosts: Record<string, number[]>; // trackId -> packed [x,y,z,yaw]* at 10 Hz
  tutorialSeen: boolean;
  championship: ChampionshipState;
  settings: Settings;
}

const KEY = 'apex-velocity-save-v1';

export const DEFAULT_SETTINGS: Settings = {
  master: 0.85,
  music: 0.55,
  engine: 0.9,
  effects: 0.85,
  quality: 'high',
  qualityAuto: true,
  resolutionScale: 1,
  motionBlur: true,
  cameraShake: true,
  racingLine: true,
  difficulty: 'pro',
  sensitivity: 1,
  units: 'kmh',
};

function defaults(): SaveData {
  return {
    version: 1,
    credits: 2500,
    selectedCar: 'crimson',
    season: 'summer',
    unlockedCars: ['crimson'],
    trophies: {},
    bestLaps: {},
    bestRaceTimes: {},
    ghosts: {},
    tutorialSeen: false,
    championship: { round: 0, points: {}, active: false },
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Persistence abstraction. The storage backend is swappable: today it is localStorage,
 * a cloud backend only needs to implement `StorageBackend`.
 */
export interface StorageBackend {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

class LocalBackend implements StorageBackend {
  load(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  save(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage full or blocked: progress stays in memory for this session */
    }
  }
}

export class SaveService {
  data: SaveData;
  private listeners: (() => void)[] = [];

  constructor(private backend: StorageBackend = new LocalBackend()) {
    this.data = defaults();
    const raw = backend.load(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        this.data = { ...defaults(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) } };
      } catch {
        /* corrupted save: start fresh */
      }
    }
  }

  get settings() {
    return this.data.settings;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  commit() {
    this.backend.save(KEY, JSON.stringify(this.data));
    this.listeners.forEach((l) => l());
  }

  awardTrophy(trackId: string, t: Trophy) {
    if (t > (this.data.trophies[trackId] ?? 0)) this.data.trophies[trackId] = t;
  }

  recordLap(trackId: string, lap: number): boolean {
    const prev = this.data.bestLaps[trackId];
    if (!prev || lap < prev) {
      this.data.bestLaps[trackId] = lap;
      return true;
    }
    return false;
  }

  totalTrophies() {
    return Object.values(this.data.trophies).reduce<number>((a, b) => a + (b ?? 0), 0);
  }
}

export const save = new SaveService();
