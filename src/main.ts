/**
 * Entry point: sets up PixiJS, the HUD and the camera, and shows a map.
 * Rendering happens only when something changes (no constant game loop yet),
 * which saves battery on phones.
 */
import { Application } from 'pixi.js';
import { generateMap } from './mapgen/generator.ts';
import { randomSeedString } from './mapgen/rng.ts';
import { DEFAULT_SETTINGS, MAP_DIMENSIONS, type MapSize } from './mapgen/types.ts';
import { Camera } from './render/camera.ts';
import { MapRenderer } from './render/mapRenderer.ts';
import { BACKGROUND } from './render/palette.ts';
import { Hud } from './ui/hud.ts';

async function start(): Promise<void> {
  const host = document.getElementById('game')!;
  const app = new Application();
  await app.init({
    background: BACKGROUND,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    autoStart: false,
    resizeTo: host,
  });
  host.appendChild(app.canvas);

  const renderer = new MapRenderer();
  app.stage.addChild(renderer.root);

  let frameRequested = false;
  const requestRender = (): void => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      renderer.update(camera.viewRect(), camera.currentZoom);
      app.render();
    });
  };

  const camera = new Camera(renderer.root, app.canvas, requestRender);
  window.addEventListener('resize', () => {
    app.resize();
    requestRender();
  });

  const show = (seed: string, size: MapSize): void => {
    const t0 = performance.now();
    try {
      const map = generateMap(seed, { ...DEFAULT_SETTINGS, size });
      const ms = performance.now() - t0;
      renderer.setMap(map);
      camera.fit(renderer.bounds);
      hud.showMap(map, ms);
      const url = new URL(window.location.href);
      url.searchParams.set('seed', seed);
      url.searchParams.set('size', size);
      window.history.replaceState(null, '', url);
    } catch (err) {
      hud.showError(err instanceof Error ? err.message : String(err));
    }
    requestRender();
  };

  const hud = new Hud(document.getElementById('hud')!, {
    onGenerate: show,
    onNewRandom: (size) => show(randomSeedString(), size),
  });

  const params = new URLSearchParams(window.location.search);
  const sizeParam = params.get('size');
  const size: MapSize = sizeParam && sizeParam in MAP_DIMENSIONS ? (sizeParam as MapSize) : 'medium';
  show(params.get('seed') || randomSeedString(), size);
}

void start();
