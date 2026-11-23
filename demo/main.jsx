import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiceThrow, RollHoldButton, planThrow, chargeOf, SIDES } from 'dice-throw';
import './demo.css';

const randomFace = () => 1 + Math.floor(Math.random() * 6);

// A short synthetic thump, louder for a harder hit; no audio files are needed.
function makeSound() {
  let ctx = null;
  return (kind, { power = 0.5 } = {}) => {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'wall' ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(kind === 'die' ? 520 : kind === 'wall' ? 260 : 150, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    gain.gain.setValueAtTime(0.05 + 0.35 * power, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  };
}

// Runs many plans and checks what must hold for every throw: resting flat, inside the dish, apart
// from each other, in bounded time; and reports how evenly the dice end up on each side.
function stress({ count, size, stage, runs }) {
  const out = { runs, maxDuration: 0, meanDuration: 0, notFlat: 0, outside: 0, minGap: Infinity, maxBounces: 0, sides: Object.fromEntries(SIDES.map((s) => [s, 0])) };
  const quarter = (deg) => Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-6;
  for (let n = 0; n < runs; n += 1) {
    const strength = 0.65 + 0.8 * (n / (runs - 1 || 1));
    const plan = planThrow({ width: stage, height: stage, size, strength, count });
    out.maxDuration = Math.max(out.maxDuration, plan.duration);
    out.meanDuration += plan.duration / runs;
    out.maxBounces = Math.max(out.maxBounces, plan.bounces);
    const ends = Array.from({ length: count }, (_, i) => plan.sample(i, plan.duration));
    ends.forEach((end, i) => {
      if (end.z !== 0 || !quarter(end.ax) || !quarter(end.ay)) out.notFlat += 1;
      if (Math.hypot(end.x - plan.bounds.cx, end.y - plan.bounds.cy) > plan.bounds.radius + 0.01) out.outside += 1;
      out.sides[plan.facing[i]] += 1;
      for (let j = i + 1; j < count; j += 1) out.minGap = Math.min(out.minGap, Math.hypot(end.x - ends[j].x, end.y - ends[j].y) / size);
    });
  }
  return out;
}

function App() {
  const [count, setCount] = useState(2);
  const [stage, setStage] = useState(260);
  const [strength, setStrength] = useState(1);
  const [fixed, setFixed] = useState(false);
  const [picked, setPicked] = useState([3, 5, 1, 6]);
  const [snap, setSnap] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sound, setSound] = useState(false);
  const [throwId, setThrowId] = useState(0);
  const [faces, setFaces] = useState([3, 5]);
  const [thrown, setThrown] = useState(null);
  const [plan, setPlan] = useState(null);
  const [settled, setSettled] = useState(true);
  const [report, setReport] = useState(null);
  const play = useMemo(makeSound, []);
  const soundOn = useRef(sound);
  soundOn.current = sound;

  const throwDice = (power) => {
    const next = Array.from({ length: count }, (_, i) => (fixed ? picked[i] : randomFace()));
    setFaces(next);
    setThrown(power);
    setSettled(false);
    setPlan(null);
    setThrowId((id) => id + 1);
  };

  const size = Math.round(Math.min(46, Math.max(22, stage * 0.14)) * 0.8);

  return (
    <main>
      <section className="panel">
        <h1>dice-throw</h1>
        <p className="muted" style={{ margin: 0, color: 'var(--muted)' }}>Faces are decided first; the throw lands on them. Hold the button to charge, release to throw.</p>
        <div className="stage-wrap">
          <div className="stage" style={{ width: stage, height: stage }}>
            {thrown != null && <DiceThrow key={throwId} faces={faces} strength={thrown} snap={snap} speed={speed}
              onPlan={setPlan} onSettled={() => setSettled(true)}
              onSound={(kind, info) => { if (soundOn.current) play(kind, info); }} />}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <RollHoldButton onRoll={throwDice} disabled={!settled}>Hold to throw {count === 1 ? '1 die' : `${count} dice`}</RollHoldButton>
          <button type="button" onClick={() => throwDice(strength)} disabled={!settled}>Throw at slider strength</button>
        </div>
        <p style={{ textAlign: 'center', margin: '4px 0 0', color: 'var(--muted)' }}>
          {thrown == null ? 'Nothing thrown yet.' : `Last throw: strength ${thrown.toFixed(2)} (charge ${(chargeOf(thrown) * 100).toFixed(0)}%), faces ${faces.join(' + ')}${settled ? '' : ' …'}`}
        </p>
      </section>

      <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <section className="panel">
          <h2>Controls</h2>
          <div className="row"><label>Dice</label><input type="range" min="1" max="4" value={count} onChange={(e) => setCount(Number(e.target.value))} /><span className="value">{count}</span></div>
          <div className="row"><label>Stage size</label><input type="range" min="160" max="480" step="10" value={stage} onChange={(e) => setStage(Number(e.target.value))} /><span className="value">{stage}</span></div>
          <div className="row"><label>Strength</label><input type="range" min="0.65" max="1.45" step="0.01" value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><span className="value">{strength.toFixed(2)}</span></div>
          <div className="row"><label>Speed</label><input type="range" min="0.25" max="2" step="0.05" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span className="value">{speed.toFixed(2)}×</span></div>
          <div className="row"><label>Faces</label>
            <label style={{ minWidth: 0 }}><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> choose</label>
            {fixed && Array.from({ length: count }, (_, i) => (
              <select key={i} value={picked[i]} onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? Number(e.target.value) : v)))}>
                {[1, 2, 3, 4, 5, 6].map((v) => <option key={v}>{v}</option>)}
              </select>))}
          </div>
          <div className="row"><label>Options</label>
            <label style={{ minWidth: 0 }}><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> snap (no flight)</label>
            <label style={{ minWidth: 0 }}><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> sound</label>
          </div>
        </section>

        <section className="panel">
          <h2>Last throw</h2>
          {plan ? <div className="stats">{`duration   ${plan.duration.toFixed(2)} s\npeak       ${plan.peakHeight.toFixed(0)} px\nbounces    ${plan.bounces}\nfloor hits ${plan.floorHits}\nends on    ${plan.facing.join(', ')}`}</div> : <div className="stats">–</div>}
          <h2 style={{ marginTop: 12 }}>Sound events</h2>
          <div className="log">{plan ? plan.events.map((e) => `${e.t.toFixed(2).padStart(5)} s  ${e.kind.padEnd(5)} ${e.power.toFixed(2)}`).join('\n') || 'none' : '–'}</div>
        </section>

        <section className="panel">
          <h2>Stress test</h2>
          <button type="button" onClick={() => setReport(stress({ count, size, stage, runs: 400 }))}>Run 400 throws</button>
          {report && <div className="stats" style={{ marginTop: 8 }}>
            <div className={report.notFlat ? 'bad' : 'ok'}>{`not resting flat   ${report.notFlat}`}</div>
            <div className={report.outside ? 'bad' : 'ok'}>{`outside the dish   ${report.outside}`}</div>
            <div className={report.minGap < 0.9 ? 'bad' : 'ok'}>{`closest dice gap  ${Number.isFinite(report.minGap) ? report.minGap.toFixed(2) + ' dice' : 'n/a'}`}</div>
            <div className={report.maxDuration > 4.5 ? 'bad' : 'ok'}>{`longest throw     ${report.maxDuration.toFixed(2)} s (mean ${report.meanDuration.toFixed(2)})`}</div>
            <div>{`most bounces      ${report.maxBounces}`}</div>
            <div>{`end facing        ${SIDES.map((s) => `${s} ${report.sides[s]}`).join(', ')}`}</div>
          </div>}
        </section>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
