import type { FanSpec } from '../miot/types.js';

/**
 * Xiaomi Mi Smart Fan 2 (`dmaker.fan.p18`).
 *
 * @see https://home.miot-spec.com/spec/dmaker.fan.p18
 */
export const dmakerFanP18: FanSpec = {
  kind: 'fan',
  model: 'dmaker.fan.p18',
  displayName: 'Mi Smart Fan 2',
  specUrl: 'https://home.miot-spec.com/spec/dmaker.fan.p18',
  props: {
    power: { siid: 2, piid: 1 },
    fanLevel: { siid: 2, piid: 2 },
    mode: { siid: 2, piid: 3 },
    swing: { siid: 2, piid: 4 },
    swingAngle: { siid: 2, piid: 5 },
    offDelay: { siid: 2, piid: 6 },
    led: { siid: 2, piid: 7 },
    buzzer: { siid: 2, piid: 8 },
    speed: { siid: 2, piid: 10 },
    childLock: { siid: 3, piid: 1 },
  },
  actions: {
    toggle: { siid: 2, aiid: 1 },
  },
  fanLevels: 4,
  straightModeValue: 0,
  naturalModeValue: 1,
};
