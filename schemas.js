'use strict';

const { z } = require('zod');

const coordinate = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().nonnegative().optional(),
  speed: z.coerce.number().nullable().optional(),
  heading: z.coerce.number().nullable().optional(),
});

const registerPayload = z.object({
  gender: z.enum(['female', 'male', 'non_binary', 'undisclosed']).optional(),
  role: z.enum(['commuter', 'driver', 'responder', 'admin']).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  availableAsResponder: z.boolean().optional(),
  orgId: z.string().max(64).nullable().optional(),
  vehicleId: z.string().max(64).nullable().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().nonnegative().optional(),
});

const sosPayload = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().nonnegative().optional(),
  trigger: z.enum(['shake', 'manual', 'button_hold', 'voice', 'fallback', 'volume_keys']).default('manual'),
  note: z.string().max(280).optional(),
});

const locationPayload = coordinate.extend({
  sosId: z.string().min(1),
  at: z.coerce.number().optional(),
});

const poolTripPayload = z.object({
  origin: coordinate,
  originLabel: z.string().max(140).optional(),
  destination: coordinate,
  destinationLabel: z.string().max(140).optional(),
  departAt: z.string().datetime(),
  seatsAvailable: z.coerce.number().int().min(1).max(6).default(3),
  womenOnly: z.boolean().default(true),
  city: z.string().max(80).optional(),
  baseline: z
    .enum(['petrol_car_solo', 'diesel_car_solo', 'auto_rickshaw', 'two_wheeler', 'ev_car_solo', 'bus', 'metro'])
    .default('petrol_car_solo'),
});

// JSON body, so plain z.number(): coercion would turn a null lat/lng into 0,0.
const chatMessagePayload = z.object({
  message: z.string().trim().min(1).max(500),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

const routeScorePayload = z.object({
  points: z.array(coordinate).min(2).max(60),
});

module.exports = {
  coordinate,
  registerPayload,
  sosPayload,
  locationPayload,
  poolTripPayload,
  routeScorePayload,
  chatMessagePayload,
};
