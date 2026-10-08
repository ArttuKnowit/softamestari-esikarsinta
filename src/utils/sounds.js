// Sounds are synthesised with Web Audio, so no audio files are needed.
let context = null;

function audio() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return null;
  context ??= new AudioContextClass();
  if (context.state === "suspended") context.resume();
  return context;
}

function tone(ctx, { frequency, start = 0, duration, volume = 0.15, type = "sine" }) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const begin = ctx.currentTime + start;
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, begin);
  gain.gain.exponentialRampToValueAtTime(volume, begin + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, begin + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(begin);
  oscillator.stop(begin + duration + 0.05);
}

function play(build) {
  try {
    const ctx = audio();
    if (ctx) build(ctx);
  } catch {
    // Audio is a nicety; never let it break the UI.
  }
}

// Short bell-like "cling": a high note with two quieter overtones.
export function playCling() {
  play((ctx) => {
    tone(ctx, { frequency: 1568, duration: 0.55, volume: 0.18 });
    tone(ctx, { frequency: 2349, duration: 0.4, volume: 0.09 });
    tone(ctx, { frequency: 3136, duration: 0.25, volume: 0.05 });
  });
}

// Rising arpeggio and a held major chord, about two seconds in total.
export function playJingle() {
  play((ctx) => {
    const arpeggio = [
      [523.25, 0],
      [659.25, 0.15],
      [783.99, 0.3],
      [1046.5, 0.45],
      [783.99, 0.75],
      [1046.5, 0.9],
    ];
    for (const [frequency, start] of arpeggio) {
      tone(ctx, { frequency, start, duration: 0.3, volume: 0.16, type: "triangle" });
    }
    for (const frequency of [523.25, 659.25, 783.99, 1046.5]) {
      tone(ctx, { frequency, start: 1.05, duration: 0.95, volume: 0.1, type: "triangle" });
    }
  });
}
