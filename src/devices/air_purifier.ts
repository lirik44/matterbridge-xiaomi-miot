import { airPurifier, airQualitySensor, bridgedNode, humiditySensor, powerSource, temperatureSensor } from 'matterbridge';
import type { MatterbridgeEndpoint } from 'matterbridge';
import {
  AirQuality,
  FanControl,
  HepaFilterMonitoring,
  OnOff,
  Pm10ConcentrationMeasurement,
  Pm25ConcentrationMeasurement,
  RelativeHumidityMeasurement,
  ResourceMonitoring,
  TemperatureMeasurement,
} from 'matterbridge/matter/clusters';

import type { AirPurifierSpec, MiotProp } from '../miot/types.js';

import { MiotAccessory } from './base.js';

/** PM2.5 thresholds, in µg/m³, used to derive the Matter air quality level. */
const PM25_THRESHOLDS: { max: number; quality: AirQuality.AirQualityEnum }[] = [
  { max: 12, quality: AirQuality.AirQualityEnum.Good },
  { max: 35, quality: AirQuality.AirQualityEnum.Fair },
  { max: 55, quality: AirQuality.AirQualityEnum.Moderate },
  { max: 150, quality: AirQuality.AirQualityEnum.Poor },
  { max: 250, quality: AirQuality.AirQualityEnum.VeryPoor },
];

/** Remaining filter life below which the filter is reported as needing attention, in percent. */
const FILTER_WARNING_PERCENT = 10;
/** Remaining filter life below which the filter is reported as critical, in percent. */
const FILTER_CRITICAL_PERCENT = 5;

/** The percentage reported while the purifier runs in sleep mode. */
const SLEEP_PERCENT = 15;

/**
 * A Xiaomi air purifier, exposed as a Matter air purifier plus its sensors.
 *
 * Apple Home does not render the child endpoints of a composed device, so the
 * sensors default to being exposed as their own bridged device
 * (`separateSensors`). Set it to `false` to compose them into the purifier, which
 * is what Google Home and Home Assistant prefer.
 */
export class AirPurifierAccessory extends MiotAccessory<AirPurifierSpec> {
  private main!: MatterbridgeEndpoint;
  private airQuality?: MatterbridgeEndpoint;
  private temperature?: MatterbridgeEndpoint;
  private humidity?: MatterbridgeEndpoint;

  protected override polledProps(): Record<string, MiotProp> {
    const { props } = this.spec;
    const polled: Record<string, MiotProp> = { power: props.power, mode: props.mode, fanLevel: props.fanLevel };
    if (props.favoriteLevel) polled.favoriteLevel = props.favoriteLevel;
    if (props.fault) polled.fault = props.fault;
    if (this.config.sensorsControl) {
      if (props.pm25) polled.pm25 = props.pm25;
      if (props.pm10) polled.pm10 = props.pm10;
      if (props.temperature) polled.temperature = props.temperature;
      if (props.humidity) polled.humidity = props.humidity;
    }
    if (this.config.filterControl && props.filterLife) polled.filterLife = props.filterLife;
    if (this.config.buzzerControl && props.buzzer) polled.buzzer = props.buzzer;
    if (this.config.ledControl && props.screen) polled.screen = props.screen;
    if (this.config.childLockControl && props.childLock) polled.childLock = props.childLock;
    if (this.config.ionizerControl && props.anion) polled.anion = props.anion;
    return polled;
  }

  protected override buildEndpoints(): void {
    this.main = this.createEndpoint([airPurifier, bridgedNode, powerSource], '', '');
    this.main
      .createDefaultIdentifyClusterServer()
      .createDefaultOnOffClusterServer(false)
      .createDefaultFanControlClusterServer(FanControl.FanMode.Off, FanControl.FanModeSequence.OffLowMedHighAuto, 0, 0);

    if (this.config.filterControl && this.spec.props.filterLife) {
      this.main.createDefaultHepaFilterMonitoringClusterServer(100, ResourceMonitoring.ChangeIndication.Ok);
    }
    this.main.addRequiredClusterServers();
    this.endpoints.push(this.main);

    if (this.config.sensorsControl) {
      if (this.config.separateSensors) this.buildSeparateSensors();
      else this.buildComposedSensors();
    }

    if (this.config.buzzerControl) this.addBoundSwitch('buzzer', 'Buzzer', 'BUZ');
    if (this.config.ledControl) this.addBoundSwitch('screen', 'Display', 'LED', this.spec.screenValues ?? { on: true, off: false });
    if (this.config.childLockControl) this.addBoundSwitch('childLock', 'Child Lock', 'LOCK');
    if (this.config.ionizerControl) this.addBoundSwitch('anion', 'Ionizer', 'ION');
    if (this.config.modeControl) {
      const { modes } = this.spec;
      this.addEnumSwitches('mode', [
        { label: 'Auto Mode', value: modes.auto, serialSuffix: 'MAUT' },
        { label: 'Sleep Mode', value: modes.sleep, serialSuffix: 'MSLP' },
        { label: 'Favorite Mode', value: modes.favorite, serialSuffix: 'MFAV' },
        { label: 'Manual Mode', value: modes.manual, serialSuffix: 'MMAN' },
      ]);
    }
  }

  /**
   * Exposes each sensor as its own bridged device.
   *
   * Apple Home shows only the primary type of a device, so temperature and
   * humidity have to be their own devices to get a tile each — putting them on
   * the air quality device makes them invisible there.
   */
  private buildSeparateSensors(): void {
    const airQuality = this.createEndpoint([airQualitySensor, bridgedNode, powerSource], 'Air Quality', 'AQ');
    airQuality.createDefaultIdentifyClusterServer().createDefaultAirQualityClusterServer(AirQuality.AirQualityEnum.Unknown);
    if (this.spec.props.pm25) airQuality.createDefaultPm25ConcentrationMeasurementClusterServer(null);
    if (this.spec.props.pm10) airQuality.createDefaultPm10ConcentrationMeasurementClusterServer(null);
    airQuality.addRequiredClusterServers();
    this.endpoints.push(airQuality);
    this.airQuality = airQuality;

    if (this.spec.props.temperature) {
      const temperature = this.createEndpoint([temperatureSensor, bridgedNode, powerSource], 'Temperature', 'TEMP');
      temperature.createDefaultIdentifyClusterServer().createDefaultTemperatureMeasurementClusterServer(null).addRequiredClusterServers();
      this.endpoints.push(temperature);
      this.temperature = temperature;
    }

    if (this.spec.props.humidity) {
      const humidity = this.createEndpoint([humiditySensor, bridgedNode, powerSource], 'Humidity', 'HUM');
      humidity.createDefaultIdentifyClusterServer().createDefaultRelativeHumidityMeasurementClusterServer(null).addRequiredClusterServers();
      this.endpoints.push(humidity);
      this.humidity = humidity;
    }
  }

  /** Exposes the sensors as child endpoints of the purifier itself. */
  private buildComposedSensors(): void {
    this.airQuality = this.main.addChildDeviceType('AirQuality', airQualitySensor).createDefaultAirQualityClusterServer(AirQuality.AirQualityEnum.Unknown);
    if (this.spec.props.pm25) this.airQuality.createDefaultPm25ConcentrationMeasurementClusterServer(null);
    if (this.spec.props.pm10) this.airQuality.createDefaultPm10ConcentrationMeasurementClusterServer(null);
    this.airQuality.addRequiredClusterServers();

    if (this.spec.props.temperature) {
      this.temperature = this.main.addChildDeviceType('Temperature', temperatureSensor).createDefaultTemperatureMeasurementClusterServer(null).addRequiredClusterServers();
    }
    if (this.spec.props.humidity) {
      this.humidity = this.main.addChildDeviceType('Humidity', humiditySensor).createDefaultRelativeHumidityMeasurementClusterServer(null).addRequiredClusterServers();
    }
  }

  protected override registerHandlers(): void {
    this.main.addCommandHandler('identify', () => {
      this.log.info(`${this.name} | identify`);
    });
    this.main.addCommandHandler('on', () => {
      void this.setPower(true);
    });
    this.main.addCommandHandler('off', () => {
      void this.setPower(false);
    });

    this.main.subscribeAttribute(
      FanControl.Cluster.id,
      'fanMode',
      (newValue, _oldValue, context) => {
        if (context.fabric === undefined) return; // Our own update, not a controller command.
        void this.handleFanMode(newValue as FanControl.FanMode);
      },
      this.log,
    );

    this.main.subscribeAttribute(
      FanControl.Cluster.id,
      'percentSetting',
      (newValue, _oldValue, context) => {
        if (context.fabric === undefined) return;
        if (typeof newValue !== 'number') return;
        void this.setSpeedPercent(newValue);
      },
      this.log,
    );
  }

  protected override async applyState(): Promise<void> {
    await this.applyPurifierState();
    await this.applySensorState();
    await this.applyFilterState();

    const fault = this.read('fault');
    if (typeof fault === 'number' && fault !== 0) {
      this.log.warn(`${this.name} | device reports fault code ${fault}`);
    }
  }

  /**
   * Reflects power, mode and speed in the on/off and fan control clusters.
   *
   * @returns {Promise<void>} Resolves once the attributes have been updated.
   */
  private async applyPurifierState(): Promise<void> {
    const on = this.read('power') === true;
    await this.main.updateAttribute(OnOff.Cluster.id, 'onOff', on, this.log);

    const auto = this.read('mode') === this.spec.modes.auto;
    // In automatic mode the speed is the device's business, so it is reported as
    // zero rather than as the level the motor happens to run at — the same thing
    // `homebridge-miot` shows, and it keeps the slider out of the way.
    const percent = !on || auto ? 0 : this.currentPercent();
    const fanMode = !on ? FanControl.FanMode.Off : auto ? FanControl.FanMode.Auto : percentToFanMode(percent);

    await this.main.updateAttribute(FanControl.Cluster.id, 'percentCurrent', percent, this.log);
    await this.main.updateAttribute(FanControl.Cluster.id, 'percentSetting', percent, this.log);
    await this.main.updateAttribute(FanControl.Cluster.id, 'fanMode', fanMode, this.log);
  }

  /**
   * Reflects the measured values in the sensor endpoints.
   *
   * @returns {Promise<void>} Resolves once the attributes have been updated.
   */
  private async applySensorState(): Promise<void> {
    if (!this.config.sensorsControl) return;

    const pm25 = this.read('pm25');
    if (this.airQuality && typeof pm25 === 'number') {
      await this.airQuality.updateAttribute(Pm25ConcentrationMeasurement.Cluster.id, 'measuredValue', Math.round(pm25), this.log);
      await this.airQuality.updateAttribute(AirQuality.Cluster.id, 'airQuality', pm25ToAirQuality(pm25), this.log);
    }

    const pm10 = this.read('pm10');
    if (this.airQuality && this.spec.props.pm10 && typeof pm10 === 'number') {
      await this.airQuality.updateAttribute(Pm10ConcentrationMeasurement.Cluster.id, 'measuredValue', Math.round(pm10), this.log);
    }

    const temperature = this.read('temperature');
    if (this.temperature && typeof temperature === 'number') {
      await this.temperature.updateAttribute(TemperatureMeasurement.Cluster.id, 'measuredValue', Math.round(temperature * 100), this.log);
    }

    const humidity = this.read('humidity');
    if (this.humidity && typeof humidity === 'number') {
      await this.humidity.updateAttribute(RelativeHumidityMeasurement.Cluster.id, 'measuredValue', Math.round(humidity * 100), this.log);
    }
  }

  /**
   * Reflects the remaining filter life in the HEPA filter monitoring cluster.
   *
   * @returns {Promise<void>} Resolves once the attributes have been updated.
   */
  private async applyFilterState(): Promise<void> {
    const life = this.read('filterLife');
    if (!this.config.filterControl || typeof life !== 'number') return;

    const condition = Math.min(100, Math.max(0, Math.round(life)));
    const changeIndication =
      condition <= FILTER_CRITICAL_PERCENT
        ? ResourceMonitoring.ChangeIndication.Critical
        : condition <= FILTER_WARNING_PERCENT
          ? ResourceMonitoring.ChangeIndication.Warning
          : ResourceMonitoring.ChangeIndication.Ok;

    await this.main.updateAttribute(HepaFilterMonitoring.Cluster.id, 'condition', condition, this.log);
    await this.main.updateAttribute(HepaFilterMonitoring.Cluster.id, 'changeIndication', changeIndication, this.log);
  }

  /** @returns {number} The current speed as a percentage, derived from the active mode. */
  private currentPercent(): number {
    const { modes } = this.spec;
    const mode = this.read('mode');

    if (mode === modes.sleep) return SLEEP_PERCENT;

    if (mode === modes.favorite && this.spec.props.favoriteLevel) {
      const level = this.read('favoriteLevel');
      if (typeof level === 'number') return favoriteLevelToPercent(level, this.favoriteRange());
    }

    const level = this.read('fanLevel');
    if (typeof level === 'number' && level > 0) return Math.round((level / this.spec.fanLevels) * 100);
    return 0;
  }

  /** @returns {[number, number]} The inclusive favorite level range of the model. */
  private favoriteRange(): [number, number] {
    return this.spec.favoriteLevelRange ?? [0, 11];
  }

  /**
   * Turns the purifier on or off.
   *
   * @param {boolean} on The requested power state.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async setPower(on: boolean): Promise<void> {
    if (await this.write('power', on)) {
      await this.applyPurifierState();
    }
  }

  /**
   * Applies a fan mode selected by the controller.
   *
   * `Auto` selects the automatic mode of the purifier, the discrete modes select
   * the manual mode with the matching fan level.
   *
   * @param {FanControl.FanMode} mode The requested fan mode.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async handleFanMode(mode: FanControl.FanMode): Promise<void> {
    const { modes, fanLevels } = this.spec;

    if (mode === FanControl.FanMode.Off) {
      await this.setPower(false);
      return;
    }

    if (this.read('power') !== true) await this.write('power', true);

    if (mode === FanControl.FanMode.Auto || mode === FanControl.FanMode.Smart) {
      await this.write('mode', modes.auto);
      await this.applyPurifierState();
      return;
    }

    const level = mode === FanControl.FanMode.Low ? 1 : mode === FanControl.FanMode.Medium ? Math.min(2, fanLevels) : fanLevels;
    await this.write('mode', modes.manual);
    await this.write('fanLevel', level);
    await this.applyPurifierState();
  }

  /**
   * Applies a speed percentage selected by the controller.
   *
   * With `speedControl: 'favorite'` (the default) the fine grained favorite level
   * is used, which gives twelve steps instead of three.
   *
   * @param {number} percent The requested speed, `0..100`. Zero turns the purifier off.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async setSpeedPercent(percent: number): Promise<void> {
    if (percent <= 0) {
      await this.setPower(false);
      return;
    }

    if (this.read('power') !== true) await this.write('power', true);

    const { modes, fanLevels } = this.spec;
    if (this.config.speedControl === 'favorite' && this.spec.props.favoriteLevel) {
      await this.write('mode', modes.favorite);
      await this.write('favoriteLevel', percentToFavoriteLevel(percent, this.favoriteRange()));
    } else {
      const level = Math.min(fanLevels, Math.max(1, Math.ceil((percent / 100) * fanLevels)));
      await this.write('mode', modes.manual);
      await this.write('fanLevel', level);
    }

    await this.applyPurifierState();
  }
}

/**
 * Maps a PM2.5 concentration onto the Matter air quality level.
 *
 * @param {number} pm25 The concentration, in µg/m³.
 * @returns {AirQuality.AirQualityEnum} The matching air quality level.
 */
function pm25ToAirQuality(pm25: number): AirQuality.AirQualityEnum {
  return PM25_THRESHOLDS.find(({ max }) => pm25 <= max)?.quality ?? AirQuality.AirQualityEnum.ExtremelyPoor;
}

/**
 * Maps a speed percentage onto the Matter fan mode.
 *
 * @param {number} percent The speed, `0..100`.
 * @returns {FanControl.FanMode} The matching fan mode.
 */
function percentToFanMode(percent: number): FanControl.FanMode {
  if (percent <= 0) return FanControl.FanMode.Off;
  if (percent <= 33) return FanControl.FanMode.Low;
  if (percent <= 66) return FanControl.FanMode.Medium;
  return FanControl.FanMode.High;
}

/**
 * Maps a favorite level onto a percentage.
 *
 * The lowest level is deliberately mapped above zero, because zero percent means
 * "off" to a Matter controller.
 *
 * @param {number} level The favorite level.
 * @param {[number, number]} range The inclusive level range of the model.
 * @returns {number} The percentage, `1..100`.
 */
function favoriteLevelToPercent(level: number, [min, max]: [number, number]): number {
  const steps = max - min + 1;
  const clamped = Math.min(max, Math.max(min, level));
  return Math.min(100, Math.max(1, Math.round(((clamped - min + 1) / steps) * 100)));
}

/**
 * Maps a percentage onto a favorite level, the inverse of {@link favoriteLevelToPercent}.
 *
 * @param {number} percent The percentage, `1..100`.
 * @param {[number, number]} range The inclusive level range of the model.
 * @returns {number} The favorite level.
 */
function percentToFavoriteLevel(percent: number, [min, max]: [number, number]): number {
  const steps = max - min + 1;
  const level = Math.ceil((percent / 100) * steps) - 1 + min;
  return Math.min(max, Math.max(min, level));
}
