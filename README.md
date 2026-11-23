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

The physics alone, without React:

```js
import { planThrow, layoutFor } from 'dice-throw/engine';

const plan = planThrow({ width: 220, height: 220, size: 30, strength: 1.1, count: 2 });
plan.sample(0, t); // { x, y, z, ax, ay, az } of the first die at time t (seconds)
plan.duration;     // seconds until both dice rest
plan.events;       // [{ t, kind, power }, ...] landings and collisions, for sound
```

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

Extracted from a Ludo game without changes to the physics. License: not chosen yet.
