// The dice come in a few finished looks instead of free colours: each one is a body colour with its own
// shade, gloss and pip colour worked out together, so pips always stand out and the glaze never looks
// smeared. `redPips` keeps the traditional red on 1 and 4 (ivory only); every other look paints all pips alike.
export const LOOKS = {
  ivory:    { label: 'Ivory',    body: '#ffffff', edge: '#f1f5fa', gloss: '#ffffff', line: '#dfe7f0', lit: '#ffffff', pip: '#0b0d10', pipHi: '#3c424b', pipRing: '#ffffff', redPips: true },
  obsidian: { label: 'Obsidian', body: '#1b1d22', edge: '#0d0e11', gloss: '#4a4f59', line: '#05060a', lit: '#ffffff1f', pip: '#f4f1e8', pipHi: '#ffffff', pipRing: '#00000055' },
  ruby:     { label: 'Ruby',     body: '#c9181f', edge: '#8e0f15', gloss: '#f06a6a', line: '#6f0a10', lit: '#ffffff26', pip: '#ffffff', pipHi: '#ffffff', pipRing: '#5a070c66' },
  sapphire: { label: 'Sapphire', body: '#1f4fb4', edge: '#13307a', gloss: '#7aa2f2', line: '#0d2255', lit: '#ffffff26', pip: '#ffffff', pipHi: '#ffffff', pipRing: '#0a183e66' },
  jade:     { label: 'Jade',     body: '#1f9a6a', edge: '#126141', gloss: '#76e0b2', line: '#0b4029', lit: '#ffffff26', pip: '#ffffff', pipHi: '#ffffff', pipRing: '#06291a66' },
  glass:    { label: 'Glass',    body: '#cfe6f3', edge: '#9bc4dc', gloss: '#ffffff', line: '#7fa9c2', lit: '#ffffff', pip: '#13304a', pipHi: '#2f5f86', pipRing: '#ffffffaa', alpha: 0.5 },
};
export const DEFAULT_LOOK = 'ivory';

const faded = (color, alpha) => (alpha < 1 ? `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)` : color);

// The CSS variables a die is drawn with.
export function lookStyle(look) {
  const l = LOOKS[look] ?? LOOKS[DEFAULT_LOOK];
  const a = l.alpha ?? 1;
  return {
    '--dt-body': faded(l.body, a), '--dt-edge': faded(l.edge, a), '--dt-gloss': faded(l.gloss, a),
    '--dt-line': l.line, '--dt-lit': l.lit,
    '--dt-pip': l.pip, '--dt-pip-hi': l.pipHi, '--dt-pip-ring': l.pipRing,
  };
}
export const alphaOf = (look) => (LOOKS[look] ?? LOOKS[DEFAULT_LOOK]).alpha ?? 1;
export const hasRedPips = (look) => Boolean((LOOKS[look] ?? LOOKS[DEFAULT_LOOK]).redPips);
