'use strict';

const geo = require('../lib/geo');

/**
 * RaahSaathi AI — the chatbot brain.
 *
 * Ported from RaahSarthi's ai_service.py and kept deliberately in two parts:
 *
 * 1. INTENT DETECTION (`detectIntent`) is regex/keyword based and always runs.
 *    The bot decides which app feature to open, and that is a routing decision
 *    that must be deterministic, instant and free. It never depends on an LLM.
 *
 * 2. HANDLERS compute real facts from RaahSaathi's own services (safety score,
 *    Green Pool, emission factors) and return a templated reply. If an LLM is
 *    configured it may rephrase that reply from the same facts; see llm.js.
 *
 * Deliberately absent, because RaahSaathi has no data source for them:
 * road-photo analysis and police-station / hospital lookup. Those intents get
 * an honest reply instead of a made-up answer.
 *
 * The SOS intent never auto-dispatches. It returns `open_sos`, and the client
 * shows an explicit confirm button, because a chat message must not be able to
 * alert responders by itself.
 *
 * Dependencies are injected so the logic is testable without Supabase.
 */

const EMERGENCY_NUMBERS = [
  { label: 'Police', number: '100' },
  { label: 'Women Helpline', number: '1091' },
  { label: 'Emergency', number: '112' },
];

/** Order matters: the first matching intent wins, so urgent intents come first. */
const PATTERNS = [
  [
    'sos_emergency',
    [
      /\bsos\b/,
      /emergency help/,
      /i.?m in danger/,
      /help me now/,
      /being followed/,
      /following me/,
      /feel(?:ing)? unsafe/,
    ],
  ],
  ['helplines', [/emergency service/, /helpline/, /\b(?:police|hospital|ambulance|fire station)\b/]],
  [
    'unsupported_media',
    [
      /\b(?:pothole|obstacle)s?\b/,
      /analy[sz]e (?:this|the) (?:road|image|photo)/,
      /upload.*(?:image|photo)/,
      /check this photo/,
    ],
  ],
  ['lighting_query', [/lighting/, /well.?lit/, /dark (?:route|road|street|area)/, /better lit/]],
  ['co2_calculation', [/\bco2\b/, /carbon/, /emission/, /footprint/]],
  [
    'carpooling',
    [/car.?pool/, /same direction/, /ride.?share/, /share a ride/, /green pool/, /\bpool\b/],
  ],
  [
    'safe_route',
    [
      /safe(?:r|st)? (?:route|way|path)/,
      /route to/,
      /best way to/,
      /navigate to/,
      /safety score/,
      /how safe/,
      /is it safe/,
      /is (?:this|the) (?:road|area|place|street) safe/,
      /\broute\b/,
    ],
  ],
];

/** Looser phrasing that only counts when no strict pattern matched. */
const LOOSE_KEYWORDS = [
  ['safe_route', ['direction', 'path to']],
  ['co2_calculation', ['emit', 'environment']],
  ['carpooling', ['rideshare']],
];

function detectIntent(message) {
  const text = String(message || '').toLowerCase().trim();
  if (!text) return { intent: 'general', confidence: 0 };

  for (const [intent, patterns] of PATTERNS) {
    if (patterns.some((re) => re.test(text))) return { intent, confidence: 0.9 };
  }
  for (const [intent, words] of LOOSE_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return { intent, confidence: 0.6 };
  }
  return { intent: 'general', confidence: 0.3 };
}

/* --------------------------------------------------------------- extractors */

/** '... route to the bus station' -> 'bus station'. Only used to be honest about it. */
function extractDestination(message) {
  const m = String(message || '')
    .toLowerCase()
    .match(/\b(?:route|navigate|directions?|way|path)\s+to\s+(?:the\s+)?([a-z][a-z\s]{1,58}?)(?:[.?!,]|$)/);
  return m ? m[1].trim() : null;
}

function extractDistanceKm(message) {
  const m = String(message || '')
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:er|re)s?)\b/);
  if (!m) return null;
  const km = Number(m[1]);
  return km > 0 && km <= 5000 ? km : null;
}

const BASELINE_RULES = [
  [/\bdiesel\b/, 'diesel_car_solo'],
  [/\bpetrol\b/, 'petrol_car_solo'],
  [/\b(?:bike|scooter|scooty|two.?wheeler|motorcycle|motorbike)\b/, 'two_wheeler'],
  [/\b(?:ev|electric)\b/, 'ev_car_solo'],
  [/\b(?:auto|rickshaw|tuk.?tuk)\b/, 'auto_rickshaw'],
  [/\bmetro\b/, 'metro'],
  [/\bbus\b/, 'bus'],
];

const BASELINE_LABELS = {
  petrol_car_solo: 'a petrol car',
  diesel_car_solo: 'a diesel car',
  auto_rickshaw: 'an auto-rickshaw',
  two_wheeler: 'a two-wheeler',
  ev_car_solo: 'an electric car',
  bus: 'a bus',
  metro: 'the metro',
};

function detectBaseline(message) {
  const text = String(message || '').toLowerCase();
  for (const [re, baseline] of BASELINE_RULES) {
    if (re.test(text)) return { baseline, assumed: false };
  }
  return { baseline: 'petrol_car_solo', assumed: true };
}

/* ----------------------------------------------------------------- service */

function createChatbot({ safety, greenPool, llm }) {
  /* ---------------------------------------------------------- handlers */

  async function handleSos() {
    return {
      action: 'open_sos',
      reply:
        "If you're in danger, tap the button below and I'll alert verified responders near you. " +
        'You can also call 112 right now.',
    };
  }

  async function handleHelplines() {
    const list = EMERGENCY_NUMBERS.map((n) => `${n.label} ${n.number}`).join(', ');
    return {
      action: 'show_helplines',
      data: { numbers: EMERGENCY_NUMBERS },
      reply:
        `I can't look up nearby stations or hospitals yet, but these numbers work anywhere in India: ${list}. ` +
        "If you're in danger right now, you can raise an SOS below.",
    };
  }

  async function handleUnsupportedMedia() {
    return {
      reply:
        "I can't analyse road photos yet. I can check how safe the area around you is right now, " +
        'though. Try asking "is it safe around me?"',
    };
  }

  async function handleSafety({ message, point, intent }) {
    if (!point) {
      return {
        needsFollowup: true,
        followupQuestion: 'Can you turn on location access?',
        reply:
          'I need your location to check the area around you. Turn on location access and ask me again.',
      };
    }

    const result = await safety.scoreLocation(point);
    const { lighting, crowd, incidents } = result.components;

    const data = {
      score: result.score,
      band: result.band,
      isNight: result.isNight,
      lighting: { value: lighting.value, confidence: lighting.confidence },
      crowd: { value: crowd.value, label: crowd.label, headcount: crowd.headcount },
      recentIncidents: incidents.recentEvents,
    };

    const bandText = {
      safe: 'looks safe',
      caution: 'needs some caution',
      elevated_risk: 'is higher risk',
    }[result.band];

    const lightWord =
      lighting.value >= 75 ? 'well lit' : lighting.value >= 55 ? 'moderately lit' : 'poorly lit';

    const parts = [];
    const destination = intent === 'safe_route' ? extractDestination(message) : null;
    if (destination) {
      parts.push(`I can't plan a route to ${destination} yet, but here's how the area around you looks.`);
    }

    if (intent === 'lighting_query') {
      parts.push(`Lighting around you is ${lightWord} (${lighting.value}/100).`);
      parts.push(`Overall the area scores ${result.score}/100 and ${bandText}.`);
    } else {
      parts.push(`Right now the area around you scores ${result.score}/100 and ${bandText}.`);
      parts.push(`It's ${lightWord}, and nearby crowd is ${crowd.label}.`);
    }

    if (lighting.confidence === 'low') {
      parts.push('We have limited lighting data for this spot, so treat this as a cautious estimate.');
    }
    if (result.band !== 'safe') {
      parts.push('If you are travelling, a verified HerRides driver is the safer option.');
    }

    return { action: 'show_safety', data, groundable: true, reply: parts.join(' ') };
  }

  async function handleCarpool({ point }) {
    if (!point) {
      return {
        action: 'open_carpool',
        needsFollowup: true,
        followupQuestion: 'Can you turn on location access?',
        reply:
          'Turn on location access and I can show open Green Pool trips near you, or open Green Pool to browse.',
      };
    }

    const trips = await greenPool.listOpenTrips({ near: point, radiusKm: 15 });
    const open = trips
      // Green Pool is women-only; same hard gate the matcher applies.
      .filter((t) => t.womenOnly !== false && t.seatsAvailable > 0)
      .slice(0, 3)
      .map((t) => ({
        id: t.id,
        hostName: t.hostName,
        originLabel: t.originLabel || null,
        destinationLabel: t.destinationLabel || null,
        departAt: t.departAt,
        seatsAvailable: t.seatsAvailable,
      }));

    if (open.length === 0) {
      return {
        action: 'open_carpool',
        data: { trips: [] },
        reply:
          'There are no open Green Pool trips near you right now. Post your own from the Green Pool tab and riders heading your way can find it.',
      };
    }

    const first = open[0];
    const route =
      first.originLabel && first.destinationLabel
        ? ` from ${first.originLabel} to ${first.destinationLabel}`
        : '';
    return {
      action: 'open_carpool',
      data: { trips: open },
      groundable: true,
      reply:
        `I found ${open.length} open Green Pool trip${open.length === 1 ? '' : 's'} near you. ` +
        `First up is ${first.hostName}${route}, with ${first.seatsAvailable} seat${first.seatsAvailable === 1 ? '' : 's'} free.`,
    };
  }

  async function handleCo2({ message }) {
    const km = extractDistanceKm(message);
    if (!km) {
      return {
        needsFollowup: true,
        followupQuestion: 'How far is the trip, and how will you travel?',
        reply: 'I can work that out. How many kilometres is the trip, and how will you travel?',
      };
    }

    const { baseline, assumed } = detectBaseline(message);
    const solo = greenPool.carbonSaved({ soloDistancesKm: [km], pooledDistanceKm: km, baseline });

    // Sharing only makes sense against a private vehicle, not a bus or metro.
    const canShare = !['bus', 'metro'].includes(baseline);
    const shared = canShare
      ? greenPool.carbonSaved({ soloDistancesKm: [km, km], pooledDistanceKm: km, baseline })
      : null;

    const label = BASELINE_LABELS[baseline];
    const data = {
      distanceKm: km,
      vehicle: baseline,
      vehicleLabel: label,
      assumedVehicle: assumed,
      soloKg: solo.soloKg,
      factorGPerKm: solo.factorGPerKm,
      sharedSavingKg: shared ? shared.savedKg : null,
    };

    const parts = [`Travelling ${km} km by ${label} emits about ${solo.soloKg} kg of CO2 per person.`];
    if (assumed) parts.push('I assumed a petrol car; tell me if you are using something else.');
    if (shared) {
      parts.push(
        `If two riders share one vehicle instead of driving separately, that saves about ${shared.savedKg} kg.`
      );
    }

    return { action: 'show_co2', data, groundable: true, reply: parts.join(' ') };
  }

  async function handleGeneral() {
    return {
      reply:
        "I'm RaahSaathi AI. I can check how safe the area around you is, find open Green Pool trips, " +
        "estimate a trip's CO2, share emergency helplines, or help you raise an SOS. What would you like to do?",
    };
  }

  const HANDLERS = {
    sos_emergency: handleSos,
    helplines: handleHelplines,
    unsupported_media: handleUnsupportedMedia,
    lighting_query: (ctx) => handleSafety({ ...ctx, intent: 'lighting_query' }),
    safe_route: (ctx) => handleSafety({ ...ctx, intent: 'safe_route' }),
    carpooling: handleCarpool,
    co2_calculation: handleCo2,
    general: handleGeneral,
  };

  /* ------------------------------------------------------- orchestration */

  async function reply({ message, lat, lng }) {
    const { intent, confidence } = detectIntent(message);
    const candidate = { lat, lng };
    const point = geo.isValidPoint(candidate) ? candidate : null;

    const result = await HANDLERS[intent]({ message, point });

    let text = result.reply;
    // Only reply text that is backed by computed data may be rephrased. SOS and
    // helpline replies are never handed to a model.
    if (result.groundable && result.data && llm.isConfigured()) {
      const phrased = await llm.rephrase({ userMessage: message, facts: result.data });
      if (phrased) text = phrased;
    }

    return {
      reply: text,
      intent,
      confidence,
      action: result.action || null,
      data: result.data || null,
      needsFollowup: Boolean(result.needsFollowup),
      followupQuestion: result.followupQuestion || null,
    };
  }

  return { reply };
}

module.exports = {
  createChatbot,
  detectIntent,
  extractDestination,
  extractDistanceKm,
  detectBaseline,
  EMERGENCY_NUMBERS,
};
