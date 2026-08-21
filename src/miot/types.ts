/**
 * Types describing a MIoT device specification.
 *
 * A MIoT device exposes its features as a tree of services (`siid`), each holding
 * properties (`piid`), actions (`aiid`) and events (`eiid`). The specification of a
 * concrete model can be looked up on https://home.miot-spec.com/ and the mapping
 * used here mirrors the one of the `homebridge-miot` plugin.
 */

/** A single MIoT property, addressed by service and property id. */
export interface MiotProp {
  siid: number;
  piid: number;
}

/** A single MIoT action, addressed by service and action id. */
export interface MiotAction {
  siid: number;
  aiid: number;
}

/** The kind of device, which decides how the device is exposed over Matter. */
export type DeviceKind = 'fan' | 'air-purifier' | 'light' | 'vacuum';

/** Fields shared by every device specification. */
interface CommonSpec {
  /** The MIoT model, e.g. `dmaker.fan.p18`. */
  model: string;
  /** The commercial product name, used as the Matter product name. */
  displayName: string;
  /** The miot-spec URL this mapping was derived from. */
  specUrl: string;
  /** Optional actions exposed by the device. */
  actions?: Record<string, MiotAction>;
}

/** A standing/desk fan, exposed as a Matter fan. */
export interface FanSpec extends CommonSpec {
  kind: 'fan';
  props: {
    /** Power switch. */
    power: MiotProp;
    /** Discrete fan level, `1..fanLevels`. */
    fanLevel: MiotProp;
    /** Continuous speed, `1..100`. Preferred over `fanLevel` when present. */
    speed?: MiotProp;
    /** Straight/natural wind selector. */
    mode?: MiotProp;
    /** Horizontal oscillation. */
    swing?: MiotProp;
    /** Horizontal oscillation angle, in degrees. */
    swingAngle?: MiotProp;
    /** Physical controls lock. */
    childLock?: MiotProp;
    /** Beeper. */
    buzzer?: MiotProp;
    /** Display/indicator light. */
    led?: MiotProp;
    /** Power off timer, in minutes. */
    offDelay?: MiotProp;
  };
  /** How many discrete fan levels the device has. */
  fanLevels: number;
  /** The `mode` value that selects straight wind. */
  straightModeValue?: number;
  /** The `mode` value that selects natural wind. */
  naturalModeValue?: number;
  /** Values to write to `led` when it is an enum rather than a boolean. */
  ledValues?: { on: number; off: number };
}

/** An air purifier, exposed as a Matter air purifier plus sensors. */
export interface AirPurifierSpec extends CommonSpec {
  kind: 'air-purifier';
  props: {
    power: MiotProp;
    /** Operating mode, see `modes`. */
    mode: MiotProp;
    /** Discrete fan level in manual mode, `1..fanLevels`. */
    fanLevel: MiotProp;
    /** Fine grained motor level used by the favorite mode. */
    favoriteLevel?: MiotProp;
    /** Ionizer. */
    anion?: MiotProp;
    /** Device fault code, `0` meaning no fault. */
    fault?: MiotProp;
    /** Measured relative humidity, in percent. */
    humidity?: MiotProp;
    /** Measured temperature, in degrees Celsius. */
    temperature?: MiotProp;
    /** Measured PM2.5 density, in µg/m³. */
    pm25?: MiotProp;
    /** Measured PM10 density, in µg/m³. */
    pm10?: MiotProp;
    /** Remaining filter life, in percent. */
    filterLife?: MiotProp;
    /** Filter time already used, in hours. */
    filterUsedTime?: MiotProp;
    /** Remaining filter time, in days. */
    filterLeftTime?: MiotProp;
    /** Beeper. */
    buzzer?: MiotProp;
    /** Physical controls lock. */
    childLock?: MiotProp;
    /** Display brightness. */
    screen?: MiotProp;
  };
  /** The `mode` values of the device. */
  modes: { auto: number; sleep: number; favorite: number; manual: number };
  /** How many discrete fan levels the manual mode has. */
  fanLevels: number;
  /** The inclusive range of `favoriteLevel`. */
  favoriteLevelRange?: [number, number];
  /** Values to write to `screen` for on and off. */
  screenValues?: { on: number; off: number };
}

/** A light bulb or lamp, exposed as a Matter light. */
export interface LightSpec extends CommonSpec {
  kind: 'light';
  /**
   * Which method set the lamp answers.
   *
   * Some Yeelight models advertise a MIoT specification but reject
   * `get_properties` with `user ack timeout`; they only speak the legacy
   * Yeelight methods (`get_prop`, `set_power`, `set_bright`, `set_ct_abx`) over
   * the same miIO channel.
   */
  transport: 'miot' | 'yeelight';
  /** The transition time used by the legacy Yeelight commands, in milliseconds. */
  transitionMs?: number;
  props: {
    power: MiotProp;
    /** Brightness, see `brightnessRange`. */
    brightness: MiotProp;
    /** Color temperature in kelvin, see `colorTemperatureRange`. */
    colorTemperature?: MiotProp;
    /** Scene selector, see `scenes`. Usually write only. */
    mode?: MiotProp;
  };
  /** The inclusive brightness range, usually `[1, 100]`. */
  brightnessRange: [number, number];
  /** The inclusive color temperature range in kelvin, e.g. `[2600, 5000]`. */
  colorTemperatureRange?: [number, number];
  /** The scenes that can be written to `mode`. */
  scenes?: { name: string; value: number }[];
}

/**
 * The state of a robot vacuum, normalised across models.
 *
 * Every model reports its own `device_status` enum, which the specification maps
 * onto these values.
 */
export type VacuumState = 'idle' | 'sleeping' | 'cleaning' | 'mopping' | 'manual-cleaning' | 'paused' | 'returning' | 'charging' | 'fully-charged' | 'error';

/**
 * How a cleaning level is presented to a controller.
 *
 * These are the Matter `RvcCleanMode` mode tags, spelled without the Matter
 * dependency so that specifications stay free of Matter imports.
 */
export type CleanModeTag = 'lowNoise' | 'min' | 'day' | 'max' | 'night' | 'quick' | 'deepClean' | 'vacuum' | 'mop';

/** The levels one cleaning dimension (suction or water flow) supports. */
export interface CleanLevels {
  /**
   * The value written when the other dimension takes over, e.g. the water flow
   * written when a vacuum-only mode is selected. `null` when the device has no
   * such value, in which case the level is left untouched.
   */
  off: number | null;
  /** The selectable levels, in ascending order. */
  modes: { name: string; value: number; tag: CleanModeTag }[];
}

/** A robot vacuum, exposed as a Matter robotic vacuum cleaner. */
export interface VacuumSpec extends CommonSpec {
  kind: 'vacuum';
  props: {
    /** Device status, see `statusValues`. */
    status: MiotProp;
    /** Fault code, `0` meaning no fault. */
    fault?: MiotProp;
    /** Battery level, in percent. */
    battery: MiotProp;
    /** Charging state, see `chargingValues`. */
    chargingState: MiotProp;
    /** Operating mode. Read for diagnostics only. */
    operatingMode?: MiotProp;
    /** Suction level, see `vacuumLevels`. */
    cleaningMode?: MiotProp;
    /** Water flow level, see `mopLevels`. */
    waterFlow?: MiotProp;
    /** Whether the water tank is attached. */
    waterBoxStatus?: MiotProp;
  };
  actions: {
    /** Starts a full clean. */
    startClean: MiotAction;
    /** Stops the current clean. */
    stopClean: MiotAction;
    /** Sends the robot back to its dock. */
    home: MiotAction;
    /** Makes the robot announce its position. */
    locate?: MiotAction;
    /** Pauses in place. Falls back to `stopClean` when the model has none. */
    pause?: MiotAction;
  };
  /** Maps the `status` values of the model onto the normalised states. */
  statusValues: Record<number, VacuumState>;
  /** Maps the `chargingState` values of the model onto "is charging". */
  chargingValues: Record<number, boolean>;
  /** The suction levels of the model. */
  vacuumLevels?: CleanLevels;
  /** The water flow levels of the model. */
  mopLevels?: CleanLevels;
  /** Whether the model can be told to clean individual rooms over MIoT. */
  roomCleaning?: boolean;
}

/** Any supported device specification. */
export type DeviceSpec = FanSpec | AirPurifierSpec | LightSpec | VacuumSpec;

/** The result of a single property in a `get_properties` response. */
export interface MiotPropertyResult {
  did?: string;
  siid?: number;
  piid?: number;
  code: number;
  value?: unknown;
}

/** The subset of `miIO.info` this plugin uses. */
export interface MiioInfo {
  model?: string;
  mac?: string;
  fw_ver?: string;
  hw_ver?: string;
  life?: number;
}
