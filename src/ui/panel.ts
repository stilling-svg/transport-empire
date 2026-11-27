/** A small card above the tool bar showing info and actions for what was tapped. */

export interface PanelAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface PanelContent {
  title: string;
  lines?: string[];
  actions?: PanelAction[];
  /** Called when the player closes the card with ✕. */
  onClose?: () => void;
}

export class Panel {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.hide();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(content: PanelContent): void {
    this.root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('strong');
    title.textContent = content.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => {
      this.hide();
      content.onClose?.();
    });
    head.append(title, close);
    this.root.append(head);

    for (const line of content.lines ?? []) {
      const p = document.createElement('div');
      p.className = 'panel-line';
      p.textContent = line;
      this.root.append(p);
    }
    if (content.actions?.length) {
      const row = document.createElement('div');
      row.className = 'panel-actions';
      for (const a of content.actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = a.label;
        if (a.primary) b.className = 'primary';
        b.disabled = !!a.disabled;
        b.addEventListener('click', a.onClick);
        row.append(b);
      }
      this.root.append(row);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }
}
