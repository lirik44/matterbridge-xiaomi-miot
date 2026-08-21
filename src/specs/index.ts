import type { DeviceSpec } from '../miot/types.js';

import { dmakerFanP18 } from './dmaker_fan_p18.js';
import { yeelinkLightLamp4 } from './yeelink_light_lamp4.js';
import { zhimiAirpMb5, zhimiAirpVb4 } from './zhimi_airp.js';

/**
 * Every supported model, keyed by its MIoT model string.
 *
 * To add a model, look up its specification on https://home.miot-spec.com/,
 * write the `siid`/`piid` mapping into a new file next to this one and register
 * it here. No other change is needed.
 */
export const SPECS: Record<string, DeviceSpec> = {
  [dmakerFanP18.model]: dmakerFanP18,
  [zhimiAirpVb4.model]: zhimiAirpVb4,
  [zhimiAirpMb5.model]: zhimiAirpMb5,
  [yeelinkLightLamp4.model]: yeelinkLightLamp4,
};

/**
 * Looks up the specification of a model.
 *
 * @param {string} model The MIoT model string, e.g. `dmaker.fan.p18`.
 * @returns {DeviceSpec | undefined} The specification, or `undefined` if unsupported.
 */
export function findSpec(model: string | undefined): DeviceSpec | undefined {
  if (!model) return undefined;
  return SPECS[model.trim().toLowerCase()];
}

/** @returns {string[]} The list of supported models. */
export function supportedModels(): string[] {
  return Object.keys(SPECS).sort();
}
