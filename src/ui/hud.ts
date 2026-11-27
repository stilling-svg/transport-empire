/** Top bar with seed, map size and "New map". Plain DOM on top of the canvas. */
import type { GameMap, MapSize } from '../mapgen/types.ts';

export interface HudHandlers {
  onGenerate: (seed: string, size: MapSize) => void;
  onNewRandom: (size: MapSize) => void;
}

const SIZE_LABEL: Record<MapSize, string> = {
  small: 'Small 64×64',
  medium: 'Medium 128×128',
  large: 'Large 256×256',
};

export class Hud {
  private readonly seedInput: HTMLInputElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly info: HTMLElement;
  private readonly copyButton: HTMLButtonElement;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    root.innerHTML = `
      <div class="bar">
        <span class="title">Transport Empire</span>
        <label class="field">Seed
          <input id="seed" type="text" inputmode="text" autocomplete="off" spellcheck="false" />
        </label>
        <button id="go" type="button">Go</button>
        <select id="size" aria-label="Map size">
          <option value="small">${SIZE_LABEL.small}</option>
          <option value="medium">${SIZE_LABEL.medium}</option>
          <option value="large">${SIZE_LABEL.large}</option>
        </select>
        <button id="new" type="button" class="primary">New map</button>
        <button id="copy" type="button">Copy link</button>
      </div>
      <div class="info" id="info"></div>
    `;
    this.seedInput = root.querySelector('#seed')!;
    this.sizeSelect = root.querySelector('#size')!;
    this.info = root.querySelector('#info')!;
    this.copyButton = root.querySelector('#copy')!;

    const size = (): MapSize => this.sizeSelect.value as MapSize;
    const go = (): void => {
      const seed = this.seedInput.value.trim();
      if (seed) handlers.onGenerate(seed, size());
      else handlers.onNewRandom(size());
    };
    root.querySelector('#go')!.addEventListener('click', go);
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.seedInput.blur();
        go();
      }
    });
    root.querySelector('#new')!.addEventListener('click', () => handlers.onNewRandom(size()));
    this.sizeSelect.addEventListener('change', go);
    this.copyButton.addEventListener('click', () => void this.copyLink());
  }

  showMap(map: GameMap, ms: number): void {
    this.seedInput.value = map.seed;
    this.sizeSelect.value = map.settings.size;
    const retry = map.attempts > 1 ? ` · regenerated as “${map.usedSeed}”` : '';
    this.info.textContent =
      `${SIZE_LABEL[map.settings.size]} · ${map.towns.length} towns · ` +
      `${map.industries.length} industries · ${Math.round(ms)} ms${retry}`;
  }

  showError(message: string): void {
    this.info.textContent = message;
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.flash('Copied!');
    } catch {
      this.flash('Copy failed');
    }
  }

  private flash(text: string): void {
    const original = 'Copy link';
    this.copyButton.textContent = text;
    window.setTimeout(() => (this.copyButton.textContent = original), 1500);
  }
}
