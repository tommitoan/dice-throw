# dice-throw

A dice throw for the browser with its own physics, and a hold-to-charge throw button.

The faces are decided first (by a game server, or by `Math.random`); the throw is then planned so
that it flies, bounces, rolls and comes to rest showing exactly those faces. The whole throw is
worked out before it is played, so the sounds (every landing and collision, with its strength and
time) are known in advance and the result is the same on every device.

## Use

```jsx
import { DiceThrow, RollHoldButton } from 'dice-throw';

<DiceThrow faces={[3, 5]} strength={1.1} onSettled={() => {}} onSound={(kind, { power }) => play(kind, power)} />
<RollHoldButton onRoll={(strength) => send(strength)}>Hold to throw</RollHoldButton>
```

`DiceThrow` is positioned absolutely inside a sized, positioned parent. `onPlan(plan)` receives the planned throw. `strength` runs from 0.65
(a tap) to 1.45 (a full charge). The package plays no audio: pass `onSound` to hear the throw.

The look of the dice: `look` is one of `'ivory'` (default, dark pips with red 1 and 4), `'obsidian'`, `'ruby'`, `'sapphire'`, `'jade'`
(opaque, white pips) or `'glass'` (translucent, dark pips). The looks are in `LOOKS` (`src/looks.js`); each one fixes body, shade, gloss and
pip colours together so pips always stand out.

The physics alone, without React:

```js
import { planThrow, layoutFor } from 'dice-throw/engine';

const plan = planThrow({ width: 220, height: 220, size: 30, strength: 1.1, count: 2 });
plan.sample(0, t); // { x, y, z, m, q, ax, ay, az } of the first die at time t (m: 3x3 row-major orientation)
plan.rest;         // per die at rest: { facing, tilt, heading } (tilt in degrees from lying flat)
plan.duration;     // seconds until both dice rest
plan.events;       // [{ t, kind, power }, ...] landings and collisions, for sound
```

## Physics

Each die is a rigid cube (position, velocity, orientation, spin) stepped at 240 Hz. Contacts of a corner with the dish
and of one cube with another are resolved with impulses (restitution and Coulomb friction), so nothing about how a
die turns over or where it lies is scripted: it lies flat at any heading, or leans on the sloped rim or on the
other die. A throw ends when every die has stopped, so its length is not fixed. A light throw drops the dice near the middle; a hard one hurls them round the dish in a random direction. The faces are painted afterwards so the top one is the number the server rolled.

Every setting can be overridden with `physics` (a prop of `DiceThrow`, an option of `planThrow`); the demo page has a
slider for each. Defaults are in `PHYSICS`:

| setting | default | effect |
|---|---|---|
| `gravity` | 2100 | px/s²; lower is floatier |
| `floorBounce`, `wallBounce`, `dieBounce` | 0.8, 0.7, 0.8 | share of the approach speed that comes back |
| `floorFriction`, `dieFriction`, `wallFriction` | 0.25, 0.2, 0.015 | grip; high friction turns sliding into rolling sooner |
| `rimAngle`, `rimWidth` | 18°, 0.7 | the sloped rim of the dish (width in die widths); 0 gives a flat dish with a wall |
| `spinChance` | 0.02 | chance per die of leaving the hand spinning very fast (45-60 rad/s) |
| `spin` | 1 | multiplier on the spin a throw starts with |
| `settle` | 1 | multiplier on the damping that brings dice to rest |

## Develop

```bash
npm install
npm test        # physics invariants and the hold button
npm run dev     # demo page at http://localhost:5190
```

The demo page throws 1-4 dice with a chosen strength or a held charge, can force the faces,
shows the plan (duration, bounces) and every sound event, and has a stress test that runs 400
throws and checks that the dice rest flat, stay inside the dish and keep apart.

## Status

Version 0.2: rigid-body physics (earlier versions scripted quarter-turn flips). License: not chosen yet.
