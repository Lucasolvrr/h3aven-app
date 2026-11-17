// A short confetti burst from a point on screen, on a throwaway canvas.
//   confetti({ x, y })  -> resolves when the last piece has fallen (about 1.8s)
// Skipped (resolves at once) when the system asks for reduced motion.

import { FOLDER_COLORS } from '../lib/colors.js';

const COLORS = FOLDER_COLORS.filter((c) => c.id !== 'stone').map((c) => `hsl(${c.h} ${Math.min(90, c.s + 30)}% 62%)`).concat('#f2f2f2');

export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 140, duration = 1800 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();

  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '600' });
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Each piece: launched up and out in a fan, then gravity, drag and a flutter.
  const pieces = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 7 + Math.random() * 9;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 5,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.35,
      flutter: Math.random() * Math.PI * 2,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < 0.25,
    };
  });

  return new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    const frame = (now) => {
      const dt = Math.min(2.5, (now - last) / 16.67); // in 60fps frames, capped after a stall
      last = now;
      const t = (now - start) / duration;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of pieces) {
        p.vx *= 0.985 ** dt;
        p.vy = p.vy * 0.985 ** dt + 0.32 * dt;
        p.flutter += 0.12 * dt;
        p.x += (p.vx + Math.sin(p.flutter) * 0.6) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.65) / 0.35); // fade over the last third
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // the cosine squash makes a flat piece look like it turns in the air
          ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.cos(p.flutter), p.w, p.h * Math.cos(p.flutter));
        }
        ctx.restore();
      }
      if (t < 1) requestAnimationFrame(frame);
      else {
        canvas.remove();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}
