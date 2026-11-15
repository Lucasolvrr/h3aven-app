// ASCII field: the artwork behind page headers and the sign-in screen.
//
// A grid of monospace glyphs drawn on a canvas. A slow noise field decides
// which glyphs are faintly visible, so they read as drifting bands that melt
// into the background. The pointer carries a soft light: glyphs near it
// brighten and keep a short afterglow as it moves on.

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const FONT_SIZE = 10;
const CELL_W = 6.4;
const CELL_H = 12;
const LEVELS = 12; // alpha is quantised so each level is one fillStyle
const BASE_ALPHA = 0.14; // brightest the resting pattern gets
const GLOW_ALPHA = 0.5; // brightest a glyph gets under the pointer
const GLOW_RADIUS = 150; // px
const FRAME_MS = 1000 / 30;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function hash(x, y) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x, y) => valueNoise(x, y) * 0.6 + valueNoise(x * 2.1 + 17, y * 2.1 + 9) * 0.28 + valueNoise(x * 4.3 + 5, y * 4.3 + 31) * 0.12;

const smoothstep = (lo, hi, x) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * Returns a canvas that animates while it is in the document.
 * Call `canvas.start()` after attaching it (safe to call repeatedly).
 */
export function createAsciiField({ seed = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ascii-field';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');

  let cols = 0;
  let rows = 0;
  let width = 0;
  let height = 0;
  let heat = new Float32Array(0); // pointer afterglow per cell
  let running = false;
  let lastFrame = 0;
  let detachedFrames = 0;
  const pointer = { x: -9999, y: -9999, active: false };
  const buckets = Array.from({ length: LEVELS }, () => []);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT_SIZE}px "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textBaseline = 'top';
    cols = Math.ceil(width / CELL_W);
    rows = Math.ceil(height / CELL_H);
    heat = new Float32Array(cols * rows);
    draw(performance.now());
  };

  function draw(now) {
    if (!cols) return;
    const t = reducedMotion.matches ? 0 : now / 1000;
    for (const bucket of buckets) bucket.length = 0;

    const px = pointer.x;
    const py = pointer.y;
    const radius2 = GLOW_RADIUS * GLOW_RADIUS;
    const slot = Math.floor(t * 1.6); // glyphs re-roll on a slow clock

    for (let row = 0; row < rows; row += 1) {
      const y = row * CELL_H;
      for (let col = 0; col < cols; col += 1) {
        const x = col * CELL_W;
        const index = row * cols + col;
        // Headings sit on the left: keep the glyphs quieter there.
        const calm = 0.3 + 0.7 * smoothstep(0.12, 0.6, x / width);

        // Long diagonal bands that drift slowly sideways.
        const n = fbm(col * 0.03 + row * 0.085 - t * 0.035 + seed, row * 0.11 - col * 0.012 + t * 0.012 + seed * 3.7);
        let alpha = smoothstep(0.5, 0.78, n) * BASE_ALPHA * calm;

        // Pointer light, with an afterglow that decays every frame.
        let glow = heat[index] * 0.9;
        if (pointer.active) {
          const dx = x - px;
          const dy = y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < radius2) {
            const f = 1 - d2 / radius2;
            glow = Math.max(glow, f * f);
          }
        }
        heat[index] = glow < 0.01 ? 0 : glow;
        // The light mostly lifts glyphs that are already there, and reveals a
        // sparse scatter of new ones where the field is empty.
        alpha += glow * GLOW_ALPHA * calm * (0.35 + 0.65 * smoothstep(0.3, 0.7, n + hash(col, row) * 0.25));

        if (alpha < 0.012) continue;
        const level = Math.min(LEVELS - 1, Math.floor((alpha / (BASE_ALPHA + GLOW_ALPHA)) * LEVELS * 1.6));
        const reroll = hash(col + 91, row + 13) < 0.22 ? slot + Math.floor(hash(col, row) * 7) : 0;
        buckets[level].push(x, y, GLYPHS.charCodeAt(Math.floor(hash(col * 7 + reroll, row * 13 + reroll) * GLYPHS.length)));
      }
    }

    ctx.clearRect(0, 0, width, height);
    for (let level = 0; level < LEVELS; level += 1) {
      const bucket = buckets[level];
      if (!bucket.length) continue;
      const alpha = ((level + 0.5) / (LEVELS * 1.6)) * (BASE_ALPHA + GLOW_ALPHA);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha).toFixed(3)})`;
      for (let i = 0; i < bucket.length; i += 3) ctx.fillText(String.fromCharCode(bucket[i + 2]), bucket[i], bucket[i + 1]);
    }
  }

  const hasHeat = () => pointer.active || heat.some((value) => value > 0);

  const frame = (now) => {
    if (!running) return;
    if (!canvas.isConnected) {
      // Views are rebuilt often; give the canvas a moment to be re-attached.
      detachedFrames += 1;
      if (detachedFrames > 90) return stop();
    } else {
      detachedFrames = 0;
      const still = reducedMotion.matches && !hasHeat();
      if (!document.hidden && !still && now - lastFrame >= FRAME_MS) {
        lastFrame = now;
        if (!cols) resize();
        draw(now);
      }
    }
    requestAnimationFrame(frame);
  };

  const onPointerMove = (event) => {
    if (event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointer.active = x > -GLOW_RADIUS && y > -GLOW_RADIUS && x < rect.width + GLOW_RADIUS && y < rect.height + GLOW_RADIUS;
    pointer.x = x;
    pointer.y = y;
  };
  const onPointerLeave = () => {
    pointer.active = false;
  };

  const observer = new ResizeObserver(resize);

  function stop() {
    running = false;
    observer.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerleave', onPointerLeave);
  }

  canvas.start = () => {
    if (running) return;
    running = true;
    detachedFrames = 0;
    observer.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    requestAnimationFrame(frame);
  };

  return canvas;
}

// One field is shared by every page header, so the pattern keeps drifting
// (instead of restarting) as views are rebuilt.
let shared = null;
export function heroField() {
  if (!shared) shared = createAsciiField();
  shared.start();
  return shared;
}
