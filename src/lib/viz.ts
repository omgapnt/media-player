export const modes = ["bars", "mirror", "radial", "rings"] as const;
export type Mode = (typeof modes)[number];

export type ThemeId = "ember" | "limestone" | "tide" | "rose" | "ink";

type RGB = readonly [number, number, number];

export type Theme = {
  id: ThemeId;
  name: string;
  bg: string;
  bgRgb: RGB;
  wash: RGB;
  swatch: string;
  stops: readonly [RGB, RGB, RGB, RGB];
};

export const themes: readonly Theme[] = [
  {
    id: "ember",
    name: "Ember",
    bg: "#0c0b0a",
    bgRgb: [12, 11, 10],
    wash: [224, 138, 69],
    swatch: "#e08a45",
    stops: [
      [92, 48, 28],
      [176, 78, 36],
      [224, 138, 69],
      [246, 228, 206],
    ],
  },
  {
    id: "limestone",
    name: "Limestone",
    bg: "#0e0d0c",
    bgRgb: [14, 13, 12],
    wash: [201, 194, 182],
    swatch: "#c9c2b6",
    stops: [
      [72, 68, 60],
      [130, 124, 112],
      [201, 194, 182],
      [238, 234, 226],
    ],
  },
  {
    id: "tide",
    name: "Tide",
    bg: "#070e0e",
    bgRgb: [7, 14, 14],
    wash: [111, 176, 168],
    swatch: "#6fb0a8",
    stops: [
      [22, 64, 62],
      [36, 112, 106],
      [111, 176, 168],
      [214, 234, 228],
    ],
  },
  {
    id: "rose",
    name: "Rose",
    bg: "#100b0c",
    bgRgb: [16, 11, 12],
    wash: [212, 132, 146],
    swatch: "#d48492",
    stops: [
      [92, 40, 52],
      [168, 72, 88],
      [212, 132, 146],
      [244, 220, 214],
    ],
  },
  {
    id: "ink",
    name: "Ink",
    bg: "#090909",
    bgRgb: [9, 9, 9],
    wash: [210, 210, 210],
    swatch: "#d2d2d2",
    stops: [
      [58, 58, 58],
      [120, 120, 120],
      [196, 196, 196],
      [242, 242, 242],
    ],
  },
];

export type Source = "idle" | "mic" | "file" | "tone";

export type Snapshot = {
  source: Source;
  playing: boolean;
  fileName: string | null;
  currentTime: number;
  duration: number;
  error: string | null;
};

export function isMode(value: string): value is Mode {
  return (modes as readonly string[]).includes(value);
}

export function themeById(id: string): Theme {
  return themes.find((theme) => theme.id === id) ?? themes[0];
}

type DrawState = {
  theme: Theme;
  disp: Float32Array;
  peaks: Float32Array;
  fills: string[];
  glows: string[];
  peak: string;
  bass: number;
  rot: number;
  wave: Uint8Array | null;
  capturing: boolean;
};

function rgb(c: RGB, a = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function sample(stops: readonly RGB[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function sampleAt(data: Float32Array, index: number, count: number): number {
  if (data.length === 0) return 0;
  const idx = Math.round((index / Math.max(1, count - 1)) * (data.length - 1));
  return data[Math.min(data.length - 1, Math.max(0, idx))] ?? 0;
}

function idleLevel(i: number, n: number, t: number): number {
  const x = i / Math.max(1, n - 1);
  const low = Math.exp(-x * 3.1);
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.85 + x * 5.2);
  const flutter = 0.5 + 0.5 * Math.sin(t * 1.65 + i * 0.41);
  return low * 0.26 * (0.42 + 0.58 * pulse) * (0.62 + 0.38 * flutter) + 0.025;
}

function roundBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (w <= 0 || h <= 0) return;
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

function wedge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
) {
  if (r1 <= r0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1, false);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
  ctx.fill();
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  theme: Theme,
  bass: number,
) {
  const pulse = Math.max(8, radius * (0.72 + bass * 0.85));
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse);
  g.addColorStop(0, rgb(theme.stops[3], 0.92));
  g.addColorStop(0.42, rgb(theme.stops[1], 0.38));
  g.addColorStop(1, rgb(theme.stops[1], 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
  ctx.fill();
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: DrawState,
  focusY: number,
) {
  ctx.fillStyle = s.theme.bg;
  ctx.fillRect(0, 0, w, h);
  const glow = 0.045 + s.bass * 0.22;
  const g = ctx.createRadialGradient(w / 2, focusY, 0, w / 2, focusY, Math.max(w, h) * 0.55);
  g.addColorStop(0, rgb(s.theme.wash, glow));
  g.addColorStop(1, rgb(s.theme.wash, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(
    w / 2,
    h * 0.48,
    Math.min(w, h) * 0.28,
    w / 2,
    h * 0.5,
    Math.max(w, h) * 0.72,
  );
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(1, "rgba(0, 0, 0, 0.48)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState, mirrored: boolean) {
  const count = s.disp.length;
  if (count === 0) return;
  const margin = Math.max(12, w * 0.03);
  const usable = Math.max(1, w - margin * 2);
  const gap = Math.max(3, (usable / count) * 0.28);
  const bw = Math.max(2, (usable - gap * (count - 1)) / count);
  const base = mirrored ? h * 0.5 : h * (w < 700 ? 0.66 : 0.78);
  const maxH = mirrored ? h * 0.34 : h * (w < 700 ? 0.4 : 0.52);
  const radius = Math.min(bw * 0.5, 14);

  const floor = ctx.createRadialGradient(w / 2, base, 0, w / 2, base, w * 0.38);
  floor.addColorStop(0, rgb(s.theme.wash, 0.16 + s.bass * 0.22));
  floor.addColorStop(1, rgb(s.theme.wash, 0));
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.ellipse(w / 2, base, w * 0.36, Math.max(12, h * 0.055), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const barH = Math.max(2, s.disp[i] * maxH);
    const x = margin + i * (bw + gap);
    ctx.fillStyle = s.glows[i] ?? s.peak;
    if (mirrored) ctx.fillRect(x - 4, base - barH - 10, bw + 8, barH * 2 + 20);
    else ctx.fillRect(x - 4, base - barH - 10, bw + 8, barH + 12);
  }
  ctx.globalCompositeOperation = "source-over";

  for (let i = 0; i < count; i++) {
    const v = s.disp[i];
    const barH = Math.max(2, v * maxH);
    const x = margin + i * (bw + gap);
    ctx.fillStyle = s.fills[i] ?? s.peak;
    roundBar(ctx, x, base - barH, bw, barH, radius);
    if (mirrored) roundBar(ctx, x, base, bw, barH, radius);
    const peakH = Math.max(v, s.peaks[i] ?? 0) * maxH;
    const cap = Math.max(2, Math.min(3, bw * 0.28));
    ctx.fillStyle = s.peak;
    ctx.fillRect(x, base - peakH - cap, bw, cap);
    if (mirrored) ctx.fillRect(x, base + peakH, bw, cap);
  }

  if (!mirrored) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < count; i++) {
      const rh = Math.max(1, s.disp[i] * maxH * 0.36);
      const x = margin + i * (bw + gap);
      ctx.fillStyle = s.fills[i] ?? s.peak;
      ctx.fillRect(x, base + 3, bw, rh);
    }
    ctx.restore();
    const fadeH = Math.min(h - base, maxH * 0.5);
    const fade = ctx.createLinearGradient(0, base, 0, base + fadeH);
    fade.addColorStop(0, rgb(s.theme.bgRgb, 0));
    fade.addColorStop(1, rgb(s.theme.bgRgb, 1));
    ctx.fillStyle = fade;
    ctx.fillRect(0, base + 1, w, fadeH);
  } else {
    ctx.strokeStyle = rgb(s.theme.stops[3], 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, base + 0.5);
    ctx.lineTo(w - margin, base + 0.5);
    ctx.stroke();
  }
}

function drawRadial(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState) {
  const cx = w / 2;
  const cy = h / 2;
  const min = Math.min(w, h);
  const spokes = min < 560 ? 18 : 26;
  const slice = Math.PI / spokes;
  const gap = slice * 0.3;
  const inner = min * 0.155;
  const maxLen = min * 0.3;

  for (let i = 0; i < spokes; i++) {
    const v = Math.min(1, sampleAt(s.disp, i, spokes));
    const peak = Math.min(1, sampleAt(s.peaks, i, spokes));
    const len = Math.max(3, v * maxLen);
    const colorIndex = Math.round((i / Math.max(1, spokes - 1)) * (s.fills.length - 1));
    const fill = s.fills[colorIndex] ?? s.peak;
    const glow = s.glows[colorIndex] ?? fill;
    const offset = (i + 0.5) * slice;
    const mids = [Math.PI / 2 - offset + s.rot, Math.PI / 2 + offset + s.rot];
    for (const mid of mids) {
      const a0 = mid - slice / 2 + gap / 2;
      const a1 = mid + slice / 2 - gap / 2;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = glow;
      wedge(ctx, cx, cy, a0, a1, inner, inner + len + min * 0.018);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = fill;
      wedge(ctx, cx, cy, a0, a1, inner, inner + len);
      const pr = inner + Math.max(len, peak * maxLen);
      ctx.strokeStyle = s.peak;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, a0, a1);
      ctx.stroke();
    }
  }

  const waveR = inner * 0.78;
  ctx.beginPath();
  if (s.capturing && s.wave && s.wave.length > 0) {
    const pts = 96;
    const step = Math.max(1, Math.floor(s.wave.length / pts));
    for (let i = 0; i < pts; i++) {
      const sampleByte = s.wave[Math.min(s.wave.length - 1, i * step)] ?? 128;
      const mag = (sampleByte - 128) / 128;
      const r = waveR + mag * inner * 0.18;
      const a = s.rot * 0.35 + (i / pts) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgb(s.theme.stops[3], 0.8);
    ctx.lineWidth = 1.25;
    ctx.stroke();
  } else {
    ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(s.theme.stops[3], 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, inner * 0.96, 0, Math.PI * 2);
  ctx.strokeStyle = rgb(s.theme.stops[3], 0.22);
  ctx.lineWidth = 1;
  ctx.stroke();
  drawCore(ctx, cx, cy, inner * 0.55, s.theme, s.bass);
}

function drawRings(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState) {
  const cx = w / 2;
  const cy = h / 2;
  const min = Math.min(w, h);
  const bands = 7;
  drawCore(ctx, cx, cy, min * 0.09, s.theme, s.bass);

  for (let i = 0; i < bands; i++) {
    const amp = Math.min(1, sampleAt(s.disp, i, bands));
    const radius = min * (0.15 + i * 0.055) + amp * min * 0.012;
    const colorIndex = Math.round((i / (bands - 1)) * Math.max(0, s.fills.length - 1));
    const fill = s.fills[colorIndex] ?? s.peak;
    const glow = s.glows[colorIndex] ?? fill;
    const dir = i % 2 === 0 ? 1 : -1;
    const spin = s.rot * dir * (0.85 + i * 0.12);
    const len = Math.PI * (0.36 + amp * 0.54);
    const lw = Math.max(1.4, min * 0.0032) + amp * min * 0.013;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = glow;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = glow;
    ctx.lineWidth = lw + min * 0.012;
    ctx.globalAlpha = 0.55;
    for (let k = 0; k < 2; k++) {
      const mid = spin + k * Math.PI;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, mid - len / 2, mid + len / 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = fill;
    ctx.lineWidth = lw;
    for (let k = 0; k < 2; k++) {
      const mid = spin + k * Math.PI;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, mid - len / 2, mid + len / 2);
      ctx.stroke();
    }
  }
  ctx.lineCap = "butt";
}

function paint(ctx: CanvasRenderingContext2D, w: number, h: number, mode: Mode, s: DrawState) {
  const focusY = mode === "radial" || mode === "rings" ? h * 0.5 : h * 0.72;
  drawBackdrop(ctx, w, h, s, focusY);
  if (mode === "bars") drawBars(ctx, w, h, s, false);
  else if (mode === "mirror") drawBars(ctx, w, h, s, true);
  else if (mode === "radial") drawRadial(ctx, w, h, s);
  else drawRings(ctx, w, h, s);
  drawVignette(ctx, w, h);
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function makeLoop(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const seconds = 4;
  const bpm = 112;
  const beat = 60 / bpm;
  const n = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(2, n, sr);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const arp = [220, 261.63, 329.63, 440, 329.63, 261.63, 220, 196];
  let kickPhase = 0;
  let bassPhase = 0;
  let pad1 = 0;
  let pad2 = 0;
  let pad3 = 0;
  let arpPhase = 0;
  let lastKick = -1;
  let lastArp = -1;
  const bassFreq = 55;

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beatPos = t / beat;
    const beatIndex = Math.floor(beatPos);
    const within = beatPos - beatIndex;
    const kickHit = beatIndex % 2 === 0;
    if (kickHit && beatIndex !== lastKick && within < 0.02) {
      kickPhase = 0;
      lastKick = beatIndex;
    }
    let kick = 0;
    if (kickHit) {
      const kf = 168 * Math.exp(-within * 9) + 46;
      kickPhase += (2 * Math.PI * kf) / sr;
      const attack = Math.min(1, within * sr * 0.02);
      kick = Math.sin(kickPhase) * Math.exp(-within * 5.4) * attack * 0.95;
    }
    bassPhase += (2 * Math.PI * bassFreq) / sr;
    const bass = Math.sin(bassPhase) * 0.26 * (0.55 + 0.45 * Math.exp(-within * 3));
    pad1 += (2 * Math.PI * 110) / sr;
    pad2 += (2 * Math.PI * 164.81) / sr;
    pad3 += (2 * Math.PI * 220) / sr;
    const pad = (Math.sin(pad1) + Math.sin(pad2) * 0.7 + Math.sin(pad3) * 0.45) * 0.065;
    const arpIndex = Math.floor(t / (beat / 2)) % arp.length;
    if (arpIndex !== lastArp) {
      arpPhase = 0;
      lastArp = arpIndex;
    }
    const arpWithin = (t / (beat / 2)) % 1;
    arpPhase += (2 * Math.PI * arp[arpIndex]) / sr;
    const arpEnv = Math.min(1, arpWithin * 70) * Math.exp(-arpWithin * 3.6);
    const arpSig = Math.sin(arpPhase) * 0.15 * arpEnv;
    const eighth = (t / (beat / 2)) % 1;
    const hatEnv = Math.min(1, eighth * 90) * Math.exp(-eighth * 20);
    const noise = hash(i) * 2 - 1;
    const hat = noise * hatEnv * 0.11;
    const mid = kick + bass + pad + arpSig + hat;
    L[i] = mid;
    R[i] = mid * 0.97 + noise * hatEnv * 0.03;
  }

  let peak = 0.001;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = 0.9 / peak;
  for (let i = 0; i < n; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  return buffer;
}

function audioMessage(err: unknown, fallback: string): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Microphone blocked. Allow access, or drop a track.";
    if (err.name === "NotFoundError") return "No microphone found. Drop a track instead.";
    if (err.name === "AbortError") return fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4|aiff|aif)$/i.test(file.name);
}

export class VizEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: (partial: Partial<Snapshot>) => void;
  private readonly g: CanvasRenderingContext2D;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private out: GainNode | null = null;
  private toneTap: GainNode | null = null;
  private toneSpeaker: GainNode | null = null;
  private demoBuffer: AudioBuffer | null = null;
  private demoNode: AudioBufferSourceNode | null = null;
  private mediaNode: MediaElementAudioSourceNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private readonly audio: HTMLAudioElement;
  private url: string | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private wave: Uint8Array<ArrayBuffer> | null = null;
  private levels = new Float32Array(48);
  private targets = new Float32Array(48);
  private scratch = new Float32Array(48);
  private disp = new Float32Array(48);
  private peaks = new Float32Array(48);
  private fills: string[] = [];
  private glows: string[] = [];
  private peakColor = "rgb(246, 228, 206)";
  private count = 48;
  private mode: Mode = "bars";
  private theme: Theme = themes[0];
  private sensitivity = 1.2;
  private source: Source = "idle";
  private toneOn = false;
  private bass = 0;
  private rot = 0;
  private t = 0;
  private dt = 0.016;
  private idleMix = 1;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private pollAcc = 0;
  private snapTime = 0;
  private snapDur = 0;
  private dead = false;
  private reduce = false;
  private op = 0;
  private ro: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;
  private readonly onMq = () => {
    this.reduce = this.mq?.matches ?? false;
  };
  private readonly onResize = () => this.resize();
  private readonly frame = (now: number) => {
    if (this.dead) return;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.tick(dt);
    this.draw();
    this.pollTransport(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  constructor(canvas: HTMLCanvasElement, onChange: (partial: Partial<Snapshot>) => void) {
    this.canvas = canvas;
    this.onChange = onChange;
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("Canvas is unavailable.");
    this.g = g;
    this.audio = document.createElement("audio");
    this.audio.preload = "auto";
    this.audio.setAttribute("playsinline", "true");
    this.audio.setAttribute("webkit-playsinline", "true");
    document.body.appendChild(this.audio);
    this.audio.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
      this.snapDur = duration;
      this.emit({ duration });
    });
    this.audio.addEventListener("play", () => {
      if (this.source === "file") this.emit({ playing: true, error: null });
    });
    this.audio.addEventListener("pause", () => {
      if (this.source === "file") this.emit({ playing: false });
    });
    this.audio.addEventListener("ended", () => {
      if (this.source === "file") {
        this.emit({
          playing: false,
          currentTime: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
        });
      }
    });
    this.audio.addEventListener("error", () => {
      if (this.source === "file") this.emit({ error: "Couldn't read that audio file.", playing: false });
    });
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.rebuildFills();
  }

  start() {
    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduce = this.mq.matches;
    this.mq.addEventListener("change", this.onMq);
    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    window.addEventListener("resize", this.onResize);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.mq?.removeEventListener("change", this.onMq);
    window.removeEventListener("resize", this.onResize);
    this.stopMicTracks();
    try {
      this.micSource?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      this.demoNode?.stop();
    } catch {
      /* not started */
    }
    try {
      this.demoNode?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.audio.pause();
    this.audio.remove();
    if (this.url) URL.revokeObjectURL(this.url);
    void this.ctx?.close();
  }

  setMode(mode: Mode) {
    this.mode = mode;
  }

  setTheme(id: string) {
    this.theme = themeById(id);
    this.rebuildFills();
  }

  setSensitivity(value: number) {
    this.sensitivity = Math.min(2.6, Math.max(0.35, value));
  }

  hasFile() {
    return this.url !== null;
  }

  async openFile(file: File) {
    if (!isAudioFile(file)) {
      this.emit({ error: "That file isn't audio." });
      return;
    }
    const op = ++this.op;
    try {
      await this.ensureCtx();
      if (op !== this.op || this.dead) return;
      this.stopMicTracks();
      try {
        this.micSource?.disconnect();
      } catch {
        /* already disconnected */
      }
      this.micSource = null;
      this.toneOn = false;
      this.setToneTap(0);
      if (this.url) URL.revokeObjectURL(this.url);
      const url = URL.createObjectURL(file);
      this.url = url;
      this.source = "file";
      this.audio.src = url;
      this.audio.currentTime = 0;
      this.connectMedia();
      this.emit({
        source: "file",
        fileName: file.name,
        error: null,
        playing: false,
        currentTime: 0,
        duration: 0,
      });
      await this.audio.play();
    } catch (err) {
      if (op !== this.op || this.dead) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      this.emit({ error: audioMessage(err, "Couldn't play that file."), playing: false });
    }
  }

  async resumeFile() {
    if (!this.url) return;
    const op = ++this.op;
    try {
      await this.ensureCtx();
      if (op !== this.op || this.dead) return;
      this.stopMicTracks();
      try {
        this.micSource?.disconnect();
      } catch {
        /* already disconnected */
      }
      this.micSource = null;
      this.toneOn = false;
      this.setToneTap(0);
      this.source = "file";
      this.connectMedia();
      this.emit({ source: "file", error: null });
      if (this.audio.ended) this.audio.currentTime = 0;
      await this.audio.play();
    } catch (err) {
      if (op !== this.op || this.dead) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      this.emit({ error: audioMessage(err, "Couldn't play that file."), playing: false });
    }
  }

  async startMic() {
    const op = ++this.op;
    try {
      await this.ensureCtx();
      if (op !== this.op || this.dead) return;
      if (this.audio && !this.audio.paused) this.audio.pause();
      this.toneOn = false;
      this.setToneTap(0);
      this.disconnectMedia();
      this.stopMicTracks();
      try {
        this.micSource?.disconnect();
      } catch {
        /* already disconnected */
      }
      this.source = "mic";
      const stream = await this.requestMic();
      if (op !== this.op || this.dead || this.source !== "mic") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const node = this.ctx!.createMediaStreamSource(stream);
      node.connect(this.analyser!);
      this.micSource = node;
      this.emit({ source: "mic", playing: true, error: null });
    } catch (err) {
      if (op !== this.op || this.dead) return;
      this.source = this.url ? "file" : "idle";
      if (this.url) this.connectMedia();
      this.emit({
        source: this.source,
        playing: false,
        error: audioMessage(err, "Microphone unavailable. Drop a track instead."),
      });
    }
  }

  stopMic() {
    this.stopMicTracks();
    try {
      this.micSource?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.micSource = null;
    if (this.source !== "mic") return;
    if (this.url) {
      this.source = "file";
      this.connectMedia();
      this.emit({ source: "file", playing: false, error: null });
    } else {
      this.source = "idle";
      this.emit({ source: "idle", playing: false, error: null });
    }
  }

  async startTone() {
    const op = ++this.op;
    try {
      await this.ensureCtx();
      if (op !== this.op || this.dead) return;
      if (!this.audio.paused) this.audio.pause();
      this.stopMicTracks();
      try {
        this.micSource?.disconnect();
      } catch {
        /* already disconnected */
      }
      this.micSource = null;
      this.disconnectMedia();
      if (!this.demoBuffer) this.demoBuffer = makeLoop(this.ctx!);
      if (!this.demoNode) this.spawnTone();
      this.toneOn = true;
      this.setToneTap(1);
      this.source = "tone";
      this.emit({ source: "tone", playing: true, error: null });
    } catch (err) {
      if (this.dead) return;
      this.emit({ error: audioMessage(err, "Audio couldn't start."), playing: false });
    }
  }

  async togglePlay() {
    if (this.source === "mic") {
      this.stopMic();
      return;
    }
    if (this.source === "tone") {
      this.toneOn = !this.toneOn;
      this.setToneTap(this.toneOn ? 1 : 0);
      this.emit({ playing: this.toneOn });
      return;
    }
    if (this.source === "file") {
      if (this.audio.paused) {
        if (this.audio.ended) this.audio.currentTime = 0;
        try {
          await this.ensureCtx();
          this.connectMedia();
          await this.audio.play();
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          this.emit({ error: audioMessage(err, "Couldn't play that file."), playing: false });
        }
      } else {
        this.audio.pause();
      }
      return;
    }
    if (this.url) await this.resumeFile();
    else await this.startTone();
  }

  seek(seconds: number) {
    if (this.source !== "file" || !Number.isFinite(this.audio.duration)) return;
    const next = Math.min(this.audio.duration, Math.max(0, seconds));
    this.audio.currentTime = next;
    this.snapTime = next;
    this.emit({ currentTime: next });
  }

  private emit(partial: Partial<Snapshot>) {
    if (this.dead) return;
    this.onChange(partial);
  }

  private async ensureCtx() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio isn't available in this browser.");
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.22;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -24;
      const out = ctx.createGain();
      out.gain.value = 1;
      out.connect(ctx.destination);
      const toneTap = ctx.createGain();
      toneTap.gain.value = 0;
      const toneSpeaker = ctx.createGain();
      toneSpeaker.gain.value = 0.42;
      toneTap.connect(analyser);
      toneTap.connect(toneSpeaker);
      toneSpeaker.connect(out);
      this.ctx = ctx;
      this.analyser = analyser;
      this.out = out;
      this.toneTap = toneTap;
      this.toneSpeaker = toneSpeaker;
      this.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.wave = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.wave.fill(128);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  private connectMedia() {
    if (!this.ctx || !this.analyser || !this.out) return;
    if (!this.mediaNode) this.mediaNode = this.ctx.createMediaElementSource(this.audio);
    try {
      this.mediaNode.disconnect();
    } catch {
      /* not connected yet */
    }
    this.mediaNode.connect(this.analyser);
    this.mediaNode.connect(this.out);
  }

  private disconnectMedia() {
    try {
      this.mediaNode?.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private spawnTone() {
    if (!this.ctx || !this.demoBuffer || !this.toneTap) return;
    const node = this.ctx.createBufferSource();
    node.buffer = this.demoBuffer;
    node.loop = true;
    node.connect(this.toneTap);
    node.start();
    this.demoNode = node;
  }

  private setToneTap(value: number) {
    if (!this.ctx || !this.toneTap) return;
    const now = this.ctx.currentTime;
    this.toneTap.gain.cancelScheduledValues(now);
    this.toneTap.gain.setTargetAtTime(value, now, 0.02);
  }

  private stopMicTracks() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private async requestMic(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "OverconstrainedError" || err.name === "NotSupportedError")
      ) {
        return navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    }
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    const next = w < 520 ? 36 : w < 1000 ? 56 : 72;
    this.setCount(next);
  }

  private setCount(n: number) {
    if (n === this.count && this.levels.length === n) return;
    const prev = this.levels;
    this.count = n;
    this.levels = new Float32Array(n);
    this.targets = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.disp = new Float32Array(n);
    this.peaks = new Float32Array(n);
    const copy = Math.min(prev.length, n);
    for (let i = 0; i < copy; i++) this.levels[i] = prev[i];
    this.rebuildFills();
  }

  private rebuildFills() {
    const fills: string[] = [];
    const glows: string[] = [];
    const n = Math.max(1, this.count);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const color = sample(this.theme.stops, 0.16 + t * 0.84);
      fills.push(rgb(color));
      glows.push(rgb(color, 0.34));
    }
    this.fills = fills;
    this.glows = glows;
    this.peakColor = rgb(this.theme.stops[3], 0.92);
  }

  private capturing() {
    if (this.source === "mic") return this.micSource !== null;
    if (this.source === "file") return !this.audio.paused && !this.audio.ended;
    if (this.source === "tone") return this.toneOn;
    return false;
  }

  private computeTargets() {
    const freq = this.freq;
    if (!freq) return;
    const bins = freq.length;
    const bars = this.count;
    const nyquist = (this.ctx?.sampleRate ?? 48000) / 2;
    const hzPer = nyquist / bins;
    const minBin = Math.max(1, Math.floor(32 / hzPer));
    const maxBin = Math.min(bins - 1, Math.max(minBin + bars, Math.floor(15000 / hzPer)));
    const logMin = Math.log(minBin);
    const logMax = Math.log(maxBin);
    for (let i = 0; i < bars; i++) {
      const start = Math.exp(logMin + ((logMax - logMin) * i) / bars);
      const end = Math.exp(logMin + ((logMax - logMin) * (i + 1)) / bars);
      const i0 = Math.max(minBin, Math.floor(start));
      const i1 = Math.min(maxBin, Math.max(i0 + 1, Math.ceil(end)));
      let sum = 0;
      for (let k = i0; k < i1; k++) sum += freq[k] ?? 0;
      const avg = sum / ((i1 - i0) * 255);
      const lifted = Math.max(0, avg - 0.04) / 0.96;
      this.targets[i] = Math.min(1.3, Math.pow(lifted, 0.76) * this.sensitivity);
    }
    this.scratch.set(this.targets);
    for (let i = 0; i < bars; i++) {
      const a = this.scratch[Math.max(0, i - 1)] ?? 0;
      const b = this.scratch[i] ?? 0;
      const c = this.scratch[Math.min(bars - 1, i + 1)] ?? 0;
      this.targets[i] = Math.min(1.3, a * 0.2 + b * 0.6 + c * 0.2);
    }
  }

  private tick(dt: number) {
    this.dt = dt;
    this.t += dt;
    const live = this.capturing();
    const mixTarget = live ? 0 : 1;
    this.idleMix += (mixTarget - this.idleMix) * (1 - Math.exp(-dt * 2.4));
    if (live && this.analyser && this.freq && this.wave) {
      this.analyser.getByteFrequencyData(this.freq);
      this.analyser.getByteTimeDomainData(this.wave);
      this.computeTargets();
    } else {
      this.targets.fill(0);
    }
    const attack = 1 - Math.exp(-dt * 18);
    const release = 1 - Math.exp(-dt * 5.2);
    let bassSum = 0;
    const bassN = Math.min(5, this.count);
    for (let i = 0; i < this.count; i++) {
      const target = this.targets[i] ?? 0;
      const level = this.levels[i] ?? 0;
      const k = target > level ? attack : release;
      const next = level + (target - level) * k;
      this.levels[i] = next;
      if (i < bassN) bassSum += next;
    }
    const bassTarget = bassN ? bassSum / bassN : 0;
    this.bass += (bassTarget - this.bass) * (1 - Math.exp(-dt * 7));
    const speed = (this.reduce ? 0.015 : 0.09) * (0.45 + this.bass * 0.8);
    this.rot += dt * speed;

    for (let i = 0; i < this.count; i++) {
      const idle = idleLevel(i, this.count, this.t);
      const mixed = (this.levels[i] ?? 0) * (1 - this.idleMix) + idle * this.idleMix;
      const v = Math.max(0, Math.min(1, mixed));
      this.disp[i] = v;
      const peak = this.peaks[i] ?? 0;
      this.peaks[i] = v >= peak ? v : Math.max(0, peak - dt * 0.28);
    }
  }

  private pollTransport(dt: number) {
    if (this.source !== "file") return;
    this.pollAcc += dt;
    if (this.pollAcc < 0.2) return;
    this.pollAcc = 0;
    const currentTime = this.audio.currentTime || 0;
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    if (Math.abs(currentTime - this.snapTime) > 0.04 || duration !== this.snapDur) {
      this.snapTime = currentTime;
      this.snapDur = duration;
      this.emit({ currentTime, duration });
    }
  }

  private draw() {
    const w = this.cssW;
    const h = this.cssH;
    if (w < 2 || h < 2) return;
    const ctx = this.g;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    paint(ctx, w, h, this.mode, {
      theme: this.theme,
      disp: this.disp,
      peaks: this.peaks,
      fills: this.fills,
      glows: this.glows,
      peak: this.peakColor,
      bass: this.bass,
      rot: this.rot,
      wave: this.wave,
      capturing: this.capturing(),
    });
  }
}
