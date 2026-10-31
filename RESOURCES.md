# Resources

Where to look when building this app, most authoritative first.

The test device runs firmware `1.3.1` (commit `8edd2da4`), HTTP API `27.14.0`, at `http://10.0.4.20` over USB.

## 1. The device

The source of truth for the firmware it runs.

- `GET http://10.0.4.20/api/version`: API version (`{"api_semver":"27.14.0"}`).
- `GET http://10.0.4.20/api/status`: firmware version, commit hash, battery and so on.
- `http://10.0.4.20/openapi.yaml`: the full HTTP API spec for this firmware. `http://10.0.4.20/docs/` is the same spec in Swagger UI.
- `GET http://10.0.4.20/api/screen?display=0`: what the front screen shows now. The body is base64 of raw 72×16 BGR (3456 bytes), even though the content type says `image/bmp`. Use it to check what a frame looks like on the device. busy-lib wraps it as `DisplayScreenFrameGet`.

### Testing on the device

Each step below was tried on the device.

1. `npm run build && npm run app:install && npm run app:run`
2. `POST /api/input?key=<key>` presses a key. The firmware sends a press and then a release, so the app gets `press`, `release` and `short`. `long` and `repeat` cannot be sent this way. In the app:
   - `ok`, `start` and `back` arrive as themselves;
   - `up` arrives as `encoder` with `clockwise` and `delta: 1`;
   - `down` arrives as `encoder` with `counterclockwise` and `delta: -1`.
3. `GET /api/screen?display=0` gets a screenshot. The body is base64 of raw 72×16 BGR (3456 bytes). Convert it to a PNG to view it.
4. Read the logs:
   - `POST /api/log_dump?filename=<name>` writes the in-memory log to `/ext/<name>.txt`;
   - `GET /api/storage/read?path=/ext/<name>.txt` reads it;
   - `DELETE /api/storage/remove?path=...` deletes the file afterwards.

   `console.*` output has the `[JsConsole]` tag, and `[JsRunner]` shows script start and errors. The log is shared with the whole firmware, so filter by tag.
5. `npm run app:stop`, or `POST /api/apps/quit`, quits the app.

### Tools

`tools/` holds helpers for tuning the app. They run on the computer, not on the bar, and the build does not include them.

- `node tools/sim.ts <check> [runs]` runs the physics in `src/lava.ts` at the bar's tick rate and Normal speed, and prints numbers: `life` (blob count, snaps, merges, splits; stalls), `clump` (overlapping and stacked blobs), `dwell` (time at the top and in the pool), `land` (temperature and squash on landing), `settle` (heater off), `spin` (after the dial). The header of the file says what each prints. Add a check when a new behaviour needs measuring.
- `node tools/sheet.mjs out.png [frames] [interval_ms] [scale]` takes screenshots over time and stacks them in one PNG.
- `tools/log.sh [pattern] [lines]` prints matching lines from the bar's log.

The device tools use `BUSY_ADDR`, `10.0.4.20` by default.

The loop that worked: reproduce or tune a physics change with `tools/sim.ts` first, as many runs are cheap and the numbers are comparable. Then build, install and run on the bar, check the look with `tools/sheet.mjs` (for example, around a key press sent with `/api/input`), and check `tools/log.sh` for errors.

`console.log` is logged at debug level, which the log buffer does not keep. Use `console.info` or `console.error`. Their lines are tagged with the app id (see `applications/system/js_app_launcher/scenes/js_app_launcher_scene_run.c`).

### Measured on the device

These are microbenchmarks on firmware 1.3.1. JerryScript is an interpreter and is slow.

| Operation | Cost |
| --- | --- |
| Empty `for` loop iteration | ~10 µs |
| Typed array or array read + add | ~25–35 µs |
| Division | ~50 µs |
| `Math.round` | ~150 µs |
| Building a 72×16 text frame (array `join`) | ~95 ms |
| Building a 72×16 text frame (`String.fromCharCode.apply`) | ~60 ms |
| `POST display/draw`, full-screen `xpmbitmap`, raw `fetch` | ~39 ms |
| The same through busy-lib `DisplayDraw` | ~72 ms |
| `POST display/draw`, 1 rectangle | ~18 ms |
| `POST display/draw`, 12 rectangles (including `JSON.stringify`) | ~75 ms |

Avoid per-pixel work in JS. 1152 pixels × a few operations already takes more than 100 ms.

## 2. Firmware repo: `../busybar-firmware`

The reference for the JS runtime. The checkout is on `dev`, which is a few commits past the device. To read what the device runs, use `git show 1.3.1:<path>`. To see what changed since then, use `git log 1.3.1..dev -- applications/services/js_runner applications/services/web_server/openapi`.

- `documentation/JavaScript Applications.dox.md`: **the JS app reference.** It covers package layout, the manifest and settings schemas, the HTTP endpoints an app may call, input events and Back behaviour. It is published at https://developer.busy.app/javascript-applications.html.
- `applications_js/AGENTS.md`, `applications_js/README.md`: agent rules and the install, launch and quit HTTP calls.
- `applications_js/app.busy.js_example/`: a minimal app in plain JS.
- `applications/services/js_runner/`: the runtime itself. This is the ground truth for which globals exist and how they behave:
  - `js_input.c`: `listen`
  - `js_interval.c`: the timers
  - `js_fetch*.c`, `js_request.c`, `js_response.c`, `js_headers.c`, `js_url.c`: fetch
  - `js_local_storage.c`: `localStorage`
  - `js_console.c`: console
  - `js_stubs.c`: `AbortController`, `DOMException` and `FormData`, which are stubs only
- `lib/jerryscript.scons`: the JerryScript feature flags. Enabled: typed arrays, Proxy, BigInt, WeakRef, containers and modules. Disabled: `Reflect`, Annex B, and Unicode case conversion.
- `applications/services/web_server/openapi/*.yaml`: the API spec as source, split by area.
- `documentation/File Formats.dox.md` and `lib/anim_file/anim_file_format.h`: the `.anim` format.
- `scripts/seq2anim.py`: turns a `.zip` of frame images into a `.anim` file. It needs Pillow and the repo's `scripts/flipper` package.

Runtime limits from the source:

| Limit | Value | Where |
| --- | --- | --- |
| Script size | 250 KiB | `js_runner_types.h` |
| App thread stack | 8 KiB (keep recursion shallow) | `js_runner_i.h` |
| Queued input events | 32 | `js_input.c` |
| Queued fetch messages | 32 | `js_runner_i.h` |
| Heap | `heap_size_kib`, 128 KiB by default, 512 KiB at most | manifest |

## 3. `@busy-app/busy-lib` (installed, `node_modules/@busy-app/busy-lib`)

- `dist/index.d.ts`: a typed client for every endpoint (`BusyBar`). It also has the display element schemas and the layout helpers: `row`, `column`, `stack`, `render`, `measure` and `textWidth`. The XPM helpers are `generateXpm2` and `scaleGrid`.
- `dist/fonts.d.ts`: font metrics.
- `README.md`: the client's errors and timeouts, plus `ScreenRenderer`, which draws RGBA frames with an LED look in a browser. That could be useful for a simulator.
- Source: https://github.com/busy-app/busylib-ts (not cloned).

## 4. busy-tools: `../busy-tools`

The repo this app was made from, along with `busy-cli`.

- `packages/cli/README.md`, `packages/cli/src/`: build, package and install.
- `packages/create/template/`: the template. Compare against it to tell template code from our own code.

## 5. docs.busy.app

User-facing guides. Every page has a markdown version: add `.md` to the URL. The index is at https://docs.busy.app/llms.txt.

- https://docs.busy.app/bar/dev/js-apps/build.md: **the most useful guide.** It builds the Rates app and covers drawing, input, settings, `localStorage`, and how to keep requests from piling up.
- https://docs.busy.app/bar/dev/js-apps.md: an overview of the built-in functions and the limits.
- https://docs.busy.app/bar/tech-specs.md: hardware. The front screen is 72×16 RGB LED with a 60 Hz max refresh. The back screen is a 160×80 OLED with 16 grays. The MCU is an STM32U595 at 160 MHz.
- https://docs.busy.app/bar/dev/http-api.md: an overview of the HTTP API (addresses, auth, Wi-Fi access).
- https://docs.busy.app/bar/dev/widget-with-ai.md: low relevance. It drives the bar from a PC with Python over the HTTP API and is not about JS apps.

## 6. api.busy.app

- https://api.busy.app/busybar/docs: public Swagger UI with a spec for each firmware release. https://api.busy.app/busybar/openapi.yaml?Name=1.3.1 is the spec for this device, the same one the device serves.

## Known mismatches

- The template's `shared/settings.ts` read a global named `Settings`, which the runtime does not provide (checked in `js_runner/` on both `1.3.1` and `dev`). This repo's version uses `device.AppsSettingsGet({ app_id })` (`GET /api/apps/settings`) instead. Apps can read settings but not write them.
- `AGENTS.md` says encoder events have "a direction". In practice that is `action: "clockwise" | "counterclockwise"`, plus `delta: 1 | -1`.
- A long press on `back` force-quits the app in firmware. The app never receives it.
- The manifest has `api_version: "1.0.0"`. The device is at `27.14.0`, and the busy-tools scaffold suggests `27.12.0`. Set it to the lowest version that has the features we use.
- The HTTP server handles requests one at a time. Each redraw goes through it, so the safe frame rate has to be measured on the device.
