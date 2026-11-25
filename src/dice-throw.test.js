import { describe, it, expect } from 'vitest';
import { planThrow, dishOf, chargeOf, facingOf, facingOfMatrix, eulerOf, layoutFor, normalOf, normalOfMatrix, PHYSICS, SIDES } from './dice-throw.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const base = { width: 220, height: 220, size: 30, count: 2 };
const plan = (strength, seed) => planThrow({ ...base, strength, rng: seeded(seed) });
const turnBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3])));

// How far the deepest corner of die A has sunk into die B.
const sinking = (a, b, size) => {
  const half = size / 2;
  let deepest = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const o = [sx * half, sy * half, sz * half];
    const w = [0, 1, 2].map((r) => [a.x, a.y, a.z + half][r] + a.m[3 * r] * o[0] + a.m[3 * r + 1] * o[1] + a.m[3 * r + 2] * o[2]);
    const rel = [w[0] - b.x, w[1] - b.y, w[2] - (b.z + half)];
    const depth = Math.min(...[0, 1, 2].map((k) => half - Math.abs(b.m[k] * rel[0] + b.m[3 + k] * rel[1] + b.m[6 + k] * rel[2])));
    if (depth > deepest) deepest = depth;
  }
  return deepest;
};

describe('dice throw physics', () => {
  it('always comes to rest inside the dish and within a bounded time, with no frame turning the cube by a quarter turn', () => {
    for (const strength of [0.65, 0.78, 1.1, 1.45]) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const p = plan(strength, seed);
        expect(p.duration).toBeLessThanOrEqual(4.5);
        for (let i = 0; i < base.count; i += 1) {
          const end = p.sample(i, p.duration);
          expect(Math.hypot(end.x - p.bounds.cx, end.y - p.bounds.cy)).toBeLessThanOrEqual(p.bounds.radius + 0.01);
          for (let f = 0; f < p.frames[i].length - 1; f += 1) expect(turnBetween(p.frames[i][f], p.frames[i][f + 1])).toBeLessThan(Math.PI / 2);
          // At rest the die has stopped: the last frames are identical.
          const last = p.frames[i].length - 1;
          expect(Math.abs(p.frames[i][last].x - p.frames[i][last - 1].x)).toBeLessThan(0.5);
        }
      }
    }
  });

  it('lies flat on the floor at any heading, not only at quarter turns', () => {
    const headings = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const p = plan([0.65, 0.78, 1.1, 1.45][seed % 4], seed);
      p.rest.forEach((r, i) => {
        const end = p.sample(i, p.duration);
        const onFlatFloor = Math.hypot(end.x - p.bounds.cx, end.y - p.bounds.cy) < p.bounds.radius - base.size * 1.4;
        if (onFlatFloor && Math.hypot(end.x - p.sample(1 - i, p.duration).x, end.y - p.sample(1 - i, p.duration).y) > base.size * 1.6) {
          expect(r.tilt).toBeLessThan(1.5);
          headings.push(r.heading);
        }
      });
    }
    expect(headings.length).toBeGreaterThan(100);
    // Headings fill the whole quarter turn instead of piling up at 0.
    const bins = [0, 0, 0, 0, 0, 0];
    headings.forEach((h) => { bins[Math.min(5, Math.floor(h / 15))] += 1; });
    for (const count of bins) { expect(count / headings.length).toBeGreaterThan(0.05); expect(count / headings.length).toBeLessThan(0.35); }
  });

  it('sometimes leans: on the sloped rim or on the other die', () => {
    let leaning = 0;
    let total = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      const p = plan([0.65, 1.1, 1.45][seed % 3], seed);
      p.rest.forEach((r) => { total += 1; if (r.tilt > 1.5) leaning += 1; });
    }
    expect(leaning / total).toBeGreaterThan(0.05);
    expect(leaning / total).toBeLessThan(0.6);
  });

  it('turns the cube freely: all six faces come up about equally often', () => {
    const seen = Object.fromEntries(SIDES.map((side) => [side, 0]));
    let total = 0;
    for (let seed = 1; seed <= 250; seed += 1) {
      const p = plan([0.65, 0.78, 1.1, 1.45][seed % 4], seed + 500);
      p.facing.forEach((side) => { seen[side] += 1; total += 1; });
    }
    for (const side of SIDES) { expect(seen[side] / total).toBeGreaterThan(0.1); expect(seen[side] / total).toBeLessThan(0.24); }
  });

  it('is deterministic for a given random source and obeys the physics settings', () => {
    const a = plan(1.2, 9);
    const b = plan(1.2, 9);
    expect(b.sample(0, 0.7)).toEqual(a.sample(0, 0.7));
    const heavy = planThrow({ ...base, strength: 1.2, rng: seeded(9), physics: { gravity: PHYSICS.gravity * 2 } });
    expect(heavy.peakHeight).toBeLessThan(a.peakHeight);
    const dead = planThrow({ ...base, strength: 1.2, rng: seeded(9), physics: { floorBounce: 0, wallBounce: 0, dieBounce: 0 } });
    expect(dead.bounces).toBeLessThan(a.bounces);
  });

  it('describes an orientation consistently: matrix, normals and the angles the page would need', () => {
    const p = plan(1.1, 3);
    const pose = p.sample(0, 0.4);
    for (const side of SIDES) {
      const viaAngles = normalOf(side, pose.ax, pose.ay, pose.az);
      const viaMatrix = normalOfMatrix(side, pose.m);
      viaMatrix.forEach((v, k) => expect(v).toBeCloseTo(viaAngles[k], 6));
    }
    const identity = eulerOf([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Math.abs(identity.ax) + Math.abs(identity.ay) + Math.abs(identity.az)).toBe(0);
  });

  it('paints the top face with the number the server rolled', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const p = plan(1.3, seed);
      for (let i = 0; i < 2; i += 1) {
        for (const value of [1, 2, 3, 4, 5, 6]) {
          const layout = layoutFor(value, p.facing[i]);
          expect(layout[p.facing[i]]).toBe(value);
          for (const side of SIDES) expect(layout[side] + layout[{ front: 'back', back: 'front', top: 'bottom', bottom: 'top', right: 'left', left: 'right' }[side]]).toBe(7);
          expect(new Set(Object.values(layout)).size).toBe(6);
        }
      }
    }
  });

  it('knows which side faces the viewer after the page turns the cube', () => {
    expect(facingOf(0, 0)).toBe('front');
    expect(facingOf(180, 0)).toBe('back');
    expect(normalOf('front', 0, 0)[2]).toBeCloseTo(1, 10);
    expect(facingOf(90, 0)).toBe('bottom');
    expect(facingOf(0, 90)).toBe('left');
  });

  it('a full charge is thrown, not just spun: higher, longer and with more bounces than a tap', () => {
    const runs = (strength) => Array.from({ length: 30 }, (_, i) => plan(strength, i + 100));
    const mean = (list, pick) => list.reduce((sum, p) => sum + pick(p), 0) / list.length;
    const tap = runs(0.78);
    const full = runs(1.45);
    expect(mean(full, (p) => p.peakHeight)).toBeGreaterThan(mean(tap, (p) => p.peakHeight) * 1.4);
    expect(mean(full, (p) => p.duration)).toBeGreaterThan(mean(tap, (p) => p.duration) * 1.2);
    expect(mean(full, (p) => p.bounces)).toBeGreaterThan(mean(tap, (p) => p.bounces));
  });

  it('bounces and clicks: a throw lands several times, each landing is a sound with a strength', () => {
    const p = plan(1.2, 7);
    expect(p.bounces).toBeGreaterThanOrEqual(3);
    expect(p.floorHits).toBeGreaterThanOrEqual(3);
    for (const e of p.events) { expect(e.power).toBeGreaterThan(0); expect(e.power).toBeLessThanOrEqual(1); expect(e.t).toBeLessThanOrEqual(p.duration + 0.02); }
    const times = p.events.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('keeps the two dice from sinking into each other at rest', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const p = plan(1, seed);
      const a = p.sample(0, p.duration);
      const b = p.sample(1, p.duration);
      expect(sinking(a, b, base.size)).toBeLessThan(2);
      expect(sinking(b, a, base.size)).toBeLessThan(2);
    }
  });

  it('keeps the dice inside the yard, clear of its top edge', () => {
    expect(plan(0.78, 3).bounds.minY).toBeGreaterThanOrEqual(0);
  });

  it('reads the strength the server sends', () => {
    expect(chargeOf(0.65)).toBe(0);
    expect(chargeOf(1.4)).toBe(1);
    expect(chargeOf(undefined)).toBeCloseTo(0.114, 2);
  });

  it('keeps every die inside the round dish for the whole throw, and the dish fits its scene', () => {
    for (const strength of [0.65, 1.45]) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const p = plan(strength, seed);
        const { cx, cy, radius } = p.bounds;
        expect(radius).toBeGreaterThan(0);
        for (let i = 0; i < base.count; i += 1) {
          for (let t = 0; t <= p.duration; t += 1 / 30) {
            const pose = p.sample(i, t);
            expect(Math.hypot(pose.x - cx, pose.y - cy)).toBeLessThanOrEqual(radius + 0.5);
          }
        }
      }
    }
  });

  it('stops a die a die-width short of the dish wall, and the floor stays inside the scene', () => {
    const p = plan(1.45, 4);
    const { radius, floor } = dishOf(base.width, base.height, base.size);
    expect(radius).toBeLessThanOrEqual(floor - base.size * 0.5);
    expect(floor * 1.22).toBeLessThanOrEqual(base.width * 0.62);   // the rim, drawn 1.22 times the floor, fits the scene
    expect(p.bounds.radius).toBeCloseTo(radius, 6);
  });

  it('never lets one die sink into the other while they move, and two flat dice rest a full width apart', () => {
    for (const strength of [0.65, 0.78, 1.1, 1.45]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const p = plan(strength, seed);
        for (let t = 0; t <= p.duration; t += 1 / 30) {
          const a = p.sample(0, t);
          const b = p.sample(1, t);
          expect(sinking(a, b, base.size)).toBeLessThan(base.size * 0.2);
        }
        const end = [p.sample(0, p.duration), p.sample(1, p.duration)];
        if (p.rest[0].tilt < 1.5 && p.rest[1].tilt < 1.5 && end[0].z < 1 && end[1].z < 1) {
          expect(Math.hypot(end[0].x - end[1].x, end[0].y - end[1].y)).toBeGreaterThan(base.size * 0.95);
        }
      }
    }
  });
});
