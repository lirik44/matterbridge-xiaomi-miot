import type { AnsiLogger } from 'matterbridge/logger';

import { MiotClient } from '../miot/client.js';
import { findSpec, supportedModels } from '../specs/index.js';
import type { ResolvedDeviceConfig } from '../config.js';

import { AirPurifierAccessory } from './air_purifier.js';
import type { MiotAccessory } from './base.js';
import { FanAccessory } from './fan.js';
import { LightAccessory } from './light.js';
import { VacuumAccessory } from './vacuum.js';

/**
 * Creates the accessory matching the model of a configured device.
 *
 * When the configuration does not name a model, the device is queried for it,
 * which requires it to be online.
 *
 * @param {ResolvedDeviceConfig} config The resolved device configuration.
 * @param {AnsiLogger} log The logger of this device.
 * @returns {Promise<MiotAccessory>} The accessory, ready to be initialized.
 * @throws {Error} When the model cannot be determined or is not supported.
 */
export async function createAccessory(config: ResolvedDeviceConfig, log: AnsiLogger): Promise<MiotAccessory> {
  const model = config.model ?? (await probeModel(config, log));
  const match = findSpec(model);

  if (!match) {
    throw new Error(`Device "${config.name}" has the unsupported model "${model ?? 'unknown'}". Supported models: ${supportedModels().join(', ')}.`);
  }

  if (match.guessed) {
    log.warn(`${config.name} | ${model} is not listed explicitly; using the ${match.spec.model} mapping of its family. Please report whether it works.`);
  }

  // Remember the model that was resolved, so the endpoints carry the real one.
  const resolved: ResolvedDeviceConfig = { ...config, model };
  const { spec } = match;

  switch (spec.kind) {
    case 'fan':
      return new FanAccessory(spec, resolved, log);
    case 'air-purifier':
      return new AirPurifierAccessory(spec, resolved, log);
    case 'light':
      return new LightAccessory(spec, resolved, log);
    case 'vacuum':
      return new VacuumAccessory(spec, resolved, log);
  }
}

/**
 * Asks the device for its model.
 *
 * @param {ResolvedDeviceConfig} config The resolved device configuration.
 * @param {AnsiLogger} log The logger of this device.
 * @returns {Promise<string | undefined>} The model reported by the device, if it answered.
 */
async function probeModel(config: ResolvedDeviceConfig, log: AnsiLogger): Promise<string | undefined> {
  log.info(`${config.name} | no model configured, asking the device at ${config.ip}...`);
  const client = new MiotClient({ name: config.name, ip: config.ip, token: config.token, log });
  try {
    const info = await client.info();
    if (info?.model) log.info(`${config.name} | reports model ${info.model}`);
    return info?.model?.toLowerCase();
  } finally {
    await client.destroy();
  }
}
