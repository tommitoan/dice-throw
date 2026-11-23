// The physics of a dice throw, written for this game instead of taken from a library: the server
// has already decided the faces, so the throw only has to look right and end exactly on them.
//
// Units are pixels and seconds. A die has a ground position (x, y) and a height z above the yard.
// It is thrown from the lower edge of the yard, flies, lands, bounces and rolls out; it bounces off
// the yard walls and off the other die. A harder throw starts faster and higher, so it travels
// farther, bounces more times and takes longer to rest.
//
// A die is a cube with six flat faces, so it does not drift to a stop: in every flight between two
// landings it turns over by whole quarter turns, and it lands flat each time. The whole throw is
// worked out first (planThrow) and then played back, which has two uses: the faces can be painted
// so that the one that ends up on top is the one the server rolled, and the sounds of the throw
// (every landing and collision, with its strength) are known with their times.

const GRAVITY = 2100;
const BOUNCE = 0.7;         // share of the fall speed that comes back after a landing (hard glazed ceramic)
const WALL_BOUNCE = 0.62;
const LAND_FRICTION = 0.7;  // sideways speed kept after each landing
const ROLL_DAMPING = 4.2;    // per second, while sliding on the ground
const SPEED_LIMIT = 16;     // px/s under which a die counts as stopped
const HOP_MIN = 40;         // a landing slower than this (px/s of fall) does not bounce again
const MAX_SECONDS = 4.4;
const STEP = 1 / 120;
const DIE_GAP = 1.1;          // centre-to-centre distance two dice keep, in die widths: a little air between neighbours
const FRAME = 1 / 60;

export const SIDES = ['front', 'back', 'top', 'bottom', 'right', 'left'];
const NORMALS = { front: [0, 0, 1], back: [0, 0, -1], top: [0, -1, 0], bottom: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0] };
const OPPOSITE = { front: 'back', back: 'front', top: 'bottom', bottom: 'top', right: 'left', left: 'right' };

const rad = (deg) => (deg * Math.PI) / 180;
const rotX = ([x, y, z], a) => { const c = Math.cos(a); const s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; };
const rotY = ([x, y, z], a) => { const c = Math.cos(a); const s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; };
const rotZ = ([x, y, z], a) => { const c = Math.cos(a); const s = Math.sin(a); return [x * c - y * s, x * s + y * c, z]; };

// Where a face points once the cube is turned the way the page turns it (rotateX rotateY rotateZ).
export const normalOf = (side, ax, ay, az = 0) => rotX(rotY(rotZ(NORMALS[side], rad(az)), rad(ay)), rad(ax));

// The face that points at the viewer for a given orientation.
export function facingOf(ax, ay) {
  let best = 'front';
  let bestZ = -2;
  for (const side of SIDES) {
    const z = normalOf(side, ax, ay)[2];
    if (z > bestZ) { best = side; bestZ = z; }
  }
  return best;
}

// Which number to paint on each side so that `facing` shows `value` and opposite faces add to seven.
export function layoutFor(value, facing) {
  const rest = [1, 2, 3, 4, 5, 6].filter((face) => face !== value && face !== 7 - value);
  const pairs = [['top', 'bottom'], ['right', 'left'], ['front', 'back']].filter(([a, b]) => a !== facing && b !== facing);
  const layout = { [facing]: value, [OPPOSITE[facing]]: 7 - value };
  pairs.forEach(([a, b], i) => { layout[a] = rest[i * 2]; layout[b] = 7 - rest[i * 2]; });
  return layout;
}

// Strength is what the server keeps: 0.65-1.45, a tap about 0.78. 0 is a tap, 1 a full charge.
export const chargeOf = (strength) => Math.min(1, Math.max(0, ((Number.isFinite(strength) ? strength : 0.78) - 0.7) / 0.7));

// The dish the dice are thrown in: a circle in the middle of the scene. `floor` is the radius of its
// flat floor as drawn; the wall stands at the floor's edge, so a die's centre can only reach a
// die's half size short of it (a corner turns, so a little more than half).
export function dishOf(width, height, size) {
  const edge = Math.min(width, height);
  const floor = edge * 0.49;
  const radius = Math.max(size * 0.5, floor - size * 0.56);
  return { cx: width / 2, cy: height / 2, radius, floor };
}

export function planThrow({ width, height, size, strength = 0.78, count = 2, rng = Math.random }) {
  const charge = chargeOf(strength);
  // The yard is a round dish: dice stay inside a circle that the picture of the dish draws around
  // the throw. The box around that circle is what callers use to size things.
  const dish = dishOf(width, height, size);
  const { cx, cy, radius } = dish;
  const bounds = { minX: cx - radius, maxX: cx + radius, minY: cy - radius, maxY: cy + radius, cx, cy, radius };
  const speed = 320 + 840 * charge;
  const lift = 360 + 560 * charge;

  const dice = Array.from({ length: count }, (_, i) => {
    const lane = count === 1 ? 0.5 : 0.3 + 0.4 * i;
    const startX = width * lane + (rng() - 0.5) * size * 0.4;
    // Start low in the dish, on its rim at that lane.
    const reach = Math.min(Math.abs(startX - cx), radius * 0.85);
    const x = cx + Math.sign(startX - cx || 1) * reach;
    const y = cy + Math.sqrt(Math.max(0, radius * radius - reach * reach)) - size * 0.2;
    const nx = (x - cx) / radius;
    const ny = (y - cy) / radius;
    const tangent = (rng() - 0.5) * 1.2;
    const aimX = -nx - ny * tangent;
    const aimY = -ny + nx * tangent;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    return {
      x,
      y,
      z: size * 0.6,
      vx: speed * aimX / aimLength * (0.8 + 0.35 * rng()),
      vy: speed * aimY / aimLength * (0.8 + 0.35 * rng()),
      vz: lift * (0.85 + 0.3 * rng()),
      ax: 0, ay: 0,                               // the turns about the two flip axes
      yaw0: (rng() - 0.5) * 120,                  // the yaw at the start of the throw
      yawRate: (rng() < 0.5 ? -1 : 1) * (140 + 260 * rng()) * (0.6 + charge), // deg/s while in the air
      flights: [],                                // when the die was in the air: { t0, t1 }
      flip: null, resting: false, bounces: 0,
    };
  });

  const frames = dice.map(() => []);
  const events = [];
  let peakZ = 0;
  let time = 0;
  let bounceCount = 0;

  // A flight starts: choose how many quarter turns it will turn over, finishing as it lands.
  function startFlight(d) {
    d.flights.push({ t0: time, t1: null });
    const flight = (d.vz + Math.sqrt(d.vz * d.vz + 2 * GRAVITY * d.z)) / GRAVITY;
    const peak = d.z + (d.vz * d.vz) / (2 * GRAVITY);
    let quarters = 0;
    if (peak > size * 1.3) quarters = 2 + Math.floor(rng() * 3);
    else if (peak > size * 0.2) quarters = 1 + (rng() < 0.3 ? 1 : 0);
    if (quarters === 0) { d.flip = null; return; }
    const axis = rng() < 0.5 ? 'ax' : 'ay';
    const sign = rng() < 0.5 ? -1 : 1;
    d.flip = { axis, from: d[axis], to: d[axis] + sign * 90 * quarters, t0: time, dur: Math.max(flight * 0.9, STEP) };
  }
  dice.forEach(startFlight);

  const record = () => dice.forEach((d, i) => frames[i].push({ x: d.x, y: d.y, z: d.z, ax: d.ax, ay: d.ay, az: 0 }));
  record();

  let done = false;
  let tick = 0;
  while (!done) {
    time += STEP;
    for (const d of dice) {
      if (d.resting) continue;
      d.vz -= GRAVITY * STEP;
      d.x += d.vx * STEP;
      d.y += d.vy * STEP;
      d.z += d.vz * STEP;
      if (d.z > peakZ) peakZ = d.z;
      if (d.flip) {
        const u = Math.min(1, (time - d.flip.t0) / d.flip.dur);
        d[d.flip.axis] = d.flip.from + (d.flip.to - d.flip.from) * u;
        if (u >= 1) d.flip = null;
      }
      if (d.z <= 0) {
        const fall = -d.vz;
        d.z = 0;
        const open = d.flights[d.flights.length - 1];
        if (open && open.t1 === null) open.t1 = time;
        if (fall > 90) events.push({ t: time, kind: 'floor', power: Math.min(1, fall / 800) });
        if (fall > HOP_MIN) {
          d.vz = fall * BOUNCE;
          d.vx *= LAND_FRICTION;
          d.vy *= LAND_FRICTION;
          d.bounces += 1;
          bounceCount += 1;
          startFlight(d);
        } else {
          d.vz = 0;
        }
      }
      if (d.z === 0 && d.vz === 0) {
        const damp = Math.exp(-ROLL_DAMPING * STEP);
        d.vx *= damp;
        d.vy *= damp;
      }
      const wall = (hit, speedAlong) => { if (speedAlong > 120) events.push({ t: time, kind: 'wall', power: Math.min(1, speedAlong / 700) }); return hit; };
      // The wall of the dish: past the circle, put the die back on it and bounce its speed off the wall's normal.
      const ox = d.x - cx;
      const oy = d.y - cy;
      const away = Math.hypot(ox, oy);
      if (away > radius) {
        const nx = ox / away;
        const ny = oy / away;
        d.x = cx + nx * radius;
        d.y = cy + ny * radius;
        const outward = d.vx * nx + d.vy * ny;
        if (outward > 0) {
          wall(0, outward);
          d.vx -= (1 + WALL_BOUNCE) * outward * nx;
          d.vy -= (1 + WALL_BOUNCE) * outward * ny;
        }
      }
    }
    // Two dice never share a spot: push them apart and swap their approach speeds.
    for (let i = 0; i < dice.length; i += 1) {
      for (let j = i + 1; j < dice.length; j += 1) {
        const a = dice[i];
        const b = dice[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const gap = size * DIE_GAP;
        if (dist < gap && Math.abs(a.z - b.z) < size * 0.9) {
          const nx = dx / dist;
          const ny = dy / dist;
          const push = (gap - dist) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const va = a.vx * nx + a.vy * ny;
          const vb = b.vx * nx + b.vy * ny;
          if (va - vb > 0) {
            const swap = (vb - va) * 0.9;
            a.vx += nx * swap; a.vy += ny * swap; b.vx -= nx * swap; b.vy -= ny * swap;
            if (va - vb > 90) events.push({ t: time, kind: 'die', power: Math.min(1, (va - vb) / 700) });
          }
          a.resting = false; b.resting = false;
        }
      }
    }
    // Pushing two dice apart can push one through the wall, and the wall pushes it back into the
    // other: settle the two constraints together a few times so no pair ever ends up overlapping.
    for (let pass = 0; pass < 4; pass += 1) {
      for (let i = 0; i < dice.length; i += 1) {
        for (let j = i + 1; j < dice.length; j += 1) {
          const a = dice[i];
          const b = dice[j];
          if (Math.abs(a.z - b.z) >= size * 0.9) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const gap = size * DIE_GAP;
          if (dist >= gap) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          const push = (gap - dist) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
      for (const d of dice) {
        const ox = d.x - cx;
        const oy = d.y - cy;
        const away = Math.hypot(ox, oy);
        if (away > radius) { d.x = cx + (ox / away) * radius; d.y = cy + (oy / away) * radius; }
      }
    }
    for (const d of dice) {
      if (!d.resting && d.z === 0 && d.vz === 0 && !d.flip && Math.hypot(d.vx, d.vy) < SPEED_LIMIT) { d.resting = true; d.vx = 0; d.vy = 0; }
    }
    tick += 1;
    if (tick % 2 === 0) record();
    if (dice.every((d) => d.resting) || time > MAX_SECONDS) {
      done = true;
      for (const d of dice) {
        if (d.flip) { d[d.flip.axis] = d.flip.to; d.flip = null; }
        d.z = 0; d.vx = 0; d.vy = 0; d.vz = 0; d.resting = true;
        const open = d.flights[d.flights.length - 1];
        if (open && open.t1 === null) open.t1 = time;
      }
      record();
    }
  }

  // The yaw: a die turns about its vertical axis only while it is in the air, as a real one does,
  // and the turn of each flight is trimmed so that the yaw at the last landing is a whole number
  // of turns: the die lies squarely, at exactly 0 degrees, without ever being turned on the ground.
  const frameCount = frames[0].length;
  dice.forEach((d, i) => {
    const airtime = d.flights.reduce((sum, f) => sum + (f.t1 - f.t0), 0) || 1;
    const natural = d.yaw0 + d.yawRate * airtime;
    const trim = 360 * Math.round(natural / 360) - natural;           // the shortest turn that squares it up
    const rate = d.yawRate + trim / airtime;
    frames[i].forEach((frame, f) => {
      const t = f * FRAME;
      let flown = 0;
      for (const flight of d.flights) flown += Math.max(0, Math.min(t, flight.t1) - flight.t0);
      frame.az = d.yaw0 + rate * flown;
    });
    // the end of the throw is the sum of all flights: that is a whole number of turns by construction
    const end = frames[i][frameCount - 1];
    end.az = 360 * Math.round(end.az / 360);
  });
  const facing = dice.map((d) => facingOf(d.ax, d.ay));
  return {
    frames, events, facing, bounds,
    duration: (frameCount - 1) * FRAME,
    peakHeight: peakZ,
    bounces: bounceCount,
    floorHits: events.filter((e) => e.kind === 'floor').length,
    // The pose of die `i` at time `t`, between the two nearest recorded frames.
    sample(i, t) {
      let at = Math.min(Math.max(t / FRAME, 0), frameCount - 1);
      if (frameCount - 1 - at < 1e-6) at = frameCount - 1; // the end of the throw is exactly the last frame, not a rounding of it
      const lo = Math.floor(at);
      const hi = Math.min(lo + 1, frameCount - 1);
      const k = at - lo;
      const a = frames[i][lo];
      const b = frames[i][hi];
      const mix = (p) => a[p] + (b[p] - a[p]) * k;
      return { x: mix('x'), y: mix('y'), z: mix('z'), ax: mix('ax'), ay: mix('ay'), az: mix('az') };
    },
  };
}
