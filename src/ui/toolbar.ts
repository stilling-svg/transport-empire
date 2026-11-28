/** Bottom tool bar, within thumb reach, plus a one-line hint above it. */

export type Tool = 'view' | 'road' | 'busstop' | 'truckstop' | 'depot' | 'demolish';

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: 'view', label: 'View', icon: '✋' },
  { id: 'road', label: 'Road', icon: '🛣' },
  { id: 'busstop', label: 'Bus stop', icon: '🚏' },
  { id: 'truckstop', label: 'Freight', icon: '📦' },
  { id: 'depot', label: 'Depot', icon: '🏠' },
  { id: 'demolish', label: 'Demolish', icon: '✖' },
];

const HINTS: Record<Tool, string> = {
  view: 'Drag to move · pinch to zoom · twist or ⟲ ⟳ to rotate · tap to inspect',
  road: 'Drag along the tiles to build a road · two fingers to move',
  busstop: 'Bus stop for passengers and mail · tap a straight road or the end of a road',
  truckstop: 'Loading bay for freight · tap a straight road or a road end near an industry or town',
  depot: 'Tap an empty tile next to a road to build a depot',
  demolish: 'Drag over your roads, stops or depots to remove them',
};

export class Toolbar {
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private tool: Tool = 'view';
  private hintTimer = 0;

  constructor(root: HTMLElement, onTool: (tool: Tool) => void, onUndo: () => void) {
    root.innerHTML = `
      <div class="hint" id="hint"></div>
      <div class="tools">
        ${TOOLS.map(
          (t) =>
            `<button type="button" class="tool" data-tool="${t.id}"><span class="icon">${t.icon}</span><span>${t.label}</span></button>`,
        ).join('')}
        <button type="button" class="tool" id="undo"><span class="icon">↶</span><span>Undo</span></button>
      </div>
    `;
    this.hint = root.querySelector('#hint')!;
    this.undoButton = root.querySelector('#undo')!;
    for (const b of root.querySelectorAll<HTMLButtonElement>('.tool[data-tool]')) {
      const id = b.dataset.tool as Tool;
      this.buttons.set(id, b);
      b.addEventListener('click', () => onTool(id));
    }
    this.undoButton.addEventListener('click', onUndo);
    this.setTool('view');
  }

  get current(): Tool {
    return this.tool;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    for (const [id, b] of this.buttons) b.classList.toggle('active', id === tool);
    this.showHint(HINTS[tool]);
  }

  setUndoEnabled(enabled: boolean): void {
    this.undoButton.disabled = !enabled;
  }

  /** Shows a hint; a temporary one returns to the tool's default after a few seconds. */
  showHint(text: string, kind: 'info' | 'ok' | 'error' = 'info', temporary = false): void {
    window.clearTimeout(this.hintTimer);
    this.hint.textContent = text;
    this.hint.dataset.kind = kind;
    if (temporary) {
      this.hintTimer = window.setTimeout(() => this.showHint(HINTS[this.tool]), 3500);
    }
  }
}
