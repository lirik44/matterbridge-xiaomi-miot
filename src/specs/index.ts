import type { DeviceSpec } from '../miot/types.js';

import { dmakerFanP18 } from './dmaker_fan_p18.js';
import { DREAME_F9_MODELS, dreameVacuumF9 } from './dreame_vacuum.js';
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
  ...Object.fromEntries(DREAME_F9_MODELS.map((model) => [model, dreameVacuumF9])),
};

/**
 * Families whose members share one mapping, used when an exact model is unknown.
 *
 * Dreame publishes near-identical specifications across its vacuum line, so an
 * unlisted `dreame.vacuum.*` is far more likely to work with the F9 mapping than
 * not to work at all — the plugin logs that it is guessing.
 */
const FAMILIES: { prefix: string; spec: DeviceSpec }[] = [{ prefix: 'dreame.vacuum.', spec: dreameVacuumF9 }];

/** The outcome of a specification lookup. */
export interface SpecMatch {
  spec: DeviceSpec;
  /** `true` when the mapping comes from the model family rather than the model itself. */
  guessed: boolean;
}

/**
 * Looks up the specification of a model.
 *
 * @param {string} model The MIoT model string, e.g. `dmaker.fan.p18`.
 * @returns {SpecMatch | undefined} The specification, or `undefined` if unsupported.
 */
export function findSpec(model: string | undefined): SpecMatch | undefined {
  if (!model) return undefined;

  const normalized = model.trim().toLowerCase();
  const exact = SPECS[normalized];
  if (exact) return { spec: exact, guessed: false };

  const family = FAMILIES.find(({ prefix }) => normalized.startsWith(prefix));
  return family ? { spec: family.spec, guessed: true } : undefined;
}

/** @returns {string[]} The list of explicitly supported models. */
export function supportedModels(): string[] {
  return Object.keys(SPECS).sort();
}
