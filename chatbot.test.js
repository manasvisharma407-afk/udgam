'use strict';

/**
 * Chatbot unit tests. Run with: npm test   (node --test, no extra dependencies)
 *
 * The real greenPool service is loaded so emission numbers are checked against
 * the same code the Green Pool page uses; only its logger and Supabase client
 * are stubbed, so no database or network is needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function stubModule(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule('src/lib/logger.js', { warn() {}, error() {}, info() {} });
stubModule('src/config/supabase.js', { getSupabase: () => null });

const greenPool = require('../src/services/greenPool');
const { createChatbot, detectIntent } = require('../src/services/chatbot');

const HERE = { lat: 26.9124, lng: 75.7873 };

function makeBot({ llmReply = null, llmConfigured = false, scoreResult, trips = [] } = {}) {
  const calls = { rephrase: [], listOpenTrips: 0 };
  const llm = {
    isConfigured: () => llmConfigured,
    rephrase: async (args) => {
      calls.rephrase.push(args);
      return llmReply;
    },
  };
  const safety = {
    scoreLocation: async () =>
      scoreResult || {
        score: 62,
        band: 'caution',
        isNight: true,
        components: {
          lighting: { value: 48, confidence: 'low', zones: ['Some Zone'] },
          crowd: { value: 30, label: 'sparse', headcount: 1 },
          incidents: { value: 10, recentEvents: 2 },
          driver: { value: 70, weight: 0.15 },
        },
      },
  };
  const pool = {
    ...greenPool,
    listOpenTrips: async () => {
      calls.listOpenTrips += 1;
      return trips;
    },
  };
  return { bot: createChatbot({ safety, greenPool: pool, llm }), calls };
}

test('detectIntent routes the main phrasings', () => {
  const cases = [
    ['SOS', 'sos_emergency'],
    ["I'm in danger", 'sos_emergency'],
    ['someone is following me', 'sos_emergency'],
    ['call the police', 'helplines'],
    ['women helpline number', 'helplines'],
    ['there is a pothole ahead', 'unsupported_media'],
    ['is the lighting good here', 'lighting_query'],
    ['how much co2 for 15 km', 'co2_calculation'],
    ['find a carpool', 'carpooling'],
    ['any green pool trips', 'carpooling'],
    ['safe route to the bus station', 'safe_route'],
    ['is it safe here?', 'safe_route'],
    ['what is the weather', 'general'],
    ['   ', 'general'],
  ];
  for (const [text, intent] of cases) {
    assert.equal(detectIntent(text).intent, intent, text);
  }
});

test('SOS never auto-dispatches and never reaches the LLM', async () => {
  const { bot, calls } = makeBot({ llmConfigured: true, llmReply: 'SOS sent!' });
  const res = await bot.reply({ message: 'sos help me now', ...HERE });
  assert.equal(res.action, 'open_sos');
  assert.equal(res.intent, 'sos_emergency');
  assert.equal(calls.rephrase.length, 0);
  assert.ok(res.reply.includes('112'));
});

test('helplines reply lists the national numbers and skips the LLM', async () => {
  const { bot, calls } = makeBot({ llmConfigured: true, llmReply: 'x' });
  const res = await bot.reply({ message: 'nearest police station', ...HERE });
  assert.equal(res.action, 'show_helplines');
  assert.match(res.reply, /100/);
  assert.match(res.reply, /1091/);
  assert.equal(calls.rephrase.length, 0);
});

test('safety needs a location; null coordinates count as missing', async () => {
  const { bot } = makeBot();
  for (const loc of [{}, { lat: null, lng: null }, { lat: 26.9 }]) {
    const res = await bot.reply({ message: 'is it safe here', ...loc });
    assert.equal(res.needsFollowup, true);
    assert.equal(res.action, null);
  }
});

test('safety reply is grounded, and coordinates never reach the LLM', async () => {
  const { bot, calls } = makeBot({ llmConfigured: true, llmReply: 'Take care out there.' });
  const res = await bot.reply({ message: 'safe route to the bus station', ...HERE });

  assert.equal(res.action, 'show_safety');
  assert.equal(res.data.score, 62);
  assert.equal(res.reply, 'Take care out there.');

  assert.equal(calls.rephrase.length, 1);
  const sent = JSON.stringify(calls.rephrase[0]);
  assert.ok(!sent.includes('26.91'), 'latitude must not be sent to the model');
  assert.ok(!sent.includes('75.78'), 'longitude must not be sent to the model');
});

test('templated safety reply is used when the LLM returns nothing', async () => {
  const { bot } = makeBot({ llmConfigured: true, llmReply: null });
  const res = await bot.reply({ message: 'safe route to the bus station', ...HERE });
  assert.match(res.reply, /can't plan a route to bus station/);
  assert.match(res.reply, /62\/100/);
  assert.match(res.reply, /caution/);
  assert.match(res.reply, /limited lighting data/);
  assert.match(res.reply, /HerRides/);
});

test('CO2 uses the Green Pool emission factors', async () => {
  const { bot } = makeBot();
  const res = await bot.reply({ message: 'how much CO2 for a 15 km ride', ...HERE });
  const expected = greenPool.carbonSaved({ soloDistancesKm: [15], pooledDistanceKm: 15, baseline: 'petrol_car_solo' });

  assert.equal(res.action, 'show_co2');
  assert.equal(res.data.soloKg, expected.soloKg);
  assert.equal(res.data.assumedVehicle, true);
  assert.equal(res.data.sharedSavingKg, expected.soloKg);
});

test('CO2 recognises the vehicle and skips pooling for public transport', async () => {
  const { bot } = makeBot();
  const bus = await bot.reply({ message: 'co2 for 20 km by bus' });
  assert.equal(bus.data.vehicle, 'bus');
  assert.equal(bus.data.sharedSavingKg, null);

  const auto = await bot.reply({ message: 'carbon for 8 km in an auto' });
  assert.equal(auto.data.vehicle, 'auto_rickshaw');
  assert.equal(auto.data.assumedVehicle, false);
});

test('CO2 asks a follow-up when no usable distance is given', async () => {
  const { bot } = makeBot();
  for (const message of ['what is my carbon footprint', 'co2 for 0 km', 'co2 for 999999 km']) {
    const res = await bot.reply({ message });
    assert.equal(res.needsFollowup, true, message);
    assert.equal(res.data, null);
  }
});

test('carpool filters closed and non-women-only trips, and needs a location', async () => {
  const base = { hostName: 'Asha', originLabel: 'Mansarovar', destinationLabel: 'Malviya Nagar', departAt: '2026-09-21T03:00:00.000Z' };
  const { bot, calls } = makeBot({
    trips: [
      { ...base, id: 'a', seatsAvailable: 0, womenOnly: true },
      { ...base, id: 'b', seatsAvailable: 2, womenOnly: false },
      { ...base, id: 'c', seatsAvailable: 2, womenOnly: true },
    ],
  });

  const res = await bot.reply({ message: 'find a carpool', ...HERE });
  assert.deepEqual(res.data.trips.map((t) => t.id), ['c']);
  assert.match(res.reply, /Asha/);

  const before = calls.listOpenTrips;
  const noLoc = await bot.reply({ message: 'find a carpool' });
  assert.equal(noLoc.needsFollowup, true);
  assert.equal(calls.listOpenTrips, before, 'must not list trips without a location');
});

test('empty carpool result is reported honestly', async () => {
  const { bot } = makeBot({ trips: [] });
  const res = await bot.reply({ message: 'any green pool trips?', ...HERE });
  assert.deepEqual(res.data, { trips: [] });
  assert.match(res.reply, /no open Green Pool trips/i);
});

test('photo analysis is declined, not faked', async () => {
  const { bot } = makeBot();
  const res = await bot.reply({ message: 'analyze this road photo', ...HERE });
  assert.equal(res.intent, 'unsupported_media');
  assert.match(res.reply, /can't analyse road photos/);
});
