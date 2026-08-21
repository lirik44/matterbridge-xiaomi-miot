import type { VacuumSpec } from '../miot/types.js';

/**
 * Dreame robot vacuums of the F9 family.
 *
 * These robots do not implement the Roborock RPCs (`app_start`, `get_status`, …):
 * sending one makes them answer `{ code: -9999, message: 'user ack timeout' }`.
 * Everything therefore goes through the MIoT property and action calls below,
 * which the whole family shares.
 *
 * @see https://home.miot-spec.com/spec/dreame.vacuum.p2008
 */
export const dreameVacuumF9: VacuumSpec = {
  kind: 'vacuum',
  model: 'dreame.vacuum.p2008',
  displayName: 'Dreame robot vacuum',
  specUrl: 'https://home.miot-spec.com/spec/dreame.vacuum.p2008',
  props: {
    status: { siid: 2, piid: 1 },
    fault: { siid: 2, piid: 2 },
    battery: { siid: 3, piid: 1 },
    chargingState: { siid: 3, piid: 2 },
    operatingMode: { siid: 4, piid: 1 },
    cleaningMode: { siid: 4, piid: 4 },
    waterFlow: { siid: 4, piid: 5 },
    waterBoxStatus: { siid: 4, piid: 6 },
  },
  actions: {
    startClean: { siid: 4, aiid: 1 },
    stopClean: { siid: 4, aiid: 2 },
    home: { siid: 3, aiid: 1 },
    locate: { siid: 7, aiid: 1 },
  },
  statusValues: {
    1: 'cleaning', // Sweeping
    2: 'idle',
    3: 'paused',
    4: 'error',
    5: 'returning', // GoCharging
    6: 'charging',
    7: 'mopping',
    13: 'manual-cleaning', // ManualSweeping
  },
  chargingValues: {
    1: true, // Charging
    2: false, // Discharging
    4: true, // Charging2
    5: false, // GoCharging
  },
  // The suction level has no "off" value: a mop-only mode leaves it untouched.
  vacuumLevels: {
    off: null,
    modes: [
      { name: 'Quiet', value: 0, tag: 'lowNoise' },
      { name: 'Standard', value: 1, tag: 'min' },
      { name: 'Strong', value: 2, tag: 'day' },
      { name: 'Turbo', value: 3, tag: 'max' },
    ],
  },
  mopLevels: {
    off: 0,
    modes: [
      { name: 'Light', value: 1, tag: 'min' },
      { name: 'Medium', value: 2, tag: 'day' },
      { name: 'High', value: 3, tag: 'max' },
    ],
  },
  // The map is only available as an opaque blob over MIoT, so rooms cannot be
  // discovered nor cleaned individually. They are declared in the configuration.
  roomCleaning: false,
};

/**
 * The models sharing the F9 mapping: p2008 (F9), p2009 (D9), p2028 (Z10 Pro),
 * p2041o, p2150a and p2150o.
 */
export const DREAME_F9_MODELS = ['dreame.vacuum.p2008', 'dreame.vacuum.p2009', 'dreame.vacuum.p2028', 'dreame.vacuum.p2041o', 'dreame.vacuum.p2150a', 'dreame.vacuum.p2150o'];
