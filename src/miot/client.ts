import miio, { type Device } from 'miio-api';
import type { AnsiLogger } from 'matterbridge/logger';

import type { MiioInfo, MiotAction, MiotProp, MiotPropertyResult } from './types.js';

/** The value types a MIoT property can hold. */
export type MiotValue = boolean | number | string;

export interface MiotClientOptions {
  /** The device name, used for logging only. */
  name: string;
  /** The device IP address. */
  ip: string;
  /** The 32 character device token. */
  token: string;
  log: AnsiLogger;
}

/** How many properties are requested in a single `get_properties` call. */
const PROPS_PER_CALL = 10;

/** How long to wait before retrying a failed connection, in milliseconds. */
const RECONNECT_DELAY_MS = 10_000;

/**
 * A thin MIoT client on top of the local miIO protocol.
 *
 * The client owns a single `miio-api` device, re-creating it whenever the
 * connection breaks. All reads and writes go through the MIoT RPCs
 * (`get_properties`, `set_properties`, `action`), which every MIoT spec v2
 * device understands, so no model specific RPCs are needed.
 */
export class MiotClient {
  private device?: Device;
  private connecting?: Promise<Device>;
  private reconnectTimer?: NodeJS.Timeout;
  private destroyed = false;

  private readonly log: AnsiLogger;

  constructor(private readonly options: MiotClientOptions) {
    this.log = options.log;
  }

  /** @returns {boolean} Whether a device connection is currently established. */
  get connected(): boolean {
    return this.device !== undefined;
  }

  /**
   * Connects to the device, reusing an in-flight connection attempt if there is one.
   *
   * @returns {Promise<Device>} The connected device.
   */
  async connect(): Promise<Device> {
    if (this.device) return this.device;
    if (this.destroyed) throw new Error('The client has been destroyed');

    this.connecting ??= miio
      .device({ address: this.options.ip, token: this.options.token })
      .then((device) => {
        this.device = device;
        this.log.info(`Connected to ${this.options.name} at ${this.options.ip} (did ${device.id})`);
        return device;
      })
      .finally(() => {
        this.connecting = undefined;
      });

    return this.connecting;
  }

  /**
   * Reads the given properties in as few calls as the device tolerates.
   *
   * Properties the device refuses to report (non-zero `code`) are omitted from the
   * result instead of failing the whole read.
   *
   * @param {Record<string, MiotProp>} props The properties to read, keyed by name.
   * @returns {Promise<Record<string, MiotValue>>} The values, keyed by the same names.
   */
  async getProperties(props: Record<string, MiotProp>): Promise<Record<string, MiotValue>> {
    const names = Object.keys(props);
    const out: Record<string, MiotValue> = {};

    for (let i = 0; i < names.length; i += PROPS_PER_CALL) {
      const batch = names.slice(i, i + PROPS_PER_CALL);
      const params = batch.map((did) => ({ did, ...props[did] }));
      const results = await this.call<MiotPropertyResult[]>('get_properties', params);

      for (const entry of results ?? []) {
        if (entry?.code === 0 && entry.did !== undefined && entry.value !== undefined) {
          out[entry.did] = entry.value as MiotValue;
        } else if (entry?.code !== 0) {
          this.log.debug(`${this.options.name} | property ${entry?.did} returned code ${entry?.code}`);
        }
      }
    }

    return out;
  }

  /**
   * Writes a single property.
   *
   * @param {string} name The property name, used for logging and as the `did`.
   * @param {MiotProp} prop The property address.
   * @param {MiotValue} value The value to write.
   * @returns {Promise<void>} Resolves once the device acknowledged the write.
   */
  async setProperty(name: string, prop: MiotProp, value: MiotValue): Promise<void> {
    this.log.debug(`${this.options.name} | set ${name} (${prop.siid}.${prop.piid}) = ${value}`);
    const results = await this.call<MiotPropertyResult[]>('set_properties', [{ did: name, ...prop, value }]);
    const failed = (results ?? []).find((entry) => entry?.code !== 0);
    if (failed) {
      throw new Error(`Failed to set ${name} to ${value}: code ${failed.code}`);
    }
  }

  /**
   * Invokes an action.
   *
   * @param {string} name The action name, used for logging and as the `did`.
   * @param {MiotAction} action The action address.
   * @param {MiotValue[]} params The action arguments.
   * @returns {Promise<void>} Resolves once the device acknowledged the action.
   */
  async callAction(name: string, action: MiotAction, params: MiotValue[] = []): Promise<void> {
    this.log.debug(`${this.options.name} | action ${name} (${action.siid}.${action.aiid})`);
    // MIoT actions take an object payload, while `miio-api` types `params` as an array.
    // The payload is only JSON serialised on the wire, so widening the type here is safe.
    await this.call<unknown>('action', { did: name, ...action, in: params } as unknown as unknown[]);
  }

  /**
   * Reads the miIO device information (mac address, firmware version, model).
   *
   * @returns {Promise<MiioInfo | undefined>} The info, or `undefined` if the device refused it.
   */
  async info(): Promise<MiioInfo | undefined> {
    try {
      return await this.call<MiioInfo>('miIO.info', []);
    } catch (error) {
      this.log.debug(`${this.options.name} | miIO.info failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Performs an arbitrary miIO call.
   *
   * Needed by devices that do not answer the MIoT RPCs, such as Yeelight lamps,
   * which only speak their own legacy method set over the same channel.
   *
   * @param {string} method The miIO method name, e.g. `get_prop`.
   * @param {unknown[]} params The method parameters.
   * @returns {Promise<T>} The parsed response.
   */
  async raw<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.call<T>(method, params);
  }

  /** Closes the connection and stops reconnecting. */
  async destroy(): Promise<void> {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    await this.dropConnection();
  }

  /**
   * Performs a single miIO call, dropping the connection on transport errors so
   * that the next call reconnects.
   *
   * @param {string} method The miIO method name.
   * @param {unknown[]} params The method parameters.
   * @returns {Promise<T>} The parsed response.
   */
  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const device = await this.connect();
    try {
      return await device.call<unknown[], T>(method, params);
    } catch (error) {
      if (this.isTransportError(error)) {
        this.log.warn(`${this.options.name} | ${method} failed (${String(error)}), reconnecting...`);
        await this.dropConnection();
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  /**
   * @param {unknown} error The error thrown by a miIO call.
   * @returns {boolean} Whether the error means the connection is no longer usable.
   */
  private isTransportError(error: unknown): boolean {
    if (error instanceof miio.SocketError || error instanceof miio.ProtocolError) return true;
    const message = error instanceof Error ? error.message : String(error);
    return /timeout|socket|closed|destroyed|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED/i.test(message);
  }

  /** Tears down the current device connection, if any. */
  private async dropConnection(): Promise<void> {
    const device = this.device;
    this.device = undefined;
    if (!device) return;
    try {
      await device.destroy();
    } catch (error) {
      this.log.debug(`${this.options.name} | destroy failed: ${error}`);
    }
  }

  /** Warms up the connection in the background so the next poll finds it ready. */
  private scheduleReconnect(): void {
    if (this.destroyed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.log.debug(`${this.options.name} | reconnect failed: ${error}`);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer.unref();
  }
}
