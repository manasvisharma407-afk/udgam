import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSafety } from '../context/SafetyContext';
import { sendChatMessage } from '../lib/api';
import { EMERGENCY_NUMBERS } from '../lib/config';
import { formatClock, formatKg, safetyBand } from '../lib/format';
import MessageBubble from './MessageBubble';
import { Badge, Button, Card, MeterBar, ScoreRing } from './ui';

const SUGGESTIONS = [
  'Is it safe around me right now?',
  'Find a Green Pool trip near me',
  'How much CO2 for a 15 km petrol car ride?',
  'Emergency helpline numbers',
];

const GREETING =
  "Hi, I'm RaahSaathi AI 👋 I can check how safe your area is, find Green Pool trips, " +
  "estimate a trip's CO2, or help you reach emergency help.";

const SpeechRecognition =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/* ------------------------------------------------------------ action cards */

/**
 * SOS from chat is always an explicit tap. The bot only ever *offers* it: a
 * typed message must never be able to alert responders on its own.
 */
function SosConfirm() {
  const { isSosActive, raiseSos, sosError } = useSafety();
  const [busy, setBusy] = useState(false);

  if (isSosActive) {
    return (
      <Card className="w-full border-rose-200 !bg-rose-50">
        <p className="text-sm font-semibold text-rose-800">
          Your SOS is live. The Safety tab shows who has been alerted.
        </p>
      </Card>
    );
  }

  const confirm = async () => {
    setBusy(true);
    try {
      await raiseSos({ source: 'manual', note: 'Raised from the chat assistant' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full border-rose-200 !bg-rose-50">
      <p className="text-xs font-semibold text-rose-800">
        This alerts verified responders near you and shares your live location.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="danger" onClick={confirm} disabled={busy}>
          {busy ? 'Sending…' : 'Raise SOS now'}
        </Button>
        <a
          href="tel:112"
          className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
        >
          Call 112
        </a>
      </div>
      {sosError ? <p className="mt-2 text-xs font-semibold text-rose-700">{sosError}</p> : null}
    </Card>
  );
}

function HelplineCard() {
  return (
    <Card className="w-full">
      <div className="flex flex-wrap gap-2">
        {EMERGENCY_NUMBERS.map((n) => (
          <a
            key={n.number}
            href={`tel:${n.number}`}
            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white"
          >
            {n.label} · {n.number}
          </a>
        ))}
      </div>
    </Card>
  );
}

function SafetyCard({ data, go }) {
  const band = safetyBand(data.score);

  return (
    <Card className="w-full">
      <div className="flex items-center gap-3">
        <ScoreRing score={data.score} size={56} label="safety" />
        <div>
          <Badge tone={band.tone}>{band.label}</Badge>
          <p className="mt-1 text-[11px] text-slate-500">
            {data.isNight ? 'Night weighting applied' : 'Daytime weighting'}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <MeterBar
          label="Lighting"
          value={data.lighting.value}
          tone="teal"
          hint={data.lighting.confidence === 'low' ? 'Limited data for this spot' : undefined}
        />
        <MeterBar
          label="Crowd"
          value={data.crowd.value}
          tone="green"
          hint={`${data.crowd.label} · live RaahSaathi presence`}
        />
      </div>

      <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => go('/')}>
        Open Safety tab
      </Button>
    </Card>
  );
}

function PoolCard({ data, go }) {
  const trips = data?.trips || [];

  return (
    <Card className="w-full">
      {trips.length > 0 ? (
        <ul className="space-y-2">
          {trips.map((trip) => (
            <li key={trip.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{trip.hostName}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {formatClock(trip.departAt)}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {trip.originLabel || 'Pickup'} → {trip.destinationLabel || 'Drop'} ·{' '}
                {trip.seatsAvailable} seat{trip.seatsAvailable === 1 ? '' : 's'}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        variant="green"
        size="sm"
        className={`w-full ${trips.length > 0 ? 'mt-3' : ''}`}
        onClick={() => go('/pool')}
      >
        Open Green Pool
      </Button>
    </Card>
  );
}

function Co2Card({ data, go }) {
  return (
    <Card className="w-full">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 p-2">
          <div className="text-lg font-bold tabular-nums text-slate-900">{formatKg(data.soloKg)}</div>
          <div className="text-[11px] text-slate-500">
            {data.distanceKm} km, {data.vehicleLabel}
          </div>
        </div>
        {data.sharedSavingKg !== null ? (
          <div className="rounded-xl bg-brand-green-light p-2">
            <div className="text-lg font-bold tabular-nums text-brand-green-dark">
              {formatKg(data.sharedSavingKg)}
            </div>
            <div className="text-[11px] text-brand-green-dark">saved if two riders share</div>
          </div>
        ) : null}
      </div>

      <Button variant="green" size="sm" className="mt-3 w-full" onClick={() => go('/pool')}>
        Find a Green Pool ride
      </Button>
    </Card>
  );
}

/** Renders whatever `action` + `data` the backend returned, inside the chat. */
function ActionPayload({ action, data, go }) {
  switch (action) {
    case 'open_sos':
      return <SosConfirm />;
    case 'show_helplines':
      return (
        <div className="w-full space-y-2">
          <HelplineCard />
          <SosConfirm />
        </div>
      );
    case 'show_safety':
      return data ? <SafetyCard data={data} go={go} /> : null;
    case 'open_carpool':
      return <PoolCard data={data} go={go} />;
    case 'show_co2':
      return data ? <Co2Card data={data} go={go} /> : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ window */

/**
 * The assistant panel. Stays mounted while closed (just hidden) so the
 * conversation survives opening and closing it.
 */
export default function ChatWindow({ open, onClose }) {
  const { geo } = useSafety();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([{ role: 'assistant', text: GREETING }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, open]);

  useEffect(() => {
    // Only auto-focus where there is no on-screen keyboard to cover the chat.
    if (open && window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus();
  }, [open]);

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

  const go = (path) => {
    navigate(path);
    onClose?.();
  };

  async function handleSend(text) {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;

    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setInput('');
    setLoading(true);

    try {
      const fix = geo.latest();
      const res = await sendChatMessage(trimmed, { lat: fix?.lat, lng: fix?.lng });
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: res.reply, action: res.action, data: res.data },
      ]);
    } catch (err) {
      // Whatever went wrong, never leave someone in a dead end: the SOS offer
      // and 112 do not depend on the chat backend being reachable.
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text:
            err.status === 429
              ? 'You are sending messages too quickly. Give it a moment. If this is an emergency, call 112.'
              : "I couldn't reach RaahSaathi just now. If this is an emergency, call 112 or raise an SOS below.",
          action: 'open_sos',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleVoice() {
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (e) => setInput(e.results[0][0].transcript);
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <section
      role="dialog"
      aria-label="RaahSaathi assistant"
      onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
      className={`fixed inset-x-0 bottom-0 z-40 h-[75vh] max-h-[640px] flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-slate-50 pb-[env(safe-area-inset-bottom)] shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-4 sm:h-[34rem] sm:w-96 sm:rounded-3xl ${
        open ? 'flex animate-slide-up' : 'hidden'
      }`}
    >
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-pink to-brand-teal text-sm font-black text-white"
            aria-hidden="true"
          >
            R
          </span>
          <div className="leading-tight">
            <h2 className="text-sm font-black tracking-tight text-slate-900">RaahSaathi AI</h2>
            <p className="text-[11px] text-slate-500">Safety, rides and Green Pool</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="rounded-full px-2.5 py-1.5 text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text}>
            {m.action ? <ActionPayload action={m.action} data={m.data} go={go} /> : null}
          </MessageBubble>
        ))}

        {loading ? (
          <MessageBubble
            role="assistant"
            text={
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="animate-pulse" aria-hidden="true">
                  ✨
                </span>
                thinking…
              </span>
            }
          />
        ) : null}

        {messages.length === 1 ? (
          <div className="flex flex-wrap gap-2 pl-10">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSend(s)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 transition hover:border-brand-teal hover:text-brand-teal-dark"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 bg-white px-3 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 focus-within:ring-2 focus-within:ring-brand-pink"
        >
          {SpeechRecognition ? (
            <button
              type="button"
              onClick={handleVoice}
              aria-label={listening ? 'Stop voice input' : 'Voice input'}
              className={`rounded-full p-1.5 transition hover:bg-white ${
                listening ? 'text-rose-600' : 'text-slate-500'
              }`}
            >
              🎤
            </button>
          ) : null}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder="Ask RaahSaathi anything…"
            aria-label="Message"
            className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-base outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="rounded-full bg-brand-teal px-3.5 py-2 text-sm font-bold text-white transition hover:bg-brand-teal-dark disabled:opacity-40"
          >
            ➤
          </button>
        </form>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          In an emergency, call 112 or use the SOS button.
        </p>
      </div>
    </section>
  );
}
