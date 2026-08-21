import { bridgedNode, colorTemperatureLight, powerSource } from 'matterbridge';
import type { MatterbridgeEndpoint } from 'matterbridge';
import { ColorControl, LevelControl, OnOff } from 'matterbridge/matter/clusters';

import type { MiotValue } from '../miot/client.js';
import type { LightSpec, MiotProp } from '../miot/types.js';

import { MiotAccessory } from './base.js';

/** The Matter level range of the level control cluster. */
const MATTER_LEVEL_RANGE: [number, number] = [1, 254];

/** The properties read from a lamp speaking the legacy Yeelight protocol. */
const YEELIGHT_PROPS = ['power', 'bright', 'ct'] as const;

/** The default transition time of the legacy Yeelight commands, in milliseconds. */
const DEFAULT_TRANSITION_MS = 500;

/** How long to wait after switching a Yeelight lamp on before changing brightness, in milliseconds. */
const YEELIGHT_POWER_SETTLE_MS = 400;

/**
 * A Xiaomi light, exposed as a Matter color temperature light.
 *
 * Brightness and color temperature are mapped onto the level control and color
 * control clusters. The built-in scenes are write-only on the device, so they are
 * exposed (optionally) as momentary switches that reset themselves after being
 * triggered.
 */
export class LightAccessory extends MiotAccessory<LightSpec> {
  private endpoint!: MatterbridgeEndpoint;

  protected override polledProps(): Record<string, MiotProp> {
    const { props } = this.spec;
    const polled: Record<string, MiotProp> = { power: props.power, brightness: props.brightness };
    // `mode` is write only on these lamps, so it is never polled.
    if (props.colorTemperature) polled.colorTemperature = props.colorTemperature;
    return polled;
  }

  protected override async readState(): Promise<Record<string, MiotValue>> {
    if (this.spec.transport !== 'yeelight') return super.readState();

    const values = await this.client.raw<string[]>('get_prop', [...YEELIGHT_PROPS]);
    const [power, bright, ct] = values ?? [];
    const state: Record<string, MiotValue> = {};
    if (power !== undefined && power !== '') state.power = power === 'on';
    if (bright !== undefined && bright !== '') state.brightness = Number(bright);
    if (ct !== undefined && ct !== '') state.colorTemperature = Number(ct);
    return state;
  }

  protected override async writeProp(propName: string, value: MiotValue): Promise<void> {
    if (this.spec.transport !== 'yeelight') return super.writeProp(propName, value);

    const transition = this.spec.transitionMs ?? DEFAULT_TRANSITION_MS;
    switch (propName) {
      case 'power':
        await this.client.raw('set_power', [value === true ? 'on' : 'off', 'smooth', transition]);
        return;
      case 'brightness':
        await this.client.raw('set_bright', [Number(value), 'smooth', transition]);
        return;
      case 'colorTemperature':
        await this.client.raw('set_ct_abx', [Number(value), 'smooth', transition]);
        return;
      default:
        throw new Error(`${this.spec.model} does not support writing "${propName}" over the Yeelight protocol`);
    }
  }

  protected override buildEndpoints(): void {
    this.endpoint = this.createEndpoint([colorTemperatureLight, bridgedNode, powerSource], '', '');
    this.endpoint.createDefaultIdentifyClusterServer().createDefaultOnOffClusterServer(false).createDefaultLevelControlClusterServer(MATTER_LEVEL_RANGE[1]);

    const [minMireds, maxMireds] = this.miredRange();
    this.endpoint.createCtColorControlClusterServer(maxMireds, minMireds, maxMireds);
    this.endpoint.addRequiredClusterServers();
    this.endpoints.push(this.endpoint);

    if (this.config.sceneControl && this.spec.transport === 'yeelight') {
      this.log.warn(`${this.name} | ${this.spec.model} rejects MIoT calls, so its built-in scenes cannot be exposed. Ignoring sceneControl.`);
    } else if (this.config.sceneControl && this.spec.props.mode && this.spec.scenes?.length) {
      this.addEnumSwitches(
        'mode',
        this.spec.scenes.map((scene, index) => ({ label: scene.name, value: scene.value, serialSuffix: `S${index}` })),
        true,
      );
    }
  }

  protected override registerHandlers(): void {
    this.endpoint.addCommandHandler('identify', () => {
      this.log.info(`${this.name} | identify`);
    });
    this.endpoint.addCommandHandler('on', () => {
      void this.setPower(true);
    });
    this.endpoint.addCommandHandler('off', () => {
      void this.setPower(false);
    });
    this.endpoint.addCommandHandler('toggle', () => {
      void this.setPower(this.read('power') !== true);
    });

    const handleLevel = ({ request: { level } }: { request: { level: number } }) => {
      void this.setBrightness(level);
    };
    this.endpoint.addCommandHandler('moveToLevel', handleLevel);
    this.endpoint.addCommandHandler('moveToLevelWithOnOff', handleLevel);

    if (this.spec.props.colorTemperature) {
      this.endpoint.addCommandHandler('moveToColorTemperature', ({ request: { colorTemperatureMireds } }: { request: { colorTemperatureMireds: number } }) => {
        void this.setColorTemperature(colorTemperatureMireds);
      });
    }
  }

  protected override async applyState(): Promise<void> {
    const on = this.read('power') === true;
    await this.endpoint.updateAttribute(OnOff.Cluster.id, 'onOff', on, this.log);

    const brightness = this.read('brightness');
    if (typeof brightness === 'number') {
      await this.endpoint.updateAttribute(LevelControl.Cluster.id, 'currentLevel', brightnessToLevel(brightness, this.spec.brightnessRange), this.log);
    }

    const kelvin = this.read('colorTemperature');
    if (this.spec.props.colorTemperature && typeof kelvin === 'number' && kelvin > 0) {
      const [minMireds, maxMireds] = this.miredRange();
      const mireds = Math.min(maxMireds, Math.max(minMireds, kelvinToMireds(kelvin)));
      await this.endpoint.updateAttribute(ColorControl.Cluster.id, 'colorTemperatureMireds', mireds, this.log);
    }
  }

  /** @returns {[number, number]} The color temperature range of the model, in mireds. */
  private miredRange(): [number, number] {
    const [minKelvin, maxKelvin] = this.spec.colorTemperatureRange ?? [2700, 6500];
    return [kelvinToMireds(maxKelvin), kelvinToMireds(minKelvin)];
  }

  /**
   * Turns the light on or off.
   *
   * @param {boolean} on The requested power state.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async setPower(on: boolean): Promise<void> {
    if (await this.write('power', on)) {
      await this.applyState();
    }
  }

  /**
   * Sets the brightness, turning the light on when it is off.
   *
   * @param {number} level The Matter level, `1..254`.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async setBrightness(level: number): Promise<void> {
    if (this.read('power') !== true) {
      await this.write('power', true);
      // A Yeelight lamp ignores a brightness change that arrives while it is still switching on.
      if (this.spec.transport === 'yeelight') await delay(YEELIGHT_POWER_SETTLE_MS);
    }
    await this.write('brightness', levelToBrightness(level, this.spec.brightnessRange));
    await this.applyState();
  }

  /**
   * Sets the color temperature.
   *
   * @param {number} mireds The requested color temperature, in mireds.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async setColorTemperature(mireds: number): Promise<void> {
    const [minKelvin, maxKelvin] = this.spec.colorTemperatureRange ?? [2700, 6500];
    const kelvin = Math.min(maxKelvin, Math.max(minKelvin, miredsToKelvin(mireds)));
    await this.write('colorTemperature', kelvin);
    await this.applyState();
  }
}

/**
 * Converts a device brightness into a Matter level.
 *
 * @param {number} brightness The device brightness.
 * @param {[number, number]} range The inclusive brightness range of the model.
 * @returns {number} The Matter level, `1..254`.
 */
function brightnessToLevel(brightness: number, [min, max]: [number, number]): number {
  const clamped = Math.min(max, Math.max(min, brightness));
  const ratio = (clamped - min) / (max - min);
  return Math.min(MATTER_LEVEL_RANGE[1], Math.max(MATTER_LEVEL_RANGE[0], Math.round(MATTER_LEVEL_RANGE[0] + ratio * (MATTER_LEVEL_RANGE[1] - MATTER_LEVEL_RANGE[0]))));
}

/**
 * Converts a Matter level into a device brightness, the inverse of {@link brightnessToLevel}.
 *
 * @param {number} level The Matter level, `1..254`.
 * @param {[number, number]} range The inclusive brightness range of the model.
 * @returns {number} The device brightness.
 */
function levelToBrightness(level: number, [min, max]: [number, number]): number {
  const clamped = Math.min(MATTER_LEVEL_RANGE[1], Math.max(MATTER_LEVEL_RANGE[0], level));
  const ratio = (clamped - MATTER_LEVEL_RANGE[0]) / (MATTER_LEVEL_RANGE[1] - MATTER_LEVEL_RANGE[0]);
  return Math.min(max, Math.max(min, Math.round(min + ratio * (max - min))));
}

/**
 * @param {number} kelvin The color temperature, in kelvin.
 * @returns {number} The same color temperature, in mireds.
 */
function kelvinToMireds(kelvin: number): number {
  return Math.round(1_000_000 / kelvin);
}

/**
 * @param {number} mireds The color temperature, in mireds.
 * @returns {number} The same color temperature, in kelvin.
 */
function miredsToKelvin(mireds: number): number {
  return Math.round(1_000_000 / mireds);
}

/**
 * @param {number} ms How long to wait, in milliseconds.
 * @returns {Promise<void>} A promise resolving after the given delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
