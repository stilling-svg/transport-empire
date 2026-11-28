/**
 * Pan and zoom for the world container, plus routing of pointer input.
 *
 * View mode:  one finger / mouse drag pans, a short tap inspects.
 * Build mode: one finger / left mouse drives the active tool,
 *             two fingers (or right mouse drag) pan, pinch zooms.
 * Twisting two fingers rotates the map in 90° steps.
 * The mouse wheel always zooms around the cursor.
 */
import type { Container } from 'pixi.js';
import type { ViewRect } from './mapRenderer.ts';

export const MAX_ZOOM = 4;

/** Receives single-pointer input while a build tool is active. Coordinates are screen pixels. */
export interface PointerTool {
  active(): boolean;
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel(): void;
}

type Mode = 'none' | 'pan' | 'tool' | 'pinch';
type Pt = { x: number; y: number };

const TAP_DISTANCE = 10;
/** How far (radians) two fingers must twist before the map turns 90°. */
const TWIST_THRESHOLD = 0.6;
const TAP_TIME = 350;

export class Camera {
  private zoom = 1;
  private minZoom = 0.1;
  private readonly pointers = new Map<number, Pt>();
  private mode: Mode = 'none';
  private pinchDistance = 0;
  private pinchMid: Pt = { x: 0, y: 0 };
  private twistStart = 0;
  private downAt: Pt = { x: 0, y: 0 };
  private downTime = 0;
  private moved = false;
  private readonly target: Container;
  private readonly element: HTMLElement;
  private readonly onChange: () => void;
  tool: PointerTool | null = null;
  onTap: ((x: number, y: number) => void) | null = null;
  /** Called with +1 (clockwise) or -1 when two fingers twist far enough. */
  onTwist: ((dir: 1 | -1) => void) | null = null;

  constructor(target: Container, element: HTMLElement, onChange: () => void) {
    this.target = target;
    this.element = element;
    this.onChange = onChange;
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerCancel);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get currentZoom(): number {
    return this.zoom;
  }

  /** Converts screen pixels (relative to the canvas) to world coordinates. */
  toWorld(x: number, y: number): Pt {
    return {
      x: (x - this.target.position.x) / this.zoom,
      y: (y - this.target.position.y) / this.zoom,
    };
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

  /** World x/y back to screen pixels. */
  toScreenX(wx: number): number {
    return wx * this.zoom + this.target.position.x;
  }

  toScreenY(wy: number): number {
    return wy * this.zoom + this.target.position.y;
  }

  /** The world point currently in the middle of the screen. */
  center(): Pt {
    return this.toWorld(this.element.clientWidth / 2, this.element.clientHeight / 2);
  }

  /** Moves the camera so the world point (wx, wy) is in the middle of the screen. */
  centerOn(wx: number, wy: number): void {
    this.target.position.set(
      this.element.clientWidth / 2 - wx * this.zoom,
      this.element.clientHeight / 2 - wy * this.zoom,
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

  private local(e: PointerEvent | WheelEvent): Pt {
    const r = this.element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.element.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 1) {
      this.downAt = p;
      this.downTime = performance.now();
      this.moved = false;
      const mouseOk = e.pointerType !== 'mouse' || e.button === 0;
      if (this.tool?.active() && mouseOk) {
        this.mode = 'tool';
        this.tool.down(p.x, p.y);
      } else {
        this.mode = 'pan';
      }
    } else if (this.pointers.size === 2) {
      if (this.mode === 'tool') this.tool?.cancel();
      this.mode = 'pinch';
      this.startPinch();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = this.local(e);
    this.pointers.set(e.pointerId, now);
    if (Math.hypot(now.x - this.downAt.x, now.y - this.downAt.y) > TAP_DISTANCE) this.moved = true;

    if (this.mode === 'tool') {
      this.tool?.move(now.x, now.y);
    } else if (this.mode === 'pan') {
      const p = this.target.position;
      this.target.position.set(p.x + now.x - prev.x, p.y + now.y - prev.y);
      this.onChange();
    } else if (this.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [Pt, Pt];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = this.target.position;
      this.target.position.set(p.x + mid.x - this.pinchMid.x, p.y + mid.y - this.pinchMid.y);
      if (this.pinchDistance > 0) this.zoomAt(mid.x, mid.y, d / this.pinchDistance);
      this.pinchDistance = d;
      this.pinchMid = mid;
      let twist = Math.atan2(b.y - a.y, b.x - a.x) - this.twistStart;
      if (twist > Math.PI) twist -= 2 * Math.PI;
      if (twist < -Math.PI) twist += 2 * Math.PI;
      if (Math.abs(twist) > TWIST_THRESHOLD) {
        this.twistStart = Math.atan2(b.y - a.y, b.x - a.x);
        this.onTwist?.(twist > 0 ? 1 : -1);
      }
      this.onChange();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId) ?? this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.mode === 'tool' && this.pointers.size === 0) {
      this.tool?.up(p.x, p.y);
    } else if (
      this.mode === 'pan' &&
      this.pointers.size === 0 &&
      !this.moved &&
      performance.now() - this.downTime < TAP_TIME
    ) {
      this.onTap?.(p.x, p.y);
    }
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.pointers.size === 1 && this.mode === 'pinch') {
      // One finger lifted after a pinch: keep panning with the other.
      this.mode = 'pan';
      this.moved = true;
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'tool') this.tool?.cancel();
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()] as [Pt, Pt];
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.twistStart = Math.atan2(b.y - a.y, b.x - a.x);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { x, y } = this.local(e);
    this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    this.onChange();
  };
}
