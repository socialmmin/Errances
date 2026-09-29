// Two-tone chime synthesized via Web Audio API — no external audio asset to
// manage/deploy, and it can't 404 or fail to load on a slow connection.
export function playLeadAlertSound() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const now = ctx.currentTime;
    const notes = [880, 1318.5]; // A5, E6
    notes.forEach((freq, i) => {
      const start = now + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.32, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // Autoplay/permission restrictions — fail silently, the visual alert still shows.
  }
}
