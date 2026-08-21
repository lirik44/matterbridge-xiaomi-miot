import type { PlatformConfig } from 'matterbridge';

/**
 * The per-device configuration.
 *
 * The `*Control` flags mirror the ones of the `homebridge-miot` plugin, so an
 * existing Homebridge configuration can be copied over as is. Every flag adds an
 * extra Matter endpoint, which shows up as its own tile in the controller app.
 */
export interface DeviceConfig {
  /** The name shown in the controller app. */
  name: string;
  /** The device IP address. Give the device a static lease on your router. */
  ip: string;
  /** The 32 character device token. */
  token: string;
  /** The MIoT model, e.g. `dmaker.fan.p18`. Auto-detected when omitted. */
  model?: string;
  /** The Xiaomi device id. Only used as a fallback serial number. */
  deviceId?: string | number;
  /** How often the device is polled, in seconds. */
  pollingInterval?: number;
  /** Set to `false` to skip this device without deleting its configuration. */
  deviceEnabled?: boolean;

  /** Expose the beeper as a switch. */
  buzzerControl?: boolean;
  /** Expose the display/indicator light as a switch. */
  ledControl?: boolean;
  /** Expose the physical controls lock as a switch. */
  childLockControl?: boolean;
  /** Expose the operating modes as switches (air purifier: auto/sleep/favorite/manual). */
  modeControl?: boolean;
  /** Expose the ionizer as a switch (air purifier only). */
  ionizerControl?: boolean;
  /** Expose the natural wind mode as a switch (fan only, in addition to the wind setting). */
  naturalModeControl?: boolean;
  /** Expose the built-in scenes as momentary switches (light only). */
  sceneControl?: boolean;

  /** Expose air quality, temperature and humidity (air purifier only). */
  sensorsControl?: boolean;
  /** Expose the HEPA filter condition (air purifier only). */
  filterControl?: boolean;
  /**
   * Expose the sensors as their own bridged devices rather than as child
   * endpoints of the purifier. Apple Home does not show child endpoints of a
   * composed device, so this defaults to `true`.
   */
  separateSensors?: boolean;
  /**
   * How the speed slider maps onto the air purifier.
   * `favorite` uses the fine grained favorite level (12 steps), `levels` uses
   * the three manual fan levels.
   */
  speedControl?: 'favorite' | 'levels';

  /** Enable debug logging for this device. */
  debug?: boolean;
}

/** The plugin configuration as stored by Matterbridge. */
export interface XiaomiMiotPlatformConfig extends PlatformConfig {
  /** The devices to expose. */
  devices?: DeviceConfig[];
  /** The default polling interval for devices that do not set their own, in seconds. */
  pollingInterval?: number;
  /** Only expose the devices named here. */
  whiteList?: string[];
  /** Never expose the devices named here. */
  blackList?: string[];
}

/** A device configuration with every optional field resolved. */
export type ResolvedDeviceConfig = Required<Omit<DeviceConfig, 'model' | 'deviceId'>> & {
  model?: string;
  deviceId?: string | number;
};

/** The default polling interval, in seconds. */
export const DEFAULT_POLLING_INTERVAL = 10;

/** The shortest polling interval accepted, in seconds. */
const MIN_POLLING_INTERVAL = 2;

/**
 * Applies the defaults to a device configuration and validates the required fields.
 *
 * @param {DeviceConfig} config The device configuration as written by the user.
 * @param {XiaomiMiotPlatformConfig} platformConfig The plugin configuration, used for the fallback polling interval.
 * @returns {ResolvedDeviceConfig} The configuration with defaults applied.
 * @throws {Error} When a required field is missing or malformed.
 */
export function resolveDeviceConfig(config: DeviceConfig, platformConfig: XiaomiMiotPlatformConfig): ResolvedDeviceConfig {
  if (!config.name) throw new Error('Every device needs a name.');
  if (!config.ip) throw new Error(`Device "${config.name}" needs an ip address.`);
  if (!config.token) throw new Error(`Device "${config.name}" needs a token.`);
  if (!/^[0-9a-fA-F]{32}$/.test(config.token.trim())) {
    throw new Error(`Device "${config.name}" has a malformed token: it must be 32 hexadecimal characters.`);
  }

  const pollingInterval = Math.max(MIN_POLLING_INTERVAL, config.pollingInterval ?? platformConfig.pollingInterval ?? DEFAULT_POLLING_INTERVAL);

  return {
    ...config,
    name: config.name.trim(),
    ip: config.ip.trim(),
    token: config.token.trim().toLowerCase(),
    model: config.model?.trim().toLowerCase(),
    pollingInterval,
    deviceEnabled: config.deviceEnabled ?? true,
    buzzerControl: config.buzzerControl ?? false,
    ledControl: config.ledControl ?? false,
    childLockControl: config.childLockControl ?? false,
    modeControl: config.modeControl ?? false,
    ionizerControl: config.ionizerControl ?? false,
    naturalModeControl: config.naturalModeControl ?? false,
    sceneControl: config.sceneControl ?? false,
    sensorsControl: config.sensorsControl ?? true,
    filterControl: config.filterControl ?? true,
    separateSensors: config.separateSensors ?? true,
    speedControl: config.speedControl ?? 'favorite',
    debug: config.debug ?? platformConfig.debug ?? false,
  };
}
