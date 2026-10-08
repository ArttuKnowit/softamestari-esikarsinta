const COLORS = ["#40798c", "#70a9a1", "#9ec1a3", "#cfe0c3", "#f2c94c", "#e07a5f", "#2f9e44"];

// Fires two confetti cannons from the bottom corners; the canvas removes itself when done.
export function launchConfetti({ count = 180, duration = 3800 } = {}) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3000";
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  document.body.append(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const speed = Math.max(10, height / 45);
  const particles = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = ((fromLeft ? -60 : -120) + (Math.random() - 0.5) * 40) * (Math.PI / 180);
    const power = speed * (0.6 + Math.random() * 0.8);
    return {
      x: fromLeft ? 0 : width,
      y: height,
      vx: Math.cos(angle) * power,
      vy: Math.sin(angle) * power,
      size: 6 + Math.random() * 6,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });

  const startTime = performance.now();
  let last = startTime;

  function frame(now) {
    const elapsed = now - startTime;
    const step = Math.min((now - last) / 16.67, 3); // normalised to 60 fps
    last = now;

    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(1, (duration - elapsed) / 800);
    for (const p of particles) {
      p.vy += 0.25 * step;
      p.vx *= 0.992 ** step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.rotation += p.spin * step;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
