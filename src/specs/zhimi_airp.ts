import type { AirPurifierSpec } from '../miot/types.js';

/** Properties shared by the `zhimi.airp.vb4` and `zhimi.airp.mb5` purifiers. */
const sharedProps = {
  power: { siid: 2, piid: 1 },
  fault: { siid: 2, piid: 2 },
  mode: { siid: 2, piid: 4 },
  fanLevel: { siid: 2, piid: 5 },
  anion: { siid: 2, piid: 6 },
  humidity: { siid: 3, piid: 1 },
  pm25: { siid: 3, piid: 4 },
  temperature: { siid: 3, piid: 7 },
  filterLife: { siid: 4, piid: 1 },
  filterUsedTime: { siid: 4, piid: 3 },
  filterLeftTime: { siid: 4, piid: 4 },
  buzzer: { siid: 6, piid: 1 },
  childLock: { siid: 8, piid: 1 },
  screen: { siid: 13, piid: 2 },
  favoriteLevel: { siid: 9, piid: 5 },
} as const;

/** The `mode` enum shared by both purifiers. */
const modes = { auto: 0, sleep: 1, favorite: 2, manual: 3 } as const;

/**
 * Xiaomi Smart Air Purifier 4 Pro (`zhimi.airp.vb4`).
 *
 * Same specification as the Air Purifier 4 plus a PM10 sensor.
 *
 * @see https://home.miot-spec.com/spec/zhimi.airp.vb4
 */
export const zhimiAirpVb4: AirPurifierSpec = {
  kind: 'air-purifier',
  model: 'zhimi.airp.vb4',
  displayName: 'Xiaomi Smart Air Purifier 4 Pro',
  specUrl: 'https://home.miot-spec.com/spec/zhimi.airp.vb4',
  props: {
    ...sharedProps,
    pm10: { siid: 3, piid: 8 },
  },
  actions: {
    toggle: { siid: 2, aiid: 1 },
    resetFilterLife: { siid: 4, aiid: 1 },
  },
  modes,
  fanLevels: 3,
  favoriteLevelRange: [0, 11],
  screenValues: { on: 2, off: 0 },
};

/**
 * Xiaomi Smart Air Purifier 4 (`zhimi.airp.mb5`).
 *
 * @see https://home.miot-spec.com/spec/zhimi.airp.mb5
 */
export const zhimiAirpMb5: AirPurifierSpec = {
  kind: 'air-purifier',
  model: 'zhimi.airp.mb5',
  displayName: 'Xiaomi Smart Air Purifier 4',
  specUrl: 'https://home.miot-spec.com/spec/zhimi.airp.mb5',
  props: { ...sharedProps },
  actions: {
    toggle: { siid: 2, aiid: 1 },
    resetFilterLife: { siid: 4, aiid: 1 },
  },
  modes,
  fanLevels: 3,
  favoriteLevelRange: [0, 11],
  screenValues: { on: 2, off: 0 },
};
