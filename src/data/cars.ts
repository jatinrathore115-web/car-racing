export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  helmet: string;
  /** Pattern drives how vertex colours are painted over the loft body. */
  pattern: 'classic' | 'split' | 'arrow' | 'stripe';
  sponsor: string;
  number: number;
}

export interface CarDef {
  id: string;
  name: string;
  team: string;
  tagline: string;
  price: number;
  stats: { topSpeed: number; acceleration: number; braking: number; handling: number };
  physics: { topSpeed: number; accel: number; brake: number; grip: number; steer: number };
  aero: 'balanced' | 'highDownforce' | 'lowDrag';
  livery: Livery;
  aiOnly?: boolean;
}

// Fictional teams & sponsors only. No real-world motorsport branding.
export const CARS: CarDef[] = [
  {
    id: 'crimson',
    name: 'CRIMSON XR',
    team: 'Apex Dynamics',
    tagline: 'Balanced front-runner with a ferocious top end.',
    price: 0,
    stats: { topSpeed: 82, acceleration: 80, braking: 78, handling: 80 },
    physics: { topSpeed: 91, accel: 15.5, brake: 31, grip: 1.0, steer: 1.0 },
    aero: 'balanced',
    livery: { primary: '#E4202C', secondary: '#111317', accent: '#F7F7F4', helmet: '#FFD43B', pattern: 'classic', sponsor: 'APEX DYNAMICS', number: 16 },
  },
  {
    id: 'solar',
    name: 'SOLAR VORTEX',
    team: 'Vector Energy',
    tagline: 'Explosive launch, built to win the drag race to turn one.',
    price: 6000,
    stats: { topSpeed: 78, acceleration: 92, braking: 76, handling: 78 },
    physics: { topSpeed: 89.5, accel: 17.2, brake: 30.5, grip: 0.99, steer: 1.0 },
    aero: 'balanced',
    livery: { primary: '#FFD43B', secondary: '#121418', accent: '#E4202C', helmet: '#121418', pattern: 'arrow', sponsor: 'VECTOR ENERGY', number: 7 },
  },
  {
    id: 'azure',
    name: 'AZURE GT',
    team: 'Nova Motors',
    tagline: 'Precision chassis. Rewards smooth, committed lines.',
    price: 9000,
    stats: { topSpeed: 80, acceleration: 79, braking: 86, handling: 91 },
    physics: { topSpeed: 90.5, accel: 15.6, brake: 33, grip: 1.06, steer: 1.04 },
    aero: 'highDownforce',
    livery: { primary: '#2E9BE8', secondary: '#F7F7F4', accent: '#0E1A2B', helmet: '#F7F7F4', pattern: 'split', sponsor: 'NOVA MOTORS', number: 22 },
  },
  {
    id: 'volt',
    name: 'VOLT RS',
    team: 'Pulse Tech',
    tagline: 'Low-drag missile. Untouchable on the long straights.',
    price: 14000,
    stats: { topSpeed: 95, acceleration: 84, braking: 80, handling: 76 },
    physics: { topSpeed: 95, accel: 16.2, brake: 31.5, grip: 0.98, steer: 0.98 },
    aero: 'lowDrag',
    livery: { primary: '#55E66A', secondary: '#0C0F12', accent: '#F7F7F4', helmet: '#55E66A', pattern: 'stripe', sponsor: 'PULSE TECH', number: 3 },
  },
  {
    id: 'phantom',
    name: 'PHANTOM X',
    team: 'Velocity Labs',
    tagline: 'Stealth-black prototype. All-round apex predator.',
    price: 22000,
    stats: { topSpeed: 92, acceleration: 90, braking: 90, handling: 92 },
    physics: { topSpeed: 94, accel: 17, brake: 34, grip: 1.07, steer: 1.04 },
    aero: 'highDownforce',
    livery: { primary: '#1B1D22', secondary: '#E4202C', accent: '#FFD43B', helmet: '#E4202C', pattern: 'arrow', sponsor: 'VELOCITY LABS', number: 1 },
  },
  {
    id: 'emerald',
    name: 'EMERALD VELOCITY',
    team: 'Verdant Racing',
    tagline: 'Heritage green with a modern aero package.',
    price: 17000,
    stats: { topSpeed: 86, acceleration: 86, braking: 84, handling: 86 },
    physics: { topSpeed: 92.5, accel: 16.4, brake: 32.5, grip: 1.03, steer: 1.02 },
    aero: 'balanced',
    livery: { primary: '#0F6B45', secondary: '#FF7B38', accent: '#F7F7F4', helmet: '#FF7B38', pattern: 'split', sponsor: 'VERDANT', number: 44 },
  },
  {
    id: 'sunset',
    name: 'INFERNO SR',
    team: 'Helix Fuel',
    tagline: 'Factory rival.',
    price: 0,
    aiOnly: true,
    stats: { topSpeed: 84, acceleration: 82, braking: 82, handling: 82 },
    physics: { topSpeed: 91.5, accel: 15.8, brake: 31.5, grip: 1.01, steer: 1 },
    aero: 'balanced',
    livery: { primary: '#FF7B38', secondary: '#16181D', accent: '#F7F7F4', helmet: '#F7F7F4', pattern: 'stripe', sponsor: 'HELIX FUEL', number: 11 },
  },
  {
    id: 'silver',
    name: 'NOVA ARROW',
    team: 'Orbit Systems',
    tagline: 'Factory rival.',
    price: 0,
    aiOnly: true,
    stats: { topSpeed: 84, acceleration: 82, braking: 82, handling: 82 },
    physics: { topSpeed: 91.5, accel: 15.8, brake: 31.5, grip: 1.01, steer: 1 },
    aero: 'balanced',
    livery: { primary: '#C9CED6', secondary: '#13161B', accent: '#4DB7F4', helmet: '#4DB7F4', pattern: 'classic', sponsor: 'ORBIT SYSTEMS', number: 63 },
  },
  {
    id: 'magenta',
    name: 'PULSAR GT',
    team: 'Kinetic Labs',
    tagline: 'Factory rival.',
    price: 0,
    aiOnly: true,
    stats: { topSpeed: 84, acceleration: 82, braking: 82, handling: 82 },
    physics: { topSpeed: 91.5, accel: 15.8, brake: 31.5, grip: 1.01, steer: 1 },
    aero: 'balanced',
    livery: { primary: '#F7F7F4', secondary: '#D6246E', accent: '#14161A', helmet: '#D6246E', pattern: 'arrow', sponsor: 'KINETIC', number: 31 },
  },
];

export const PLAYER_CARS = CARS.filter((c) => !c.aiOnly);
export const getCar = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];

export interface AIPersonality {
  name: string;
  label: 'Aggressive' | 'Balanced' | 'Defensive' | 'Late Braker' | 'Smooth';
  pace: number; // corner-speed confidence multiplier
  brakeLate: number; // assumed braking capability multiplier
  aggression: number; // 0..1 overtaking appetite
  defend: number; // 0..1 likelihood to cover the inside
  consistency: number; // 0..1 (1 = never makes mistakes)
  lineAccuracy: number; // 0..1 how tightly the racing line is followed
}

export const DRIVERS: AIPersonality[] = [
  { name: 'M. KESSLER', label: 'Aggressive', pace: 1.0, brakeLate: 1.04, aggression: 0.95, defend: 0.5, consistency: 0.9, lineAccuracy: 0.9 },
  { name: 'R. ORTEGA', label: 'Late Braker', pace: 0.99, brakeLate: 1.12, aggression: 0.7, defend: 0.4, consistency: 0.86, lineAccuracy: 0.88 },
  { name: 'J. LAURENT', label: 'Smooth', pace: 1.01, brakeLate: 0.97, aggression: 0.4, defend: 0.3, consistency: 0.98, lineAccuracy: 0.98 },
  { name: 'K. TANAKA', label: 'Balanced', pace: 1.0, brakeLate: 1.0, aggression: 0.6, defend: 0.55, consistency: 0.94, lineAccuracy: 0.94 },
  { name: 'A. NOVAK', label: 'Defensive', pace: 0.985, brakeLate: 1.0, aggression: 0.45, defend: 0.95, consistency: 0.93, lineAccuracy: 0.92 },
  { name: 'D. BRENNAN', label: 'Aggressive', pace: 0.99, brakeLate: 1.06, aggression: 0.85, defend: 0.6, consistency: 0.85, lineAccuracy: 0.86 },
  { name: 'L. MOREAU', label: 'Smooth', pace: 0.995, brakeLate: 0.98, aggression: 0.5, defend: 0.4, consistency: 0.97, lineAccuracy: 0.96 },
  { name: 'S. VARGA', label: 'Balanced', pace: 0.98, brakeLate: 1.0, aggression: 0.55, defend: 0.5, consistency: 0.92, lineAccuracy: 0.9 },
];
