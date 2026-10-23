import type { Weather } from './tracks';

export type SeasonId = 'winter' | 'summer' | 'autumn' | 'rainy' | 'desert';
export type Precip = 'snow' | 'leaves' | 'rain' | 'dust' | 'pollen';

export interface SeasonWorld {
  /** Lighting / sky / fog preset (see Environment PRESETS). */
  preset: Weather;
  ground: 'snow' | 'grass' | 'sand';
  grassTint: string;
  /** Foliage colours picked per tree instance. */
  foliage: string[];
  trunk: string;
  treeMul: number;
  /** Replace tree species for the season (e.g. palms in the desert). */
  treeKind?: 'palm' | 'pine';
  rocks: boolean;
  drifts: 'dune' | 'snow' | null;
  mountainLow: string;
  mountainHigh: string;
  snowCaps: boolean;
  precip: Precip | null;
  precipAmount: number;
  /** Tyre grip multiplier applied to every car (fair for AI and player). */
  grip: number;
}

export interface SeasonUI {
  accent: string;
  accent2: string;
  ink: string;
  bg0: string;
  bg1: string;
  glow: string;
}

export interface SeasonDef {
  id: SeasonId;
  name: string;
  title: string;
  tagline: string;
  traits: string[];
  gripLabel: string;
  gripLevel: number; // 1..5 for the UI meter
  visibility: number; // 1..5
  ui: SeasonUI;
  world: SeasonWorld;
  /** Painted backdrop palette for the season-select art. */
  art: { skyTop: string; skyBottom: string; sun: string; far: string; mid: string; near: string; ground: string; road: string; foliage: string[]; particle: string };
}

export const SEASONS: SeasonDef[] = [
  {
    id: 'winter',
    name: 'Winter',
    title: 'FROSTLINE',
    tagline: 'Crisp air, low sun and a ribbon of tarmac through fresh snow.',
    traits: ['Snowfall', 'Icy edges', 'Low sun'],
    gripLabel: 'Low grip',
    gripLevel: 2,
    visibility: 4,
    ui: { accent: '#8fdcff', accent2: '#b9a8ff', ink: '#071322', bg0: '#0a1628', bg1: '#25496f', glow: 'rgba(143,220,255,0.42)' },
    world: {
      preset: 'winter',
      ground: 'snow',
      grassTint: '#e9eff5',
      foliage: ['#e8eef4', '#d6e1ea', '#f4f7fa', '#355c49', '#2c4f40'],
      trunk: '#4a3a30',
      treeMul: 0.9,
      treeKind: 'pine',
      rocks: false,
      drifts: 'snow',
      mountainLow: '#b9c9d8',
      mountainHigh: '#f6f9fc',
      snowCaps: true,
      precip: 'snow',
      precipAmount: 1,
      grip: 0.9,
    },
    art: { skyTop: '#5b86c4', skyBottom: '#e8f0f8', sun: '#fff4e6', far: '#c8d7e6', mid: '#9fb6cc', near: '#f3f7fb', ground: '#eef3f8', road: '#3b4350', foliage: ['#2f5a48', '#e9f0f6'], particle: '#ffffff' },
  },
  {
    id: 'summer',
    name: 'Summer',
    title: 'SOLSTICE',
    tagline: 'Deep blue skies, lush green verges and grip for days.',
    traits: ['Peak grip', 'Bright sun', 'Clear skies'],
    gripLabel: 'High grip',
    gripLevel: 5,
    visibility: 5,
    ui: { accent: '#ffd23f', accent2: '#2ee6c5', ink: '#1a1400', bg0: '#06213f', bg1: '#1366b8', glow: 'rgba(255,210,63,0.42)' },
    world: {
      preset: 'summer',
      ground: 'grass',
      grassTint: '#4f9e36',
      foliage: ['#3f8f3a', '#56a83f', '#2f7a35', '#6fb848'],
      trunk: '#5a4030',
      treeMul: 1,
      rocks: false,
      drifts: null,
      mountainLow: '#3f6e45',
      mountainHigh: '#7fa36a',
      snowCaps: false,
      precip: 'pollen',
      precipAmount: 1,
      grip: 1.02,
    },
    art: { skyTop: '#0f5fd6', skyBottom: '#9fd8ff', sun: '#fff6c8', far: '#6f9fd0', mid: '#3d8c4a', near: '#2f7a35', ground: '#4ea53a', road: '#3a3f47', foliage: ['#2f7a35', '#56a83f'], particle: '#fff6c8' },
  },
  {
    id: 'autumn',
    name: 'Autumn',
    title: 'EMBER FALL',
    tagline: 'Golden hour light and a storm of copper leaves on every straight.',
    traits: ['Falling leaves', 'Golden hour', 'Long shadows'],
    gripLabel: 'Good grip',
    gripLevel: 4,
    visibility: 4,
    ui: { accent: '#ff8a3d', accent2: '#ff4f6d', ink: '#200a00', bg0: '#1f0d07', bg1: '#7a3214', glow: 'rgba(255,138,61,0.45)' },
    world: {
      preset: 'autumn',
      ground: 'grass',
      grassTint: '#8a8a3a',
      foliage: ['#e2572b', '#f08a24', '#f5b833', '#b8332a', '#c9772b', '#8a9a3b'],
      trunk: '#4d3426',
      treeMul: 1,
      rocks: false,
      drifts: null,
      mountainLow: '#6b5233',
      mountainHigh: '#a8804c',
      snowCaps: false,
      precip: 'leaves',
      precipAmount: 1,
      grip: 0.98,
    },
    art: { skyTop: '#3f5f99', skyBottom: '#f6c48a', sun: '#ffd79a', far: '#a77a5a', mid: '#b5522b', near: '#8a3a1c', ground: '#9a8a3c', road: '#3a3a40', foliage: ['#e2572b', '#f5b833'], particle: '#f08a24' },
  },
  {
    id: 'rainy',
    name: 'Rainy Season',
    title: 'MONSOON',
    tagline: 'Mirror-wet tarmac, roostertail spray and nerves of steel.',
    traits: ['Heavy rain', 'Wet tarmac', 'Spray'],
    gripLabel: 'Low grip',
    gripLevel: 2,
    visibility: 2,
    ui: { accent: '#4fe3c1', accent2: '#6c8bff', ink: '#031712', bg0: '#070f14', bg1: '#1f3340', glow: 'rgba(79,227,193,0.4)' },
    world: {
      preset: 'rain',
      ground: 'grass',
      grassTint: '#3c7a3e',
      foliage: ['#2f6b3a', '#3c7d44', '#285e33'],
      trunk: '#3e3028',
      treeMul: 1,
      rocks: false,
      drifts: null,
      mountainLow: '#34473f',
      mountainHigh: '#56685f',
      snowCaps: false,
      precip: 'rain',
      precipAmount: 1,
      grip: 1,
    },
    art: { skyTop: '#2e3a46', skyBottom: '#8796a3', sun: '#c9d6e0', far: '#5d6c78', mid: '#3d4d48', near: '#2a3a33', ground: '#33503a', road: '#22262c', foliage: ['#2a4e34', '#3c6a46'], particle: '#cfe3f0' },
  },
  {
    id: 'desert',
    name: 'Desert',
    title: 'MIRAGE',
    tagline: 'Heat shimmer, endless dunes and a sun that never blinks.',
    traits: ['Heat haze', 'Sand dust', 'Blinding sun'],
    gripLabel: 'Medium grip',
    gripLevel: 3,
    visibility: 3,
    ui: { accent: '#ffb35c', accent2: '#ff6a4d', ink: '#241000', bg0: '#1d0f08', bg1: '#9a4a20', glow: 'rgba(255,179,92,0.42)' },
    world: {
      preset: 'desert',
      ground: 'sand',
      grassTint: '#d9b27a',
      foliage: ['#7c8a3a', '#9aa44a', '#6f7d33'],
      trunk: '#8a6a48',
      treeMul: 0.22,
      treeKind: 'palm',
      rocks: true,
      drifts: 'dune',
      mountainLow: '#c49460',
      mountainHigh: '#e7bf8c',
      snowCaps: false,
      precip: 'dust',
      precipAmount: 1,
      grip: 0.96,
    },
    art: { skyTop: '#3d8de0', skyBottom: '#f6dcb0', sun: '#fffbe8', far: '#e8c08a', mid: '#d89a5a', near: '#c07a3c', ground: '#e2b67a', road: '#45403c', foliage: ['#7c8a3a', '#9aa44a'], particle: '#f3d2a0' },
  },
];

export const getSeason = (id: string | undefined) => SEASONS.find((s) => s.id === id) ?? SEASONS[1];

/** Push the season palette into CSS custom properties; the whole UI re-themes (animated via @property). */
export function applySeasonTheme(s: SeasonDef) {
  const r = document.documentElement;
  r.dataset.season = s.id;
  r.style.setProperty('--accent', s.ui.accent);
  r.style.setProperty('--accent-2', s.ui.accent2);
  r.style.setProperty('--accent-ink', s.ui.ink);
  r.style.setProperty('--bg-0', s.ui.bg0);
  r.style.setProperty('--bg-1', s.ui.bg1);
  r.style.setProperty('--glow', s.ui.glow);
}
