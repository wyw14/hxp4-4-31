import { CRTRenderer } from './renderer';
import { AudioManager } from './audio';
import { KnobController, type KnobParam } from './knobs';
import {
  findBestSignalMatch,
  getSignalColor,
  WeatherSystem,
  lerp,
  type SignalMatch
} from './signal';
import type { Signal, SignalsData, TunerState, WeatherOffset } from './types';
import { generateCreepyChannels } from './seededRandom';

class Game {
  private renderer: CRTRenderer | null = null;
  private audioManager: AudioManager;
  private knobController: KnobController | null = null;
  private weatherSystem: WeatherSystem | null = null;

  private baseSignals: Signal[] = [];
  private seededSignals: Signal[] = [];
  private signalHueMap: Map<string, number> = new Map();

  private get signals(): Signal[] {
    return [...this.baseSignals, ...this.seededSignals];
  }

  private tuner: TunerState = { vhf: 100, uhf: 400, antenna: 180 };
  private weatherOffset: WeatherOffset = { vhfShift: 0, uhfShift: 0, antennaShift: 0 };
  private currentMatch: SignalMatch = { signal: null, strength: 0, vhfMatch: 0, uhfMatch: 0, antennaMatch: 0 };

  private smoothedStrength: number = 0;
  private smoothedDistortion: number = 1;
  private smoothedStatic: number = 1;
  private smoothedVhsTint: number = 0;
  private smoothedSignalColor: [number, number, number] = [0.08, 0.08, 0.1];

  private foundSignals: Set<string> = new Set();
  private signalOverlayActive: boolean = false;
  private binaryStream: string = '';
  private binaryTimer: number = 0;

  private elements: {
    signalFill: HTMLElement;
    signalOverlay: HTMLElement;
    signalName: HTMLElement;
    signalDescription: HTMLElement;
    binaryStream: HTMLElement;
    foundCount: HTMLElement;
    audioToggle: HTMLButtonElement;
    seedInput: HTMLInputElement;
    seedGenerateBtn: HTMLButtonElement;
    seedClearBtn: HTMLButtonElement;
    seedStatus: HTMLElement;
  };

  constructor() {
    this.audioManager = new AudioManager();
    this.elements = this.getElements();
  }

  private getElements() {
    const get = (id: string): HTMLElement => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Element not found: ${id}`);
      return el;
    };

    return {
      signalFill: get('signalFill'),
      signalOverlay: get('signalOverlay'),
      signalName: get('signalOverlay').querySelector('.signal-name') as HTMLElement,
      signalDescription: get('signalOverlay').querySelector('.signal-description') as HTMLElement,
      binaryStream: get('signalOverlay').querySelector('.binary-stream') as HTMLElement,
      foundCount: get('foundCount'),
      audioToggle: get('audioToggle') as HTMLButtonElement,
      seedInput: get('seedInput') as HTMLInputElement,
      seedGenerateBtn: get('seedGenerateBtn') as HTMLButtonElement,
      seedClearBtn: get('seedClearBtn') as HTMLButtonElement,
      seedStatus: get('seedStatus') as HTMLElement
    };
  }

  async init(): Promise<void> {
    try {
      const signalsData = await this.loadSignals();
      this.baseSignals = signalsData.signals;
      this.updateFoundCount();
      this.weatherSystem = new WeatherSystem(signalsData.weatherConfig);
    } catch (e) {
      console.error('Failed to load signals:', e);
      return;
    }

    const canvas = document.getElementById('glCanvas') as HTMLCanvasElement;
    this.renderer = new CRTRenderer(canvas);

    this.knobController = new KnobController([
      {
        param: 'vhf',
        element: document.getElementById('vhfKnob')!,
        valueElement: document.getElementById('vhfValue')!,
        min: 0,
        max: 250,
        initialValue: 100,
        sensitivity: 0.8
      },
      {
        param: 'uhf',
        element: document.getElementById('uhfKnob')!,
        valueElement: document.getElementById('uhfValue')!,
        min: 100,
        max: 800,
        initialValue: 400,
        sensitivity: 1.2
      },
      {
        param: 'antenna',
        element: document.getElementById('antennaKnob')!,
        valueElement: document.getElementById('antennaValue')!,
        min: 0,
        max: 360,
        initialValue: 180,
        sensitivity: 1.5
      }
    ], (param: KnobParam, value: number) => {
      this.tuner[param] = value;
    });

    this.elements.audioToggle.addEventListener('click', async () => {
      if (!this.audioManager['isInitialized']) {
        await this.audioManager.init();
      }
      this.audioManager.resume();
      const enabled = this.audioManager.toggle();
      this.elements.audioToggle.classList.toggle('active', enabled);
    });

    this.elements.seedGenerateBtn.addEventListener('click', () => {
      this.generateSeededChannels();
    });

    this.elements.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.generateSeededChannels();
      }
    });

    this.elements.seedClearBtn.addEventListener('click', () => {
      this.clearSeededChannels();
    });

    window.addEventListener('resize', () => {
      this.renderer?.resize();
    });

    void this.knobController;

    this.animate();
  }

  private async loadSignals(): Promise<SignalsData> {
    const response = await fetch('/signals.json');
    if (!response.ok) throw new Error('Failed to load signals');
    return response.json();
  }

  private generateSeededChannels(): void {
    const seed = this.elements.seedInput.value.trim();
    if (!seed) return;

    const generated = generateCreepyChannels(seed, 5);
    this.seededSignals = generated.signals;

    for (const [id, hue] of generated.hueMap) {
      this.signalHueMap.set(id, hue);
    }

    this.elements.seedStatus.textContent = `Seed: "${seed}" — ${this.seededSignals.length} channels`;
    this.elements.seedStatus.classList.add('active');
    this.elements.seedClearBtn.style.display = 'inline-block';
    this.elements.seedGenerateBtn.disabled = true;
    this.elements.seedInput.disabled = true;
    this.updateFoundCount();
  }

  private clearSeededChannels(): void {
    const seededIds = new Set(this.seededSignals.map(s => s.id));
    for (const id of seededIds) {
      this.signalHueMap.delete(id);
      this.foundSignals.delete(id);
    }
    this.seededSignals = [];

    this.elements.seedStatus.textContent = 'No active seed';
    this.elements.seedStatus.classList.remove('active');
    this.elements.seedClearBtn.style.display = 'none';
    this.elements.seedGenerateBtn.disabled = false;
    this.elements.seedInput.disabled = false;
    this.elements.seedInput.value = '';
    this.updateFoundCount();
  }

  private updateFoundCount(): void {
    const totalSignals = this.signals.length;
    const actualFound = Array.from(this.foundSignals).filter(id =>
      this.signals.some(s => s.id === id)
    ).length;
    this.elements.foundCount.textContent = `Signals found: ${actualFound} / ${totalSignals}`;
  }

  private getSignalBaseFreq(signalId: string): number {
    if (signalId === 'signal_01') return 220;
    if (signalId === 'signal_02') return 440;
    if (signalId === 'signal_03') return 660;
    if (signalId === 'signal_04') return 550;
    let hash = 0;
    for (let i = 0; i < signalId.length; i++) {
      hash = ((hash << 5) - hash) + signalId.charCodeAt(i);
      hash |= 0;
    }
    const freqs = [110, 146.83, 164.81, 196, 233.08, 277.18, 311.13, 349.23, 392, 466.16, 523.25, 587.33];
    return freqs[Math.abs(hash) % freqs.length];
  }

  private updateSignalMatch(): void {
    this.currentMatch = findBestSignalMatch(this.tuner, this.signals, this.weatherOffset);
  }

  private updateSmoothing(): void {
    const targetStrength = this.currentMatch.strength;
    this.smoothedStrength = lerp(this.smoothedStrength, targetStrength, 0.12);

    const targetDistortion = 1 - this.smoothedStrength * 0.85;
    this.smoothedDistortion = lerp(this.smoothedDistortion, targetDistortion, 0.1);

    const targetStatic = 1 - this.smoothedStrength * 0.7;
    this.smoothedStatic = lerp(this.smoothedStatic, targetStatic, 0.15);

    const targetVhsTint = this.smoothedStrength > 0.4 ? this.smoothedStrength : 0;
    this.smoothedVhsTint = lerp(this.smoothedVhsTint, targetVhsTint, 0.08);

    const targetColor = getSignalColor(this.currentMatch.signal, this.smoothedStrength, this.signalHueMap);
    this.smoothedSignalColor = [
      lerp(this.smoothedSignalColor[0], targetColor[0], 0.1),
      lerp(this.smoothedSignalColor[1], targetColor[1], 0.1),
      lerp(this.smoothedSignalColor[2], targetColor[2], 0.1)
    ];
  }

  private updateUI(): void {
    const fillPercent = Math.min(100, this.smoothedStrength * 100);
    this.elements.signalFill.style.width = `${fillPercent.toFixed(1)}%`;

    const shouldShowOverlay = this.smoothedStrength > 0.7;
    if (shouldShowOverlay !== this.signalOverlayActive) {
      this.signalOverlayActive = shouldShowOverlay;
      this.elements.signalOverlay.classList.toggle('active', shouldShowOverlay);

      if (shouldShowOverlay && this.currentMatch.signal) {
        const signal = this.currentMatch.signal;
        this.elements.signalName.textContent = signal.name;
        this.elements.signalDescription.textContent = signal.description;
        this.binaryStream = signal.fragmentPath;

        if (!this.foundSignals.has(signal.id)) {
          this.foundSignals.add(signal.id);
          this.updateFoundCount();
        }
      }
    }

    this.binaryTimer += 1;
    if (this.binaryTimer > 3 && this.signalOverlayActive) {
      this.binaryTimer = 0;
      const len = this.binaryStream.length;
      const extra = Math.floor(Math.random() * 12) + 4;
      let display = this.binaryStream;
      for (let i = 0; i < extra; i++) {
        display += Math.random() > 0.5 ? '1' : '0';
      }
      this.elements.binaryStream.textContent = display.substring(0, Math.min(len + extra, 80));
    }
  }

  private animate(): void {
    if (this.weatherSystem) {
      const weatherResult = this.weatherSystem.update();
      this.weatherOffset = weatherResult.offset;
      this.updateSignalMatch();
      this.updateSmoothing();

      if (this.renderer) {
        this.renderer.render({
          signalStrength: this.smoothedStrength,
          staticAmount: this.smoothedStatic,
          distortionAmount: this.smoothedDistortion,
          vhsTint: this.smoothedVhsTint,
          signalColor: this.smoothedSignalColor,
          rainIntensity: weatherResult.rainIntensity,
          flash: weatherResult.flash
        });
      }

      this.audioManager.setNoiseIntensity(this.smoothedStrength);
      if (this.currentMatch.signal && this.smoothedStrength > 0.3) {
        const baseFreq = this.getSignalBaseFreq(this.currentMatch.signal.id);
        const wobble = Math.sin(performance.now() * 0.008) * 15;
        this.audioManager.setSignalTone(baseFreq + wobble, this.smoothedStrength);
      } else {
        this.audioManager.setSignalTone(0, 0);
      }
      this.audioManager.update();

      this.updateUI();
    }

    requestAnimationFrame(() => this.animate());
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const game = new Game();
  await game.init();
});
