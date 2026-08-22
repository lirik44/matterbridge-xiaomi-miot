import { createHash } from 'node:crypto';

import { bridgedNode, MatterbridgeEndpoint, onOffPlugInUnit, powerSource } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { OnOff } from 'matterbridge/matter/clusters';

import { MiotClient, type MiotValue } from '../miot/client.js';
import type { DeviceSpec, MiotProp } from '../miot/types.js';
import type { ResolvedDeviceConfig } from '../config.js';

/** The Matter vendor id used for the bridged devices of this plugin. */
export const VENDOR_ID = 0xfff1;
/** The vendor name shown in the controller app. */
export const VENDOR_NAME = 'Xiaomi';
/** The plugin URL shown in the controller app. */
export const PRODUCT_URL = 'https://github.com/lirik44/matterbridge-xiaomi-miot';

/** How long a momentary switch stays on before it resets itself, in milliseconds. */
const MOMENTARY_RESET_MS = 1000;

/** How many consecutive failed polls it takes to call a device unreachable. */
const FAILURES_BEFORE_UNREACHABLE = 3;

/** A switch endpoint bound to a boolean or enum MIoT property. */
interface BoundSwitch {
  endpoint: MatterbridgeEndpoint;
  /** The polled property this switch reflects. */
  propName: string;
  /** The value written when the switch is turned on. */
  onValue: MiotValue;
  /** The value written when the switch is turned off, or `undefined` for momentary switches. */
  offValue?: MiotValue;
  /** Whether the switch turns itself back off after being triggered. */
  momentary: boolean;
}

/**
 * The shared machinery of every exposed device: the MIoT connection, the polling
 * loop, the identity of the bridged devices and the optional switch endpoints.
 *
 * Subclasses describe what to poll ({@link polledProps}), how to build the Matter
 * endpoints ({@link buildEndpoints}) and how to push a polled state into them
 * ({@link applyState}).
 */
export abstract class MiotAccessory<S extends DeviceSpec = DeviceSpec> {
  protected readonly client: MiotClient;
  /** The most recent values read from the device, keyed by property name. */
  protected state: Record<string, MiotValue> = {};
  /** Every endpoint of this device, in registration order. */
  protected readonly endpoints: MatterbridgeEndpoint[] = [];

  private readonly switches: BoundSwitch[] = [];
  private pollTimer?: NodeJS.Timeout;
  private polling = false;
  private stopped = false;
  private reachable = false;
  private consecutiveFailures = 0;

  protected serialNumber = '';
  protected firmware = 'Unknown';
  /** The MIoT model of this device, which may be a family member of the specification. */
  protected readonly model: string;

  constructor(
    protected readonly spec: S,
    protected readonly config: ResolvedDeviceConfig,
    protected readonly log: AnsiLogger,
  ) {
    this.client = new MiotClient({ name: config.name, ip: config.ip, token: config.token, log });
    this.model = config.model ?? spec.model;
  }

  /** @returns {string} The device name as configured. */
  get name(): string {
    return this.config.name;
  }

  /**
   * Connects to the device (best effort), then builds every Matter endpoint.
   *
   * The endpoints are built even when the device is unreachable, so that a device
   * that is temporarily offline does not disappear from the controller app.
   *
   * @returns {Promise<MatterbridgeEndpoint[]>} The endpoints to register.
   */
  async initialize(): Promise<MatterbridgeEndpoint[]> {
    const info = await this.client
      .connect()
      .then(() => this.client.info())
      .catch((error) => {
        this.log.warn(`${this.name} | not reachable yet (${String(error)}). The device will be exposed and polled anyway.`);
        return undefined;
      });

    this.reachable = info !== undefined;
    this.firmware = info?.fw_ver ?? 'Unknown';
    this.serialNumber = this.resolveSerialNumber(info?.mac);

    this.log.info(`${this.name} | ${this.spec.displayName} (${this.model}) serial ${this.serialNumber} firmware ${this.firmware}`);

    this.buildEndpoints();
    return this.endpoints;
  }

  /**
   * Wires up the command handlers and starts the polling loop.
   *
   * Must be called after the endpoints have been registered with Matterbridge,
   * because attributes can only be written once the endpoint is alive.
   *
   * @returns {Promise<void>} Resolves once the first poll completed.
   */
  async postRegister(): Promise<void> {
    this.registerHandlers();
    this.registerSwitchHandlers();

    await this.poll();

    this.pollTimer = setInterval(
      () => {
        void this.poll();
      },
      Math.round(this.config.pollingInterval * 1000),
    );
    this.pollTimer.unref();
  }

  /** Stops polling and closes the MIoT connection. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    await this.client.destroy();
  }

  // --- to be implemented by the concrete device kinds ------------------------

  /** @returns {Record<string, MiotProp>} The properties to read on every poll. */
  protected abstract polledProps(): Record<string, MiotProp>;

  /** Builds the endpoints of this device, appending them to {@link endpoints}. */
  protected abstract buildEndpoints(): void;

  /**
   * Pushes the current {@link state} into the Matter attributes.
   *
   * @returns {Promise<void>} Resolves once every attribute has been updated.
   */
  protected abstract applyState(): Promise<void>;

  /** Subscribes to the Matter attributes and commands this device reacts to. */
  protected abstract registerHandlers(): void;

  // --- polling --------------------------------------------------------------

  /**
   * Reads every polled property and pushes the result into the Matter attributes.
   *
   * @returns {Promise<void>} Resolves once the state has been applied.
   */
  protected async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      this.state = await this.readState();
      this.consecutiveFailures = 0;
      if (!this.reachable) {
        this.log.info(`${this.name} | is reachable again`);
        this.reachable = true;
      }
      await this.applyState();
      await this.applySwitchState();
    } catch (error) {
      this.consecutiveFailures++;
      // A single timeout is routine — a device asleep on its dock or busy with
      // its own radio misses one read and answers the next. Only a run of them
      // means the device is really gone.
      if (this.reachable && this.consecutiveFailures >= FAILURES_BEFORE_UNREACHABLE) {
        this.log.warn(`${this.name} | unreachable after ${this.consecutiveFailures} failed polls: ${String(error)}`);
        this.reachable = false;
      } else {
        this.log.debug(`${this.name} | poll failed: ${String(error)}`);
      }
    } finally {
      this.polling = false;
    }
  }

  // --- MIoT writes ----------------------------------------------------------

  /**
   * Reads the current device state.
   *
   * Devices that do not answer the MIoT RPCs override this.
   *
   * @returns {Promise<Record<string, MiotValue>>} The polled values, keyed by property name.
   */
  protected async readState(): Promise<Record<string, MiotValue>> {
    return this.client.getProperties(this.polledProps());
  }

  /**
   * Writes a single property.
   *
   * Devices that do not answer the MIoT RPCs override this.
   *
   * @param {string} propName The property name in the device specification.
   * @param {MiotValue} value The value to write.
   * @returns {Promise<void>} Resolves once the device acknowledged the write.
   */
  protected async writeProp(propName: string, value: MiotValue): Promise<void> {
    const prop = (this.spec.props as Record<string, MiotProp | undefined>)[propName];
    if (!prop) throw new Error(`${this.model} has no property "${propName}"`);
    await this.client.setProperty(propName, prop, value);
  }

  /**
   * Writes a property and updates the local state, logging failures instead of throwing.
   *
   * @param {string} propName The property name in the device specification.
   * @param {MiotValue} value The value to write.
   * @returns {Promise<boolean>} Whether the write succeeded.
   */
  protected async write(propName: string, value: MiotValue): Promise<boolean> {
    try {
      await this.writeProp(propName, value);
      this.state[propName] = value;
      return true;
    } catch (error) {
      this.log.error(`${this.name} | failed to set ${propName} to ${value}: ${String(error)}`);
      return false;
    }
  }

  /**
   * @param {string} propName The property name in the device specification.
   * @returns {boolean} Whether the model supports the property.
   */
  protected has(propName: string): boolean {
    return (this.spec.props as Record<string, MiotProp | undefined>)[propName] !== undefined;
  }

  /**
   * @param {string} propName The property name in the device specification.
   * @returns {MiotValue | undefined} The last polled value of a property.
   */
  protected read(propName: string): MiotValue | undefined {
    return this.state[propName];
  }

  // --- endpoint construction ------------------------------------------------

  /**
   * Creates a bridged endpoint carrying the identity of this device.
   *
   * @param {Parameters<typeof MatterbridgeEndpoint.prototype.constructor>[0]} deviceTypes The Matter device types of the endpoint.
   * @param {string} label A suffix distinguishing this endpoint from the main one, or `''` for the main endpoint.
   * @param {string} serialSuffix A short suffix appended to the serial number, or `''` for the main endpoint.
   * @returns {MatterbridgeEndpoint} The created endpoint.
   */
  protected createEndpoint(deviceTypes: Parameters<typeof createBridgedEndpoint>[0], label: string, serialSuffix: string): MatterbridgeEndpoint {
    const name = label ? `${this.name} ${label}` : this.name;
    const serial = serialSuffix ? `${this.serialNumber}-${serialSuffix}` : this.serialNumber;
    return createBridgedEndpoint(deviceTypes, {
      id: `${this.model}-${serial}`,
      name,
      serial,
      productName: this.spec.displayName,
      firmware: this.firmware,
      model: this.model,
      debug: this.config.debug,
    });
  }

  /**
   * Stamps this device's identity onto an endpoint built elsewhere, such as the
   * Matterbridge robotic vacuum cleaner device class.
   *
   * @param {MatterbridgeEndpoint} endpoint The endpoint to stamp.
   */
  protected applyIdentity(endpoint: MatterbridgeEndpoint): void {
    endpoint.vendorName = VENDOR_NAME;
    endpoint.productName = this.spec.displayName;
    endpoint.productUrl = PRODUCT_URL;
    endpoint.hardwareVersionString = this.model;
    endpoint.softwareVersionString = this.firmware;
  }

  /**
   * Adds a switch endpoint bound to a boolean property of the device.
   *
   * @param {string} propName The boolean property to bind, e.g. `buzzer`.
   * @param {string} label The label appended to the device name, e.g. `Buzzer`.
   * @param {string} serialSuffix A short unique suffix for the serial number, e.g. `BUZ`.
   * @param {object} values The values written when the switch is operated.
   * @param {MiotValue} values.on The value written when turning the switch on.
   * @param {MiotValue} values.off The value written when turning the switch off.
   */
  protected addBoundSwitch(propName: string, label: string, serialSuffix: string, values: { on: MiotValue; off: MiotValue } = { on: true, off: false }): void {
    if (!this.has(propName)) {
      this.log.debug(`${this.name} | ${this.model} has no "${propName}" property, skipping the ${label} switch`);
      return;
    }
    const endpoint = this.createSwitchEndpoint(label, serialSuffix);
    this.endpoints.push(endpoint);
    this.switches.push({ endpoint, propName, onValue: values.on, offValue: values.off, momentary: false });
  }

  /**
   * Adds one switch endpoint per value of an enum property, only one of which can be on.
   *
   * @param {string} propName The enum property to bind, e.g. `mode`.
   * @param {{ label: string; value: number; serialSuffix: string }[]} options The values to expose.
   * @param {boolean} momentary Whether the switches reset themselves after being triggered (for write-only properties such as light scenes).
   */
  protected addEnumSwitches(propName: string, options: { label: string; value: number; serialSuffix: string }[], momentary = false): void {
    if (!this.has(propName)) {
      this.log.debug(`${this.name} | ${this.model} has no "${propName}" property, skipping its switches`);
      return;
    }
    for (const option of options) {
      const endpoint = this.createSwitchEndpoint(option.label, option.serialSuffix);
      this.endpoints.push(endpoint);
      this.switches.push({ endpoint, propName, onValue: option.value, momentary });
    }
  }

  /**
   * Creates a switchable bridged endpoint.
   *
   * @param {string} label The label appended to the device name.
   * @param {string} serialSuffix A short unique suffix for the serial number.
   * @returns {MatterbridgeEndpoint} The endpoint, with its on/off cluster ready.
   */
  private createSwitchEndpoint(label: string, serialSuffix: string): MatterbridgeEndpoint {
    return this.createEndpoint([onOffPlugInUnit, bridgedNode, powerSource], label, serialSuffix)
      .createDefaultIdentifyClusterServer()
      .createDefaultOnOffClusterServer(false)
      .addRequiredClusterServers();
  }

  /** Wires the command handlers of every switch endpoint added by the subclass. */
  private registerSwitchHandlers(): void {
    for (const entry of this.switches) {
      entry.endpoint.addCommandHandler('on', () => {
        void this.handleSwitchCommand(entry, true);
      });
      entry.endpoint.addCommandHandler('off', () => {
        void this.handleSwitchCommand(entry, false);
      });
    }
  }

  /**
   * Applies a switch command to the device.
   *
   * @param {BoundSwitch} entry The switch that was operated.
   * @param {boolean} on Whether it was turned on.
   * @returns {Promise<void>} Resolves once the device was written to and the state re-applied.
   */
  private async handleSwitchCommand(entry: BoundSwitch, on: boolean): Promise<void> {
    if (on) {
      await this.write(entry.propName, entry.onValue);
      if (entry.momentary) {
        setTimeout(() => {
          void entry.endpoint.updateAttribute(OnOff.Cluster.id, 'onOff', false, this.log);
        }, MOMENTARY_RESET_MS).unref();
        return;
      }
    } else if (entry.offValue !== undefined) {
      await this.write(entry.propName, entry.offValue);
    } else {
      // Exclusive enum switches cannot be turned off: turning another one on is the way to switch.
      this.log.debug(`${this.name} | ignoring off command on exclusive switch ${entry.propName}=${entry.onValue}`);
      await this.applySwitchState();
      return;
    }
    await this.applySwitchState();
  }

  /**
   * Reflects the polled state in every switch endpoint.
   *
   * @returns {Promise<void>} Resolves once every switch was updated.
   */
  private async applySwitchState(): Promise<void> {
    for (const entry of this.switches) {
      if (entry.momentary) continue;
      const value = this.state[entry.propName];
      if (value === undefined) continue;
      const on = typeof entry.onValue === 'boolean' ? value === true : value === entry.onValue;
      await entry.endpoint.updateAttribute(OnOff.Cluster.id, 'onOff', on, this.log);
    }
  }

  /**
   * Builds a stable serial number.
   *
   * The serial identifies the device in the controller app, so it must not change
   * between restarts: the configured device id is preferred, then the MAC address,
   * and only as a last resort a hash of the name and address.
   *
   * @param {string | undefined} mac The MAC address reported by `miIO.info`.
   * @returns {string} A serial number of at most 32 characters.
   */
  private resolveSerialNumber(mac: string | undefined): string {
    if (this.config.deviceId) return `did${String(this.config.deviceId).replace(/[^A-Za-z0-9]/g, '')}`;
    if (mac) return mac.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return createHash('md5').update(`${this.config.name}${this.config.ip}`).digest('hex').slice(0, 24);
  }
}

/** The identity written into the bridged device information cluster. */
interface BridgedEndpointOptions {
  id: string;
  name: string;
  serial: string;
  productName: string;
  firmware: string;
  model: string;
  debug: boolean;
}

/**
 * Creates a bridged Matter endpoint with the basic information cluster filled in.
 *
 * @param {ConstructorParameters<typeof MatterbridgeEndpoint>[0]} deviceTypes The Matter device types.
 * @param {BridgedEndpointOptions} options The identity of the endpoint.
 * @returns {MatterbridgeEndpoint} The created endpoint.
 */
export function createBridgedEndpoint(deviceTypes: ConstructorParameters<typeof MatterbridgeEndpoint>[0], options: BridgedEndpointOptions): MatterbridgeEndpoint {
  const endpoint = new MatterbridgeEndpoint(deviceTypes, { id: options.id }, options.debug)
    .createDefaultBridgedDeviceBasicInformationClusterServer(options.name, options.serial, VENDOR_ID, VENDOR_NAME, options.productName, undefined, options.firmware)
    .createDefaultPowerSourceWiredClusterServer();
  endpoint.productUrl = PRODUCT_URL;
  endpoint.hardwareVersionString = options.model;
  return endpoint;
}
