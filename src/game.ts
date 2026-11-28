/**
 * Glue between the simulation, the renderer and the DOM user interface:
 * tools, tapping, panels, the game loop and time controls.
 */
import type { Application } from 'pixi.js';
import industries from './data/industries.json' with { type: 'json' };
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
import { RoadOwner, TICKS_PER_DAY } from './sim/constants.ts';
import type { ActionResult } from './sim/world.ts';
import { World } from './sim/world.ts';
import { extendPath } from './ui/dragPath.ts';
import { Hud, formatMoney } from './ui/hud.ts';
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
const CARGO_NAMES: Record<string, string> = {
  coal: 'Coal',
  grain: 'Grain',
  food: 'Food',
  wood: 'Wood',
  planks: 'Planks',
};
const BUS_STATE: Record<string, string> = {
  idle: 'waiting in the depot',
  driving: 'driving',
  loading: 'at a stop',
  lost: 'cannot find a way',
};

/** Max simulation ticks per frame, so a slow frame cannot snowball. */
const MAX_TICKS_PER_FRAME = 240;

interface RouteEdit {
  busId: number;
  stops: number[];
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
      this.hud.setStatus(this.world.day, this.world.spent);
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
        else if (tool === 'stop' && this.tapTile >= 0) result = this.world.placeStop(this.tapTile);
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
      const what = { road: 'Road built', stop: 'Bus stop built', depot: 'Depot built', demolish: 'Removed', view: '' }[tool];
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
  // Tapping, info panels and routes

  private onTap(sx: number, sy: number): void {
    const tile = this.pick(sx, sy);
    if (this.routeEdit) {
      const stop = tile >= 0 ? this.world.stopAt[tile]! : -1;
      if (stop >= 0) {
        this.routeEdit.stops.push(stop);
        this.showRouteEditor();
      } else this.toolbar.showHint('Tap a bus stop to add it to the route', 'error', true);
      return;
    }
    if (tile < 0) {
      this.panel.hide();
      return;
    }
    this.showInfo(tile);
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
      const stop = world.stops.get(stopId)!;
      const calling = world.buses.filter((b) => b.route.includes(stopId)).length;
      this.panel.show({
        title: stop.name,
        lines: ['Bus stop', `Buses calling here: ${calling}`],
      });
      return;
    }
    if (map.occupant[tile] === Occupant.Industry) {
      const ind = map.industries[map.occupantId[tile]!]!;
      const info = industries[ind.type] as { name: string; produces: string[]; accepts: string[] };
      const produces = info.produces.map((c) => CARGO_NAMES[c] ?? c).join(', ');
      const accepts = info.accepts.map((c) => CARGO_NAMES[c] ?? c).join(', ');
      this.panel.show({
        title: info.name,
        lines: [produces ? `Produces: ${produces}` : '', accepts ? `Accepts: ${accepts}` : ''].filter(Boolean),
      });
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
      this.panel.show({
        title: town.name,
        lines: [`Population ${town.population.toLocaleString('en-US')}`, 'Town streets are free to use'],
      });
      return;
    }
    const water = map.water[tile]!;
    const lines = [`Height ${map.heights[tile]}`];
    if (world.roads[tile] !== 0) lines.push(water === WaterKind.River ? 'Road bridge' : 'Road');
    this.panel.show({
      title: water !== WaterKind.None ? WATER_NAMES[water]! : TERRAIN_NAMES[map.terrain[tile]!]!,
      lines,
    });
  }

  private showDepot(depotId: number): void {
    const buses = this.world.buses.filter((b) => b.depotId === depotId);
    const lines =
      buses.length === 0
        ? ['No buses yet. Buy one, then tap the stops it should visit.']
        : buses.map((b) => `${b.name}: ${BUS_STATE[b.state]} · ${b.route.length} stops`);
    this.panel.show({
      title: 'Bus depot',
      lines,
      actions: [
        {
          label: 'Buy bus',
          primary: true,
          onClick: () => {
            const bus = this.world.buyBus(depotId);
            if (bus) this.startRouteEdit(bus.id);
          },
        },
        ...buses.slice(-3).map((b) => ({ label: `Route: ${b.name}`, onClick: () => this.startRouteEdit(b.id) })),
      ],
    });
  }

  private startRouteEdit(busId: number): void {
    this.selectTool('view');
    this.routeEdit = { busId, stops: [] };
    this.showRouteEditor();
  }

  private showRouteEditor(): void {
    const edit = this.routeEdit;
    if (!edit) return;
    edit.stops = edit.stops.filter((id) => this.world.stops.has(id));
    const bus = this.world.buses.find((b) => b.id === edit.busId);
    if (!bus) {
      this.cancelRouteEdit();
      return;
    }
    const names = edit.stops.map((id) => this.world.stops.get(id)!.name);
    this.panel.show({
      title: `Route for ${bus.name}`,
      onClose: () => this.cancelRouteEdit(),
      lines: [
        'Tap bus stops on the map in the order the bus should visit them.',
        names.length ? names.join(' → ') : 'No stops chosen yet',
      ],
      actions: [
        {
          label: 'Start',
          primary: true,
          disabled: edit.stops.length < 2,
          onClick: () => {
            const res = this.world.setRoute(edit.busId, edit.stops);
            this.cancelRouteEdit();
            this.toolbar.showHint(res.ok ? `${bus.name} is on its way` : (res.reason ?? 'Could not set route'), res.ok ? 'ok' : 'error', true);
          },
        },
        {
          label: 'Remove last',
          disabled: edit.stops.length === 0,
          onClick: () => {
            edit.stops.pop();
            this.showRouteEditor();
          },
        },
        { label: 'Cancel', onClick: () => this.cancelRouteEdit() },
      ],
    });
    this.overlay.clear();
    this.overlay.outline(
      this.world,
      edit.stops.map((id) => this.world.stops.get(id)!.tile),
    );
    this.toolbar.showHint('Choosing stops: tap them on the map', 'info');
    this.needsRender = true;
  }

  private cancelRouteEdit(): void {
    if (!this.routeEdit) return;
    this.routeEdit = null;
    this.overlay.clear();
    this.panel.hide();
    this.toolbar.setTool(this.toolbar.current);
    this.needsRender = true;
  }
}
