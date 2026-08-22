# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Dreame robot vacuums (`dreame.vacuum.p2008`/`p2009`/`p2028`/`p2041o`/`p2150a`/`p2150o`, with a
  family fallback for unlisted models) exposed as Matter robotic vacuum cleaners: start, stop,
  pause, resume, return to dock, suction and mop levels as clean modes, battery state and the
  rooms declared through `roomIds`/`roomNames`.

### Fixed

- A docked robot is reported as docked or charging instead of stopped: Dreame signals the dock
  through `charging_state` while `device_status` stays `Idle`.
- Property and action calls wait up to 5 s, so a vacuum asleep on its dock no longer produces
  spurious poll timeouts.

## [0.1.0] - 2026-08-21

Initial release.

### Added

- Local MIoT/miIO client with automatic reconnection, no Mi Cloud account needed.
- `dmaker.fan.p18` (Mi Smart Fan 2) exposed as a Matter fan: on/off, 1–100 % speed,
  horizontal oscillation and the natural wind mode.
- `zhimi.airp.vb4` (Air Purifier 4 Pro) and `zhimi.airp.mb5` (Air Purifier 4) exposed as
  Matter air purifiers with air quality, PM2.5, PM10 (Pro), temperature, humidity and
  HEPA filter life.
- `yeelink.light.lamp4` (Mi LED Desk Lamp 1S) exposed as a Matter color temperature light,
  driven over the legacy Yeelight protocol because its firmware rejects MIoT calls.
- Optional switch endpoints for the beeper, display, child lock, ionizer, operating modes
  and light scenes, named after the `homebridge-miot` flags so configurations can be copied.
