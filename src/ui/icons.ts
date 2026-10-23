export const ICON = {
  /** Brand mark: an apex curve slicing through a wheel ring, filled with the season gradient. */
  mark: `<svg class="mark" viewBox="0 0 64 64"><defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="18" fill="url(#bm)"/><path d="M14 44c8-2 14-8 18-17 3-7 8-11 18-12" fill="none" stroke="#0b0f1a" stroke-width="6" stroke-linecap="round"/><circle cx="44" cy="40" r="6" fill="none" stroke="#0b0f1a" stroke-width="4"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 21V4M5 4h13l-2.5 4.5L18 13H5"/></svg>`,
  stopwatch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 3h5M19 6.5l-1.5 1.5"/></svg>`,
  car: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 15.5h18M6 15.5l1.5-5h9l1.5 5M4.5 12.5h3M16.5 12.5h3"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/></svg>`,
  season: {
    winter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/></svg>`,
    summer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>`,
    autumn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l8-8"/></svg>`,
    rainy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 14a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 7 3.5 3.5 0 0 1 18 14z"/><path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"/></svg>`,
    desert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="16.5" cy="7" r="3"/><path d="M2 18c3.5-3.5 7-3.5 10 0s6.5 3 10 0M2 21.5h20"/></svg>`,
  } as Record<string, string>,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>`,
  coin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4" stroke-linecap="round"/></svg>`,
  cup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5A3.5 3.5 0 0 1 16.5 11M12 14v3.5M8.5 20.5h7l-1-3h-5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>`,
  left: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 4.5L7 12l8.5 7.5z"/></svg>`,
  right: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 4.5L17 12l-8.5 7.5z"/></svg>`,
  weather: {
    clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`,
    sunset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17a5 5 0 0 1 10 0M3 17h18M5 21h14M12 4v4M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4"/></svg>`,
    night: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`,
    rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 15a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 8 3.5 3.5 0 0 1 18 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/></svg>`,
    desert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="16" cy="7" r="3"/><path d="M2 18c3-3 6-3 9 0s6 3 11 0M2 21h20"/></svg>`,
    storm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 15a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 8 3.5 3.5 0 0 1 18 15z"/><path d="M12 15l-2 4h4l-2 3"/></svg>`,
  } as Record<string, string>,
};

/** Metallic trophy with gradient shading; tier 1 bronze, 2 silver, 3 gold, 0 empty outline. */
export function trophySVG(tier: number, id = Math.random().toString(36).slice(2)) {
  if (!tier)
    return `<svg viewBox="0 0 64 64" class="trophy"><path d="M20 10h24v14a12 12 0 0 1-24 0zM20 14h-7v3a8 8 0 0 0 8 8M44 14h7v3a8 8 0 0 1-8 8M32 36v8M24 54h16l-2-10H26z" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  const pal = tier === 3 ? ['#fff4c4', '#f5c84c', '#9c6b10'] : tier === 2 ? ['#ffffff', '#cfd5dc', '#6b7480'] : ['#ffd6b0', '#d08a52', '#6e3f1a'];
  return `<svg viewBox="0 0 64 64" class="trophy">
    <defs>
      <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset="0.45" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[2]}"/></linearGradient>
      <clipPath id="c${id}"><path d="M20 10h24v14a12 12 0 0 1-24 0z"/></clipPath>
    </defs>
    <path d="M20 14h-7v3a8 8 0 0 0 8 8M44 14h7v3a8 8 0 0 1-8 8" fill="none" stroke="url(#g${id})" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M20 10h24v14a12 12 0 0 1-24 0z" fill="url(#g${id})"/>
    <g clip-path="url(#c${id})"><rect class="trophy-shine" x="18" y="6" width="8" height="34" fill="rgba(255,255,255,0.55)" transform="skewX(-20)"/></g>
    <rect x="29.5" y="35" width="5" height="9" fill="url(#g${id})"/>
    <path d="M24 54h16l-2-10H26z" fill="url(#g${id})"/>
    <rect x="21" y="54" width="22" height="4" rx="1" fill="${pal[2]}"/>
  </svg>`;
}
