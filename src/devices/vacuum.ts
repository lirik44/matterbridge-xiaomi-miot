import { RoboticVacuumCleaner } from 'matterbridge/devices';
import { PowerSource, RvcCleanMode, RvcOperationalState, RvcRunMode, ServiceArea } from 'matterbridge/matter/clusters';

import type { CleanModeTag, MiotAction, MiotProp, VacuumSpec, VacuumState } from '../miot/types.js';

import { MiotAccessory } from './base.js';

/** The run modes the robot is exposed with. */
const RUN_MODES: RvcRunMode.ModeOption[] = [
  { label: 'Idle', mode: 1, modeTags: [{ value: RvcRunMode.ModeTag.Idle }] },
  { label: 'Cleaning', mode: 2, modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }] },
];

/** The operational states the robot can report. */
const OPERATIONAL_STATES: RvcOperationalState.OperationalStateStruct[] = [
  { operationalStateId: RvcOperationalState.OperationalState.Docked },
  { operationalStateId: RvcOperationalState.OperationalState.SeekingCharger },
  { operationalStateId: RvcOperationalState.OperationalState.Charging },
  { operationalStateId: RvcOperationalState.OperationalState.Running },
  { operationalStateId: RvcOperationalState.OperationalState.Stopped },
  { operationalStateId: RvcOperationalState.OperationalState.Paused },
  { operationalStateId: RvcOperationalState.OperationalState.Error },
];

/** The states in which the robot is actively cleaning. */
const CLEANING_STATES: VacuumState[] = ['cleaning', 'mopping', 'manual-cleaning'];

/** Maps the specification's mode tags onto the Matter clean mode tags. */
const CLEAN_MODE_TAGS: Record<CleanModeTag, RvcCleanMode.ModeTag> = {
  lowNoise: RvcCleanMode.ModeTag.LowNoise,
  min: RvcCleanMode.ModeTag.Min,
  day: RvcCleanMode.ModeTag.Day,
  max: RvcCleanMode.ModeTag.Max,
  night: RvcCleanMode.ModeTag.Night,
  quick: RvcCleanMode.ModeTag.Quick,
  deepClean: RvcCleanMode.ModeTag.DeepClean,
  vacuum: RvcCleanMode.ModeTag.Vacuum,
  mop: RvcCleanMode.ModeTag.Mop,
};

/** Battery percentage below which the level is reported as critical. */
const BATTERY_CRITICAL_PERCENT = 10;
/** Battery percentage below which the level is reported as low. */
const BATTERY_WARNING_PERCENT = 20;

/** A clean mode as exposed over Matter, together with the levels it writes. */
interface SupportedCleanMode extends RvcCleanMode.ModeOption {
  levels: { vacuum: number | null; mop: number | null };
}

/**
 * A robot vacuum, exposed as a Matter robotic vacuum cleaner.
 *
 * Suction and water flow are two independent MIoT properties, while Matter has a
 * single clean mode, so the modes are the vacuum levels followed by the mop
 * levels: selecting a vacuum level parks the water flow and vice versa.
 *
 * Rooms come from the configuration (`roomIds`/`roomNames`): the robots covered
 * here keep their map as an opaque blob and cannot report a room list over MIoT.
 */
export class VacuumAccessory extends MiotAccessory<VacuumSpec> {
  private endpoint!: RoboticVacuumCleaner;
  private cleanModes: SupportedCleanMode[] = [];
  private serviceAreas: ServiceArea.Area[] = [];

  protected override polledProps(): Record<string, MiotProp> {
    const { props } = this.spec;
    const polled: Record<string, MiotProp> = { status: props.status, battery: props.battery, chargingState: props.chargingState };
    if (props.fault) polled.fault = props.fault;
    if (props.cleaningMode) polled.cleaningMode = props.cleaningMode;
    if (props.waterFlow) polled.waterFlow = props.waterFlow;
    if (props.waterBoxStatus) polled.waterBoxStatus = props.waterBoxStatus;
    return polled;
  }

  protected override buildEndpoints(): void {
    this.cleanModes = this.buildCleanModes();
    this.serviceAreas = this.buildServiceAreas();

    if (this.serviceAreas.length > 0) {
      this.log.info(`${this.name} | exposing ${this.serviceAreas.length} room(s): ${this.serviceAreas.map((area) => area.areaInfo.locationInfo?.locationName).join(', ')}`);
    }

    // A robotic vacuum cleaner has to be its own Matter node: Apple Home and
    // Google Home both refuse to show one that sits behind a bridge.
    this.endpoint = new RoboticVacuumCleaner(
      this.name,
      this.serialNumber,
      'server',
      RUN_MODES[0].mode,
      RUN_MODES,
      this.cleanModes[0]?.mode ?? 1,
      this.cleanModes,
      undefined,
      undefined,
      RvcOperationalState.OperationalState.Docked,
      OPERATIONAL_STATES,
      this.serviceAreas.length > 0 ? this.serviceAreas : undefined,
      [],
      this.serviceAreas[0]?.areaId,
    );
    this.applyIdentity(this.endpoint);
    this.endpoints.push(this.endpoint);
  }

  protected override registerHandlers(): void {
    this.endpoint.addCommandHandler('identify', () => {
      void this.invoke('locate');
    });

    this.endpoint.addCommandHandler('RvcRunMode.changeToMode', (data) => {
      void this.handleRunMode(data.request.newMode as number);
    });

    this.endpoint.addCommandHandler('RvcCleanMode.changeToMode', (data) => {
      void this.handleCleanMode(data.request.newMode as number);
    });

    this.endpoint.addCommandHandler('stop', () => {
      void this.invoke('stopClean');
    });

    this.endpoint.addCommandHandler('pause', () => {
      // Models without a dedicated pause action stop in place instead.
      void this.invoke(this.spec.actions.pause ? 'pause' : 'stopClean');
    });

    this.endpoint.addCommandHandler('resume', () => {
      void this.startCleaning();
    });

    this.endpoint.addCommandHandler('goHome', () => {
      void (async () => {
        await this.endpoint.updateAttribute(RvcOperationalState.Cluster.id, 'operationalState', RvcOperationalState.OperationalState.SeekingCharger, this.log);
        await this.invoke('home');
      })();
    });

    this.endpoint.addCommandHandler('selectAreas', (data) => {
      void (async () => {
        let selected = data.request.newAreas as number[];
        if ((data.attributes.supportedAreas as ServiceArea.Area[] | undefined)?.length === selected.length) {
          selected = []; // Everything selected means a full clean.
        }
        this.log.debug(`${this.name} | areas selected: ${selected.join(', ') || 'all'}`);
        await this.endpoint.updateAttribute(ServiceArea.Cluster.id, 'selectedAreas', selected, this.log);
      })();
    });
  }

  public override async postRegister(): Promise<void> {
    await super.postRegister();

    // The robots covered here cannot report which area they are working on.
    await this.endpoint.updateAttribute(ServiceArea.Cluster.id, 'currentArea', null, this.log);
    if (this.serviceAreas.length === 0) {
      await this.endpoint.updateAttribute(ServiceArea.Cluster.id, 'supportedAreas', [], this.log);
    }
  }

  protected override async applyState(): Promise<void> {
    const state = this.currentState();

    await this.applyBattery(state);
    await this.applyRunState(state);
    await this.applyCleanMode();

    const fault = this.read('fault');
    if (typeof fault === 'number' && fault !== 0) {
      this.log.warn(`${this.name} | device reports fault code ${fault}`);
    }
  }

  /** @returns {VacuumState} The normalised state of the robot. */
  private currentState(): VacuumState {
    const status = this.read('status');
    const mapped = typeof status === 'number' ? this.spec.statusValues[status] : undefined;

    if (!mapped) {
      if (status !== undefined) this.log.debug(`${this.name} | unmapped device status ${status}`);
      return 'idle';
    }

    // A docked Dreame reports `Idle` and signals the dock through `charging_state`
    // instead, so the charging state has the last word when the robot is not busy.
    if ((mapped === 'idle' || mapped === 'sleeping') && this.isCharging()) {
      return this.batteryLevel() >= 100 ? 'fully-charged' : 'charging';
    }

    if (mapped === 'charging' && this.batteryLevel() >= 100) return 'fully-charged';
    return mapped;
  }

  /** @returns {number} The battery level in percent, or `0` when unknown. */
  private batteryLevel(): number {
    const level = this.read('battery');
    return typeof level === 'number' ? level : 0;
  }

  /** @returns {boolean} Whether the robot is charging. */
  private isCharging(): boolean {
    const charging = this.read('chargingState');
    return typeof charging === 'number' ? (this.spec.chargingValues[charging] ?? false) : false;
  }

  /**
   * Reflects the battery in the power source cluster.
   *
   * @param {VacuumState} state The normalised state of the robot.
   * @returns {Promise<void>} Resolves once the attributes have been updated.
   */
  private async applyBattery(state: VacuumState): Promise<void> {
    const level = this.batteryLevel();
    const charging = this.isCharging() || state === 'charging' || state === 'fully-charged';

    await this.endpoint.updateAttribute(PowerSource.Cluster.id, 'batPercentRemaining', level * 2, this.log);
    await this.endpoint.updateAttribute(
      PowerSource.Cluster.id,
      'batChargeLevel',
      level < BATTERY_CRITICAL_PERCENT ? PowerSource.BatChargeLevel.Critical : level < BATTERY_WARNING_PERCENT ? PowerSource.BatChargeLevel.Warning : PowerSource.BatChargeLevel.Ok,
      this.log,
    );
    await this.endpoint.updateAttribute(
      PowerSource.Cluster.id,
      'batChargeState',
      state === 'fully-charged' ? PowerSource.BatChargeState.IsAtFullCharge : charging ? PowerSource.BatChargeState.IsCharging : PowerSource.BatChargeState.IsNotCharging,
      this.log,
    );
  }

  /**
   * Reflects the state in the run mode and operational state clusters.
   *
   * @param {VacuumState} state The normalised state of the robot.
   * @returns {Promise<void>} Resolves once the attributes have been updated.
   */
  private async applyRunState(state: VacuumState): Promise<void> {
    const cleaning = CLEANING_STATES.includes(state);
    await this.endpoint.updateAttribute(RvcRunMode.Cluster.id, 'currentMode', cleaning ? RUN_MODES[1].mode : RUN_MODES[0].mode, this.log);

    const operationalState = OPERATIONAL_STATE_BY_VACUUM_STATE[state];
    await this.endpoint.updateAttribute(RvcOperationalState.Cluster.id, 'operationalState', operationalState, this.log);
  }

  /**
   * Reflects the suction and water flow levels in the clean mode cluster.
   *
   * @returns {Promise<void>} Resolves once the attribute has been updated.
   */
  private async applyCleanMode(): Promise<void> {
    const vacuum = this.read('cleaningMode');
    const mop = this.read('waterFlow');

    const active = this.cleanModes.find((mode) => {
      const vacuumMatches = mode.levels.vacuum === null || mode.levels.vacuum === vacuum;
      const mopMatches = mode.levels.mop === null || mode.levels.mop === mop;
      return vacuumMatches && mopMatches;
    });

    if (active) {
      await this.endpoint.updateAttribute(RvcCleanMode.Cluster.id, 'currentMode', active.mode, this.log);
    }
  }

  /**
   * Starts or stops cleaning in response to a run mode change.
   *
   * @param {number} newMode The run mode the controller selected.
   * @returns {Promise<void>} Resolves once the device was commanded.
   */
  private async handleRunMode(newMode: number): Promise<void> {
    if (newMode === RUN_MODES[1].mode) {
      await this.startCleaning();
      return;
    }
    if (newMode === RUN_MODES[0].mode) {
      await this.invoke('stopClean');
      return;
    }
    this.log.warn(`${this.name} | unknown run mode ${newMode}`);
  }

  /**
   * Applies the suction and water flow levels of the selected clean mode.
   *
   * @param {number} newMode The clean mode the controller selected.
   * @returns {Promise<void>} Resolves once the device was written to.
   */
  private async handleCleanMode(newMode: number): Promise<void> {
    const mode = this.cleanModes.find(({ mode: candidate }) => candidate === newMode);
    if (!mode) {
      this.log.warn(`${this.name} | unknown clean mode ${newMode}`);
      return;
    }

    this.log.info(`${this.name} | clean mode: ${mode.label}`);
    if (mode.levels.vacuum !== null && this.spec.props.cleaningMode) await this.write('cleaningMode', mode.levels.vacuum);
    if (mode.levels.mop !== null && this.spec.props.waterFlow) await this.write('waterFlow', mode.levels.mop);
  }

  /**
   * Starts a clean, honouring the selected rooms when the model supports it.
   *
   * @returns {Promise<void>} Resolves once the device was commanded.
   */
  private async startCleaning(): Promise<void> {
    const selected = (this.endpoint.getAttribute(ServiceArea.Cluster.id, 'selectedAreas') as number[] | undefined) ?? [];

    if (selected.length > 0 && selected.length !== this.serviceAreas.length && this.spec.roomCleaning !== true) {
      this.log.warn(`${this.name} | ${this.model} cannot start a room clean over MIoT (requested: ${selected.join(', ')}). Starting a full clean instead.`);
    }

    await this.invoke('startClean');
  }

  /**
   * Invokes one of the actions of the specification.
   *
   * @param {keyof VacuumSpec['actions']} name The action to invoke.
   * @returns {Promise<void>} Resolves once the device acknowledged the action, or the failure was logged.
   */
  private async invoke(name: keyof VacuumSpec['actions']): Promise<void> {
    const action: MiotAction | undefined = this.spec.actions[name];
    if (!action) {
      this.log.warn(`${this.name} | ${this.model} has no "${name}" action`);
      return;
    }

    try {
      await this.client.callAction(name, action);
      this.log.info(`${this.name} | ${name}`);
    } catch (error) {
      this.log.error(`${this.name} | ${name} failed: ${String(error)}`);
      return;
    }

    await this.poll();
  }

  /**
   * Builds the clean modes: every suction level, then every water flow level.
   *
   * @returns {SupportedCleanMode[]} The modes to expose, numbered from one.
   */
  private buildCleanModes(): SupportedCleanMode[] {
    const { vacuumLevels, mopLevels } = this.spec;
    const modes: SupportedCleanMode[] = [];

    for (const level of vacuumLevels?.modes ?? []) {
      modes.push({
        label: `${level.name} Vacuum`,
        mode: modes.length + 1,
        modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: CLEAN_MODE_TAGS[level.tag] }],
        levels: { vacuum: level.value, mop: mopLevels?.off ?? null },
      });
    }

    for (const level of mopLevels?.modes ?? []) {
      modes.push({
        label: `${level.name} Mop`,
        mode: modes.length + 1,
        modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: CLEAN_MODE_TAGS[level.tag] }],
        levels: { vacuum: vacuumLevels?.off ?? null, mop: level.value },
      });
    }

    if (modes.length === 0) {
      modes.push({ label: 'Vacuum', mode: 1, modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }], levels: { vacuum: null, mop: null } });
    }

    return modes;
  }

  /**
   * Builds the service areas from the rooms declared in the configuration.
   *
   * @returns {ServiceArea.Area[]} The areas to expose, empty when none were declared.
   */
  private buildServiceAreas(): ServiceArea.Area[] {
    const { roomIds, roomNames } = this.config;
    if (!roomIds?.length) return [];

    return roomIds.map((areaId, index) => ({
      areaId,
      mapId: null,
      areaInfo: {
        locationInfo: {
          locationName: roomNames?.[index] ?? `Room ${areaId}`,
          floorNumber: null,
          areaType: null,
        },
        landmarkInfo: null,
      },
    }));
  }
}

/** The operational state reported for each normalised vacuum state. */
const OPERATIONAL_STATE_BY_VACUUM_STATE: Record<VacuumState, RvcOperationalState.OperationalState> = {
  'idle': RvcOperationalState.OperationalState.Stopped,
  'sleeping': RvcOperationalState.OperationalState.Stopped,
  'cleaning': RvcOperationalState.OperationalState.Running,
  'mopping': RvcOperationalState.OperationalState.Running,
  'manual-cleaning': RvcOperationalState.OperationalState.Running,
  'paused': RvcOperationalState.OperationalState.Paused,
  'returning': RvcOperationalState.OperationalState.SeekingCharger,
  'charging': RvcOperationalState.OperationalState.Charging,
  'fully-charged': RvcOperationalState.OperationalState.Docked,
  'error': RvcOperationalState.OperationalState.Error,
};
