import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planThrow, layoutFor, normalOfMatrix, dishOf, SIDES } from './dice-throw.js';
import './dice-throw.css';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// Light from above, left and in front: faces turned toward it are bright, faces turned away dim.
const LIGHT = (() => { const v = [-0.35, -0.55, 0.76]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
// Outer diameter of the dish as a multiple of the diameter of its floor.
export const DISH_RIM = 1.22;
// Dice are drawn at 80% of what they once were: a pair then reads as small objects in a dish.
const sizeFor = (width) => Math.round(Math.min(46, Math.max(22, width * 0.14)) * 0.8);

function Die({ layout, size, look, dieRef, shadowRef }) {
  return <>
    <span className="dt-shadow" ref={shadowRef} style={{ width: size, height: size }} />
    <span className="dt-die" ref={dieRef} style={{ width: size, height: size, '--dt-size': `${size}px`, ...look }}>
      <span className="dt-cube">
        {/* A solid core just inside the faces: their rounded corners would otherwise leave dark notches at the cube's corners. */}
        <span className="dt-core" aria-hidden="true">{SIDES.map((side) => <span key={side} className={`dt-core-face dt-core-${side}`} />)}</span>
        {SIDES.map((side) => <span key={side} className={`dt-face dt-${side}`} data-side={side}>
          {Array.from({ length: 9 }, (_, index) => PIPS[layout[side]].includes(index)
            ? <i key={index} className={`dt-pip ${!look['--dt-pip'] && (layout[side] === 1 || layout[side] === 4) ? 'dt-pip-red' : ''} ${layout[side] === 1 ? 'dt-pip-one' : ''}`} />
            : <i key={index} />)}
        </span>)}
      </span>
    </span>
  </>;
}

// A throw drawn with CSS 3D transforms from a plan worked out in dice-throw.js. `snap` skips the
// flight and shows the dice at rest (a hidden or very slow window must not hold the table);
// `onSettled` is called once, when they stop. `speed` plays the throw faster for a throw nobody is
// waiting for. `onSound(kind, { power })` is called for the throw's sounds (the cup shake at the start,
// then every landing and collision at its time); the package plays no audio itself. `onPlan(plan)`
// receives the planned throw (frames, events, duration) once it is worked out, for tests and tools.
// `physics` overrides any of the physics settings (see PHYSICS in dice-throw.js).
// `dieColor` is any CSS colour for the body of the dice (white by default), `dieOpacity` runs from 0.15
// (glass) to 1 (solid), and `pipColor` paints every pip (by default they are dark, and red on 1 and 4).
export default function DiceThrow({ faces, strength, snap = false, speed = 1, physics, dieColor = '#ffffff', dieOpacity = 1, pipColor, onSettled, onSound, onPlan }) {
  const sceneRef = useRef(null);
  const dieRefs = useRef([]);
  const shadowRefs = useRef([]);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const soundRef = useRef(onSound);
  soundRef.current = onSound;
  const planRef = useRef(onPlan);
  planRef.current = onPlan;
  const values = faces.filter((value) => Number.isInteger(value));
  const key = values.join(',');
  const [setup, setSetup] = useState(null);
  const alpha = Math.min(1, Math.max(0.15, Number.isFinite(dieOpacity) ? dieOpacity : 1));
  const look = { '--dt-body': dieColor, '--dt-alpha': alpha, ...(pipColor ? { '--dt-pip': pipColor, '--dt-pip-hi': `color-mix(in srgb, ${pipColor} 70%, #ffffff)` } : {}) };
  const alphaRef = useRef(alpha);
  alphaRef.current = alpha;

  // Plan the whole throw first: the faces are painted so the one that ends up on top is the one rolled.
  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const width = scene?.clientWidth || 220;
    const height = scene?.clientHeight || width;
    const size = sizeFor(width);
    const plan = planThrow({ width, height, size, strength, count: values.length, physics });
    planRef.current?.(plan);
    setSetup({ plan, size, dish: dishOf(width, height, size), layouts: values.map((value, i) => layoutFor(value, plan.facing[i])) });
  }, [key]);

  useEffect(() => {
    if (!setup) return undefined;
    const { plan, size } = setup;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const draw = (t) => values.forEach((_, i) => {
      const die = dieRefs.current[i];
      const shadow = shadowRefs.current[i];
      if (!die) return;
      const pose = plan.sample(i, t);
      // Height is shown by scale, not by depth: each die has its own perspective, centred on itself,
      // so a die at rest is seen straight down and shows only its top face, wherever it lies.
      die.style.transform = `translate(${pose.x - size / 2}px, ${pose.y - size / 2}px) scale(${(1 + pose.z / 520).toFixed(3)})`;
      const m = pose.m;
      die.firstChild.style.transform = `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;
      for (const face of die.firstChild.children) {
        if (!face.dataset.side) continue;
        const n = normalOfMatrix(face.dataset.side, m);
        const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        face.style.setProperty('--sh', (0.95 + 0.05 * lit).toFixed(3));
      }
      if (shadow) {
        const lift = Math.min(1, pose.z / 260);
        shadow.style.transform = `translate(${pose.x - size / 2 + pose.z * 0.12}px, ${pose.y - size / 2 + pose.z * 0.2 + size * 0.1}px) scale(${1 + lift * 0.5})`;
        shadow.style.opacity = String((0.4 - lift * 0.25) * (0.35 + 0.65 * alphaRef.current));
      }
    });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      draw(plan.duration);
      settledRef.current?.();
    };
    if (snap || reduced) { finish(); return undefined; }
    draw(0);
    soundRef.current?.('cup', { power: 0.35 + 0.5 * Math.min(1, Math.max(0, ((strength ?? 0.78) - 0.7) / 0.7)) });
    let frame = 0;
    let start = 0;
    let next = 0;
    const tick = (now) => {
      if (!start) start = now;
      const t = ((now - start) / 1000) * speed;
      while (next < plan.events.length && plan.events[next].t <= t) { soundRef.current?.(plan.events[next].kind, { power: plan.events[next].power }); next += 1; }
      draw(Math.min(t, plan.duration));
      if (t >= plan.duration) finish(); else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [setup, snap]);

  // The dish the dice are thrown in. Its floor is the circle the dice stay inside, so the edge of
  // the picture is where the physics ends; the rim is drawn outside that circle.
  const rim = DISH_RIM;
  const diameter = setup ? setup.dish.floor * 2 * rim : 0;
  return <div className="dt-scene" ref={sceneRef} aria-hidden="true">
    {setup && <span className="dt-dish" style={{ left: setup.dish.cx - diameter / 2, top: setup.dish.cy - diameter / 2, width: diameter, height: diameter }} />}
    {setup && values.map((value, index) => <Die key={`${value}-${index}`} layout={setup.layouts[index]} size={setup.size} look={look}
      dieRef={(node) => { dieRefs.current[index] = node; }} shadowRef={(node) => { shadowRefs.current[index] = node; }} />)}
  </div>;
}
