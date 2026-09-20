'use strict';

const config = require('../../config/env');

/**
 * CO2 estimates and the Saathi leaderboard for Smart Route.
 *
 * Not to be confused with `services/greenPool.js`, which computes Green Pool
 * carbon savings from India-specific baselines per vehicle type. This module
 * uses a single prototype-average car factor and only powers the Smart Route
 * "Carbon Savings" card, so the two figures will differ by design.
 */
const CAR_CO2_G_PER_KM = 192;
const POINTS_PER_50G = 1;

// Synthetic riders so the leaderboard is not empty in a demo. Never seeded
// outside demo mode: a production rider must not see invented people ranked
// against them.
const DEMO_ROWS = [
  { id: 'demo-passenger-b', name: 'Saathi B', points: 96, co2SavedGrams: 4800, trips: 7 },
  { id: 'demo-passenger-c', name: 'Green Rider', points: 78, co2SavedGrams: 3900, trips: 6 },
  { id: 'demo-passenger-d', name: 'Eco Commuter', points: 54, co2SavedGrams: 2700, trips: 4 },
];

const leaderboard = new Map((config.demoMode ? DEMO_ROWS : []).map((row) => [row.id, { ...row }]));

function round(n, digits = 1) {
  const p = 10 ** digits;
  return Math.round(Number(n) * p) / p;
}

function estimateImpact({ selectedDistanceKm, baselineDistanceKm, carpoolPassengers = 1 }) {
  if (!Number.isFinite(Number(selectedDistanceKm))) {
    throw new Error('selectedDistanceKm must be numeric');
  }
  const selected = Math.max(0, Number(selectedDistanceKm || 0));
  const baseline = Math.max(selected, Number(baselineDistanceKm || selected));
  const passengers = Math.max(1, Math.floor(Number(carpoolPassengers || 1)));

  // Route optimization compares the selected route with the pre-optimization baseline.
  const routeKmSaved = Math.max(0, baseline - selected);
  const routeCo2SavedGrams = routeKmSaved * CAR_CO2_G_PER_KM;

  // Carpool compares multiple solo vehicle trips with one shared vehicle trip.
  const carpoolVehicleTripsAvoided = Math.max(0, passengers - 1);
  const carpoolCo2SavedGrams = selected * CAR_CO2_G_PER_KM * carpoolVehicleTripsAvoided;
  const totalCo2SavedGrams = routeCo2SavedGrams + carpoolCo2SavedGrams;
  const points = Math.floor(totalCo2SavedGrams / 50) * POINTS_PER_50G;

  return {
    assumptions: {
      carCo2GramsPerKm: CAR_CO2_G_PER_KM,
      pointsPer50gCo2Saved: POINTS_PER_50G,
      note: 'Estimate only. Uses a prototype-average passenger-car emission factor; it is not a measured vehicle emission.',
    },
    routeOptimization: {
      baselineDistanceKm: round(baseline, 2),
      selectedDistanceKm: round(selected, 2),
      distanceSavedKm: round(routeKmSaved, 2),
      co2SavedGrams: Math.round(routeCo2SavedGrams),
      co2SavedKg: round(routeCo2SavedGrams / 1000, 2),
    },
    carpool: {
      passengers,
      vehicleTripsAvoided: carpoolVehicleTripsAvoided,
      co2SavedGrams: Math.round(carpoolCo2SavedGrams),
      co2SavedKg: round(carpoolCo2SavedGrams / 1000, 2),
    },
    total: {
      co2SavedGrams: Math.round(totalCo2SavedGrams),
      co2SavedKg: round(totalCo2SavedGrams / 1000, 2),
      points,
    },
  };
}

function ensureUser(id, name) {
  if (!leaderboard.has(id)) {
    leaderboard.set(id, { id, name: name || 'Saathi', points: 0, co2SavedGrams: 0, trips: 0 });
  }
  return leaderboard.get(id);
}

function recordImpact({ userId, name, impact }) {
  if (!userId) throw new Error('userId is required');
  const user = ensureUser(String(userId), name);
  user.points += Number(impact?.total?.points || 0);
  user.co2SavedGrams += Number(impact?.total?.co2SavedGrams || 0);
  user.trips += 1;
  return user;
}

function getLeaderboard(currentUserId) {
  return [...leaderboard.values()]
    .sort((a, b) => b.points - a.points)
    .map((row, index) => ({
      rank: index + 1,
      ...row,
      co2SavedKg: round(row.co2SavedGrams / 1000, 2),
      isCurrentUser: row.id === currentUserId,
    }));
}

module.exports = { estimateImpact, recordImpact, getLeaderboard, CAR_CO2_G_PER_KM, POINTS_PER_50G };
