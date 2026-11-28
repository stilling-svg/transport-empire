/**
 * Glue between the simulation, the renderer and the DOM user interface:
 * tools, tapping, panels, the game loop and time controls.
 */
import type { Application } from 'pixi.js';
import { generateMap } from './mapgen/generator.ts';
import { randomSeedString } from './mapgen/rng.ts';
import { DEFAULT_SETTINGS, Occupant, Terrain, WaterKind, type MapSize } from './mapgen/types.ts';
import { Camera, type PointerTool } from './render/camera.ts';
import { pickTile, tileCenter } from './render/iso.ts';
import { MapRenderer } from './render/mapRenderer.ts';
import { Overlay } from './render/overlay.ts';
import { PREVIEW_BAD, PREVIEW_OK } from './render/palette.ts';
import { VehicleRenderer } from './render/vehicleRenderer.ts';
import type { Rotation } from './render/view.ts';
import { cargoInfo, type CargoId } from './sim/cargo.ts';
import { RoadOwner, TICKS_PER_DAY } from './sim/constants.ts';
import { industryInfo, stopAccepts, stopSupplies } from './sim/economy.ts';
import { LEDGER_KEYS, LEDGER_LABELS, ledgerTotal, type Ledger } from './sim/finance.ts';
import { DEPOT_CAPACITY, SERVICE_INTERVAL_DAYS, industryName, vehicleAgeYears } from './sim/events.ts';
import type { ModelId, Order, Vehicle } from './sim/types.ts';
import { MODELS } from './sim/vehicles.ts';
import type { ActionResult } from './sim/world.ts';
import { World } from './sim/world.ts';
import { extendPath } from './ui/dragPath.ts';
import { Hud, formatDate, formatMoney } from './ui/hud.ts';
import { Panel } from './ui/panel.ts';
import { Toolbar, type Tool } from './ui/toolbar.ts';

const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Grass]: 'Grass',
  [Terrain.Rough]: 'Rough land',
  [Terrain.Farmland]: 'Farmland',
  [Terrain.Forest]: 'Forest',
  [Terrain.Rock]: 'Rocks',
  [Terrain.Water]: 'Water',
};
const WATER_NAMES: Record<number, string> = {
  [WaterKind.Sea]: 'Sea',
  [WaterKind.Lake]: 'Lake',
  [WaterKind.River]: 'River',
};
const VEHICLE_STATE: Record<string, string> = {
  idle: 'in the depot, no route',
  driving: 'driving',
  loading: 'loading at a stop',
  lost: 'cannot find a way',
  servicing: 'being serviced',
};

function vehicleStatus(world: World, v: Vehicle): string {
  if (v.brokenTicks > 0) return `broken down (${Math.ceil(v.brokenTicks / TICKS_PER_DAY)} days)`;
  if (v.goingToDepot && v.state === 'driving') return 'heading to the depot for service';
  if (v.state === 'driving') {
    const stop = world.stops.get(v.orders[v.orderIndex]?.stopId ?? -1);
    return stop ? `driving to ${stop.name}` : 'driving';
  }
  return VEHICLE_STATE[v.state] ?? v.state;
}
const cargoName = (c: CargoId): string => cargoInfo(c).name;
const amount = (c: CargoId, n: number): string => `${Math.round(n)} ${cargoInfo(c).unit}`;
const signed = (n: number): string => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));

/** Max simulation ticks per frame, so a slow frame cannot snowball. */
const MAX_TICKS_PER_FRAME = 240;

interface RouteEdit {
  vehicleId: number;
  orders: Order[];
  /** Editing an existing route (Save) rather than a new one (Start). */
  existing: boolean;
}

export class Game {
  private readonly renderer = new MapRenderer();
  private readonly overlay = new Overlay();
  private readonly vehicles = new VehicleRenderer();
  private readonly camera: Camera;
  private readonly hud: Hud;
  private readonly toolbar: Toolbar;
  private readonly panel: Panel;
  private world!: World;
  private speed = 1;
  private accumulator = 0;
  private lastFrame = performance.now();
  private needsRender = true;
  private dragPath: number[] = [];
  private tapTile = -1;
  private routeEdit: RouteEdit | null = null;
  /** Redraws the open panel with fresh numbers (called about once a second). */
  private panelRefresh: (() => void) | null = null;
  /** Vehicle whose route is shown on the map, or -1. */
  private shownVehicle = -1;
  private seenNews = 0;
  private unreadNews = 0;
  private frameCount = 0;
  private readonly app: Application;
  /** Which of the four sides the map is viewed from. */
  rotation: Rotation = 0;

  constructor(app: Application, hud: HTMLElement, toolbar: HTMLElement, panel: HTMLElement) {
    this.app = app;
    app.stage.addChild(this.renderer.root);
    this.renderer.overlayLayer.addChild(this.vehicles.layer, this.overlay.gfx);

    this.camera = new Camera(this.renderer.root, app.canvas, () => (this.needsRender = true));
    this.camera.tool = this.pointerTool();
    this.camera.onTap = (x, y) => this.onTap(x, y);
    this.camera.onTwist = (dir) => this.rotate(dir);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'q' || e.key === 'Q') this.rotate(-1);
      if (e.key === 'e' || e.key === 'E') this.rotate(1);
    });

    this.hud = new Hud(hud, {
      onGenerate: (seed, size) => this.newWorld(seed, size),
      onNewRandom: (size) => this.newWorld(randomSeedString(), size),
      onSpeed: (s) => this.setSpeed(s),
      onRotate: (dir) => this.rotate(dir),
      onMoney: () => this.showFinances(),
      onNews: () => this.showNews(),
    });
    this.toolbar = new Toolbar(
      toolbar,
      (tool) => this.selectTool(tool),
      () => this.undo(),
    );
    this.panel = new Panel(panel);
    this.setSpeed(1);

    window.addEventListener('resize', () => {
      app.resize();
      this.needsRender = true;
    });
    requestAnimationFrame(this.frame);
  }

  newWorld(seed: string, size: MapSize): void {
    const t0 = performance.now();
    try {
      const map = generateMap(seed, { ...DEFAULT_SETTINGS, size });
      const ms = performance.now() - t0;
      this.world = new World(map);
      this.renderer.setWorld(this.world, this.rotation);
      this.overlay.view = this.renderer.view;
      this.vehicles.clear();
      this.overlay.clear();
      this.routeEdit = null;
      this.shownVehicle = -1;
      this.seenNews = 0;
      this.unreadNews = 0;
      this.hud.setUnread(0);
      this.panel.hide();
      this.selectTool('view');
      this.camera.fit(this.renderer.bounds);
      this.hud.showMap(map, ms);
      const url = new URL(window.location.href);
      url.searchParams.set('seed', seed);
      url.searchParams.set('size', size);
      window.history.replaceState(null, '', url);
      this.updateRotationParam();
    } catch (err) {
      this.hud.showError(err instanceof Error ? err.message : String(err));
    }
    this.toolbar.setUndoEnabled(false);
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------
  // Game loop

  private frame = (now: number): void => {
    const dt = Math.min(now - this.lastFrame, 250);
    this.lastFrame = now;
    if (this.world) {
      if (this.speed > 0) {
        this.accumulator += (dt / 1000) * this.speed * TICKS_PER_DAY;
        const ticks = Math.min(Math.floor(this.accumulator), MAX_TICKS_PER_FRAME);
        this.accumulator -= Math.floor(this.accumulator);
        for (let t = 0; t < ticks; t++) this.world.step();
      }
      if (this.renderer.refreshDirty()) this.needsRender = true;
      const view = this.camera.viewRect();
      this.renderer.update(view, this.camera.currentZoom);
      const busesVisible = this.vehicles.update(this.world, this.renderer.view, view);
      this.hud.setStatus(this.world.day, this.world.money);
      this.checkNews();
      if (this.world.labelsDirty) {
        this.world.labelsDirty = false;
        this.renderer.rebuildLabels();
        this.needsRender = true;
      }
      if (++this.frameCount % 30 === 0 && this.panelRefresh && this.panel.isOpen) this.panelRefresh();
      if (this.needsRender || (busesVisible && this.speed > 0)) {
        this.app.render();
        this.needsRender = false;
      }
    }
    requestAnimationFrame(this.frame);
  };

  /** Turns the map 90° (dir +1 = clockwise), keeping the same spot in the middle of the screen. */
  rotate(dir: 1 | -1): void {
    if (!this.world) return;
    const { map } = this.world;
    const c = this.camera.center();
    let anchor = this.pick(this.camera.toScreenX(c.x), this.camera.toScreenY(c.y));
    if (anchor < 0) anchor = Math.floor(map.height / 2) * map.width + Math.floor(map.width / 2);
    const ax = anchor % map.width;
    const ay = (anchor - ax) / map.width;

    this.rotation = (((this.rotation + dir) % 4) + 4) % 4 as Rotation;
    this.renderer.setWorld(this.world, this.rotation);
    this.overlay.view = this.renderer.view;
    this.overlay.clear();
    this.dragPath = [];
    this.tapTile = -1;
    if (this.routeEdit) this.showRouteEditor();

    const { u, v } = this.renderer.view.toView(ax, ay);
    const p = tileCenter(u, v, map.heights[anchor]!);
    this.camera.centerOn(p.px, p.py);
    this.updateRotationParam();
    this.needsRender = true;
  }

  private updateRotationParam(): void {
    const url = new URL(window.location.href);
    if (this.rotation === 0) url.searchParams.delete('rot');
    else url.searchParams.set('rot', String(this.rotation));
    window.history.replaceState(null, '', url);
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    this.hud.setSpeed(speed);
  }

  // -------------------------------------------------------------------------
  // Tools

  private selectTool(tool: Tool): void {
    if (tool !== 'view') this.cancelRouteEdit();
    this.toolbar.setTool(tool);
    this.overlay.clear();
    this.dragPath = [];
    this.tapTile = -1;
    if (tool !== 'view') this.panel.hide();
    this.needsRender = true;
  }

  private pick(sx: number, sy: number): number {
    const w = this.camera.toWorld(sx, sy);
    return pickTile(this.world.map, this.renderer.view, w.x, w.y);
  }

  private pointerTool(): PointerTool {
    return {
      active: () => this.toolbar.current !== 'view',
      down: (x, y) => {
        const t = this.pick(x, y);
        this.dragPath = [];
        this.tapTile = t;
        extendPath(this.dragPath, t, this.world.map.width);
        this.previewDrag();
      },
      move: (x, y) => {
        const t = this.pick(x, y);
        const tool = this.toolbar.current;
        if (tool === 'road' || tool === 'demolish') {
          extendPath(this.dragPath, t, this.world.map.width);
          this.previewDrag();
        } else if (t !== this.tapTile) {
          this.tapTile = -1;
          this.overlay.clear();
          this.needsRender = true;
        }
      },
      up: () => {
        const tool = this.toolbar.current;
        let result: ActionResult | null = null;
        if (tool === 'road') result = this.world.buildRoad(this.dragPath);
        else if (tool === 'demolish' && this.dragPath.length > 0) result = this.world.demolish(this.dragPath);
        else if (tool === 'busstop' && this.tapTile >= 0) result = this.world.placeStop(this.tapTile, 'bus');
        else if (tool === 'truckstop' && this.tapTile >= 0) result = this.world.placeStop(this.tapTile, 'truck');
        else if (tool === 'depot' && this.tapTile >= 0) result = this.world.placeDepot(this.tapTile);
        if (result) this.report(result, tool);
        this.dragPath = [];
        this.tapTile = -1;
        this.overlay.clear();
        this.needsRender = true;
      },
      cancel: () => {
        this.dragPath = [];
        this.tapTile = -1;
        this.overlay.clear();
        this.toolbar.setTool(this.toolbar.current);
        this.needsRender = true;
      },
    };
  }

  private previewDrag(): void {
    const tool = this.toolbar.current;
    if (tool === 'road') {
      const plan = this.world.planRoad(this.dragPath);
      this.overlay.showPlan(this.world, plan);
      const bridges = plan.tiles.filter((t) => t.bridge).length;
      if (this.dragPath.length < 2) this.toolbar.showHint('Keep dragging to lay the road');
      else if (plan.ok) {
        const extra = bridges > 0 ? ` · ${bridges} bridge tile${bridges > 1 ? 's' : ''}` : '';
        this.toolbar.showHint(
          `Road · ${this.dragPath.length} tiles${extra} · ${formatMoney(plan.cost)}`,
          'ok',
        );
      } else this.toolbar.showHint(plan.reason ?? 'Cannot build here', 'error');
    } else if (tool === 'demolish') {
      this.overlay.showTiles(this.world, this.dragPath, PREVIEW_BAD);
    } else if (this.tapTile >= 0) {
      this.overlay.showTiles(this.world, [this.tapTile], PREVIEW_OK, 0.35);
    }
    this.needsRender = true;
  }

  private report(result: ActionResult, tool: Tool): void {
    if (result.ok) {
      const what = {
        road: 'Road built',
        busstop: 'Bus stop built',
        truckstop: 'Loading bay built',
        depot: 'Depot built',
        demolish: 'Removed',
        view: '',
      }[tool];
      const cost = result.cost > 0 ? ` for ${formatMoney(result.cost)}` : '';
      this.toolbar.showHint(`${what}${cost}${result.reason ? ` · ${result.reason}` : ''}`, 'ok', true);
    } else {
      this.toolbar.showHint(result.reason ?? 'Not possible here', 'error', true);
    }
    this.toolbar.setUndoEnabled(this.world.canUndo);
  }

  private undo(): void {
    if (this.world.undo()) {
      this.toolbar.showHint('Undone', 'ok', true);
      this.panel.hide();
      if (this.routeEdit) this.showRouteEditor();
    } else this.toolbar.showHint('Nothing to undo', 'info', true);
    this.toolbar.setUndoEnabled(this.world.canUndo);
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------
  // Tapping and info panels

  private onTap(sx: number, sy: number): void {
    const tile = this.pick(sx, sy);
    if (this.routeEdit) {
      this.addRouteStop(tile);
      return;
    }
    const w = this.camera.toWorld(sx, sy);
    const hit = this.vehicles.hitTest(this.world, w.x, w.y, 22 / this.camera.currentZoom);
    if (hit >= 0) {
      this.showVehicle(hit);
      return;
    }
    if (tile < 0) {
      this.closePanel();
      return;
    }
    this.showInfo(tile);
  }

  private showPanel(content: Parameters<Panel['show']>[0], refresh: (() => void) | null = null): void {
    this.panelRefresh = refresh;
    if (this.shownVehicle >= 0 && !this.routeEdit) {
      // Another panel replaces the vehicle panel: stop drawing its route.
      this.shownVehicle = -1;
      this.overlay.clear();
      this.needsRender = true;
    }
    const userClose = content.onClose;
    this.panel.show({
      ...content,
      onClose: () => {
        this.panelRefresh = null;
        if (this.shownVehicle >= 0) {
          this.shownVehicle = -1;
          this.overlay.clear();
          this.needsRender = true;
        }
        userClose?.();
      },
    });
  }

  private closePanel(): void {
    this.panelRefresh = null;
    if (this.shownVehicle >= 0) {
      this.shownVehicle = -1;
      this.overlay.clear();
      this.needsRender = true;
    }
    this.panel.hide();
  }

  private showInfo(tile: number): void {
    const { world } = this;
    const { map } = world;
    const x = tile % map.width;
    const y = (tile - x) / map.width;

    const depotId = world.depotAt[tile]!;
    if (depotId >= 0) {
      this.showDepot(depotId);
      return;
    }
    const stopId = world.stopAt[tile]!;
    if (stopId >= 0) {
      this.showStop(stopId);
      return;
    }
    if (map.occupant[tile] === Occupant.Industry) {
      this.showIndustry(map.occupantId[tile]!);
      return;
    }
    const town =
      map.occupant[tile] === Occupant.Town
        ? map.towns[map.occupantId[tile]!]
        : world.roadOwner[tile] === RoadOwner.Town
          ? map.towns.reduce((best, t) =>
              Math.hypot(t.x - x, t.y - y) < Math.hypot(best.x - x, best.y - y) ? t : best,
            )
          : undefined;
    if (town) {
      this.showPanel({
        title: town.name,
        lines: [
          `Population ${town.population.toLocaleString('en-US')}`,
          'Makes passengers and mail · wants food and planks',
          'Town streets are free to use',
        ],
      });
      return;
    }
    const water = map.water[tile]!;
    const lines = [`Height ${map.heights[tile]}`];
    if (world.roads[tile] !== 0) lines.push(water === WaterKind.River ? 'Road bridge' : 'Road');
    this.showPanel({
      title: water !== WaterKind.None ? WATER_NAMES[water]! : TERRAIN_NAMES[map.terrain[tile]!]!,
      lines,
    });
  }

  private showStop(stopId: number): void {
    const render = (): void => {
      const stop = this.world.stops.get(stopId);
      if (!stop) {
        this.closePanel();
        return;
      }
      const supplies = stopSupplies(this.world, stop);
      const accepts = (['passengers', 'mail', 'food', 'coal', 'grain', 'wood', 'planks'] as CargoId[]).filter((c) =>
        stopAccepts(this.world, stop, c),
      );
      const waiting = (Object.entries(stop.waiting) as Array<[CargoId, number]>)
        .filter(([, n]) => n > 0)
        .map(([c, n]) => `${cargoName(c)} ${amount(c, n)}`);
      const calling = this.world.vehicles.filter((v) => v.orders.some((o) => o.stopId === stopId)).length;
      this.showPanel(
        {
          title: stop.name,
          lines: [
            stop.kind === 'bus' ? 'Bus stop' : 'Loading bay',
            `Waiting: ${waiting.length ? waiting.join(', ') : 'nothing'}`,
            `Supplies: ${supplies.length ? supplies.map(cargoName).join(', ') : 'nothing nearby'}`,
            `Accepts: ${accepts.length ? accepts.map(cargoName).join(', ') : 'nothing nearby'}`,
            `Vehicles calling here: ${calling}`,
          ],
        },
        render,
      );
    };
    render();
  }

  private showIndustry(id: number): void {
    const render = (): void => {
      const ind = this.world.map.industries[id]!;
      const info = industryInfo(ind.type);
      const stats = this.world.industryStats[id]!;
      const lines: string[] = [];
      if (info.accepts.length) lines.push(`Accepts: ${info.accepts.map(cargoName).join(', ')}`);
      for (const c of info.produces) {
        const pct = stats.producedLastMonth > 0 ? Math.round((stats.transportedLastMonth / stats.producedLastMonth) * 100) : 0;
        lines.push(
          info.productionPerMonth > 0
            ? `Produces ${amount(c, stats.production)} ${cargoName(c).toLowerCase()} a month`
            : `Makes ${cargoName(c).toLowerCase()} from what is delivered`,
        );
        lines.push(`Last month: ${amount(c, stats.producedLastMonth)} made, ${pct} % transported`);
      }
      const st = this.world.industryStats[id]!;
      if (st.closingIn > 0) lines.push(`⚠ Closes in ${st.closingIn} months unless you start serving it`);
      if (st.strikeMonths > 0) lines.push(st.strikeWarned ? '⚠ Workers threaten to strike next month' : '⚠ On strike');
      if (st.boostMonths > 0) lines.push(`Double production for ${st.boostMonths} more months`);
      this.showPanel({ title: industryName(this.world, id), lines }, render);
    };
    render();
  }

  // -------------------------------------------------------------------------
  // Depots and vehicles

  private showDepot(depotId: number): void {
    const render = (): void => {
      if (!this.world.depots.has(depotId)) {
        this.closePanel();
        return;
      }
      const list = this.world.vehiclesIn(depotId);
      const buy = (model: ModelId): { label: string; onClick: () => void; primary?: boolean; disabled?: boolean } => ({
        label: `${MODELS[model].name} ${formatMoney(MODELS[model].price)}`,
        primary: model === 'bus',
        disabled: this.world.buyProblem(depotId, model) !== null,
        onClick: () => (model === 'truck' ? this.chooseTruckCargo(depotId) : this.buy(depotId, model)),
      });
      const full = list.length >= DEPOT_CAPACITY;
      this.showPanel(
        {
          title: `Depot · ${list.length} / ${DEPOT_CAPACITY} vehicles`,
          lines: [
            full
              ? 'This depot is full. Build another depot to buy more vehicles.'
              : list.length === 0
                ? 'Buy a vehicle, then tap the stops it should visit.'
                : `Vehicles here get a service about every ${SERVICE_INTERVAL_DAYS} days. Tap one to see it.`,
          ],
          actions: [
            buy('bus'),
            buy('van'),
            buy('truck'),
            ...list.map((v) => ({
              label: `${v.brokenTicks > 0 ? '⚠ ' : ''}${v.name}`,
              onClick: () => this.showVehicle(v.id),
            })),
          ],
        },
        render,
      );
    };
    render();
  }

  private chooseTruckCargo(depotId: number): void {
    this.showPanel({
      title: 'What should the truck carry?',
      lines: ['Coal, grain and wood come from industries; food and planks from factories.'],
      actions: MODELS.truck.cargo.map((c) => ({ label: cargoName(c), onClick: () => this.buy(depotId, 'truck', c) })),
    });
  }

  private buy(depotId: number, model: ModelId, cargo?: CargoId): void {
    const problem = this.world.buyProblem(depotId, model);
    const v = problem ? null : this.world.buyVehicle(depotId, model, cargo);
    if (!v) {
      this.toolbar.showHint(problem ?? 'Cannot buy that here', 'error', true);
      return;
    }
    this.toolbar.showHint(`Bought ${v.name} for ${formatMoney(v.price)}`, 'ok', true);
    this.startRouteEdit(v.id, false);
  }

  /** Vehicle card: status, numbers and its route drawn on the map. */
  private showVehicle(vehicleId: number): void {
    const render = (): void => {
      const v = this.world.vehicles.find((x) => x.id === vehicleId);
      if (!v) {
        this.closePanel();
        return;
      }
      const route = v.orders.map((o, k) => {
        const name = this.world.stops.get(o.stopId)?.name ?? '?';
        const here = k === v.orderIndex ? '▶ ' : '';
        return `${here}${k + 1}. ${name}${o.fullLoad ? ' (full load)' : ''}`;
      });
      const nextService = Math.max(0, Math.round(v.lastServiceDay + SERVICE_INTERVAL_DAYS - this.world.day));
      this.showPanel(
        {
          title: v.name,
          lines: [
            `${cargoName(v.cargo)} · ${amount(v.cargo, v.load)} of ${amount(v.cargo, v.capacity)} · ${vehicleStatus(this.world, v)}`,
            `Reliability ${Math.round(v.reliability * 100)} % · ${v.breakdowns} breakdowns · service in ${nextService} days · ${Math.floor(vehicleAgeYears(this.world, v))} years old`,
            `Profit this year ${signed(v.profitThisYear)} · last year ${signed(v.profitLastYear)}`,
            route.length ? `Route: ${route.join('  ')}` : 'No route yet',
          ],
          actions: [
            { label: 'Edit route', primary: true, onClick: () => this.startRouteEdit(v.id, true) },
            {
              label: 'Send for service',
              disabled: v.goingToDepot || v.state === 'servicing',
              onClick: () => {
                const res = this.world.serviceVehicle(v.id);
                this.toolbar.showHint(res.ok ? `${v.name} is heading to the depot` : (res.reason ?? ''), res.ok ? 'ok' : 'error', true);
                render();
              },
            },
            {
              label: `Sell for ${formatMoney(Math.round(v.price * 0.75))}`,
              onClick: () => {
                const res = this.world.sellVehicle(v.id);
                this.toolbar.showHint(res.ok ? `Sold ${v.name}` : (res.reason ?? ''), res.ok ? 'ok' : 'error', true);
                this.closePanel();
              },
            },
          ],
        },
        render,
      );
      this.shownVehicle = v.id;
      this.overlay.showRoute(this.world, v);
      this.needsRender = true;
    };
    this.selectTool('view');
    render();
  }

  // -------------------------------------------------------------------------
  // Routes

  private startRouteEdit(vehicleId: number, existing: boolean): void {
    this.selectTool('view');
    const v = this.world.vehicles.find((x) => x.id === vehicleId);
    this.shownVehicle = -1;
    this.routeEdit = {
      vehicleId,
      orders: existing && v ? v.orders.map((o) => ({ ...o })) : [],
      existing,
    };
    this.showRouteEditor();
  }

  private addRouteStop(tile: number): void {
    const edit = this.routeEdit!;
    const v = this.world.vehicles.find((x) => x.id === edit.vehicleId);
    const stopId = tile >= 0 ? this.world.stopAt[tile]! : -1;
    if (!v || stopId < 0) {
      this.toolbar.showHint('Tap a stop to add it to the route', 'error', true);
      return;
    }
    if (!this.world.stopFits(stopId, v.model)) {
      const need = MODELS[v.model].stop === 'bus' ? 'bus stops' : 'loading bays';
      this.toolbar.showHint(`${v.name} can only use ${need}`, 'error', true);
      return;
    }
    edit.orders.push({ stopId, fullLoad: false });
    this.showRouteEditor();
  }

  /** Small menu for one stop in the route being edited. */
  private editOrder(index: number): void {
    const edit = this.routeEdit;
    const order = edit?.orders[index];
    if (!edit || !order) return;
    const name = this.world.stops.get(order.stopId)?.name ?? '?';
    this.showPanel({
      title: `${index + 1}. ${name}`,
      onClose: () => this.cancelRouteEdit(),
      lines: [order.fullLoad ? 'The vehicle waits here until it is full.' : 'The vehicle loads what is waiting and drives on.'],
      actions: [
        {
          label: order.fullLoad ? 'Do not wait for full load' : 'Wait for full load',
          primary: true,
          onClick: () => {
            order.fullLoad = !order.fullLoad;
            this.showRouteEditor();
          },
        },
        {
          label: 'Remove from route',
          onClick: () => {
            edit.orders.splice(index, 1);
            this.showRouteEditor();
          },
        },
        { label: 'Back', onClick: () => this.showRouteEditor() },
      ],
    });
  }

  private showRouteEditor(): void {
    const edit = this.routeEdit;
    if (!edit) return;
    edit.orders = edit.orders.filter((o) => this.world.stops.has(o.stopId));
    const v = this.world.vehicles.find((x) => x.id === edit.vehicleId);
    if (!v) {
      this.cancelRouteEdit();
      return;
    }
    const kind = MODELS[v.model].stop === 'bus' ? 'bus stops' : 'loading bays';
    this.showPanel({
      title: `Route for ${v.name}`,
      onClose: () => this.cancelRouteEdit(),
      lines: [
        `Tap ${kind} on the map to add them. Tap a stop below to change or remove it.`,
        edit.orders.length ? '' : 'No stops chosen yet',
      ].filter(Boolean),
      actions: [
        ...edit.orders.map((o, k) => ({
          label: `${k + 1}. ${this.world.stops.get(o.stopId)!.name}${o.fullLoad ? ' ⏳' : ''}`,
          onClick: () => this.editOrder(k),
        })),
        {
          label: edit.existing ? 'Save' : 'Start',
          primary: true,
          disabled: edit.orders.length < 2,
          onClick: () => {
            const res = this.world.setRoute(edit.vehicleId, edit.orders);
            const id = edit.vehicleId;
            this.cancelRouteEdit();
            this.toolbar.showHint(
              res.ok ? (edit.existing ? `New route saved for ${v.name}` : `${v.name} is on its way`) : (res.reason ?? 'Could not set route'),
              res.ok ? 'ok' : 'error',
              true,
            );
            if (res.ok) this.showVehicle(id);
          },
        },
        { label: 'Cancel', onClick: () => this.cancelRouteEdit() },
      ],
    });
    this.overlay.clear();
    this.overlay.outline(
      this.world,
      edit.orders.map((o) => this.world.stops.get(o.stopId)!.tile),
    );
    this.toolbar.showHint(`Choosing ${kind}: tap them on the map`, 'info');
    this.needsRender = true;
  }

  private cancelRouteEdit(): void {
    if (!this.routeEdit) return;
    this.routeEdit = null;
    this.overlay.clear();
    this.closePanel();
    this.toolbar.setTool(this.toolbar.current);
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------
  // News

  private checkNews(): void {
    const w = this.world;
    if (w.newsCount === this.seenNews) return;
    const fresh = w.newsCount - this.seenNews;
    this.seenNews = w.newsCount;
    this.unreadNews += fresh;
    const headline = [...w.news].reverse().find((n) => !n.quiet);
    if (headline) this.hud.showHeadline(headline.text, headline.kind);
    this.hud.setUnread(this.unreadNews);
    if (this.shownVehicle >= 0 && this.panelRefresh) this.panelRefresh();
  }

  private showNews(): void {
    this.unreadNews = 0;
    this.hud.setUnread(0);
    const items = this.world.news.filter((n) => !n.quiet).slice(-8).reverse();
    const icon = { good: '🟢', bad: '🔴', info: '🔵' } as const;
    this.selectTool('view');
    this.showPanel({
      title: 'News',
      lines: items.length
        ? items.map((n) => `${icon[n.kind]} ${formatDate(n.day)} · ${n.text}`)
        : ['Nothing has happened yet.'],
      actions: items
        .filter((n) => n.tile !== undefined)
        .slice(0, 3)
        .map((n) => ({
          label: `Show: ${n.text.length > 28 ? `${n.text.slice(0, 27)}…` : n.text}`,
          onClick: () => this.jumpTo(n.tile!),
        })),
    });
  }

  /** Centres the camera on a tile. */
  private jumpTo(tile: number): void {
    const { map } = this.world;
    const x = tile % map.width;
    const y = (tile - x) / map.width;
    const { u, v } = this.renderer.view.toView(x, y);
    const p = tileCenter(u, v, map.heights[tile]!);
    this.camera.centerOn(p.px, p.py);
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------
  // Finances

  private showFinances(): void {
    const render = (): void => {
      const f = this.world.finance;
      const row = (key: (typeof LEDGER_KEYS)[number], l: Ledger): string =>
        key === 'income' ? signed(l[key]) : l[key] === 0 ? '$0' : signed(-l[key]);
      const lines = [
        `Money ${formatMoney(f.money)} · loan ${formatMoney(f.loan)} of ${formatMoney(f.maxLoan)}`,
        'This month · last month · this year',
        ...LEDGER_KEYS.map(
          (k) => `${LEDGER_LABELS[k]}: ${row(k, f.thisMonth)} · ${row(k, f.lastMonth)} · ${row(k, f.thisYear)}`,
        ),
        `Total: ${signed(ledgerTotal(f.thisMonth))} · ${signed(ledgerTotal(f.lastMonth))} · ${signed(ledgerTotal(f.thisYear))}`,
      ];
      this.showPanel(
        {
          title: 'Finances',
          lines,
          actions: [
            {
              label: `Borrow ${formatMoney(f.loanStep)}`,
              disabled: f.loan + f.loanStep > f.maxLoan,
              onClick: () => {
                this.world.borrow();
                render();
              },
            },
            {
              label: `Repay ${formatMoney(f.loanStep)}`,
              disabled: f.loan < f.loanStep || f.money < f.loanStep,
              onClick: () => {
                this.world.repay();
                render();
              },
            },
          ],
        },
        render,
      );
    };
    this.selectTool('view');
    render();
  }
}
