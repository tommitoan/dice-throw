import useThrowHold from './useThrowHold.js';
import './roll-hold.css';

// The throw button fills its charge meter while held; a plain click or keyboard activation throws at tap strength.
export default function RollHoldButton({ disabled = false, onRoll, className = 'roll-button', children }) {
  const { progress, handlers } = useThrowHold(onRoll, { disabled });
  return (
    <button type="button" className={className} disabled={disabled} {...handlers}>
      {children}
      <span className={`roll-hold-bar${progress > 0 ? ' is-holding' : ''}`} style={{ '--hold': progress }} aria-hidden="true" />
    </button>
  );
}
