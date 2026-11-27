/**
 * Pan and zoom for the world container.
 * Touch: drag with one finger to pan, pinch with two to zoom.
 * Mouse: drag to pan, scroll wheel to zoom around the cursor.
 */
import type { Container } from 'pixi.js';
import type { ViewRect } from './mapRenderer.ts';

export const MAX_ZOOM = 4;

export class Camera {
  private zoom = 1;
  private minZoom = 0.1;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private pinchMid = { x: 0, y: 0 };

  constructor(
    private readonly target: Container,
    private readonly element: HTMLElement,
    private readonly onChange: () => void,
  ) {
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('pointerleave', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  get currentZoom(): number {
    return this.zoom;
  }

  /** Zooms and centres so that the given world rectangle fits the screen. */
  fit(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const w = this.element.clientWidth;
    const h = this.element.clientHeight;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const fitZoom = Math.min(w / bw, h / bh) * 0.95;
    this.minZoom = Math.min(fitZoom * 0.6, 0.5);
    this.zoom = Math.max(this.minZoom, Math.min(MAX_ZOOM, fitZoom));
    this.target.scale.set(this.zoom);
    this.target.position.set(
      w / 2 - ((bounds.minX + bounds.maxX) / 2) * this.zoom,
      h / 2 - ((bounds.minY + bounds.maxY) / 2) * this.zoom,
    );
    this.onChange();
  }

  /** The part of the world currently on screen, in world coordinates. */
  viewRect(): ViewRect {
    const z = this.zoom;
    return {
      x: -this.target.position.x / z,
      y: -this.target.position.y / z,
      width: this.element.clientWidth / z,
      height: this.element.clientHeight / z,
    };
  }

  private zoomAt(screenX: number, screenY: number, factor: number): void {
    const next = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.zoom * factor));
    const applied = next / this.zoom;
    if (applied === 1) return;
    const p = this.target.position;
    this.target.position.set(screenX - (screenX - p.x) * applied, screenY - (screenY - p.y) * applied);
    this.zoom = next;
    this.target.scale.set(next);
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.element.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) this.startPinch();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = this.local(e);
    this.pointers.set(e.pointerId, now);

    if (this.pointers.size === 1) {
      const p = this.target.position;
      this.target.position.set(p.x + now.x - prev.x, p.y + now.y - prev.y);
      this.onChange();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = this.target.position;
      this.target.position.set(p.x + mid.x - this.pinchMid.x, p.y + mid.y - this.pinchMid.y);
      if (this.pinchDistance > 0) this.zoomAt(mid.x, mid.y, d / this.pinchDistance);
      this.pinchDistance = d;
      this.pinchMid = mid;
      this.onChange();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 2) this.startPinch();
  };

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { x, y } = this.local(e);
    this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    this.onChange();
  };
}
