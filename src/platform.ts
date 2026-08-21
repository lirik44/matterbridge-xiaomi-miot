import { MatterbridgeDynamicPlatform, type PlatformMatterbridge } from 'matterbridge';
import { AnsiLogger, LogLevel, TimestampFormat, type AnsiLogger as Logger } from 'matterbridge/logger';

import { resolveDeviceConfig, type XiaomiMiotPlatformConfig } from './config.js';
import { createAccessory } from './devices/factory.js';
import type { MiotAccessory } from './devices/base.js';

/**
 * The Matterbridge platform exposing Xiaomi MIoT devices over Matter.
 *
 * Every configured device is contacted over the local miIO protocol, exposed as
 * one or more bridged Matter devices and polled on a fixed interval.
 */
export class XiaomiMiotPlatform extends MatterbridgeDynamicPlatform {
  private readonly accessories = new Set<MiotAccessory>();

  constructor(
    matterbridge: PlatformMatterbridge,
    log: Logger,
    override config: XiaomiMiotPlatformConfig,
  ) {
    super(matterbridge, log, config);

    log.logLevel = this.config.debug === true ? LogLevel.DEBUG : log.logLevel;

    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.3.0')) {
      throw new Error(`This plugin requires Matterbridge version >= "3.3.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version.`);
    }

    this.log.info('Initializing platform...');
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`onStart called with reason: ${reason ?? 'none'}`);

    await this.ready;
    await this.clearSelect();

    const devices = this.config.devices ?? [];
    if (devices.length === 0) {
      this.log.warn('No devices configured. Add your Xiaomi devices in the plugin configuration.');
      return;
    }

    // Devices are set up in parallel: a device that is offline must not hold up the others.
    await Promise.all(devices.map((device) => this.startDevice(device)));
  }

  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.debug(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    await super.onShutdown(reason);
    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);

    await Promise.all([...this.accessories].map((accessory) => accessory.stop()));
    this.accessories.clear();

    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }

  /**
   * Sets up a single configured device: resolves its configuration, builds its
   * endpoints, registers them and starts polling.
   *
   * A failure is logged and does not affect the other devices.
   *
   * @param {XiaomiMiotPlatformConfig['devices'][number]} device The device configuration as written by the user.
   * @returns {Promise<void>} Resolves once the device has been registered, or the failure logged.
   */
  private async startDevice(device: NonNullable<XiaomiMiotPlatformConfig['devices']>[number]): Promise<void> {
    let name = device.name ?? device.ip ?? 'unnamed device';
    try {
      const config = resolveDeviceConfig(device, this.config);
      name = config.name;

      if (!config.deviceEnabled) {
        this.log.info(`${name} | disabled in the configuration, skipping`);
        return;
      }

      if (!this.validateDevice(name)) {
        this.log.info(`${name} | filtered out by the white/black list, skipping`);
        return;
      }

      const log = new AnsiLogger({
        logName: name,
        logLevel: config.debug ? LogLevel.DEBUG : this.log.logLevel,
        logTimestampFormat: TimestampFormat.TIME_MILLIS,
      });

      const accessory = await createAccessory(config, log);
      const endpoints = await accessory.initialize();
      this.accessories.add(accessory);

      for (const endpoint of endpoints) {
        await this.registerDevice(endpoint);
      }
      await accessory.postRegister();

      this.log.info(`${name} | exposed ${endpoints.length} Matter device${endpoints.length === 1 ? '' : 's'}, polling every ${config.pollingInterval}s`);
    } catch (error) {
      this.log.error(`${name} | failed to set up: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
