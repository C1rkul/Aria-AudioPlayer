<script>
  import { onMount, onDestroy } from 'svelte';
  import { settings } from '../stores/settings.js';

  export let active = true;
  let wasActive = true;
  let canvas;
  let ctx;
  let raf;

  let width = 0;
  let height = 0;

  let type = 'none';
  let accent = '#7c5cff';
  let currentBackground = 'none';

  let particles = [];
  let balls = [];
  let drops = [];
  let blobs = [];

  let matrixFontSize = 14;
  let matrixActive = [];
  let matrixLastRow = [];

  $: particleCount = $settings.particleCount ?? 60;
  $: babbleCount = $settings.babbleCount ?? 22;
  $: auroraCount = $settings.auroraCount ?? 5;
  $: matrixSpeed = $settings.matrixSpeed ?? 1;
  $: matrixDensity = $settings.matrixDensity ?? 100;

  // Количество элементов меняем «на лету», не пересоздавая уже летающие
  $: if (ctx) { particleCount, babbleCount, auroraCount, matrixDensity, adjustCounts(); }
  let auroraTime = 0;

  const matrixChars =
    'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';

  $: accentValue = $settings.customAccent || '#7c5cff';
  $: if (accentValue !== accent) {
    accent = accentValue;
  }

  $: if (canvas && ($settings.background || 'none') !== currentBackground) {
    currentBackground = $settings.background || 'none';
    type = currentBackground;
    restart();
  }

  $: if (canvas && active !== wasActive) {
    wasActive = active;
    if (active) restart(); else cancelAnimationFrame(raf);
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    currentBackground = $settings.background || 'none';
    type = currentBackground;
    accent = $settings.customAccent || '#7c5cff';

    resize();
    window.addEventListener('resize', resize);
    restart();
  });

  onDestroy(() => {
    window.removeEventListener('resize', resize);
    cancelAnimationFrame(raf);
  });

  function restart() {
    cancelAnimationFrame(raf);
    initEffects();
    loop();
  }

  function resize() {
    if (!canvas) return;

    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;

    initEffects();
  }

  const makeParticle = () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.45,
    vy: (Math.random() - 0.5) * 0.45,
    r: Math.random() * 2 + 1
  });
  const makeBall = () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.7,
    vy: (Math.random() - 0.5) * 0.7,
    r: Math.random() * 70 + 30,
    hue: Math.random() * 360
  });
  const makeBlob = (i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: Math.random() * 180 + 160,
    hue: (i * 67) % 360,
    phase: Math.random() * Math.PI * 2
  });

  function resizeList(list, target, make) {
    if (list.length > target) return list.slice(0, target);
    const out = list.slice();
    while (out.length < target) out.push(make(out.length));
    return out;
  }

  function adjustCounts() {
    if (!ctx || !width) return;
    if (type === 'particle') particles = resizeList(particles, particleCount, makeParticle);
    if (type === 'babble') balls = resizeList(balls, babbleCount, makeBall);
    if (type === 'aurora') blobs = resizeList(blobs, auroraCount, makeBlob);
    if (type === 'matrix') {
      matrixActive = drops.map((_, i) => hashCol(i) < matrixDensity / 100);
    }
  }

  // стабильный «случайный» порядок колонок, чтобы плотность менялась плавно
  function hashCol(i) {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function initEffects() {
    if (!ctx) return;

    if (type === 'particle') particles = Array.from({ length: particleCount }, makeParticle);
    if (type === 'babble') balls = Array.from({ length: babbleCount }, makeBall);

    if (type === 'matrix') {
      const cols = Math.ceil(width / matrixFontSize);
      drops = Array.from({ length: cols }, () => Math.random() * -height / matrixFontSize);
      matrixLastRow = drops.map((d) => Math.floor(d));
      matrixActive = drops.map((_, i) => hashCol(i) < matrixDensity / 100);
    }

    if (type === 'aurora') blobs = Array.from({ length: auroraCount }, (_, i) => makeBlob(i));
  }

  function loop() {
    if (!ctx) return;

    if (type === 'none') {
      ctx.clearRect(0, 0, width, height);
      raf = requestAnimationFrame(loop);
      return;
    }

    if (type === 'particle') drawParticle();
    if (type === 'babble') drawBabble();
    if (type === 'matrix') drawMatrix();
    if (type === 'aurora') drawAurora();

    raf = requestAnimationFrame(loop);
  }

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full =
      clean.length === 3
        ? clean
            .split('')
            .map((c) => c + c)
            .join('')
        : clean;

    const num = parseInt(full, 16);

    if (isNaN(num)) {
      return { r: 124, g: 92, b: 255 };
    }

    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function drawParticle() {
    const rgb = hexToRgb(accent);

    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`;
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 130) {
          const alpha = (1 - dist / 130) * 0.32;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  function drawBabble() {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    for (const ball of balls) {
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.x < -ball.r) ball.x = width + ball.r;
      if (ball.x > width + ball.r) ball.x = -ball.r;
      if (ball.y < -ball.r) ball.y = height + ball.r;
      if (ball.y > height + ball.r) ball.y = -ball.r;

      ball.hue = (ball.hue + 0.2) % 360;

      const gradient = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r);
      gradient.addColorStop(0, `hsla(${ball.hue}, 100%, 65%, 0.34)`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawMatrix() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(0, 0, width, height);

    ctx.font = `${matrixFontSize}px monospace`;
    ctx.fillStyle = (() => { const c = hexToRgb(accent); return `rgba(${c.r}, ${c.g}, ${c.b}, 0.86)`; })();

    for (let i = 0; i < drops.length; i++) {
      if (!matrixActive[i]) continue;

      drops[i] += matrixSpeed;
      const row = Math.floor(drops[i]);
      const x = i * matrixFontSize;

      // рисуем каждую пройденную строку, чтобы при высокой скорости не было дыр
      for (let r = matrixLastRow[i] + 1; r <= row; r++) {
        const char = matrixChars[Math.floor(Math.random() * matrixChars.length)];
        ctx.fillText(char, x, r * matrixFontSize);
      }
      matrixLastRow[i] = row;

      if (row * matrixFontSize > height && Math.random() > 0.975) {
        drops[i] = 0;
        matrixLastRow[i] = 0;
      }
    }
  }

  function drawAurora() {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    auroraTime += 0.005;

    for (const blob of blobs) {
      blob.x += blob.vx + Math.sin(auroraTime + blob.phase) * 0.25;
      blob.y += blob.vy + Math.cos(auroraTime + blob.phase) * 0.2;

      if (blob.x < -blob.r) blob.x = width + blob.r;
      if (blob.x > width + blob.r) blob.x = -blob.r;
      if (blob.y < -blob.r) blob.y = height + blob.r;
      if (blob.y > height + blob.r) blob.y = -blob.r;

      blob.hue = (blob.hue + 0.12) % 360;

      const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
      gradient.addColorStop(0, `hsla(${blob.hue}, 90%, 62%, 0.22)`);
      gradient.addColorStop(0.45, `hsla(${(blob.hue + 40) % 360}, 90%, 55%, 0.12)`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }
</script>

<canvas
  bind:this={canvas}
  class="fx"
  class:hidden={type === 'none'}
></canvas>

<style>
  .fx {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 0;
  }

  .hidden {
    display: none;
  }
</style>