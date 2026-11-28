/** Top bar: map controls (seed, size, New map) and time controls. Plain DOM over the canvas. */
import type { GameMap, MapSize } from '../mapgen/types.ts';
import { formatDate } from '../sim/calendar.ts';

export { formatDate };

export interface HudHandlers {
  onGenerate: (seed: string, size: MapSize) => void;
  onNewRandom: (size: MapSize) => void;
  onSpeed: (speed: number) => void;
  /** +1 turns the map clockwise, -1 anticlockwise. */
  onRotate: (dir: 1 | -1) => void;
  /** Tapping the money opens the finances. */
  onMoney: () => void;
  /** Tapping the news button or a headline opens the news archive. */
  onNews: () => void;
}

const SIZE_LABEL: Record<MapSize, string> = {
  small: 'Small 64×64',
  medium: 'Medium 128×128',
  large: 'Large 256×256',
};

const SPEEDS = [0, 1, 2, 4] as const;
export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString('en-US')}`;
}

export class Hud {
  private readonly seedInput: HTMLInputElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly info: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly dateEl: HTMLElement;
  private readonly moneyEl: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly headline: HTMLButtonElement;
  private headlineTimer = 0;
  private readonly speedButtons: HTMLButtonElement[];
  private mapInfo = '';
  private lastDate = '';
  private lastMoney = NaN;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    root.innerHTML = `
      <div class="bar">
        <span class="title">Transport Empire</span>
        <span class="date" id="date"></span>
        <span class="speeds" role="group" aria-label="Game speed">
          ${SPEEDS.map((s) => `<button type="button" class="speed" data-speed="${s}">${s === 0 ? '❚❚' : `${s}x`}</button>`).join('')}
        </span>
        <span class="rotate" role="group" aria-label="Rotate map">
          <button type="button" id="rot-left" aria-label="Rotate map anticlockwise">⟲</button>
          <button type="button" id="rot-right" aria-label="Rotate map clockwise">⟳</button>
        </span>
        <button type="button" class="money" id="money" aria-label="Finances"></button>
        <button type="button" class="newsbtn" id="newsbtn" aria-label="News">📰<span class="badge" id="badge" hidden></span></button>
      </div>
      <button type="button" class="headline" id="headline" hidden></button>
      <details class="mapbar">
        <summary>Map</summary>
        <div class="bar">
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
      </details>
    `;
    this.seedInput = root.querySelector('#seed')!;
    this.sizeSelect = root.querySelector('#size')!;
    this.info = root.querySelector('#info')!;
    this.copyButton = root.querySelector('#copy')!;
    this.dateEl = root.querySelector('#date')!;
    this.moneyEl = root.querySelector('#money')!;
    this.moneyEl.addEventListener('click', handlers.onMoney);
    this.badge = root.querySelector('#badge')!;
    this.headline = root.querySelector('#headline')!;
    root.querySelector('#newsbtn')!.addEventListener('click', handlers.onNews);
    this.headline.addEventListener('click', handlers.onNews);
    this.speedButtons = [...root.querySelectorAll<HTMLButtonElement>('.speed')];

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
    root.querySelector('#rot-left')!.addEventListener('click', () => handlers.onRotate(-1));
    root.querySelector('#rot-right')!.addEventListener('click', () => handlers.onRotate(1));
    for (const b of this.speedButtons) {
      b.addEventListener('click', () => handlers.onSpeed(Number(b.dataset.speed)));
    }
  }

  showMap(map: GameMap, ms: number): void {
    this.seedInput.value = map.seed;
    this.sizeSelect.value = map.settings.size;
    const retry = map.attempts > 1 ? ` · regenerated as “${map.usedSeed}”` : '';
    this.mapInfo =
      `${SIZE_LABEL[map.settings.size]} · ${map.towns.length} towns · ` +
      `${map.industries.length} industries · ${Math.round(ms)} ms${retry}`;
    this.info.textContent = this.mapInfo;
  }

  showError(message: string): void {
    this.info.textContent = message;
  }

  setSpeed(speed: number): void {
    for (const b of this.speedButtons) b.classList.toggle('active', Number(b.dataset.speed) === speed);
  }

  /** Cheap to call every frame: only touches the DOM when the text changes. */
  setStatus(day: number, money: number): void {
    const date = formatDate(day);
    if (date !== this.lastDate) {
      this.lastDate = date;
      this.dateEl.textContent = date;
    }
    if (money !== this.lastMoney) {
      this.lastMoney = money;
      this.moneyEl.textContent = formatMoney(money);
      this.moneyEl.classList.toggle('negative', money < 0);
    }
  }

  /** Shows the newest headline for a few seconds and the number of unread items. */
  showHeadline(text: string, kind: 'good' | 'bad' | 'info'): void {
    this.headline.textContent = text;
    this.headline.dataset.kind = kind;
    this.headline.hidden = false;
    window.clearTimeout(this.headlineTimer);
    this.headlineTimer = window.setTimeout(() => (this.headline.hidden = true), 6000);
  }

  setUnread(count: number): void {
    this.badge.hidden = count === 0;
    this.badge.textContent = count > 9 ? '9+' : String(count);
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
    this.copyButton.textContent = text;
    window.setTimeout(() => (this.copyButton.textContent = 'Copy link'), 1500);
  }
}
