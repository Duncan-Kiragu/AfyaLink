import { useEffect, useRef } from "react";

export type VoiceOrbMode = "idle" | "ready" | "listening" | "mock";

type Palette = {
  light: [number, number, number];
  mid: [number, number, number];
  deep: [number, number, number];
  glow: [number, number, number];
};

const PALETTES: Record<VoiceOrbMode, Palette> = {
  idle: {
    light: [230, 244, 255],
    mid: [96, 158, 238],
    deep: [10, 28, 62],
    glow: [130, 196, 255],
  },
  ready: {
    light: [220, 238, 255],
    mid: [64, 140, 230],
    deep: [6, 18, 42],
    glow: [110, 190, 255],
  },
  listening: {
    light: [230, 248, 255],
    mid: [70, 190, 240],
    deep: [4, 28, 48],
    glow: [140, 230, 255],
  },
  mock: {
    light: [255, 242, 216],
    mid: [214, 146, 82],
    deep: [42, 20, 8],
    glow: [255, 176, 88],
  },
};

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function paint(
  ctx: CanvasRenderingContext2D,
  size: number,
  time: number,
  mode: VoiceOrbMode,
  pointer: { x: number; y: number },
): void {
  const palette = PALETTES[mode];
  const listening = mode === "listening";
  const mock = mode === "mock";
  const pulse = listening ? 1 + Math.sin(time * 3.2) * 0.08 : 1 + Math.sin(time * 1.15) * 0.028;
  const cx = size / 2 + pointer.x * 14;
  const cy = size / 2 + pointer.y * 10;
  const radius = size * 0.236 * pulse;

  ctx.clearRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, size * (listening ? 0.58 : 0.54));
  glow.addColorStop(0, rgba(palette.glow, listening ? 0.74 : mock ? 0.56 : 0.48));
  glow.addColorStop(0.36, rgba(palette.glow, listening ? 0.24 : 0.16));
  glow.addColorStop(0.7, rgba(palette.glow, 0.05));
  glow.addColorStop(1, rgba(palette.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.2, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(palette.glow, listening ? 0.3 : mock ? 0.22 : 0.14);
  ctx.lineWidth = Math.max(5, size * 0.026);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  const body = ctx.createRadialGradient(
    cx - radius * 0.38,
    cy - radius * 0.42,
    radius * 0.05,
    cx + radius * 0.08,
    cy + radius * 0.2,
    radius * 1.12,
  );
  body.addColorStop(0, rgba(palette.light, 1));
  body.addColorStop(0.22, rgba(palette.mid, 1));
  body.addColorStop(0.62, rgba(palette.deep, 1));
  body.addColorStop(1, "#02040a");
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  const volume = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius);
  volume.addColorStop(0, "rgba(0, 0, 0, 0)");
  volume.addColorStop(0.72, "rgba(0, 0, 0, 0)");
  volume.addColorStop(1, "rgba(0, 0, 0, 0.5)");
  ctx.fillStyle = volume;
  ctx.fillRect(0, 0, size, size);

  if (mock) {
    const ember = ctx.createRadialGradient(cx + radius * 0.06, cy + radius * 0.14, 0, cx, cy, radius * 0.62);
    ember.addColorStop(0, rgba(palette.glow, 0.38));
    ember.addColorStop(1, rgba(palette.glow, 0));
    ctx.fillStyle = ember;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(cx, cy);
  for (let index = 0; index < 5; index += 1) {
    ctx.save();
    ctx.rotate(time * (0.34 + index * 0.09) + index * 1.12);
    ctx.scale(1, 0.26 + (index % 3) * 0.09);
    const drift = Math.sin(time * 0.45 + index) * radius * 0.08;
    const bandR = radius * (0.52 + index * 0.08);
    ctx.beginPath();
    ctx.arc(drift, 0, bandR, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(palette.glow, 0.14 - index * 0.012);
    ctx.lineWidth = Math.max(5, radius * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(drift, 0, bandR, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(palette.light, 0.22 - index * 0.02);
    ctx.lineWidth = Math.max(1.2, radius * 0.028);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  for (let index = 0; index < 3; index += 1) {
    const angle = time * (0.28 + index * 0.09) + index * 1.9;
    const bx = cx + Math.cos(angle) * radius * (0.18 + index * 0.05);
    const by = cy + Math.sin(angle * 0.84) * radius * (0.14 + index * 0.04);
    const caustic = ctx.createRadialGradient(bx, by, 0, bx, by, radius * (0.34 - index * 0.04));
    caustic.addColorStop(0, rgba(palette.light, 0.28 - index * 0.05));
    caustic.addColorStop(1, rgba(palette.light, 0));
    ctx.fillStyle = caustic;
    ctx.fillRect(0, 0, size, size);
  }

  const specular = ctx.createRadialGradient(
    cx - radius * 0.32,
    cy - radius * 0.4,
    0,
    cx - radius * 0.32,
    cy - radius * 0.4,
    radius * 0.4,
  );
  specular.addColorStop(0, "rgba(255, 255, 255, 0.88)");
  specular.addColorStop(0.32, "rgba(255, 255, 255, 0.16)");
  specular.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = specular;
  ctx.fillRect(0, 0, size, size);

  const rim = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
  rim.addColorStop(0, rgba(palette.light, 0));
  rim.addColorStop(0.7, rgba(palette.glow, 0));
  rim.addColorStop(0.86, rgba(palette.glow, listening ? 0.5 : mock ? 0.38 : 0.28));
  rim.addColorStop(0.94, rgba(palette.light, listening ? 0.78 : 0.62));
  rim.addColorStop(1, "rgba(255, 255, 255, 0.55)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(palette.light, listening ? 0.58 : 0.4);
  ctx.lineWidth = Math.max(1.6, size * 0.0065);
  ctx.stroke();

  for (let index = 0; index < 12; index += 1) {
    const speed = 0.22 + (index % 5) * 0.05;
    const angle = time * speed + index * 0.7;
    const orbitX = radius * (1.18 + (index % 4) * 0.09);
    const orbitY = orbitX * 0.36;
    const x = cx + Math.cos(angle) * orbitX;
    const y = cy + Math.sin(angle) * orbitY;
    ctx.fillStyle = rgba(palette.light, 0.18 + (index % 3) * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, index % 4 === 0 ? 1.8 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function VoiceOrb({ mode }: { mode: VoiceOrbMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const pointer = { x: 0, y: 0 };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let time = 0;
    let running = true;

    const resize = () => {
      const size = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX / window.innerWidth - 0.5;
      pointer.y = event.clientY / window.innerHeight - 0.5;
      wrap.style.setProperty("--ox", pointer.x.toFixed(3));
      wrap.style.setProperty("--oy", pointer.y.toFixed(3));
    };

    const tick = (now: number) => {
      if (!running) {
        return;
      }
      time = now / 1000;
      paint(ctx, wrap.clientWidth, time, modeRef.current, pointer);
      if (!reduced) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    resize();
    paint(ctx, wrap.clientWidth, 0, modeRef.current, pointer);
    if (!reduced) {
      frame = window.requestAnimationFrame(tick);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    window.addEventListener("pointermove", onPointer);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`voice-orb is-${mode}`} aria-hidden="true">
      <span className="voice-orb-orbit a" />
      <span className="voice-orb-orbit b" />
      <span className="voice-orb-orbit c" />
      <canvas ref={canvasRef} />
    </div>
  );
}
