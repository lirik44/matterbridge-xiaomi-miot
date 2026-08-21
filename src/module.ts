import type { PlatformMatterbridge } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import { XiaomiMiotPlatform } from './platform.js';
import type { XiaomiMiotPlatformConfig } from './config.js';

/**
 * The entry point every Matterbridge plugin exports.
 *
 * @param {PlatformMatterbridge} matterbridge The Matterbridge instance.
 * @param {AnsiLogger} log The logger of this plugin.
 * @param {XiaomiMiotPlatformConfig} config The plugin configuration.
 * @returns {XiaomiMiotPlatform} The platform instance driving the plugin.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: XiaomiMiotPlatformConfig): XiaomiMiotPlatform {
  return new XiaomiMiotPlatform(matterbridge, log, config);
}

export { XiaomiMiotPlatform } from './platform.js';
export type { DeviceConfig, XiaomiMiotPlatformConfig } from './config.js';
