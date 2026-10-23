import * as THREE from 'three';
import { mulberry32 } from './utils';

/**
 * Procedurally generated textures. Everything is drawn into canvases at load time so the game
 * ships without third-party image assets. Resolution scales with graphics quality.
 */

let maxAniso = 8;
let texScale = 1;
export function configureTextures(renderer: THREE.WebGLRenderer, quality: 'performance' | 'high' | 'ultra') {
  maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality === 'ultra' ? 16 : quality === 'high' ? 8 : 4);
  texScale = quality === 'performance' ? 0.5 : 1;
}

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function finish(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; mips?: boolean } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (opts.mips === false) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  t.needsUpdate = true;
  return t;
}

function cached(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: number) {
  const img = ctx.createImageData(w, h);
  const r = mulberry32(seed);
  for (let i = 0; i < w * h; i++) {
    const n = (r() - 0.5) * amp + (r() - 0.5) * amp * 0.5;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, color: string, rmin: number, rmax: number, alpha: number, seed: number) {
  const r = mulberry32(seed);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = rmin + r() * (rmax - rmin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (0.4 + r() * 0.6);
    ctx.fillStyle = g;
    // draw wrapped copies so the texture tiles seamlessly
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) ctx.fillRect(x - rad + ox, y - rad + oy, rad * 2, rad * 2);
  }
  ctx.restore();
}

export const Tex = {
  asphalt(): THREE.Texture {
    return cached('asphalt', () => {
      const s = Math.round(1024 * texScale);
      const [c, ctx] = canvas(s, s);
      noiseFill(ctx, s, s, [92, 94, 98], 46, 1);
      blotches(ctx, s, s, 60, 'rgba(40,42,46,1)', s * 0.03, s * 0.12, 0.25, 2);
      blotches(ctx, s, s, 40, 'rgba(140,140,145,1)', s * 0.02, s * 0.08, 0.12, 3);
      // fine aggregate speckles
      const r = mulberry32(4);
      for (let i = 0; i < s * s * 0.02; i++) {
        const v = 120 + r() * 110;
        ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + r() * 0.4})`;
        ctx.fillRect(r() * s, r() * s, 1 + r() * 1.4, 1 + r() * 1.4);
      }
      // patched seams/cracks
      ctx.strokeStyle = 'rgba(25,26,29,0.35)';
      for (let i = 0; i < 6; i++) {
        ctx.lineWidth = 1 + r() * 2;
        ctx.beginPath();
        let x = r() * s;
        let y = r() * s;
        ctx.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += (r() - 0.5) * 60;
          y += r() * 50;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return finish(c);
    });
  },

  /** Greyscale roughness variation for asphalt (darker = smoother / shinier). */
  asphaltRough(): THREE.Texture {
    return cached('asphaltRough', () => {
      const s = Math.round(512 * texScale);
      const [c, ctx] = canvas(s, s);
      noiseFill(ctx, s, s, [200, 200, 200], 70, 5);
      blotches(ctx, s, s, 30, 'rgba(90,90,90,1)', s * 0.05, s * 0.18, 0.45, 6);
      return finish(c, { srgb: false });
    });
  },

  grass(tint = '#4f9a3a'): THREE.Texture {
    return cached('grass' + tint, () => {
      const s = Math.round(512 * texScale);
      const [c, ctx] = canvas(s, s);
      const col = new THREE.Color(tint);
      noiseFill(ctx, s, s, [col.r * 255, col.g * 255, col.b * 255], 40, 7);
      blotches(ctx, s, s, 40, 'rgba(255,255,170,1)', s * 0.05, s * 0.2, 0.08, 8);
      blotches(ctx, s, s, 40, 'rgba(0,40,0,1)', s * 0.05, s * 0.2, 0.12, 9);
      const r = mulberry32(10);
      for (let i = 0; i < s * 30; i++) {
        const g = 0.8 + r() * 0.5;
        ctx.strokeStyle = `rgba(${col.r * 255 * g},${col.g * 255 * g * 1.05},${col.b * 255 * g},0.5)`;
        const x = r() * s;
        const y = r() * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
        ctx.stroke();
      }
      // mowing stripes
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, s, s / 2);
      ctx.globalAlpha = 1;
      return finish(c);
    });
  },

  snow(): THREE.Texture {
    return cached('snow', () => {
      const s = Math.round(512 * texScale);
      const [c, ctx] = canvas(s, s);
      noiseFill(ctx, s, s, [236, 241, 247], 14, 31);
      blotches(ctx, s, s, 40, 'rgba(190,206,224,1)', s * 0.05, s * 0.22, 0.22, 32);
      blotches(ctx, s, s, 30, 'rgba(255,255,255,1)', s * 0.04, s * 0.16, 0.35, 33);
      const r = mulberry32(34);
      for (let i = 0; i < s * 20; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`;
        ctx.fillRect(r() * s, r() * s, 1, 1);
      }
      return finish(c);
    });
  },

  sand(): THREE.Texture {
    return cached('sand', () => {
      const s = Math.round(512 * texScale);
      const [c, ctx] = canvas(s, s);
      noiseFill(ctx, s, s, [214, 176, 122], 30, 11);
      blotches(ctx, s, s, 40, 'rgba(160,110,60,1)', s * 0.05, s * 0.2, 0.15, 12);
      blotches(ctx, s, s, 30, 'rgba(255,230,190,1)', s * 0.05, s * 0.2, 0.15, 13);
      return finish(c);
    });
  },

  gravel(): THREE.Texture {
    return cached('gravel', () => {
      const s = Math.round(512 * texScale);
      const [c, ctx] = canvas(s, s);
      noiseFill(ctx, s, s, [176, 160, 136], 30, 14);
      const r = mulberry32(15);
      for (let i = 0; i < s * s * 0.03; i++) {
        const v = 110 + r() * 120;
        ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.82})`;
        ctx.beginPath();
        ctx.arc(r() * s, r() * s, 0.6 + r() * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      return finish(c);
    });
  },

  curb(): THREE.Texture {
    return cached('curb', () => {
      const [c, ctx] = canvas(64, 256);
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = i === 0 ? '#d81d27' : '#f4f4f0';
        ctx.fillRect(0, i * 128, 64, 128);
      }
      // ridge shading
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 256);
      return finish(c);
    });
  },

  /** Advertising boards for barriers. Fictional sponsors only. */
  adBoards(theme: 'day' | 'night' = 'day'): THREE.Texture {
    return cached('ads' + theme, () => {
      const w = Math.round(2048 * texScale);
      const h = Math.round(128 * texScale);
      const [c, ctx] = canvas(w, h);
      const brands = [
        { t: 'VELOCITY LABS', bg: '#E4202C', fg: '#ffffff' },
        { t: 'APEX DYNAMICS', bg: '#101216', fg: '#FFD43B' },
        { t: 'NOVA MOTORS', bg: '#F7F7F4', fg: '#1a6fd1' },
        { t: 'VECTOR ENERGY', bg: '#FFD43B', fg: '#101216' },
        { t: 'PULSE TECH', bg: '#1d2128', fg: '#55E66A' },
        { t: 'HELIX FUEL', bg: '#FF7B38', fg: '#ffffff' },
        { t: 'ORBIT SYSTEMS', bg: '#0f3b73', fg: '#ffffff' },
        { t: 'KINETIC', bg: '#F7F7F4', fg: '#D6246E' },
      ];
      const seg = w / brands.length;
      brands.forEach((b, i) => {
        ctx.fillStyle = b.bg;
        ctx.fillRect(i * seg, 0, seg, h);
        ctx.fillStyle = b.fg;
        let fs = h * 0.56;
        const setF = () => (ctx.font = `italic 900 ${fs}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`);
        setF();
        while (ctx.measureText(b.t).width > seg * 0.86 && fs > 8) {
          fs -= 2;
          setF();
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.t, i * seg + seg / 2, h * 0.53);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(i * seg, 0, 2, h);
      });
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, h - 6, w, 6);
      return finish(c);
    });
  },

  /** Concrete wall with red/white blocks and white top. */
  wall(): THREE.Texture {
    return cached('wall', () => {
      const [c, ctx] = canvas(256, 64);
      noiseFill(ctx, 256, 64, [190, 190, 186], 18, 21);
      ctx.fillStyle = '#d42029';
      ctx.fillRect(0, 0, 128, 64);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 56, 256, 8);
      ctx.fillRect(127, 0, 2, 64);
      return finish(c);
    });
  },

  fence(): THREE.Texture {
    return cached('fence', () => {
      const [c, ctx] = canvas(128, 128);
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(200,205,210,0.9)';
      ctx.lineWidth = 1.5;
      for (let i = -128; i < 256; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 128, 128);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i + 128, 0);
        ctx.lineTo(i, 128);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160,165,170,1)';
      ctx.fillRect(0, 0, 128, 4);
      return finish(c);
    });
  },

  windows(seed: number, night: boolean): THREE.Texture {
    return cached('win' + seed + night, () => {
      const [c, ctx] = canvas(256, 512);
      const r = mulberry32(seed);
      const base = night ? 14 : 60 + r() * 40;
      ctx.fillStyle = `rgb(${base},${base + 4},${base + 10})`;
      ctx.fillRect(0, 0, 256, 512);
      for (let y = 8; y < 512; y += 24) {
        for (let x = 8; x < 256; x += 20) {
          const lit = r();
          if (night) {
            const cool = r() < 0.35;
            ctx.fillStyle = lit > 0.62 ? (cool ? `rgba(${170 + r() * 50},${210 + r() * 30},255,${0.5 + r() * 0.4})` : `rgba(255,${190 + r() * 50},${120 + r() * 80},${0.45 + r() * 0.45})`) : 'rgba(16,22,34,1)';
          } else {
            const v = 110 + r() * 80;
            ctx.fillStyle = `rgb(${v * 0.7},${v * 0.85},${v})`;
          }
          ctx.fillRect(x, y, 14, 16);
        }
      }
      return finish(c);
    });
  },

  blob(): THREE.Texture {
    return cached('blob', () => {
      const [c, ctx] = canvas(128, 256);
      const g = ctx.createRadialGradient(64, 128, 0, 64, 128, 128);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.6)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.scale(1, 1);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 256);
      ctx.restore();
      return finish(c, { repeat: false });
    });
  },

  particle(): THREE.Texture {
    return cached('particle', () => {
      const [c, ctx] = canvas(64, 64);
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return finish(c, { repeat: false });
    });
  },

  carbon(): THREE.Texture {
    return cached('carbon', () => {
      const [c, ctx] = canvas(64, 64);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const odd = (x + y) % 2 === 0;
          const g = ctx.createLinearGradient(x * 8, y * 8, x * 8 + (odd ? 8 : 0), y * 8 + (odd ? 0 : 8));
          g.addColorStop(0, '#1a1c20');
          g.addColorStop(0.5, '#34373d');
          g.addColorStop(1, '#16181b');
          ctx.fillStyle = g;
          ctx.fillRect(x * 8, y * 8, 8, 8);
        }
      return finish(c);
    });
  },

  tireSide(): THREE.Texture {
    return cached('tireSide', () => {
      const s = 256;
      const [c, ctx] = canvas(s, s);
      ctx.fillStyle = '#121214';
      ctx.fillRect(0, 0, s, s);
      // compound colour band (soft = red ring)
      ctx.strokeStyle = '#d8232c';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8e8e8';
      ctx.font = 'bold 18px "Barlow Condensed", Arial';
      ctx.textAlign = 'center';
      for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(s / 2, s / 2);
        ctx.rotate(i * Math.PI);
        ctx.fillText('APEX GRIP', 0, -s * 0.44);
        ctx.restore();
      }
      return finish(c, { repeat: false });
    });
  },

  /** Decal sheet: sponsor text on transparent bg, for wings & side panels. */
  decal(text: string, fg: string, bg: string | null, w = 512, h = 128, italic = true): THREE.Texture {
    return cached(`decal|${text}|${fg}|${bg}|${w}|${h}`, () => {
      const [c, ctx] = canvas(w, h);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      } else ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fg;
      ctx.font = `${italic ? 'italic ' : ''}900 ${h * 0.62}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = h * 0.62;
      while (ctx.measureText(text).width > w * 0.92 && size > 8) {
        size -= 2;
        ctx.font = `${italic ? 'italic ' : ''}900 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
      }
      ctx.fillText(text, w / 2, h * 0.54);
      return finish(c, { repeat: false });
    });
  },

  crowd(): THREE.Texture {
    return cached('crowd', () => {
      const w = 512;
      const h = 256;
      const [c, ctx] = canvas(w, h);
      ctx.fillStyle = '#20232a';
      ctx.fillRect(0, 0, w, h);
      const r = mulberry32(99);
      const cols = ['#2b2f38', '#3d4350', '#c9c9c9', '#8a8f99', '#1e2a44', '#e8e6df', '#5a5f6a', '#B8323A', '#2f4f8f', '#d9c9a8', '#E4202C', '#FFD43B'];
      for (let row = 0; row < 16; row++) {
        const y = row * 16;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y + 13, w, 3);
        for (let x = 2; x < w; x += 6 + r() * 3) {
          if (r() < 0.12) continue;
          ctx.fillStyle = cols[Math.floor(r() * cols.length)];
          ctx.fillRect(x, y + 5, 4, 8); // body
          ctx.fillStyle = ['#f0c8a0', '#c08a60', '#7a5030', '#e8b890'][Math.floor(r() * 4)];
          ctx.fillRect(x + 0.5, y + 1.5, 3, 3.5); // head
          if (r() < 0.12) {
            ctx.fillStyle = cols[Math.floor(r() * 5)];
            ctx.fillRect(x - 2, y - 3, 8, 5); // flag/banner
          }
        }
      }
      return finish(c);
    });
  },

  logoSign(text: string, sub: string): THREE.Texture {
    return cached('sign' + text + sub, () => {
      const w = 1024;
      const h = 256;
      const [c, ctx] = canvas(w, h);
      ctx.fillStyle = '#101216';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#E4202C';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.08, 0);
      ctx.lineTo(w * 0.04, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.font = 'italic 900 120px "Barlow Condensed", "Arial Narrow", Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#F7F7F4';
      ctx.fillText(text, w / 2, h * 0.42);
      ctx.font = '700 40px "Barlow Condensed", Arial';
      ctx.fillStyle = '#E4202C';
      ctx.fillText(sub, w / 2, h * 0.8);
      return finish(c, { repeat: false });
    });
  },

  distanceBoard(n: string): THREE.Texture {
    return cached('dist' + n, () => {
      const [c, ctx] = canvas(128, 128);
      ctx.fillStyle = '#F7F7F4';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#101216';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 120, 120);
      ctx.fillStyle = '#101216';
      ctx.font = '900 64px "Barlow Condensed", Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n, 64, 68);
      return finish(c, { repeat: false });
    });
  },

  startGrid(): THREE.Texture {
    return cached('checker', () => {
      const [c, ctx] = canvas(256, 64);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 16; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          ctx.fillRect(x * 16, y * 16, 16, 16);
        }
      return finish(c);
    });
  },
};
