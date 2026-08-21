import type { LightSpec } from '../miot/types.js';

/**
 * Xiaomi Mi LED Desk Lamp 1S (`yeelink.light.lamp4`).
 *
 * The lamp is white only: brightness `1..100` and color temperature
 * `2600..5000` K.
 *
 * Even though the lamp publishes a MIoT specification, its firmware (2.1.7)
 * answers every `get_properties`/`set_properties` call with `user ack timeout`
 * (-9999). It does answer the legacy Yeelight methods over the same miIO
 * channel, so the `yeelight` transport is used. The `siid`/`piid` mapping below
 * is kept for reference and would be used if a firmware update ever starts
 * answering MIoT calls.
 *
 * @see https://home.miot-spec.com/spec/yeelink.light.lamp4
 */
export const yeelinkLightLamp4: LightSpec = {
  kind: 'light',
  model: 'yeelink.light.lamp4',
  displayName: 'Mi LED Desk Lamp 1S',
  specUrl: 'https://home.miot-spec.com/spec/yeelink.light.lamp4',
  props: {
    power: { siid: 2, piid: 1 },
    brightness: { siid: 2, piid: 2 },
    colorTemperature: { siid: 2, piid: 3 },
    mode: { siid: 2, piid: 4 },
  },
  actions: {
    toggle: { siid: 2, aiid: 1 },
  },
  transport: 'yeelight',
  brightnessRange: [1, 100],
  colorTemperatureRange: [2600, 5000],
  scenes: [
    { name: 'Reading', value: 0 },
    { name: 'Computer', value: 1 },
    { name: 'Night Reading', value: 2 },
    { name: 'Anti-blue', value: 3 },
    { name: 'Effective Work', value: 4 },
    { name: 'Candle', value: 5 },
    { name: 'Twinkle', value: 6 },
  ],
};
