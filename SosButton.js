import React from 'react';
import { useSafety } from '../context/SafetyContext';
import { Button } from './ui';

/**
 * The panic surface.
 *
 * Deliberately the largest tap target in the app and reachable with a thumb.
 * Every input path lands here: tap (counts toward the 5-tap fallback), press
 * and hold, and the shake detector which drives the progress ring.
 */
export default function SosButton() {
  const { isSosActive, activeSos, shake, fallback, raiseSos, cancelSos } = useSafety();

  const progress = Math.max(
    shake.shakeProgress / shake.requiredShakes,
    fallback.holdProgress
  );

  if (isSosActive) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-44 w-44 items-center justify-center">
          <span className="absolute inset-0 animate-ping-slow rounded-full bg-rose-500/30" />
          <span className="absolute inset-3 animate-pulse rounded-full bg-rose-500/20" />
          <div className="relative flex h-36 w-36 flex-col items-center justify-center rounded-full bg-rose-600 text-white shadow-2xl shadow-rose-500/40">
            <span className="text-3xl font-black tracking-tight">SOS</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest">
              {activeSos?.pending ? 'Sending…' : 'Live'}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="lg"
          onClick={cancelSos}
          className="w-full max-w-xs"
          aria-label="Stand down the emergency alert"
        >
          I am safe — stand down
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        {...fallback.bindPanicSurface()}
        onDoubleClick={() => raiseSos({ source: 'manual' })}
        className="group relative flex h-44 w-44 touch-none select-none items-center justify-center rounded-full focus-visible:outline-none"
        aria-label="Emergency SOS. Press and hold, tap five times, or shake your phone three times."
      >
        {/* Progress ring: fills as shakes register or the hold completes. */}
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" fill="none" stroke="#fce7f3" strokeWidth="5" />
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="#db2777"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 46}
            strokeDashoffset={2 * Math.PI * 46 * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 180ms linear' }}
          />
        </svg>

        <span className="absolute inset-4 rounded-full bg-brand-pink/10 transition group-active:bg-brand-pink/20" />

        <div className="relative flex h-32 w-32 flex-col items-center justify-center rounded-full bg-gradient-to-br from-brand-pink to-brand-pink-dark text-white shadow-xl shadow-brand-pink/30 transition group-active:scale-95">
          <span className="text-2xl font-black tracking-tight">SOS</span>
          <span className="mt-0.5 px-3 text-center text-[9px] font-semibold uppercase leading-tight tracking-wider opacity-90">
            Hold or shake 3×
          </span>
        </div>
      </button>

      <div className="h-5 text-center text-xs font-medium text-slate-500" aria-live="polite">
        {shake.shakeProgress > 0 ? (
          <span className="text-brand-pink">
            Shake detected {shake.shakeProgress}/{shake.requiredShakes}
          </span>
        ) : fallback.tapProgress > 0 ? (
          <span className="text-brand-pink">
            {fallback.tapProgress}/{fallback.tapTarget} taps
          </span>
        ) : fallback.holdProgress > 0 ? (
          <span className="text-brand-pink">Keep holding…</span>
        ) : (
          <span>Hold the button, tap 5 times, or shake your phone</span>
        )}
      </div>
    </div>
  );
}
