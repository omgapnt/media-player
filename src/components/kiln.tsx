import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Maximize,
  Mic,
  Minimize,
  Music,
  Orbit,
  Pause,
  Play,
  SlidersHorizontal,
  Square,
  SunMedium,
  UnfoldVertical,
  Waves,
} from "lucide-react";
import { clsx } from "clsx";
import {
  VizEngine,
  isMode,
  modes,
  themeById,
  themes,
  type Mode,
  type Snapshot,
  type Source,
  type ThemeId,
} from "@/lib/viz";

const initialSnap: Snapshot = {
  source: "idle",
  playing: false,
  fileName: null,
  currentTime: 0,
  duration: 0,
  error: null,
};

const modeIcon = {
  bars: AudioLines,
  mirror: UnfoldVertical,
  radial: SunMedium,
  rings: Orbit,
} as const;

const modeLabel: Record<Mode, string> = {
  bars: "Bars",
  mirror: "Mirror",
  radial: "Radial",
  rings: "Rings",
};

function readMode(): Mode {
  const stored = localStorage.getItem("kiln-mode");
  return stored && isMode(stored) ? stored : "bars";
}

function readTheme(): ThemeId {
  const stored = localStorage.getItem("kiln-theme");
  return stored && themes.some((theme) => theme.id === stored) ? (stored as ThemeId) : "ember";
}

function readSens(): number {
  const stored = Number(localStorage.getItem("kiln-sens"));
  return Number.isFinite(stored) && stored >= 0.4 && stored <= 2.6 ? stored : 1.2;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sourceLabel(source: Source, fileName: string | null, mode: Mode, themeName: string): string {
  if (source === "file" && fileName) return fileName;
  if (source === "mic") return "Microphone";
  if (source === "tone") return "Room tone";
  return `${modeLabel[mode]} · ${themeName}`;
}

export function Kiln() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<VizEngine | null>(null);
  const pinned = useRef(false);
  const liveRef = useRef(false);
  const timer = useRef(0);
  const dragDepth = useRef(0);

  const [snap, setSnap] = useState<Snapshot>(initialSnap);
  const [mode, setMode] = useState<Mode>("bars");
  const [themeId, setThemeId] = useState<ThemeId>("ember");
  const [sens, setSens] = useState(1.2);
  const [chromeOn, setChromeOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const theme = themeById(themeId);
  const live = snap.source === "mic" || snap.playing;
  liveRef.current = live;

  const armHide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!pinned.current && liveRef.current) {
      timer.current = window.setTimeout(() => setChromeOn(false), 3200);
    }
  }, []);

  const reveal = useCallback(() => {
    setChromeOn(true);
    armHide();
  }, [armHide]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const storedMode = readMode();
    const storedTheme = readTheme();
    const storedSens = readSens();
    setMode(storedMode);
    setThemeId(storedTheme);
    setSens(storedSens);
    const engine = new VizEngine(canvas, (partial) => {
      setSnap((current) => ({ ...current, ...partial }));
    });
    engine.setMode(storedMode);
    engine.setTheme(storedTheme);
    engine.setSensitivity(storedSens);
    engine.start();
    engineRef.current = engine;
    return () => {
      window.clearTimeout(timer.current);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMode(mode);
    localStorage.setItem("kiln-mode", mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setTheme(themeId);
    localStorage.setItem("kiln-theme", themeId);
  }, [themeId]);

  useEffect(() => {
    engineRef.current?.setSensitivity(sens);
    localStorage.setItem("kiln-sens", String(sens));
  }, [sens]);

  useEffect(() => {
    if (live) armHide();
    else {
      window.clearTimeout(timer.current);
      setChromeOn(true);
    }
  }, [live, armHide]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        void engineRef.current?.togglePlay();
        reveal();
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === "m" || event.key === "M") {
        setMode((current) => modes[(modes.indexOf(current) + 1) % modes.length]);
        reveal();
      } else if (event.key === "t" || event.key === "T") {
        setThemeId((current) => {
          const index = themes.findIndex((item) => item.id === current);
          return themes[(index + 1) % themes.length].id;
        });
        reveal();
      } else if (event.key === "[" || event.key === "]") {
        setSens((current) =>
          Math.min(2.4, Math.max(0.5, current + (event.key === "]" ? 0.08 : -0.08))),
        );
        reveal();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const engine = engineRef.current;
        if (!engine || snap.source !== "file") return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 5 : -5;
        engine.seek(snap.currentTime + delta);
        reveal();
      } else if (event.key >= "1" && event.key <= "4") {
        setMode(modes[Number(event.key) - 1]);
        reveal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reveal, snap.currentTime, snap.source]);

  async function toggleFullscreen() {
    const node = rootRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      /* Fullscreen can be blocked in an embedded preview. */
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void engineRef.current?.openFile(file);
    reveal();
  }

  function onTrack() {
    if (snap.fileName && snap.source !== "file") void engineRef.current?.resumeFile();
    else fileRef.current?.click();
    reveal();
  }

  const showInvite = snap.source === "idle";
  const progress =
    snap.duration > 0 ? Math.min(100, Math.max(0, (snap.currentTime / snap.duration) * 100)) : 0;
  const transportLabel =
    snap.source === "mic" ? "Stop microphone" : snap.playing ? "Pause" : "Play";
  const fileButtonLabel =
    snap.source === "file" ? "Replace audio file" : snap.fileName ? "Back to track" : "Open audio file";

  return (
    <div
      ref={rootRef}
      className={clsx(
        "stage relative h-dvh w-full overflow-hidden select-none",
        !chromeOn && live && "cursor-none",
      )}
      style={{ background: theme.bg }}
      onPointerMove={reveal}
      onPointerDown={reveal}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void engineRef.current?.openFile(file);
      }}
    >
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full touch-none" aria-hidden="true" />
      </div>

      <div
        className={clsx(
          "fade pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 pb-40",
          showInvite ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="invite-scrim max-w-md rounded-full px-8 py-8 text-center">
          <p className="font-serif text-4xl text-balance italic sm:text-5xl">Drop a track</p>
          <p className="mt-3 text-pretty text-muted">
            Microphone, room tone, or a file. The room answers.
          </p>
          <p className="mt-4 hidden text-xs tracking-widest text-muted uppercase sm:block">
            Space plays · F fills the screen
          </p>
        </div>
      </div>

      <header
        className={clsx(
          "fade absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-5 pt-5",
          chromeOn ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onPointerEnter={() => {
          pinned.current = true;
          window.clearTimeout(timer.current);
        }}
        onPointerLeave={() => {
          pinned.current = false;
          armHide();
        }}
      >
        <div className="min-w-0">
          <h1 className="font-serif text-3xl leading-none italic">Kiln</h1>
          <p
            className={clsx(
              "mt-2 max-w-xs truncate text-xs text-muted",
              snap.source === "file" ? "tracking-normal" : "tracking-widest uppercase",
            )}
            title={snap.fileName ?? undefined}
          >
            {sourceLabel(snap.source, snap.fileName, mode, theme.name)}
            {snap.source === "mic" && (
              <span className="live-dot ml-2 inline-block size-1.5 rounded-full bg-ember align-middle" />
            )}
          </p>
          {snap.error && (
            <p role="alert" className="mt-2 max-w-xs text-sm text-ember">
              {snap.error}
            </p>
          )}
        </div>
      </header>

      <footer
        className={clsx(
          "fade safe-bottom absolute inset-x-0 bottom-0 z-20 px-3",
          chromeOn ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onPointerEnter={() => {
          pinned.current = true;
          window.clearTimeout(timer.current);
        }}
        onPointerLeave={() => {
          pinned.current = false;
          armHide();
        }}
      >
        <div
          role="toolbar"
          aria-label="Visualizer controls"
          className="mx-auto flex w-full max-w-5xl flex-col gap-1 rounded-dock border border-line bg-glass/80 px-2 py-2 shadow-2xl backdrop-blur-xl"
        >
          {snap.source === "file" && (
            <div className="flex items-center gap-3 px-2">
              <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">
                {formatTime(snap.currentTime)}
              </span>
              <input
                className="range seek min-w-0 flex-1"
                type="range"
                min={0}
                max={snap.duration || 0}
                step={0.01}
                value={Math.min(snap.currentTime, snap.duration || 0)}
                aria-label="Seek"
                style={{ "--pct": `${progress}%` } as React.CSSProperties}
                onChange={(event) => engineRef.current?.seek(Number(event.target.value))}
              />
              <span className="w-10 shrink-0 text-xs text-muted tabular-nums">
                {formatTime(snap.duration)}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-1">
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-fg text-bg"
              aria-label={transportLabel}
              onClick={() => void engineRef.current?.togglePlay()}
            >
              {snap.source === "mic" ? (
                <Square className="size-4" strokeWidth={1.75} />
              ) : snap.playing ? (
                <Pause className="size-5" strokeWidth={1.75} />
              ) : (
                <Play className="size-5" strokeWidth={1.75} />
              )}
            </button>

            <button
              type="button"
              aria-pressed={snap.source === "mic"}
              aria-label="Microphone"
              className={clsx(
                "flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm",
                snap.source === "mic" ? "bg-fg text-bg" : "text-muted hover:text-fg",
              )}
              onClick={() => {
                if (snap.source === "mic") engineRef.current?.stopMic();
                else void engineRef.current?.startMic();
              }}
            >
              <Mic className="size-4" strokeWidth={1.75} />
              Mic
            </button>
            <button
              type="button"
              aria-pressed={snap.source === "file"}
              aria-label={fileButtonLabel}
              className={clsx(
                "flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm",
                snap.source === "file" ? "bg-fg text-bg" : "text-muted hover:text-fg",
              )}
              onClick={onTrack}
            >
              <Music className="size-4" strokeWidth={1.75} />
              Track
            </button>
            <button
              type="button"
              aria-pressed={snap.source === "tone"}
              aria-label="Room tone"
              className={clsx(
                "flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm",
                snap.source === "tone" ? "bg-fg text-bg" : "text-muted hover:text-fg",
              )}
              onClick={() => void engineRef.current?.startTone()}
            >
              <Waves className="size-4" strokeWidth={1.75} />
              Tone
            </button>

            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />

            <div className="flex items-center" role="group" aria-label="Mode">
              {modes.map((id) => {
                const Icon = modeIcon[id];
                const active = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    aria-label={modeLabel[id]}
                    title={modeLabel[id]}
                    className={clsx(
                      "grid size-11 shrink-0 place-items-center rounded-full",
                      active ? "bg-fg text-bg" : "text-muted hover:text-fg",
                    )}
                    onClick={() => setMode(id)}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>

            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />

            <div className="flex items-center" role="group" aria-label="Color theme">
              {themes.map((item) => {
                const active = item.id === themeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${item.name} theme`}
                    title={item.name}
                    className="grid size-11 shrink-0 place-items-center rounded-full"
                    onClick={() => setThemeId(item.id)}
                  >
                    <span
                      className={clsx(
                        "size-3.5 rounded-full",
                        active && "outline outline-2 outline-offset-2 outline-fg",
                      )}
                      style={{ backgroundColor: item.swatch }}
                    />
                  </button>
                );
              })}
            </div>

            <label className="flex h-11 shrink-0 items-center gap-2 px-2">
              <SlidersHorizontal className="size-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
              <input
                className="range sens"
                type="range"
                min={0.5}
                max={2.4}
                step={0.01}
                value={sens}
                aria-label="Sensitivity"
                onChange={(event) => setSens(Number(event.target.value))}
              />
            </label>

            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-fg"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-pressed={fullscreen}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? (
                <Minimize className="size-4" strokeWidth={1.75} />
              ) : (
                <Maximize className="size-4" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      </footer>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-dock border border-dashed border-fg/40 bg-bg/50">
          <p className="font-serif text-4xl italic">Drop to play</p>
        </div>
      )}

      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm"
        onChange={onFile}
      />
    </div>
  );
}
