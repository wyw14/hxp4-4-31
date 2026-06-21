import type { Signal } from './types';

export class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashSeed(seed);
  }

  private hashSeed(seed: string): number {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0xffffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}

const CREEPY_NAMES_PREFIX = [
  'Ghost', 'Shadow', 'Void', 'Echo', 'Phantom', 'Wraith', 'Specter', 'Shade',
  'Crypt', 'Abyss', 'Mourn', 'Hollow', 'Dread', 'Raven', 'Ashen', 'Crimson',
  'Forsaken', 'Silent', 'Lost', 'Forgotten', 'Haunted', 'Cursed', 'Doomed',
  'Bleak', 'Grim', 'Somber', 'Eerie', 'Ominous', 'Sinister', 'Macabre'
];

const CREEPY_NAMES_SUFFIX = [
  'Frequency', 'Transmission', 'Broadcast', 'Signal', 'Channel', 'Wavelength',
  'Resonance', 'Vibration', 'Pulse', 'Emanation', 'Emission', 'Radiation',
  'Protocol', 'Archive', 'Record', 'Tape', 'Log', 'Transcript', 'Manifest',
  'Apparition', 'Presence', 'Entity', 'Message', 'Warning', 'Distress'
];

const CREEPY_DESCRIPTIONS = [
  'Do not answer. They are listening.',
  'The date is wrong. It has always been wrong.',
  'Count the seconds between the static.',
  'Someone else is tuning this frequency.',
  'The voice on the other end knows your name.',
  'This transmission was never supposed to be found.',
  'You can hear them breathing on the line.',
  'Turn off the radio. It is already too late.',
  'Numbers in sequence: do not memorize them.',
  'The signal originates from inside your house.',
  'They recorded this before you were born.',
  'Every time you tune in, they get closer.',
  'This is not a test. This has never been a test.',
  'The humming is coming from within the walls.',
  'Seven Knocks. Do not answer the door.',
  'You are not the first listener. You will not be the last.',
  'The static is trying to tell you something.',
  'Pay attention to what is NOT being said.',
  'This channel bleeds through from somewhere else.',
  'It remembers everyone who has found it.',
  'Time moves differently on this frequency.',
  'The person speaking sounds exactly like you.',
  'Three minutes. Then change the channel.',
  'Somewhere, a tape is playing this conversation.',
  'They already know you found this.'
];

const FRAGMENT_TEMPLATES = [
  '001101010111001010100111',
  '100010101110011010101110',
  '010110101001110100101011',
  '110101010111001011010010',
  '101001110010101101011100',
  '011010010111001010101101',
  '111001010101101001110101',
  '001010111001101010110011'
];

const COLOR_HUES = [
  0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9
];

export interface GeneratedChannels {
  signals: Signal[];
  hueMap: Map<string, number>;
}

export function generateCreepyChannels(seed: string, count: number = 5): GeneratedChannels {
  const rng = new SeededRandom(seed);
  const signals: Signal[] = [];
  const hueMap = new Map<string, number>();

  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let name = '';
    let attempts = 0;
    do {
      const prefix = rng.pick(CREEPY_NAMES_PREFIX);
      const suffix = rng.pick(CREEPY_NAMES_SUFFIX);
      name = attempts === 0
        ? `${prefix} ${suffix}`
        : `${prefix} ${suffix} #${rng.nextInt(2, 99)}`;
      attempts++;
    } while (usedNames.has(name) && attempts < 50);
    usedNames.add(name);

    const vhfCenter = rng.nextFloat(10, 240);
    const vhfWidth = rng.nextFloat(3, 10);
    const uhfCenter = rng.nextFloat(120, 780);
    const uhfWidth = rng.nextFloat(8, 25);
    const antennaCenter = rng.nextFloat(10, 350);
    const antennaWidth = rng.nextFloat(15, 45);

    const id = `seeded_${seed.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 8)}_${i.toString().padStart(2, '0')}`;
    const hue = rng.pick(COLOR_HUES) + rng.nextFloat(-0.02, 0.02);
    hueMap.set(id, hue);

    signals.push({
      id,
      name,
      fragmentPath: `#${rng.pick(FRAGMENT_TEMPLATES)}`,
      description: rng.pick(CREEPY_DESCRIPTIONS),
      intensity: rng.nextFloat(0.45, 0.92),
      weatherAffected: rng.next() > 0.35,
      vhfRange: [
        Math.max(0, vhfCenter - vhfWidth / 2),
        Math.min(250, vhfCenter + vhfWidth / 2)
      ] as [number, number],
      uhfRange: [
        Math.max(100, uhfCenter - uhfWidth / 2),
        Math.min(800, uhfCenter + uhfWidth / 2)
      ] as [number, number],
      antennaAngle: [
        Math.max(0, antennaCenter - antennaWidth / 2),
        Math.min(360, antennaCenter + antennaWidth / 2)
      ] as [number, number]
    });
  }

  return { signals, hueMap };
}
