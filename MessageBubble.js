import React from 'react';

/**
 * One chat message. `children` renders below the bubble in the same column,
 * which is where action cards (safety score, Green Pool trips, SOS confirm) go.
 */
export default function MessageBubble({ role, text, children }) {
  const isUser = role === 'user';

  return (
    <div className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
          isUser
            ? 'bg-slate-900 text-white'
            : 'bg-gradient-to-br from-brand-pink to-brand-teal text-white'
        }`}
        aria-hidden="true"
      >
        {isUser ? '👤' : 'R'}
      </span>

      <div className={`flex max-w-[85%] flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {text ? (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
              isUser
                ? 'rounded-tr-sm bg-slate-900 text-white'
                : 'rounded-tl-sm border border-slate-200/80 bg-white text-slate-900'
            }`}
          >
            {text}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
