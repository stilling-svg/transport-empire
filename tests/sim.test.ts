import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/mapgen/generator.ts';
import { Occupant, Terrain, WaterKind } from '../src/mapgen/types.ts';
import { Dir, RoadOwner, TICKS_PER_DAY } from '../src/sim/constants.ts';
import { findRoadPath } from '../src/sim/pathfinding.ts';
import { MAX_UNDO, World } from '../src/sim/world.ts';
import { col, flatMap, row, setWater } from './helpers.ts';

const runDays = (world: World, days: number): void => {
  for (let t = 0; t < days * TICKS_PER_DAY; t++) world.step();
};

describe('road building', () => {
  it('builds a straight road and charges 100 per grass tile', () => {
    const w = new World(flatMap());
    const path = row(w.map, 5, 2, 6);
    const res = w.buildRoad(path);
    expect(res.ok).toBe(true);
    expect(res.cost).toBe(500);
    expect(w.roads[path[0]!]).toBe(Dir.E);
    expect(w.roads[path[2]!]).toBe(Dir.E | Dir.W);
    expect(w.roads[path[4]!]).toBe(Dir.W);
    expect(w.roadOwner[path[2]!]).toBe(RoadOwner.Player);
  });

  it('charges nothing for road that already exists', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 6));
    const plan = w.planRoad(row(w.map, 5, 3, 5));
    expect(plan.cost).toBe(0);
    expect(w.buildRoad(row(w.map, 5, 3, 5)).ok).toBe(false);
  });

  it('applies terrain and slope costs', () => {
    const map = flatMap();
    map.terrain[5 * 16 + 3] = Terrain.Forest; // 100 + 50 clearing
    map.terrain[5 * 16 + 4] = Terrain.Rock; // 300
    const w = new World(map);
    expect(w.planRoad(row(map, 5, 2, 4)).cost).toBe(100 + 150 + 300);
    map.heights[7 * 16 + 3] = 2; // one step up: both tiles on the slope cost 1.5x
    expect(w.planRoad(row(map, 7, 2, 3)).cost).toBe(150 + 150);
  });

  it('turns trees into grass when building', () => {
    const map = flatMap();
    map.terrain[5 * 16 + 3] = Terrain.Forest;
    const w = new World(map);
    w.buildRoad(row(map, 5, 2, 4));
    expect(map.terrain[5 * 16 + 3]).toBe(Terrain.Grass);
  });

  it('refuses open water, steep climbs, industries and houses', () => {
    const map = flatMap();
    setWater(map, 4, 2, WaterKind.Lake);
    map.heights[4 * 16 + 4] = 3; // two steps up from height 1
    map.occupant[6 * 16 + 4] = Occupant.Industry;
    map.occupant[8 * 16 + 4] = Occupant.Town;
    const w = new World(map);
    expect(w.planRoad(row(map, 2, 3, 5)).ok).toBe(false);
    expect(w.planRoad(row(map, 4, 3, 5)).ok).toBe(false);
    expect(w.planRoad(row(map, 6, 3, 5)).ok).toBe(false);
    expect(w.planRoad(row(map, 8, 3, 5)).ok).toBe(false);
    expect(w.planRoad(row(map, 9, 3, 5)).ok).toBe(true);
  });

  it('refuses gaps in the path and single tiles', () => {
    const w = new World(flatMap());
    expect(w.planRoad([5 * 16 + 2]).ok).toBe(false);
    expect(w.planRoad([5 * 16 + 2, 5 * 16 + 4]).ok).toBe(false);
  });

  it('bridges a river in a straight line for 1000', () => {
    const map = flatMap();
    for (let y = 0; y < 16; y++) setWater(map, 6, y, WaterKind.River);
    const w = new World(map);
    const plan = w.planRoad(row(map, 4, 4, 8));
    expect(plan.ok).toBe(true);
    expect(plan.cost).toBe(4 * 100 + 1000);
    expect(plan.tiles.find((t) => t.index === 4 * 16 + 6)!.bridge).toBe(true);
    // Turning on the river is not allowed.
    const bent = [4 * 16 + 5, 4 * 16 + 6, 5 * 16 + 6];
    expect(w.planRoad(bent).ok).toBe(false);
    // Ending on the river is not allowed either.
    expect(w.planRoad(row(map, 4, 4, 6)).ok).toBe(false);
  });
});

describe('demolish and undo', () => {
  it('demolishes player roads and cleans up the neighbours', () => {
    const w = new World(flatMap());
    const path = row(w.map, 5, 2, 6);
    w.buildRoad(path);
    const res = w.demolish([path[4]!]);
    expect(res.ok).toBe(true);
    expect(w.roads[path[4]!]).toBe(0);
    expect(w.roads[path[3]!]).toBe(Dir.W);
  });

  it('does not demolish town roads', () => {
    const map = generateMap('town-roads', { size: 'small', water: 'medium', relief: 'hilly', towns: 'normal' });
    const w = new World(map);
    const town = map.towns[0]!;
    const centre = town.y * map.width + town.x;
    expect(w.roadOwner[centre]).toBe(RoadOwner.Town);
    expect(w.demolish([centre]).ok).toBe(false);
    expect(w.roads[centre]).not.toBe(0);
  });

  it('undoes building and demolishing', () => {
    const w = new World(flatMap());
    const path = row(w.map, 5, 2, 6);
    w.buildRoad(path);
    w.demolish(path);
    expect(w.roads[path[2]!]).toBe(0);
    expect(w.undo()).toBe(true);
    expect(w.roads[path[2]!]).toBe(Dir.E | Dir.W);
    expect(w.undo()).toBe(true);
    expect(w.roads[path[2]!]).toBe(0);
    expect(w.money).toBe(200_000); // undo refunds the road
    expect(w.undo()).toBe(false);
  });

  it('keeps at most 10 undo steps', () => {
    const w = new World(flatMap());
    for (let y = 0; y < 12; y++) w.buildRoad(row(w.map, y, 0, 3));
    let undone = 0;
    while (w.undo()) undone++;
    expect(undone).toBe(MAX_UNDO);
    expect(w.roads[1 * 16 + 1]).not.toBe(0); // the two oldest roads remain
    expect(w.roads[2 * 16 + 1]).toBe(0);
  });
});

describe('stops and depots', () => {
  it('places stops only on straight road', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 6));
    w.buildRoad(col(w.map, 4, 5, 8)); // makes (4,5) a T-junction
    expect(w.placeStop(5 * 16 + 3).ok).toBe(true);
    expect(w.placeStop(5 * 16 + 3).ok).toBe(false); // already a stop
    expect(w.placeStop(5 * 16 + 4).ok).toBe(false); // junction
    expect(w.placeStop(9 * 16 + 9).ok).toBe(false); // no road
  });

  it('places stops at the end of a road too, but not on corners', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 6));
    w.buildRoad(col(w.map, 6, 5, 8)); // corner at (6,5)
    expect(w.placeStop(5 * 16 + 2).ok).toBe(true); // dead end
    expect(w.placeStop(8 * 16 + 6).ok).toBe(true); // other dead end
    expect(w.placeStop(5 * 16 + 6).ok).toBe(false); // corner
  });

  it('lets a bus shuttle between stops at two road ends', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 12));
    w.placeStop(5 * 16 + 2);
    w.placeStop(5 * 16 + 12);
    w.placeDepot(6 * 16 + 7);
    const bus = w.buyBus(0)!;
    w.setRoute(bus.id, [0, 1]);
    runDays(w, 40);
    expect(bus.arrivals).toBeGreaterThanOrEqual(4);
  });

  it('builds roads across farmland', () => {
    const map = flatMap();
    for (let x = 0; x < 16; x++) map.terrain[5 * 16 + x] = Terrain.Farmland;
    const w = new World(map);
    const res = w.buildRoad(row(map, 5, 2, 8));
    expect(res.ok).toBe(true);
    expect(res.cost).toBe(7 * 150);
  });

  it('connects a depot to the neighbouring road', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 6));
    const depotTile = 6 * 16 + 4;
    expect(w.placeDepot(depotTile).ok).toBe(true);
    expect(w.roads[depotTile]).toBe(Dir.N);
    expect(w.roads[5 * 16 + 4]! & Dir.S).toBe(Dir.S);
    expect(w.placeDepot(10 * 16 + 10).ok).toBe(false); // no road nearby
  });
});

describe('path finding', () => {
  it('finds the shortest road path', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 2, 2, 10));
    const path = findRoadPath(w.roads, 16, 16, 2 * 16 + 2, 2 * 16 + 10);
    expect(path?.length).toBe(9);
  });

  it('goes around obstacles', () => {
    const w = new World(flatMap());
    // A U-shaped road: (2,2) -> (2,8) -> (8,8) -> (8,2)
    w.buildRoad(col(w.map, 2, 2, 8));
    w.buildRoad(row(w.map, 8, 2, 8));
    w.buildRoad(col(w.map, 8, 8, 2));
    const path = findRoadPath(w.roads, 16, 16, 2 * 16 + 2, 2 * 16 + 8);
    expect(path?.length).toBe(7 + 6 + 6);
  });

  it('returns null when there is no connection', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 2, 2, 5));
    w.buildRoad(row(w.map, 2, 7, 10));
    expect(findRoadPath(w.roads, 16, 16, 2 * 16 + 2, 2 * 16 + 10)).toBe(null);
  });
});

/** Road from (2,5) to (12,5) with stops at both ends and a depot in the middle. */
function busWorld(): { w: World; a: number; b: number; depot: number } {
  const w = new World(flatMap());
  w.buildRoad(row(w.map, 5, 1, 13));
  w.placeStop(5 * 16 + 2);
  w.placeStop(5 * 16 + 12);
  w.placeDepot(6 * 16 + 7);
  const [a, b] = [...w.stops.keys()] as [number, number];
  const depot = [...w.depots.keys()][0]!;
  return { w, a, b, depot };
}

describe('buses', () => {
  it('drives back and forth between two stops', () => {
    const { w, a, b, depot } = busWorld();
    const bus = w.buyBus(depot)!;
    expect(w.setRoute(bus.id, [a, b]).ok).toBe(true);
    const visits: number[] = [];
    let lastArrivals = 0;
    for (let t = 0; t < 60 * TICKS_PER_DAY; t++) {
      w.step();
      if (bus.arrivals !== lastArrivals) {
        lastArrivals = bus.arrivals;
        visits.push(bus.lastStopId);
      }
      // The bus never leaves the road.
      expect(w.roads[bus.tile]).not.toBe(0);
    }
    expect(visits.length).toBeGreaterThanOrEqual(6);
    visits.forEach((stop, k) => expect(stop).toBe(k % 2 === 0 ? a : b));
  });

  it('needs at least two stops', () => {
    const { w, a, depot } = busWorld();
    const bus = w.buyBus(depot)!;
    expect(w.setRoute(bus.id, [a]).ok).toBe(false);
    expect(bus.state).toBe('idle');
  });

  it('waits when the route is cut and continues when it is rebuilt', () => {
    const { w, a, b, depot } = busWorld();
    const bus = w.buyBus(depot)!;
    w.setRoute(bus.id, [a, b]);
    runDays(w, 1);
    // Cut the road far from the bus, then rebuild it.
    const cut = 5 * 16 + 10;
    const res = w.demolish([cut]);
    expect(res.ok).toBe(true);
    runDays(w, 20);
    expect(['lost', 'loading', 'driving']).toContain(bus.state);
    const before = bus.arrivals;
    w.buildRoad(row(w.map, 5, 9, 11));
    runDays(w, 30);
    expect(bus.arrivals).toBeGreaterThan(before);
  });

  it('is deterministic', () => {
    const run = (): number[] => {
      const { w, a, b, depot } = busWorld();
      for (let k = 0; k < 5; k++) {
        const bus = w.buyBus(depot)!;
        w.setRoute(bus.id, k % 2 ? [a, b] : [b, a]);
        runDays(w, 1.3);
      }
      runDays(w, 40);
      return w.vehicles.flatMap((bus) => [bus.tile, bus.progress, bus.arrivals]);
    };
    expect(run()).toEqual(run());
  });

  it('simulates 100 buses on a medium map quickly', () => {
    const map = generateMap('perf', { size: 'medium', water: 'medium', relief: 'hilly', towns: 'normal' });
    const w = new World(map);
    w.finance.money = 10_000_000;
    // Connect two towns' streets with stops on town roads.
    const stopsPlaced: number[] = [];
    for (const town of map.towns) {
      for (const dx of [-1, 1]) {
        const i = town.y * map.width + town.x + dx;
        if (w.placeStop(i).ok) stopsPlaced.push(w.stopAt[i]!);
      }
      if (stopsPlaced.length >= 2) break;
    }
    expect(stopsPlaced.length).toBeGreaterThanOrEqual(2);
    // A depot next to the first stop's street.
    const stopTile = w.stops.get(stopsPlaced[0]!)!.tile;
    const x = stopTile % map.width;
    const y = (stopTile - x) / map.width;
    // Each depot holds 8 vehicles, so 100 buses need 13 depots around the stop.
    search: for (let r = 1; r <= 24; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          w.placeDepot(ty * map.width + tx);
          if (w.depots.size >= 13) break search;
        }
      }
    }
    expect(w.depots.size).toBe(13);
    for (const depotId of w.depots.keys()) {
      for (let k = 0; k < 8 && w.vehicles.length < 100; k++) {
        const bus = w.buyBus(depotId)!;
        w.setRoute(bus.id, [stopsPlaced[0]!, stopsPlaced[1]!]);
      }
    }
    expect(w.vehicles.length).toBe(100);
    const start = performance.now();
    runDays(w, 30);
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(2000);
    // With 100 buses on one route most of them queue, but the route keeps moving.
    expect(w.vehicles.filter((b) => b.arrivals > 0).length).toBeGreaterThan(10);
  });
});

describe('drag paths', () => {
  it('fills gaps and trims when dragging back', async () => {
    const { extendPath } = await import('../src/ui/dragPath.ts');
    const path: number[] = [];
    extendPath(path, 0, 16);
    extendPath(path, 3, 16); // jump: filled in as 0,1,2,3
    expect(path).toEqual([0, 1, 2, 3]);
    extendPath(path, 3 + 2 * 16, 16); // down two rows
    expect(path).toEqual([0, 1, 2, 3, 19, 35]);
    extendPath(path, 2, 16); // back onto the path trims it
    expect(path).toEqual([0, 1, 2]);
  });
});
