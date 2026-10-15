/**
 * Synthesizes a loud, crisp, and resonant notification chime using Web Audio API.
 * Engineered to cut through room background noise cleanly without clipping.
 */
export function playNotificationChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Master Volume Gain node (loud, clear, no distortion)
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.75, now);
    masterGain.connect(ctx.destination);

    // Chime Note 1: E5 (659.25 Hz) with gentle harmonic overtone (1318.5 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle'; // Richer harmonics than pure sine
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.45);

    // Chime Note 2: B5 (987.77 Hz) slightly delayed (+120ms) for a distinct attention-grabbing melodic lift
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.12);
    gain2.gain.setValueAtTime(0.85, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.85);

    // Chime Note 3: High Sparkle E6 (1318.5 Hz) for high-frequency presence (+220ms)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1318.5, now + 0.22);
    gain3.gain.setValueAtTime(0.4, now + 0.22);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc3.connect(gain3);
    gain3.connect(masterGain);
    osc3.start(now + 0.22);
    osc3.stop(now + 0.9);
  } catch {
    // Audio autoplay restrictions or blocked context
  }
}


