import { useRef, useEffect } from 'react';
import './MobileControls.css';

export default function MobileControls({ onMove, onAttack }) {
  const moveIntervalRef = useRef(null);

  const startMoving = (dx, dy) => {
    if (moveIntervalRef.current) return;
    onMove(dx, dy); // Move once immediately
    // Continue moving while held
    moveIntervalRef.current = setInterval(() => {
      onMove(dx, dy);
    }, 200);
  };

  const stopMoving = () => {
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
      moveIntervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopMoving();
  }, []);

  const btn = (label, dx, dy) => (
    <button
      key={`${dx}-${dy}`}
      className="dpad__btn"
      // Use both touch and pointer for widest compatibility
      onTouchStart={(e) => {
        if (e.cancelable) e.preventDefault();
        startMoving(dx, dy);
      }}
      onTouchEnd={stopMoving}
      onPointerDown={(e) => {
        // Only trigger if touch isn't available/used
        if (e.pointerType === 'mouse') {
          startMoving(dx, dy);
        }
      }}
      onPointerUp={stopMoving}
      onPointerLeave={stopMoving}
    >
      {label}
    </button>
  );

  return (
    <div className="mobile-controls">
      <div className="dpad">
        <div className="dpad__row dpad__row--top">
          {btn('▲', 0, -1)}
        </div>
        <div className="dpad__row dpad__row--middle">
          {btn('◀', -1, 0)}
          <div className="dpad__center" />
          {btn('▶', 1, 0)}
        </div>
        <div className="dpad__row dpad__row--bottom">
          {btn('▼', 0, 1)}
        </div>
      </div>

      <button
        className="atk-btn"
        onTouchStart={(e) => {
          if (e.cancelable) e.preventDefault();
          onAttack();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') onAttack();
        }}
      >
        ATK
      </button>
    </div>
  );
}
