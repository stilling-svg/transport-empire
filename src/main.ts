/**
 * Entry point: sets up PixiJS and hands over to the Game controller.
 * Rendering happens only when something changes or vehicles move,
 * which saves battery on phones.
 */
import { Application } from 'pixi.js';
import { Game } from './game.ts';
import { randomSeedString } from './mapgen/rng.ts';
import { MAP_DIMENSIONS, type MapSize } from './mapgen/types.ts';
import { BACKGROUND } from './render/palette.ts';

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

  const game = new Game(
    app,
    document.getElementById('hud')!,
    document.getElementById('toolbar')!,
    document.getElementById('panel')!,
  );

  const params = new URLSearchParams(window.location.search);
  const sizeParam = params.get('size');
  const size: MapSize = sizeParam && sizeParam in MAP_DIMENSIONS ? (sizeParam as MapSize) : 'medium';
  game.newWorld(params.get('seed') || randomSeedString(), size);
}

void start();
