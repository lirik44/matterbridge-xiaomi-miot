# matterbridge-xiaomi-miot

A [Matterbridge](https://github.com/Luligu/matterbridge) plugin that exposes Xiaomi
fans, air purifiers and lamps over Matter, talking to them **locally** over the
miIO/MIoT protocol. No Mi Cloud account and no internet access are needed — only
the device IP address and its token.

It is the Matter counterpart of the Homebridge plugin
[`homebridge-miot`](https://github.com/merdok/homebridge-miot): the per-device
`*Control` flags are named the same, so an existing Homebridge configuration can
be copied over almost verbatim.

## Supported models

| Model                 | Product                         | Exposed as                                                                                |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `dmaker.fan.p18`      | Mi Smart Fan 2                  | Fan (on/off, speed 1–100 %, oscillation, natural wind)                                    |
| `zhimi.airp.vb4`      | Xiaomi Smart Air Purifier 4 Pro | Air purifier + air quality sensor (PM2.5, PM10, temperature, humidity) + HEPA filter life |
| `zhimi.airp.mb5`      | Xiaomi Smart Air Purifier 4     | Air purifier + air quality sensor (PM2.5, temperature, humidity) + HEPA filter life       |
| `yeelink.light.lamp4` | Mi LED Desk Lamp 1S             | Color temperature light (on/off, brightness, 2600–5000 K)                                 |

Adding a model is a single file: look its specification up on
[home.miot-spec.com](https://home.miot-spec.com/), write the `siid`/`piid`
mapping into `src/specs/` and register it in `src/specs/index.ts`.

## Installation

```shell
npm install -g matterbridge-xiaomi-miot
matterbridge -add matterbridge-xiaomi-miot
```

Then configure the plugin in the Matterbridge frontend, or edit
`~/.matterbridge/matterbridge-xiaomi-miot.config.json` directly.

## Configuration

```json
{
  "name": "matterbridge-xiaomi-miot",
  "type": "DynamicPlatform",
  "pollingInterval": 10,
  "devices": [
    {
      "name": "Fan",
      "ip": "192.168.1.46",
      "token": "................................",
      "deviceId": "456381061",
      "model": "dmaker.fan.p18"
    },
    {
      "name": "Air Purifier Pro",
      "ip": "192.168.1.147",
      "token": "................................",
      "deviceId": "682252461",
      "model": "zhimi.airp.vb4",
      "buzzerControl": false,
      "ledControl": false,
      "childLockControl": false,
      "modeControl": false,
      "ionizerControl": false
    }
  ]
}
```

### Per-device options

| Option             | Default    | Effect                                                                                                                  |
| ------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`             | –          | Required. The name shown in the controller app.                                                                         |
| `ip`               | –          | Required. Give the device a static lease on your router.                                                                |
| `token`            | –          | Required. 32 hexadecimal characters, see [obtaining a token](#obtaining-a-token).                                       |
| `model`            | auto       | The MIoT model. When omitted the device is asked, which requires it to be online.                                       |
| `deviceId`         | –          | Used as the Matter serial number. Setting it keeps the device identity stable even if the device is offline on startup. |
| `pollingInterval`  | `10`       | How often the device is polled, in seconds.                                                                             |
| `deviceEnabled`    | `true`     | Set to `false` to skip the device without deleting its configuration.                                                   |
| `sensorsControl`   | `true`     | Air purifier: expose air quality, PM2.5/PM10, temperature and humidity.                                                 |
| `separateSensors`  | `true`     | Air purifier: expose the sensors as their own bridged device. Required for Apple Home.                                  |
| `filterControl`    | `true`     | Air purifier: expose the remaining HEPA filter life.                                                                    |
| `speedControl`     | `favorite` | Air purifier: `favorite` maps the speed slider onto the 12-step favorite level, `levels` onto the 3 manual fan levels.  |
| `buzzerControl`    | `false`    | Expose the beeper as a switch.                                                                                          |
| `ledControl`       | `false`    | Expose the display/indicator light as a switch.                                                                         |
| `childLockControl` | `false`    | Expose the physical controls lock as a switch.                                                                          |
| `modeControl`      | `false`    | Expose the operating modes as switches (purifier: auto/sleep/favorite/manual, fan: straight/natural wind).              |
| `ionizerControl`   | `false`    | Air purifier: expose the ionizer as a switch.                                                                           |
| `sceneControl`     | `false`    | Light: expose the built-in scenes as momentary switches.                                                                |
| `debug`            | `false`    | Debug logging for this device only.                                                                                     |

Every enabled `*Control` flag adds one more bridged device, which shows up as its
own tile in the controller app. With all flags off, a device is a single tile
(plus the sensor device for a purifier).

### Obtaining a token

Use [Xiaomi-cloud-tokens-extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor).
It also prints the device id and the model, which are the other two fields worth
copying into the configuration.

## What ends up in the controller app

**Fan** — on/off, a 1–100 % speed slider, horizontal oscillation (rocking) and
the natural wind mode (wind setting). With `modeControl` the straight/natural
wind modes also appear as two switches. These fans have no automatic mode, so the
fan control cluster advertises `Off/Low/Medium/High` without `Auto`.

**Air purifier** — on/off, the fan modes `Low`/`Medium`/`High` (manual fan levels
1–3) and `Auto`, a speed slider, and the remaining HEPA filter life with a
warning below 10 % and a critical indication below 5 %. The sensors are a second
device carrying air quality (derived from PM2.5), PM2.5, PM10 (Pro only),
temperature and humidity.

**Light** — on/off, brightness and color temperature between 2600 K and 5000 K.

## Apple Home notes

Apple Home does not render the child endpoints of a composed device, which is why
the purifier sensors default to being exposed as their own device
(`separateSensors: true`). Set it to `false` for Google Home or Home Assistant, which
prefer a single composed device.

Apple Home also has no concept for the sleep and favorite modes of a purifier, so
they are reachable through the speed slider (`speedControl: "favorite"`) or as
explicit switches (`modeControl: true`).

## Known limitations

- The power-off timer (`off-delay-time`) and the fan's oscillation **angle** have
  no Matter equivalent and are not exposed.
- `yeelink.light.lamp4` firmware 2.1.7 answers every MIoT call with
  `user ack timeout`, so the plugin drives it over the legacy Yeelight methods
  (`get_prop`, `set_power`, `set_bright`, `set_ct_abx`). Its built-in scenes are
  only reachable over MIoT, so `sceneControl` has no effect on this lamp.
- Devices are polled; Xiaomi devices do not push state changes over the local
  protocol. A change made on the device itself shows up within one polling
  interval.

## Development

Matterbridge refuses to load a plugin that lists `matterbridge` in any of its
dependency sections, so it is installed without being saved:

```shell
npm install
npm run dev:matterbridge   # npm install matterbridge --no-save
npm run build
matterbridge -add .
```

Re-run `npm run dev:matterbridge` after any `npm install`, which prunes unsaved
packages.

To *run* a bridge from this working copy, link the very same installation the
bridge itself runs from (`npm link matterbridge`, or a symlink into the global
`node_modules`). Two separate copies of `matterbridge` — one for the host, one in
this folder — make the host reject the plugin with `does not export a valid
MatterbridgePlatform`, because the two copies carry different class identities.

## License

Apache-2.0
