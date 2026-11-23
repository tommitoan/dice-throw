// Physics (no React): plan a throw, then sample it frame by frame.
export { planThrow, layoutFor, dishOf, chargeOf, facingOf, normalOf, SIDES } from './dice-throw.js';
// React pieces: the dice scene, and the hold-to-charge button and hook.
export { default as DiceThrow, DISH_RIM } from './DiceThrow.jsx';
export { default as RollHoldButton } from './RollHoldButton.jsx';
export { default as useThrowHold, HOLD_MS, TAP_STRENGTH } from './useThrowHold.js';
