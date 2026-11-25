// The physics of a dice throw, written for this game instead of taken from a library: the server
// has already decided the faces, so the throw only has to look right and end exactly on them.
//
// Each die is a rigid cube: a position, a velocity, an orientation and a spin. Units are pixels and
// seconds; x is right, y is down the screen and z is the height above the dish (toward the viewer).
// A die is thrown from the lower edge of the dish, flies with its spin unchanged, and every contact
// (a corner on the floor, an edge on the rim, a face on another die) is resolved with impulses that
// follow from the geometry: a cube that lands on a corner kicks and tumbles, one that lands flat
// bounces and slides, friction turns sliding into rolling and the rest takes care of itself. Nothing
// about how it turns over is scripted, so nothing about where it ends up is either: a die lies flat
// on the floor at any heading, or leans on the sloped rim or on the other die.
//
// The whole throw is worked out first (planThrow) and then played back, which has two uses: the faces
// are painted afterwards so that the one that ends up on top is the one the server rolled, and the
// sounds of the throw (every landing and collision, with its strength) are known with their times.

// Everything that can be tuned. Pass a partial object as `physics` to planThrow to override.
export const PHYSICS = {
  gravity: 2100,        // px/s squared
  floorBounce: 0.5,     // share of the approach speed that comes back from the dish floor (glazed ceramic on felt)
  floorFriction: 0.5,   // Coulomb friction between a die and the floor
  wallBounce: 0.45,     // the same for the wall of the dish
  wallFriction: 0.3,
  dieBounce: 0.5,       // and between two dice
  dieFriction: 0.3,
  rimAngle: 12,         // degrees: how steeply the floor of the dish rises toward the wall
  rimWidth: 0.7,        // width of that sloped rim, in die widths
  spin: 1,              // multiplier on the spin a throw starts with
  spinChance: 0.02,     // chance, per die, that it lands flat with a spin and keeps turning for a while
  settle: 1,            // multiplier on the damping that brings a die to rest
};

const FRAME = 1 / 60;
const STEP = FRAME / 4;        // the physics runs four times per recorded frame
const MAX_SECONDS = 20;        // a safety stop only: a throw ends when every die has stopped
const ITERATIONS = 10;         // passes of the contact solver per step
const SLOP = 0.05;             // px of penetration that is left alone
const REST_SPEED = 50;         // px/s of approach under which a contact does not bounce
const SLEEP_SPEED = 18;        // px/s and rad/s under which a supported die counts as stopped
const SLEEP_SPIN = 0.8;
const SLEEP_TIME = 0.1;
const SLEEP_WEDGED = 0.35;
const COCKED = 24;             // degrees of lean past which a die that has stopped is nudged to fall flat

export const SIDES = ['front', 'back', 'top', 'bottom', 'right', 'left'];
const NORMALS = { front: [0, 0, 1], back: [0, 0, -1], top: [0, -1, 0], bottom: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0] };
const OPPOSITE = { front: 'back', back: 'front', top: 'bottom', bottom: 'top', right: 'left', left: 'right' };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const rotX = ([x, y, z], a) => { const c = Math.cos(a); const s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; };
const rotY = ([x, y, z], a) => { const c = Math.cos(a); const s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; };
const rotZ = ([x, y, z], a) => { const c = Math.cos(a); const s = Math.sin(a); return [x * c - y * s, x * s + y * c, z]; };

// Where a face points once the cube is turned the way the page turns it (rotateX rotateY rotateZ).
export const normalOf = (side, ax, ay, az = 0) => rotX(rotY(rotZ(NORMALS[side], rad(az)), rad(ay)), rad(ax));

// The same for an orientation given as a row-major 3x3 matrix (what a pose carries as `m`).
export const normalOfMatrix = (side, m) => {
  const [x, y, z] = NORMALS[side];
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
};

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

export function facingOfMatrix(m) {
  let best = 'front';
  let bestZ = -2;
  for (const side of SIDES) {
    const z = normalOfMatrix(side, m)[2];
    if (z > bestZ) { best = side; bestZ = z; }
  }
  return best;
}

// The angles rotateX rotateY rotateZ would need to give an orientation matrix (for tools that want them).
export const eulerOf = (m) => ({
  ax: deg(Math.atan2(-m[5], m[8])),
  ay: deg(Math.asin(Math.max(-1, Math.min(1, m[2])))),
  az: deg(Math.atan2(-m[1], m[0])),
});

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
// edge as drawn, where the wall stands; a die's centre can come no closer to the wall than half a die.
export function dishOf(width, height, size) {
  const edge = Math.min(width, height);
  const floor = edge * 0.49;
  const radius = Math.max(size * 0.5, floor - size * 0.5);
  return { cx: width / 2, cy: height / 2, radius, floor };
}

// --- small vector and rotation helpers -------------------------------------------------------------

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function matrixOf(q) {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function randomQuaternion(rng) {
  const u1 = rng();
  const u2 = rng() * 2 * Math.PI;
  const u3 = rng() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

function slerp(a, b, k) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = d < 0 ? -1 : 1;
  d *= sign;
  let wa = 1 - k;
  let wb = k;
  if (d < 0.9995) {
    const theta = Math.acos(d);
    const s = Math.sin(theta);
    wa = Math.sin((1 - k) * theta) / s;
    wb = Math.sin(k * theta) / s;
  }
  const out = [0, 1, 2, 3].map((i) => wa * a[i] + wb * sign * b[i]);
  const n = Math.hypot(...out);
  return out.map((v) => v / n);
}


// Contacts between two cubes by the separating-axis test: the axis along which they overlap least is
// the contact normal. Face contacts give the corners of one cube that lie in the face of the other; an
// edge crossing an edge gives one point. Each contact pushes `a` along `n` and `b` the other way.
function pairContacts(A, B, d, cornersA, cornersB, contacts, P) {
  const half = A.half;
  const axesOf = (D) => [0, 1, 2].map((k) => [D.m[k], D.m[3 + k], D.m[6 + k]]);
  const ax = axesOf(A);
  const bx = axesOf(B);
  const overlapOn = (l) => {
    let reach = 0;
    for (let k = 0; k < 3; k += 1) reach += Math.abs(dot(ax[k], l)) + Math.abs(dot(bx[k], l));
    return half * reach - Math.abs(dot(d, l));
  };
  let face = null;
  const faceAxes = [...ax.map((l) => ({ l, owner: A })), ...bx.map((l) => ({ l, owner: B }))];
  for (const { l, owner } of faceAxes) {
    const overlap = overlapOn(l);
    if (overlap <= 0) return;
    if (!face || overlap < face.overlap) face = { overlap, l, owner };
  }
  let edge = null;
  for (const u of ax) {
    for (const v of bx) {
      const c = cross(u, v);
      const len = Math.hypot(...c);
      if (len < 1e-3) continue;
      const l = c.map((x) => x / len);
      const overlap = overlapOn(l);
      if (overlap <= 0) return;
      if (!edge || overlap < edge.overlap) edge = { overlap, l };
    }
  }
  const towardB = (l) => (dot(d, l) >= 0 ? l : l.map((x) => -x));
  if (edge && edge.overlap < face.overlap * 0.85) {
    const l = towardB(edge.l);
    const support = (list, sign) => list.reduce((best, p) => (sign * dot(p, l) > sign * dot(best, l) ? p : best));
    const pa = support(cornersA, 1);
    const pb = support(cornersB, -1);
    const p = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    contacts.push({ a: B, b: A, kind: 'die', n: l, depth: edge.overlap, ra: [p[0] - B.p[0], p[1] - B.p[1], p[2] - B.p[2]], rb: [p[0] - A.p[0], p[1] - A.p[1], p[2] - A.p[2]], mu: P.dieFriction, e: P.dieBounce });
    return;
  }
  // The reference cube owns the face; the other one is the incident cube whose corners touch it.
  const ref = face.owner;
  const inc = ref === A ? B : A;
  const incCorners = ref === A ? cornersB : cornersA;
  const refAxes = ref === A ? ax : bx;
  const l = towardB(face.l);
  const n = ref === A ? l : l.map((x) => -x);             // from the reference cube toward the incident one
  const k = refAxes.findIndex((axis) => Math.abs(dot(axis, face.l)) > 0.999999);
  const others = refAxes.filter((_, index) => index !== k);
  const scored = incCorners.map((v) => {
    const rel = [v[0] - ref.p[0], v[1] - ref.p[1], v[2] - ref.p[2]];
    return { v, rel, depth: half - dot(rel, n), inside: others.every((axis) => Math.abs(dot(rel, axis)) <= half + 0.3) };
  });
  const deepest = Math.max(...scored.filter((c) => c.inside).map((c) => c.depth), -Infinity);
  if (!(deepest > -0.2)) return;
  for (const c of scored) {
    if (!c.inside || c.depth < deepest - 0.6 || c.depth < -0.2) continue;
    contacts.push({ a: inc, b: ref, kind: 'die', n, depth: Math.max(0, c.depth), ra: [c.v[0] - inc.p[0], c.v[1] - inc.p[1], c.v[2] - inc.p[2]], rb: c.rel, mu: P.dieFriction, e: P.dieBounce });
  }
}

// --- the throw ---------------------------------------------------------------------------------------

export function planThrow({ width, height, size, strength = 0.78, count = 2, rng = Math.random, physics }) {
  const P = { ...PHYSICS, ...physics };
  const charge = chargeOf(strength);
  const dish = dishOf(width, height, size);
  const { cx, cy, radius, floor } = dish;
  const bounds = { minX: cx - radius, maxX: cx + radius, minY: cy - radius, maxY: cy + radius, cx, cy, radius };
  const half = size / 2;
  const inertia = (size * size) / 6;           // a cube of unit mass turns about any axis through its centre like this
  const offsets = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) offsets.push([sx * half, sy * half, sz * half]);

  // The dish: a flat floor, a rim that rises at `rimAngle` toward the wall, then the wall itself.
  const wallAt = floor;
  const rimStart = Math.max(size, floor - size * P.rimWidth);
  const tanRim = Math.tan(rad(P.rimAngle));
  const sinRim = Math.sin(rad(P.rimAngle));
  const cosRim = Math.cos(rad(P.rimAngle));

  // How the dice are thrown depends on the hand. A light throw lets the two dice drop from a little
  // above the middle of the dish with hardly any sideways speed; a hard one hurls them along the wall in
  // one direction (either one, at random) so that they are carried round the dish before they slow.
  const swirl = smooth(0.12, 0.7, charge);
  const turn = rng() < 0.5 ? -1 : 1;
  const heading = rng() * 2 * Math.PI;
  const startRadius = Math.max(0, radius - size * 0.95);
  const gap = Math.max(0.55, (2.3 * size) / Math.max(startRadius, 1));

  const dice = Array.from({ length: count }, (_, i) => {
    const dropAngle = heading + (2 * Math.PI * i) / count;
    const dropSpread = count > 1 ? size * (0.75 + 0.3 * rng()) : size * 0.3 * rng();
    const rimAngle = heading + gap * (i - (count - 1) / 2);
    const x = cx + (1 - swirl) * Math.cos(dropAngle) * dropSpread + swirl * Math.cos(rimAngle) * startRadius;
    const y = cy + (1 - swirl) * Math.sin(dropAngle) * dropSpread + swirl * Math.sin(rimAngle) * startRadius;
    // Round the dish, with a little pull inward so the die meets the wall at a slant.
    const around = swirl * (850 + 1000 * charge) * (0.85 + 0.3 * rng());
    const inward = swirl * 140 * rng();
    const drift = (1 - swirl) * 70 * rng();
    const driftAngle = rng() * 2 * Math.PI;
    const vx = -turn * Math.sin(rimAngle) * around - Math.cos(rimAngle) * inward + Math.cos(driftAngle) * drift;
    const vy = turn * Math.cos(rimAngle) * around - Math.sin(rimAngle) * inward + Math.sin(driftAngle) * drift;
    const vz = (1 - swirl) * 80 * rng() + swirl * (260 + 360 * charge) * (0.7 + 0.5 * rng());
    const z = half + size * ((1 - swirl) * (1.6 + 1.3 * rng() + 0.9 * (i % 2)) + swirl * (0.6 + 0.9 * (i % 2)));
    // The spin the hand gives: a random axis, faster for a harder throw.
    const axis = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    const axisLength = Math.hypot(...axis) || 1;
    const rate = (3 + 26 * charge) * (0.6 + 0.8 * rng()) * P.spin;
    const q = randomQuaternion(rng);
    return {
      p: [x, y, z], v: [vx, vy, vz],
      w: axis.map((a) => (a / axisLength) * rate),
      q, m: matrixOf(q),
      half, asleep: false, calm: 0, kicks: 0, touch: false, near: 0, stack: 0,
      spinner: rng() < P.spinChance, glide: 0,
      last: { floor: -1, wall: -1, die: -1 },
    };
  });

  const frames = dice.map(() => []);
  const events = [];
  let peakZ = 0;
  let floorLanded = 0;
  let time = 0;

  const record = () => dice.forEach((d, i) => frames[i].push({ x: d.p[0], y: d.p[1], z: d.p[2] - half, q: d.q.slice() }));
  record();

  const velocityAt = (d, r) => { const c = cross(d.w, r); return [d.v[0] + c[0], d.v[1] + c[1], d.v[2] + c[2]]; };
  const relative = (c) => {
    const va = velocityAt(c.a, c.ra);
    if (!c.b) return va;
    const vb = velocityAt(c.b, c.rb);
    return [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]];
  };
  const effective = (c, dir) => {
    const ca = cross(c.ra, dir);
    let k = 1 + dot(ca, ca) / inertia;
    if (c.b) { const cb = cross(c.rb, dir); k += 1 + dot(cb, cb) / inertia; }
    return k;
  };
  const impulse = (c, J) => {
    const { a, b } = c;
    a.v[0] += J[0]; a.v[1] += J[1]; a.v[2] += J[2];
    const ta = cross(c.ra, J);
    a.w[0] += ta[0] / inertia; a.w[1] += ta[1] / inertia; a.w[2] += ta[2] / inertia;
    if (b) {
      b.v[0] -= J[0]; b.v[1] -= J[1]; b.v[2] -= J[2];
      const tb = cross(c.rb, J);
      b.w[0] -= tb[0] / inertia; b.w[1] -= tb[1] / inertia; b.w[2] -= tb[2] / inertia;
    }
  };
  const sound = (d, kind, approach, scale, floorSpeed) => {
    if (approach <= floorSpeed) return;
    if (time - d.last[kind] < 0.03) return;
    d.last[kind] = time;
    events.push({ t: time, kind, power: Math.min(1, approach / scale) });
    if (kind === 'floor' && approach > 60) floorLanded += 1;
  };

  let step = 0;
  let done = false;
  while (!done) {
    time += STEP;
    step += 1;
    const settle = P.settle;

    // Forces and motion.
    for (const d of dice) {
      if (d.asleep) continue;
      d.v[2] -= P.gravity * STEP;
      if (d.touch) {
        const lin = Math.exp(-0.3 * settle * STEP);
        const ang = Math.exp(-0.6 * settle * STEP);
        d.v[0] *= lin; d.v[1] *= lin;
        d.w[0] *= ang; d.w[1] *= ang; d.w[2] *= ang;
      }
      const spin = Math.hypot(...d.w);
      if (spin > 60) d.w = d.w.map((s) => (s * 60) / spin);
      d.p[0] += d.v[0] * STEP; d.p[1] += d.v[1] * STEP; d.p[2] += d.v[2] * STEP;
      const [qw, qx, qy, qz] = d.q;
      const [wx, wy, wz] = d.w;
      const k = 0.5 * STEP;
      const q = [
        qw + k * (-wx * qx - wy * qy - wz * qz),
        qx + k * (wx * qw + wy * qz - wz * qy),
        qy + k * (wy * qw + wz * qx - wx * qz),
        qz + k * (wz * qw + wx * qy - wy * qx),
      ];
      const n = Math.hypot(...q);
      d.q = q.map((c) => c / n);
      d.m = matrixOf(d.q);
      if (d.p[2] - half > peakZ) peakZ = d.p[2] - half;
    }

    // Contacts: every corner against the dish, every corner of one die against the other cubes.
    const contacts = [];
    const corners = dice.map((d) => offsets.map((o) => [
      d.p[0] + d.m[0] * o[0] + d.m[1] * o[1] + d.m[2] * o[2],
      d.p[1] + d.m[3] * o[0] + d.m[4] * o[1] + d.m[5] * o[2],
      d.p[2] + d.m[6] * o[0] + d.m[7] * o[1] + d.m[8] * o[2],
    ]));
    dice.forEach((d, i) => {
      d.near = 0; d.stack = 0;
      if (d.asleep) return;
      corners[i].forEach((p) => {
        const ox = p[0] - cx;
        const oy = p[1] - cy;
        const away = Math.hypot(ox, oy);
        const rx = away > 1e-6 ? ox / away : 0;
        const ry = away > 1e-6 ? oy / away : 0;
        const ra = [p[0] - d.p[0], p[1] - d.p[1], p[2] - d.p[2]];
        if (away >= wallAt) {
          contacts.push({ a: d, b: null, kind: 'wall', n: [-rx, -ry, 0], depth: away - wallAt, ra, mu: P.wallFriction, e: P.wallBounce });
          return;
        }
        let n = [0, 0, 1];
        let gap = p[2];
        if (away > rimStart) {
          n = [-sinRim * rx, -sinRim * ry, cosRim];
          gap = (p[2] - (away - rimStart) * tanRim) * cosRim;
        }
        if (gap < 0.6) d.near += 1;
        if (gap < 0) contacts.push({ a: d, b: null, kind: 'floor', n, depth: -gap, ra, mu: P.floorFriction * (d.glide || 1), e: P.floorBounce });
      });
    });
    for (let i = 0; i < dice.length; i += 1) {
      for (let j = i + 1; j < dice.length; j += 1) {
        const A = dice[i];
        const B = dice[j];
        if (A.asleep && B.asleep) continue;
        const d = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]];
        if (dot(d, d) > 3 * size * size) continue;
        pairContacts(A, B, d, corners[i], corners[j], contacts, P);
      }
    }
    for (const c of contacts) {
      if (c.kind !== 'die') continue;
      if (c.n[2] > 0.5) c.a.stack += 1; else if (c.n[2] < -0.5) c.b.stack += 1;
    }

    // How fast each contact is closing, and how fast it should leave.
    for (const c of contacts) {
      c.approach = -dot(relative(c), c.n);
      c.target = c.approach > REST_SPEED ? c.e * c.approach : 0;
      c.kn = effective(c, c.n);
      c.accN = 0;
      c.accT = [0, 0, 0];
    }
    for (let it = 0; it < ITERATIONS; it += 1) {
      for (const c of contacts) {
        const rv = relative(c);
        const vn = dot(rv, c.n);
        const wanted = (c.target - vn) / c.kn;
        const acc = Math.max(0, c.accN + wanted);
        const dn = acc - c.accN;
        c.accN = acc;
        impulse(c, [c.n[0] * dn, c.n[1] * dn, c.n[2] * dn]);
        const after = relative(c);
        const along = dot(after, c.n);
        const slide = [after[0] - c.n[0] * along, after[1] - c.n[1] * along, after[2] - c.n[2] * along];
        const rate = Math.hypot(...slide);
        if (rate > 1e-6) {
          const t = slide.map((s) => s / rate);
          const jt = -rate / effective(c, t);
          const next = [c.accT[0] + t[0] * jt, c.accT[1] + t[1] * jt, c.accT[2] + t[2] * jt];
          const limit = c.mu * c.accN;
          const length = Math.hypot(...next);
          if (length > limit) { const s = limit / length; next[0] *= s; next[1] *= s; next[2] *= s; }
          impulse(c, [next[0] - c.accT[0], next[1] - c.accT[1], next[2] - c.accT[2]]);
          c.accT = next;
        }
      }
    }

    // Push overlaps apart. A die in several contacts is moved once for the deepest, not once per corner.
    const moved = new Map();
    for (const c of contacts) {
      const have = moved.get(c.a) || [0, 0, 0];
      const already = Math.max(0, dot(have, c.n));
      const need = Math.max(0, c.depth - SLOP) * 0.8 - already * (c.b ? 0.5 : 1);
      if (need <= 0) continue;
      const share = c.b ? 0.5 : 1;
      const push = need * share;
      c.a.p[0] += c.n[0] * push; c.a.p[1] += c.n[1] * push; c.a.p[2] += c.n[2] * push;
      moved.set(c.a, [have[0] + c.n[0] * push, have[1] + c.n[1] * push, have[2] + c.n[2] * push]);
      if (c.b) {
        const hb = moved.get(c.b) || [0, 0, 0];
        c.b.p[0] -= c.n[0] * push; c.b.p[1] -= c.n[1] * push; c.b.p[2] -= c.n[2] * push;
        moved.set(c.b, [hb[0] - c.n[0] * push, hb[1] - c.n[1] * push, hb[2] - c.n[2] * push]);
      }
    }

    // The sounds: the hardest contact of each kind, for each die, this step.
    const hardest = new Map();
    for (const c of contacts) {
      const key = `${dice.indexOf(c.a)}-${c.kind}`;
      if (!hardest.has(key) || hardest.get(key).approach < c.approach) hardest.set(key, c);
    }
    for (const c of hardest.values()) {
      if (c.kind === 'floor') sound(c.a, 'floor', c.approach, 800, 90);
      else if (c.kind === 'wall') sound(c.a, 'wall', c.approach, 700, 120);
      else if (c.b && dice.indexOf(c.a) < dice.indexOf(c.b)) sound(c.a, 'die', c.approach, 700, 90);
      else if (c.b && !c.b.asleep) sound(c.b, 'die', c.approach, 700, 90);
    }
    for (const d of dice) {
      d.touch = false;
    }
    for (const c of contacts) {
      c.a.touch = true;
      if (c.b) {
        c.b.touch = true;
        for (const sleeper of [c.a, c.b]) {
          if (!sleeper.asleep) continue;
          if (c.accN > 4) { sleeper.asleep = false; sleeper.calm = 0; } else { sleeper.v = [0, 0, 0]; sleeper.w = [0, 0, 0]; }
        }
      }
    }

    // A die that is supported and has stopped goes to sleep, so it stays exactly where it lies.
    for (const d of dice) {
      if (d.asleep) continue;
      const supported = d.near >= 3 || d.near + d.stack >= 3;
      const still = Math.hypot(...d.v) < SLEEP_SPEED && Math.hypot(...d.w) < SLEEP_SPIN;
      if (still && (supported || d.touch)) d.calm += STEP;
      else d.calm = 0;
      // Wedged against the wall or the other die, a die can stand still without lying on a face: that
      // takes longer to be sure of.
      if (d.calm >= (supported ? SLEEP_TIME : SLEEP_WEDGED)) {
        const up = normalOfMatrix(facingOfMatrix(d.m), d.m)[2];
        if (d.spinner && up > Math.cos(rad(3))) {
          // It has settled flat, but with a spin left in it: it turns on its face on a slick spot of the
          // glaze (`glide` is how little the floor grips it), and only that friction brings it to a stop.
          d.spinner = false; d.glide = 0.01 + 0.04 * rng(); d.calm = 0;
          d.w = [0, 0, (rng() < 0.5 ? -1 : 1) * (14 + 26 * rng())];
        } else if (up < Math.cos(rad(COCKED)) && d.kicks < 3) {
          // Cocked on its edge or leaning on the wall: a real die would be re-thrown, here it is nudged down.
          d.kicks += 1; d.calm = 0;
          const toward = Math.hypot(cx - d.p[0], cy - d.p[1]) || 1;
          d.v = [((cx - d.p[0]) / toward) * 90, ((cy - d.p[1]) / toward) * 90, 260];
          d.w = [(rng() - 0.5) * 6, (rng() - 0.5) * 6, 0];
        } else { d.asleep = true; d.v = [0, 0, 0]; d.w = [0, 0, 0]; }
      }
    }

    if (step % 4 === 0) record();
    if (dice.every((d) => d.asleep) || time > MAX_SECONDS) {
      done = true;
      for (const d of dice) { d.v = [0, 0, 0]; d.w = [0, 0, 0]; d.asleep = true; }
      if (step % 4 !== 0) record();
    }
  }

  const frameCount = frames[0].length;
  const atRest = dice.map((_, i) => frames[i][frameCount - 1]);
  const rest = atRest.map((end) => {
    const m = matrixOf(end.q);
    const facing = facingOfMatrix(m);
    const up = normalOfMatrix(facing, m);
    // The heading of the die about the vertical, folded to a quarter turn: all that tells two flat dice apart.
    const axisX = [m[0], m[3]];
    const heading = ((deg(Math.atan2(axisX[1], axisX[0])) % 90) + 90) % 90;
    return { facing, tilt: deg(Math.acos(Math.min(1, up[2]))), heading };
  });
  return {
    frames, events, bounds, rest,
    facing: rest.map((r) => r.facing),
    duration: (frameCount - 1) * FRAME,
    peakHeight: peakZ,
    bounces: floorLanded,
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
      const q = k === 0 ? a.q : slerp(a.q, b.q, k);
      const m = matrixOf(q);
      return { x: mix('x'), y: mix('y'), z: mix('z'), q, m, ...eulerOf(m) };
    },
  };
}
