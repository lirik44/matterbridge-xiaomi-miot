import { bridgedNode, fan, powerSource } from 'matterbridge';
import type { MatterbridgeEndpoint } from 'matterbridge';
import { FanControlServer } from 'matterbridge/matter/behaviors';
import { FanControl, OnOff } from 'matterbridge/matter/clusters';

import type { FanSpec, MiotProp } from '../miot/types.js';

import { MiotAccessory } from './base.js';

/** The percentage a fan mode maps onto when the controller selects it. */
const MODE_PERCENT = { low: 25, medium: 60, high: 100 } as const;

/**
 * A Xiaomi fan, exposed as a Matter fan.
 *
 * The Matter fan control cluster carries everything the fan can do that a
 * controller understands: on/off, a continuous speed, the horizontal oscillation
 * (rocking) and the natural wind mode (wind setting). The remaining features —
 * beeper, display, child lock and the wind mode as an explicit switch — are
 * opt-in switch endpoints.
 */
export class FanAccessory extends MiotAccessory<FanSpec> {
  private endpoint!: MatterbridgeEndpoint;

  protected override polledProps(): Record<string, MiotProp> {
    const { props } = this.spec;
    const polled: Record<string, MiotProp> = { power: props.power, fanLevel: props.fanLevel };
    if (props.speed) polled.speed = props.speed;
    if (props.mode) polled.mode = props.mode;
    if (props.swing) polled.swing = props.swing;
    if (this.config.buzzerControl && props.buzzer) polled.buzzer = props.buzzer;
    if (this.config.ledControl && props.led) polled.led = props.led;
    if (this.config.childLockControl && props.childLock) polled.childLock = props.childLock;
    return polled;
  }

  protected override buildEndpoints(): void {
    const hasSwing = this.spec.props.swing !== undefined;
    const hasNaturalWind = this.spec.props.mode !== undefined && this.spec.naturalModeValue !== undefined;

    this.endpoint = this.createEndpoint([fan, bridgedNode, powerSource], '', '');
    this.endpoint.createDefaultIdentifyClusterServer().createDefaultOnOffClusterServer(false);

    // These fans have no automatic mode, so the fan control cluster is assembled here
    // rather than through the Matterbridge helpers, which all include the Auto feature:
    // a fan mode sequence without Auto is invalid while that feature is claimed.
    const base = {
      fanMode: FanControl.FanMode.Off,
      fanModeSequence: FanControl.FanModeSequence.OffLowMedHigh,
      percentSetting: 0,
      percentCurrent: 0,
    };
    const rocking = {
      rockSupport: { rockLeftRight: true, rockUpDown: false, rockRound: false },
      rockSetting: { rockLeftRight: false, rockUpDown: false, rockRound: false },
    };
    const wind = {
      windSupport: { sleepWind: false, naturalWind: true },
      windSetting: { sleepWind: false, naturalWind: false },
    };

    if (hasSwing && hasNaturalWind) {
      this.endpoint.behaviors.require(FanControlServer.with(FanControl.Feature.Rocking, FanControl.Feature.Wind), { ...base, ...rocking, ...wind });
    } else if (hasSwing) {
      this.endpoint.behaviors.require(FanControlServer.with(FanControl.Feature.Rocking), { ...base, ...rocking });
    } else if (hasNaturalWind) {
      this.endpoint.behaviors.require(FanControlServer.with(FanControl.Feature.Wind), { ...base, ...wind });
    } else {
      this.endpoint.behaviors.require(FanControlServer, base);
    }

    this.endpoint.addRequiredClusterServers();
    this.endpoints.push(this.endpoint);

    if (this.config.buzzerControl) this.addBoundSwitch('buzzer', 'Buzzer', 'BUZ');
    if (this.config.ledControl) this.addBoundSwitch('led', 'Display', 'LED', this.spec.ledValues ?? { on: true, off: false });
    if (this.config.childLockControl) this.addBoundSwitch('childLock', 'Child Lock', 'LOCK');
    if (this.config.modeControl && this.spec.props.mode) {
      this.addEnumSwitches('mode', [
        { label: 'Straight Wind', value: this.spec.straightModeValue ?? 0, serialSuffix: 'MSTR' },
        { label: 'Natural Wind', value: this.spec.naturalModeValue ?? 1, serialSuffix: 'MNAT' },
      ]);
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

    this.endpoint.subscribeAttribute(
      FanControl.Cluster.id,
      'fanMode',
      (newValue, _oldValue, context) => {
        if (context.fabric === undefined) return; // Our own update, not a controller command.
        void this.handleFanMode(newValue as FanControl.FanMode);
      },
      this.log,
    );

    this.endpoint.subscribeAttribute(
      FanControl.Cluster.id,
      'percentSetting',
      (newValue, _oldValue, context) => {
        if (context.fabric === undefined) return;
        if (typeof newValue !== 'number') return;
        void this.setSpeed(newValue);
      },
      this.log,
    );

    if (this.spec.props.swing) {
      this.endpoint.subscribeAttribute(
        FanControl.Cluster.id,
        'rockSetting',
        (newValue, _oldValue, context) => {
          if (context.fabric === undefined) return;
          const setting = newValue as { rockLeftRight?: boolean };
          void this.write('swing', setting.rockLeftRight === true);
        },
        this.log,
      );
    }

    if (this.spec.props.mode && this.spec.naturalModeValue !== undefined) {
      this.endpoint.subscribeAttribute(
        FanControl.Cluster.id,
        'windSetting',
        (newValue, _oldValue, context) => {
          if (context.fabric === undefined) return;
          const setting = newValue as { naturalWind?: boolean };
          const mode = setting.naturalWind === true ? this.spec.naturalModeValue : this.spec.straightModeValue;
          if (mode !== undefined) void this.write('mode', mode);
        },
        this.log,
      );
    }
  }

  protected override async applyState(): Promise<void> {
    const on = this.read('power') === true;
    await this.endpoint.updateAttribute(OnOff.Cluster.id, 'onOff', on, this.log);

    const percent = on ? this.currentPercent() : 0;
    await this.endpoint.updateAttribute(FanControl.Cluster.id, 'percentCurrent', percent, this.log);
    await this.endpoint.updateAttribute(FanControl.Cluster.id, 'percentSetting', percent, this.log);
    await this.endpoint.updateAttribute(FanControl.Cluster.id, 'fanMode', percentToFanMode(percent), this.log);

    if (this.spec.props.swing) {
      await this.endpoint.updateAttribute(FanControl.Cluster.id, 'rockSetting', { rockLeftRight: this.read('swing') === true, rockUpDown: false, rockRound: false }, this.log);
    }

    if (this.spec.props.mode && this.spec.naturalModeValue !== undefined) {
      const natural = this.read('mode') === this.spec.naturalModeValue;
      await this.endpoint.updateAttribute(FanControl.Cluster.id, 'windSetting', { sleepWind: false, naturalWind: natural }, this.log);
    }
  }

  /**
   * @returns {number} The current speed as a percentage, derived from the continuous
   * speed property when the model has one and from the discrete fan level otherwise.
   */
  private currentPercent(): number {
    const speed = this.read('speed');
    if (this.spec.props.speed && typeof speed === 'number' && speed > 0) {
      return Math.min(100, Math.max(1, Math.round(speed)));
    }
    const level = this.read('fanLevel');
    if (typeof level === 'number' && level > 0) {
      return Math.round((level / this.spec.fanLevels) * 100);
    }
    return 0;
  }

  /**
   * Turns the fan on or off.
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
   * Applies a fan mode selected by the controller.
   *
   * @param {FanControl.FanMode} mode The requested fan mode.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async handleFanMode(mode: FanControl.FanMode): Promise<void> {
    switch (mode) {
      case FanControl.FanMode.Off:
        await this.setPower(false);
        return;
      case FanControl.FanMode.Low:
        await this.setSpeed(MODE_PERCENT.low);
        return;
      case FanControl.FanMode.Medium:
        await this.setSpeed(MODE_PERCENT.medium);
        return;
      case FanControl.FanMode.High:
      case FanControl.FanMode.On:
      case FanControl.FanMode.Auto:
      case FanControl.FanMode.Smart:
        await this.setSpeed(MODE_PERCENT.high);
        return;
      default:
        this.log.debug(`${this.name} | unhandled fan mode ${mode}`);
    }
  }

  /**
   * Sets the speed, turning the fan on when it is off.
   *
   * @param {number} percent The requested speed, `0..100`. Zero turns the fan off.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async setSpeed(percent: number): Promise<void> {
    if (percent <= 0) {
      await this.setPower(false);
      return;
    }

    if (this.read('power') !== true) {
      await this.write('power', true);
    }

    if (this.spec.props.speed) {
      await this.write('speed', Math.min(100, Math.max(1, Math.round(percent))));
    } else {
      const level = Math.min(this.spec.fanLevels, Math.max(1, Math.ceil((percent / 100) * this.spec.fanLevels)));
      await this.write('fanLevel', level);
    }

    await this.applyState();
  }
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
