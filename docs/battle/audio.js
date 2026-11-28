export function createBattleAudio(music,{victoryEffect}={}) {
  let enabled = true;
  let musicWanted = false;
  let context;
  let output;
  let noiseBuffer;
  const activeSources = new Set();

  music.volume = .85;

  function syncMusic() {
    if (!enabled || !musicWanted || document.hidden) {
      music.pause();
    } else if (music.paused) {
      music.play().catch(() => {});
    }
  }

  function setMusic(wanted) {
    musicWanted = wanted;
    syncMusic();
    if (!wanted) music.currentTime = 0;
  }

  function setEnabled(value) {
    enabled = value;
    if (!value) stopEffects();
    syncMusic();
  }

  function stopEffects() {
    for (const source of activeSources) source.stop();
    activeSources.clear();
  }

  function unlock() {
    if (!enabled || document.hidden) return;
    syncMusic();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    try {
      if (!context) {
        context = new AudioContext();
        output = context.createGain();
        output.gain.value = .72;
        output.connect(context.destination);
        noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate / 2), context.sampleRate);
        const samples = noiseBuffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      if (context.state !== "running") context.resume().catch(() => {});
    } catch {
      // The BGM and battle remain usable if Web Audio is unavailable.
    }
  }

  function envelope(start, duration, volume) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    gain.connect(output);
    return gain;
  }

  function schedule(source, start, duration) {
    activeSources.add(source);
    source.onended = () => activeSources.delete(source);
    source.start(start);
    source.stop(start + duration);
  }

  function tone(start, duration, from, to, volume, type = "sine") {
    const source = context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(from, start);
    source.frequency.exponentialRampToValueAtTime(to, start + duration);
    source.connect(envelope(start, duration, volume));
    schedule(source, start, duration);
  }

  function noise(start, duration, frequency, volume) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    source.connect(filter);
    filter.connect(envelope(start, duration, volume));
    schedule(source, start, duration);
  }

  const effects = {
    start: t => tone(t, .22, 260, 520, .12, "triangle"),
    heavyWarning: t => {
      tone(t, .20, 113, 90, .17, "triangle");
      tone(t + .14, .26, 145, 112, .14, "triangle");
    },
    fireWarning: t => {
      tone(t, .36, 355, 660, .11, "triangle");
      noise(t + .04, .32, 1550, .13);
    },
    yellow: t => noise(t, .16, 2700, .36),
    blue: t => {
      noise(t, .21, 1030, .31);
      tone(t, .20, 175, 83, .16, "triangle");
    },
    red: t => {
      noise(t, .39, 850, .32);
      tone(t, .27, 190, 72, .15, "triangle");
    },
    damage: t => tone(t, .20, 185, 103, .20, "triangle"),
    critical: t => {
      tone(t, .23, 252, 102, .23, "triangle");
      tone(t + .07, .21, 198, 88, .15, "triangle");
    },
    dodge: t => tone(t, .20, 940, 490, .10, "triangle"),
    guard: t => {
      tone(t, .26, 765, 731, .15);
      tone(t, .13, 1250, 1043, .09);
    },
    clash: t => {
      tone(t, .31, 1046, 795, .18, "triangle");
      noise(t, .22, 1950, .14);
    },
    recover: t => {
      tone(t, .12, 520, 530, .09);
      tone(t + .08, .18, 695, 705, .10);
    },
    victory: t => victoryEffect ? victoryEffect(t,{tone,noise}) : notes(t, [392, 494, 587, 784]),
    defeat: t => notes(t, [349, 294, 220, 147]),
    draw: t => notes(t, [349, 440, 392])
  };

  function notes(start, frequencies) {
    frequencies.forEach((frequency, index) => {
      const duration = index === frequencies.length - 1 ? .50 : .21;
      tone(start + index * .14, duration, frequency, frequency, .16, "triangle");
    });
  }

  function play(effect, delay = 0) {
    if (enabled && !document.hidden && context?.state === "running" && output && noiseBuffer) {
      effects[effect](context.currentTime + delay + .008);
    }
  }

  return { unlock, setEnabled, setMusic, syncMusic, play, stopEffects };
}
