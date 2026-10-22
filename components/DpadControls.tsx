/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, TerraformIcon } from './Icons';

const triggerHaptic = (ms = 12) => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignore vibration errors on unsupported devices
    }
  }
};

const VirtualThumbstick: React.FC<{
  label: string;
  onMove: (x: number, y: number) => void;
  onEnd: () => void;
  size?: number;
}> = ({ label, onMove, onEnd, size = 124 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const maxRadius = size / 2 - 22;

  const updateStick = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    setKnobPos({ x: dx, y: dy });
    const normX = Number((dx / maxRadius).toFixed(3));
    const normY = Number((-dy / maxRadius).toFixed(3)); // Up is +1
    onMove(normX, normY);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsActive(true);
    triggerHaptic(10);
    updateStick(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    updateStick(e.clientX, e.clientY);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    setIsActive(false);
    setKnobPos({ x: 0, y: 0 });
    onEnd();
  };

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label={label}
      aria-valuenow={0}
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`relative rounded-full backdrop-blur-md border transition-colors select-none touch-none flex items-center justify-center ${
        isActive ? 'bg-cyan-950/50 border-cyan-400/60 shadow-lg shadow-cyan-500/20' : 'bg-slate-900/45 border-white/20'
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handlePointerUpOrCancel}
    >
      {/* Crosshair guide rings */}
      <div className="w-1/2 h-1/2 rounded-full border border-white/10 pointer-events-none" />
      <span className="absolute bottom-2 text-[10px] font-medium tracking-wider text-white/45 pointer-events-none uppercase">
        {label}
      </span>

      {/* Thumb Knob */}
      <div
        style={{
          transform: `translate3d(${knobPos.x}px, ${knobPos.y}px, 0)`,
        }}
        className={`w-12 h-12 rounded-full pointer-events-none transition-transform duration-75 flex items-center justify-center border ${
          isActive
            ? 'bg-cyan-400/80 border-white text-slate-950 scale-105 shadow-md'
            : 'bg-white/25 border-white/40 text-white'
        }`}
      >
        <div className="w-3 h-3 rounded-full bg-current opacity-80" />
      </div>
    </div>
  );
};

const DpadButton: React.FC<{
  onPress: () => void;
  onRelease: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
  isKeyPressed?: boolean;
}> = ({ onPress, onRelease, children, className = '', ariaLabel, isKeyPressed = false }) => {
  const [isPointerPressed, setIsPointerPressed] = useState(false);
  const activePointerId = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (activePointerId.current !== null) return;
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    activePointerId.current = e.pointerId;
    setIsPointerPressed(true);
    triggerHaptic(10);
    onPress();
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
      setIsPointerPressed(false);
      onRelease();
    }
  };

  const isVisuallyPressed = isPointerPressed || isKeyPressed;

  return (
    <div
      role="button"
      aria-label={ariaLabel}
      className={`min-w-[44px] min-h-[44px] w-11 h-11 sm:w-14 sm:h-14 bg-slate-900/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white transition-transform duration-100 ease-in-out select-none touch-none ${className} ${
        isVisuallyPressed ? 'bg-cyan-400/50 border-cyan-300 scale-90' : ''
      }`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handlePointerUpOrCancel}
    >
      {children}
    </div>
  );
};

const TerraformButton: React.FC<{
  onPress: () => void;
  onRelease: () => void;
  power: number;
}> = ({ onPress, onRelease, power }) => {
  const [isPointerPressed, setIsPointerPressed] = useState(false);
  const activePointerId = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (activePointerId.current !== null) return;
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    activePointerId.current = e.pointerId;
    setIsPointerPressed(true);
    triggerHaptic(25);
    onPress();
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
      setIsPointerPressed(false);
      onRelease();
    }
  };

  const isFull = power >= 1.0;
  const isDepleted = power <= 0.01;
  const fillHeight = `${Math.min(1, power) * 100}%`;
  const fillColor = isFull ? 'bg-cyan-400/50' : 'bg-white/40';
  const iconColor = isFull ? 'text-cyan-300' : 'text-white';

  return (
    <div
      role="button"
      aria-label="Terraform Fractal"
      title="Terraform"
      className={`w-16 h-16 sm:w-20 sm:h-20 bg-slate-900/55 backdrop-blur-md border border-white/25 rounded-full flex flex-col items-center justify-center text-white transition-transform duration-150 ease-in-out select-none touch-none transform relative overflow-hidden shadow-xl ${
        isPointerPressed ? 'scale-95 border-cyan-400' : ''
      } ${isDepleted && !isPointerPressed ? 'opacity-70' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handlePointerUpOrCancel}
    >
      <div
        className={`absolute bottom-0 left-0 w-full transition-colors duration-300 ${fillColor}`}
        style={{ height: fillHeight }}
      />
      <TerraformIcon className={`w-7 h-7 sm:w-9 sm:h-9 relative z-10 transition-colors duration-300 ${iconColor}`} />
      <span className="relative z-10 text-[9px] font-semibold tracking-wider uppercase text-white/80 mt-0.5">
        Morph
      </span>
    </div>
  );
};

export const DpadControls: React.FC = () => {
  const {
    pressKey,
    releaseKey,
    cameraControlsEnabled,
    pressedKeys,
    handleTerraformPress,
    handleTerraformRelease,
    terraformPower,
    analogStickRef,
  } = useAppContext();

  const [controlScheme, setControlScheme] = useState<'joystick' | 'dpad'>('joystick');
  const [gyroEnabled, setGyroEnabled] = useState(false);
  const [turboActive, setTurboActive] = useState(false);

  // DeviceOrientation (Gyroscope) support for mobile steering
  useEffect(() => {
    if (!gyroEnabled) return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const gamma = event.gamma ?? 0; // Left/Right tilt (-90 to 90)
      const beta = event.beta ?? 0; // Front/Back tilt (-180 to 180)
      const clampedX = Math.max(-1, Math.min(1, gamma / 35));
      const clampedY = Math.max(-1, Math.min(1, (beta - 45) / 35));
      analogStickRef.current.lookX = clampedX;
      analogStickRef.current.lookY = clampedY;
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      analogStickRef.current.lookX = 0;
      analogStickRef.current.lookY = 0;
    };
  }, [gyroEnabled, analogStickRef]);

  const toggleGyro = async () => {
    if (gyroEnabled) {
      setGyroEnabled(false);
      return;
    }
    const DevOrient = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DevOrient?.requestPermission === 'function') {
      try {
        const state = await DevOrient.requestPermission();
        if (state === 'granted') {
          setGyroEnabled(true);
        }
      } catch {
        setGyroEnabled(true);
      }
    } else {
      setGyroEnabled(true);
    }
  };

  if (!cameraControlsEnabled) {
    return null;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 p-3 sm:p-5 flex justify-between items-end pointer-events-none z-30"
      aria-label="Mobile Flight Controls"
    >
      {/* Left Side: Movement Stick or D-Pad + Altitude + Boost */}
      <div className="flex items-end gap-2.5 sm:gap-3 pointer-events-auto">
        {controlScheme === 'joystick' ? (
          <VirtualThumbstick
            label="Thrust"
            size={126}
            onMove={(x, y) => {
              // Ensure audio starts on first mobile touch
              if (y > 0.1) pressKey('w');
              else releaseKey('w');
              analogStickRef.current.moveX = x;
              analogStickRef.current.moveY = y * (turboActive ? 1.45 : 1.0);
            }}
            onEnd={() => {
              releaseKey('w');
              analogStickRef.current.moveX = 0;
              analogStickRef.current.moveY = 0;
            }}
          />
        ) : (
          <div className="grid grid-cols-3 grid-rows-3 w-32 h-32 sm:w-40 sm:h-40">
            <div className="col-start-2 row-start-1 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('w')} onRelease={() => releaseKey('w')} ariaLabel="Move Forward" isKeyPressed={pressedKeys.has('w')}>
                <ChevronUpIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
            <div className="col-start-1 row-start-2 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('a')} onRelease={() => releaseKey('a')} ariaLabel="Move Left" isKeyPressed={pressedKeys.has('a')}>
                <ChevronLeftIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
            <div className="col-start-3 row-start-2 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('d')} onRelease={() => releaseKey('d')} ariaLabel="Move Right" isKeyPressed={pressedKeys.has('d')}>
                <ChevronRightIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
            <div className="col-start-2 row-start-3 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('s')} onRelease={() => releaseKey('s')} ariaLabel="Move Backward" isKeyPressed={pressedKeys.has('s')}>
                <ChevronDownIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
          </div>
        )}

        {/* Vertical Ascend / Descend + Turbo Boost */}
        <div className="flex flex-col gap-1.5 justify-center pb-0.5">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(15);
              setTurboActive(prev => !prev);
            }}
            className={`min-h-[44px] min-w-[44px] px-2.5 rounded-xl border text-[11px] font-semibold tracking-tight transition-colors select-none touch-none ${
              turboActive
                ? 'bg-amber-400/90 text-slate-950 border-amber-300 shadow-md shadow-amber-500/20'
                : 'bg-slate-900/50 text-white/80 border-white/20 backdrop-blur-md'
            }`}
            title="Toggle Afterburner Boost"
          >
            Boost
          </button>
          <DpadButton
            onPress={() => pressKey(' ')}
            onRelease={() => releaseKey(' ')}
            ariaLabel="Ascend Up"
            className="!w-11 !h-12 !rounded-xl"
            isKeyPressed={pressedKeys.has(' ')}
          >
            <ChevronUpIcon className="w-5 h-5" />
          </DpadButton>
          <DpadButton
            onPress={() => pressKey('shift')}
            onRelease={() => releaseKey('shift')}
            ariaLabel="Descend Down"
            className="!w-11 !h-12 !rounded-xl"
            isKeyPressed={pressedKeys.has('shift')}
          >
            <ChevronDownIcon className="w-5 h-5" />
          </DpadButton>
        </div>
      </div>

      {/* Center Action Cluster: Terraform + Mobile Mode Switches */}
      <div className="flex flex-col items-center gap-2 pointer-events-auto mb-1">
        <TerraformButton onPress={handleTerraformPress} onRelease={handleTerraformRelease} power={terraformPower} />
        <div className="flex items-center gap-1 bg-slate-900/60 backdrop-blur-md border border-white/15 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setControlScheme(prev => (prev === 'joystick' ? 'dpad' : 'joystick'))}
            className="px-2.5 py-1 text-[11px] font-medium text-white/90 hover:text-white rounded-lg bg-white/10 whitespace-nowrap"
          >
            {controlScheme === 'joystick' ? 'Stick' : 'D-Pad'}
          </button>
          <button
            type="button"
            onClick={toggleGyro}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap ${
              gyroEnabled ? 'bg-cyan-400 text-slate-950 font-semibold' : 'text-white/75 hover:text-white'
            }`}
          >
            Gyro {gyroEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Right Side: Look / Steer Stick or D-Pad */}
      <div className="pointer-events-auto">
        {controlScheme === 'joystick' ? (
          <VirtualThumbstick
            label="Steer"
            size={126}
            onMove={(x, y) => {
              analogStickRef.current.lookX = x;
              analogStickRef.current.lookY = -y;
            }}
            onEnd={() => {
              analogStickRef.current.lookX = 0;
              analogStickRef.current.lookY = 0;
            }}
          />
        ) : (
          <div className="grid grid-cols-3 grid-rows-3 w-32 h-32 sm:w-40 sm:h-40">
            <div className="col-start-2 row-start-1 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('arrowup')} onRelease={() => releaseKey('arrowup')} ariaLabel="Look Up" isKeyPressed={pressedKeys.has('arrowup')}>
                <ChevronUpIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
            <div className="col-start-1 row-start-2 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('arrowleft')} onRelease={() => releaseKey('arrowleft')} ariaLabel="Look Left" isKeyPressed={pressedKeys.has('arrowleft')}>
                <ChevronLeftIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
            <div className="col-start-3 row-start-2 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('arrowright')} onRelease={() => releaseKey('arrowright')} ariaLabel="Look Right" isKeyPressed={pressedKeys.has('arrowright')}>
                <ChevronRightIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
            <div className="col-start-2 row-start-3 flex justify-center items-center">
              <DpadButton onPress={() => pressKey('arrowdown')} onRelease={() => releaseKey('arrowdown')} ariaLabel="Look Down" isKeyPressed={pressedKeys.has('arrowdown')}>
                <ChevronDownIcon className="w-5 h-5 sm:w-7 sm:h-7" />
              </DpadButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
