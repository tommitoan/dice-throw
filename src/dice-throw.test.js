import { describe, it, expect } from 'vitest';
import { planThrow, dishOf, chargeOf, facingOf, layoutFor, normalOf, SIDES } from './dice-throw.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const base = { width: 220, height: 220, size: 30, count: 2 };
const plan = (strength, seed) => planThrow({ ...base, strength, rng: seeded(seed) });
const quarter = (deg) => Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-9;

describe('dice throw physics', () => {
  it('always comes to rest flat, inside the yard and within a bounded time', () => {
    for (const strength of [0.65, 0.78, 1.1, 1.45]) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const p = plan(strength, seed);
        expect(p.duration).toBeLessThanOrEqual(4.5);
        for (let i = 0; i < base.count; i += 1) {
          const end = p.sample(i, p.duration);
          expect(end.z).toBe(0);
          expect(quarter(end.ax)).toBe(true);   // lying flat: whole quarter turns
          expect(quarter(end.ay)).toBe(true);
          expect(end.x).toBeGreaterThanOrEqual(p.bounds.minX - 0.01);
          expect(end.x).toBeLessThanOrEqual(p.bounds.maxX + 0.01);
          expect(end.y).toBeGreaterThanOrEqual(p.bounds.minY - 0.01);
          expect(end.y).toBeLessThanOrEqual(p.bounds.maxY + 0.01);
        }
      }
    }
  });

  it('turns over in quick quarter turns while in the air and ends on the ground', () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const p = plan(1.2, seed);
      for (let t = 0; t < p.duration; t += 1 / 60) {
        const a = p.sample(0, t);
        const b = p.sample(0, t + 1 / 60);
        // No frame turns the cube by more than a quarter turn: it is a tumble, not a spin-up.
        expect(Math.abs(b.ax - a.ax)).toBeLessThanOrEqual(90);
        expect(Math.abs(b.ay - a.ay)).toBeLessThanOrEqual(90);
      }
      expect(p.sample(0, p.duration).z).toBe(0);
    }
  });

  it('lies squarely at exactly 0 degrees, and only turns about the vertical while in the air', () => {
    for (const strength of [0.7, 1, 1.45]) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const p = plan(strength, seed);
        for (let i = 0; i < base.count; i += 1) {
          const end = p.sample(i, p.duration);
          expect(Math.abs(end.az / 360 - Math.round(end.az / 360))).toBeLessThan(1e-9);
          for (let t = 0; t < p.duration; t += 1 / 60) {
            const a = p.sample(i, t);
            const b = p.sample(i, t + 1 / 60);
            // On the ground the die is not turned: no yaw while it rests or slides.
            if (a.z === 0 && b.z === 0) expect(Math.abs(b.az - a.az)).toBeLessThan(1e-9);
          }
        }
      }
    }
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
    expect(p.bounces).toBeGreaterThanOrEqual(4);
    expect(p.floorHits).toBeGreaterThanOrEqual(3);
    for (const e of p.events) { expect(e.power).toBeGreaterThan(0); expect(e.power).toBeLessThanOrEqual(1); expect(e.t).toBeLessThanOrEqual(p.duration + 0.02); }
    const times = p.events.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('keeps the two dice apart at rest', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const p = plan(1, seed);
      const a = p.sample(0, p.duration);
      const b = p.sample(1, p.duration);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(base.size * 0.85);
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

  it('never leaves two dice overlapping when they come to rest, nor while they lie on the floor', () => {
    for (const strength of [0.65, 0.78, 1.1, 1.45]) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const p = plan(strength, seed);
        const end = [p.sample(0, p.duration), p.sample(1, p.duration)];
        expect(Math.hypot(end[0].x - end[1].x, end[0].y - end[1].y)).toBeGreaterThanOrEqual(base.size * 1.05);
        for (let t = 0; t <= p.duration; t += 1 / 30) {
          const a = p.sample(0, t);
          const b = p.sample(1, t);
          if (a.z < base.size * 0.2 && b.z < base.size * 0.2) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(base.size * 0.9);
        }
      }
    }
  });
});
