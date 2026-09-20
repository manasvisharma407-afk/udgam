import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSafety } from '../context/SafetyContext';
import ChatWindow from './ChatWindow';

/**
 * Floating entry point for the assistant, mounted once in the app shell so it
 * is reachable from every tab.
 *
 * Layering: above the tab bar (z-40), below the inbound-alert overlay (z-50),
 * so a nearby emergency can never be hidden behind the chat.
 */
export default function ChatLauncher() {
  const { isSosActive } = useSafety();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // When an SOS goes live while the chat is open (raised from the chat or by a
  // shake), get out of the way and show the Safety tab, where dispatch status
  // and any "call 112" guidance live.
  useEffect(() => {
    if (isSosActive && open) {
      setOpen(false);
      navigate('/');
    }
  }, [isSosActive, open, navigate]);

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close assistant"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/30 sm:hidden"
        />
      ) : null}

      <ChatWindow open={open} onClose={() => setOpen(false)} />

      {!open && !isSosActive ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open RaahSaathi assistant"
          aria-haspopup="dialog"
          className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-pink to-brand-teal text-2xl text-white shadow-xl transition hover:scale-105 active:scale-95"
        >
          <span aria-hidden="true">💬</span>
        </button>
      ) : null}
    </>
  );
}