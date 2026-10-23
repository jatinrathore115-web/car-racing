export type Weather = 'clear' | 'sunset' | 'night' | 'rain' | 'desert' | 'storm' | 'winter' | 'summer' | 'autumn';
export type Theme = 'stadium' | 'coastal' | 'forest' | 'desert' | 'city' | 'mountain' | 'metro' | 'valley';

export interface TrackDef {
  id: string;
  name: string;
  location: string;
  theme: Theme;
  weather: Weather;
  difficulty: 1 | 2 | 3;
  /** [x, z, elevation?] control points in metres. Point 0 is the start/finish line. */
  points: [number, number, number?][];
  halfWidth: number;
  /** Lateral distance from the road edge to the barriers. */
  runoff: number;
  laps: number;
  /** Target lap time (s) for a gold time-trial trophy. Filled from AI reference at runtime when 0. */
  seed: number;
  /** Index into TRACKS of the circuit that must be podiumed to unlock this one (-1 = open). */
  unlockAfter: number;
}

// The architecture supports any number of circuits; each uses the shared modular track kit
// with its own layout, elevation, corner rhythm, environment, weather and lighting.
export const TRACKS: TrackDef[] = [
  {
    id: 'apex-park',
    name: 'APEX PARK GRAND PRIX',
    location: 'Valcrest',
    theme: 'stadium',
    weather: 'clear',
    difficulty: 1,
    points: [
      [-100, 0, 0], [350, 0, 0], [450, 60, 1], [440, 180, 3], [330, 230, 4], [200, 200, 4], [100, 260, 3],
      [120, 380, 2], [0, 440, 2], [-200, 420, 3], [-300, 330, 3], [-235, 250, 2], [-265, 200, 2], [-380, 160, 1], [-470, 80, 0], [-400, 0, 0],
    ],
    halfWidth: 7,
    runoff: 12,
    laps: 3,
    seed: 11,
    unlockAfter: -1,
  },
  {
    id: 'porto-celeste',
    name: 'PORTO CELESTE HARBOUR',
    location: 'Costa Lumen',
    theme: 'coastal',
    weather: 'clear',
    difficulty: 1,
    points: [
      [0, 0, 0], [300, -20, 0], [520, 30, 1], [600, 150, 3], [540, 260, 5], [400, 250, 5], [300, 320, 4], [150, 300, 4],
      [60, 380, 3], [-120, 360, 2], [-180, 240, 2], [-320, 200, 1], [-420, 100, 0], [-380, 10, 0], [-200, -10, 0],
    ],
    halfWidth: 6.8,
    runoff: 10,
    laps: 3,
    seed: 23,
    unlockAfter: -1,
  },
  {
    id: 'golden-valley',
    name: 'GOLDEN VALLEY RACEWAY',
    location: 'Sierra Ambra',
    theme: 'valley',
    weather: 'sunset',
    difficulty: 2,
    points: [
      [0, 0, 0], [350, 0, 0], [550, -50, 5], [620, -200, 10], [520, -330, 12], [320, -300, 8], [200, -380, 6], [0, -400, 8],
      [-200, -350, 12], [-300, -220, 9], [-225, -170, 6], [-235, -110, 5], [-320, -80, 3], [-385, -55, 2], [-405, 5, 1], [-330, 40, 0], [-180, 20, 0],
    ],
    halfWidth: 7,
    runoff: 12,
    laps: 3,
    seed: 37,
    unlockAfter: -1,
  },
  {
    id: 'silverpine',
    name: 'SILVERPINE RING',
    location: 'Nordhavn Forest',
    theme: 'forest',
    weather: 'clear',
    difficulty: 2,
    points: [
      [0, 0, 0], [250, 0, 1], [380, -60, 3], [420, -200, 6], [320, -300, 8], [180, -260, 6], [100, -340, 4], [-60, -360, 5],
      [-150, -300, 7], [-150, -220, 7], [-95, -195, 6], [-95, -135, 5], [-200, -100, 4], [-300, -160, 3], [-400, -80, 2], [-340, 40, 1], [-180, 40, 0],
    ],
    halfWidth: 6.5,
    runoff: 10,
    laps: 3,
    seed: 41,
    unlockAfter: 0,
  },
  {
    id: 'rainford',
    name: 'RAINFORD STREET CIRCUIT',
    location: 'Rainford City',
    theme: 'city',
    weather: 'rain',
    difficulty: 3,
    points: [
      [0, 0, 0], [300, 0, 0], [360, 40, 0], [360, 200, 0], [300, 240, 0], [160, 240, 0], [120, 300, 0], [120, 420, 0],
      [60, 460, 0], [-160, 460, 0], [-220, 400, 0], [-220, 260, 0], [-300, 200, 0], [-380, 160, 0], [-400, 60, 0], [-340, 0, 0],
    ],
    halfWidth: 6.2,
    runoff: 3.2,
    laps: 3,
    seed: 53,
    unlockAfter: 1,
  },
  {
    id: 'dune-mirage',
    name: 'DUNE MIRAGE RACEWAY',
    location: 'Al Sarab',
    theme: 'desert',
    weather: 'desert',
    difficulty: 2,
    points: [
      [0, 0, 0], [400, 0, 0], [600, 80, 2], [650, 250, 4], [500, 380, 5], [250, 350, 4], [150, 450, 3], [-100, 480, 2],
      [-300, 380, 3], [-250, 250, 3], [-420, 180, 1], [-480, 40, 0], [-300, -20, 0],
    ],
    halfWidth: 7.5,
    runoff: 14,
    laps: 3,
    seed: 67,
    unlockAfter: 2,
  },
  {
    id: 'highcrest',
    name: 'HIGHCREST MOUNTAIN SPEEDWAY',
    location: 'Alto Brenna',
    theme: 'mountain',
    weather: 'clear',
    difficulty: 3,
    points: [
      [0, 0, 0], [300, 0, 4], [480, -80, 10], [520, -260, 18], [400, -380, 22], [220, -340, 16], [120, -420, 12],
      [-80, -440, 8], [-240, -340, 10], [-200, -200, 14], [-340, -140, 10], [-430, -50, 4], [-380, 15, 2], [-260, 20, 1],
    ],
    halfWidth: 6.8,
    runoff: 11,
    laps: 3,
    seed: 79,
    unlockAfter: 3,
  },
  {
    id: 'metro-nocturne',
    name: 'METRO NOCTURNE',
    location: 'Neo Kaiyo',
    theme: 'metro',
    weather: 'night',
    difficulty: 3,
    points: [
      [0, 0, 0], [350, 0, 0], [420, -60, 0], [400, -180, 1], [280, -220, 2], [240, -320, 2], [300, -420, 1], [200, -500, 0],
      [0, -480, 0], [-80, -380, 1], [-200, -400, 2], [-320, -320, 2], [-300, -180, 1], [-200, -150, 0], [-195, -100, 0], [-250, -75, 0], [-260, -25, 0], [-130, 0, 0],
    ],
    halfWidth: 6.6,
    runoff: 6,
    laps: 3,
    seed: 97,
    unlockAfter: 4,
  },
];

export const getTrack = (id: string) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'CLEAR DAY',
  sunset: 'SUNSET',
  night: 'NIGHT',
  rain: 'RAIN',
  desert: 'DESERT HEAT',
  storm: 'STORM',
  winter: 'WINTER',
  summer: 'SUMMER',
  autumn: 'AUTUMN',
};

export const CHAMPIONSHIP = {
  name: 'APEX CONTINENTAL CUP',
  rounds: ['apex-park', 'porto-celeste', 'golden-valley', 'silverpine'],
  points: [25, 18, 15, 12, 10, 8, 6, 4],
};
