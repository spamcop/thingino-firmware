# Open ISP Conversion — Handoff

Branch: `switch-to-open-isp` (in `/home/paul/thingino/firmware/ciao`)
Camera: `cinnado_d1_t31l_sc2336_atbm6031` (T31L, SC2336, ATBM6031) at `192.168.88.34`

## What was done

Switched the Cinnado D1 from the proprietary Ingenic ISP blob to the
open-source `open-tx-isp` kernel driver, plus a set of driver fixes that
removed a motor timer-interrupt storm and an ISP thread D-state load-average
spike. The streamer (prudynt) links against the *proprietary* Ingenic
`libimp.so` (not OpenIMP) because OpenIMP's T31 build is video-focused and
lacks the IMP audio/IVS symbols prudynt needs.

## Commits (oldest to newest, all on `switch-to-open-isp`)

- `b75e00d2e` — `ingenic-sdk: stop T31 motor TCU counter when steppers idle`
  Already on `origin/ciao`. Fixes the Pan/Tilt stepper driver free-running its
  TCU channel at 900 interrupts/sec forever after homing/positioning. Adds
  `package/ingenic-sdk/0003-motor-t31-stop-tcu-counter-when-idle.patch`.
  Verified: idle motor TCU drops 900/sec -> 0/sec; motion still works.

- `3c993a75d` — `open-tx-isp: make tisp_event_process wait interruptible`
  Adds `package/open-tx-isp/0001-tisp-event-process-interruptible-wait.patch`.
  `wait_for_completion_timeout` (D/uninterruptible) -> `_interruptible_timeout`
  (S/interruptible). Fixes: load average drops ~2.7 -> ~0.55, no more D-state
  ISP thread, clean kthread_stop teardown.

- `2a2ecdc9f` — `cinnado-d1: switch to open ISP stack (open-tx-isp + OpenIMP)`
  Adds `configs/fragments/open-isp.fragment` and references it from the camera
  defconfig `# FRAG:` line.

- `8d410128f` — `thingino-isp: add userspace ABI choice for the open ISP stack`
  Reworked `package/thingino-isp/Config.in`: added a separate
  "Open ISP userspace ABI" choice (OpenIMP vs proprietary libimp, default
  libimp). Needed because the prior `THINGINO_ISP_OPEN` force-selected OpenIMP
  which broke prudynt's link.

- `91021b01a` — `open-tx-isp: expose OEM isp-m0 stats for daynightd`
  Adds `package/open-tx-isp/0002-isp-m0-procfs-daynightd-stats.patch` and
  `docs/dev/open-tx-isp-isp-m0-stats.md`. Fixes daynightd brightness `-1`.
  See "Not yet validated" below.

## Working-tree state / overrides

- `local.mk` currently wires:
  ```
  INGENIC_SDK_OVERRIDE_SRCDIR = $(BR2_EXTERNAL)/overrides/ingenic-sdk
  ```
  (`OPEN_TX_ISP_OVERRIDE_SRCDIR` is commented out; open-tx-isp ships via the
  numbered patches above.)

- `overrides/ingenic-sdk` — the motor fix source (git checkout at pinned
  `c5cbd61e`, with the `jz_tcu_disable_counter` change). This is what the
  committed `0003` patch was generated from.

- `overrides/open-tx-isp` — local scratch checkout at pinned `99b11416` with
  the two fixes applied in-tree. Used to *generate* the `0001`/`0002` patches.
  Do not rely on it at build time; the patches are authoritative.

- `overrides/prudynt-t` — unrelated earlier streamer experiment (commented out
  in local.mk); not used.

- `package/all-patches/linux/3.10.14/0092-wdt-shutdown-keep-armed.patch` —
  untracked, intentionally left alone (watchdog shutdown behavior; author
  asked to leave it).

## Build / flash commands (confirmed working)

```bash
cd /home/paul/thingino/firmware/ciao
CAMERA=cinnado_d1_t31l_sc2336_atbm6031 IP=192.168.88.34 make cleanbuild ota
```

Output dir for this branch (note branch name in path):
```
output/switch-to-open-isp/cinnado_d1_t31l_sc2336_atbm6031-3.10.14-uclibc-192.168.88.34/
```

The uclibc toolchain is used. `IP=` is required for `ota`.

## Verification done (on a successful open-ISP flash)

After flashing, confirm the open driver is live and the fixes held:

```sh
# open driver (author Matt Davis, not "Ingenic xhshen")
modinfo tx_isp_t31 | grep -E 'author|description'

# isp_fw_process is S-state (not D), no D-state procs, low load
cat /proc/loadavg
for p in /proc/[0-9]*; do s=$(awk '{print $3}' $p/stat 2>/dev/null); \
  [ "$s" = "D" ] && echo "$(cat $p/comm)"; done

# motor TCU idle at 0/sec
m1=$(awk '/jz_timer_interrupt/{print $2}' /proc/interrupts); sleep 5; \
m2=$(awk '/jz_timer_interrupt/{print $2}' /proc/interrupts); echo $(( (m2-m1)/5 ))
```

Observed good results:
- ISP module author = `Matt Davis <matteius@gmail.com>` (open-tx-isp)
- `isp_fw_process` state `S`, load ~0.55, no D-state procs
- motor TCU 0/sec idle, ~305/sec during a real move (then back to 0)

## Still latently present (accepted, not addressed)

- `jz-timerost` ~1120/sec persists while prudynt streams at 25fps. This is the
  ISP frame/sub-frame interrupt + clockevent re-arm cost, proportional to
  stream rate. It is *not* the D-state phantom load (that is fixed). Reducing
  stream0 fps (25 -> 15) would lower it, but it was not pursued.

- The open driver's live AE gain state is not cleanly readable (`attr.again` /
  `attr.dgain` read 0; the AE algorithm state is packed in `0xa004..0xa828`
  registers with no simple getter). This is why the `isp-m0` fix relies on the
  integration-time ratio rather than an EV value. See below.

## NOT yet validated (needs a device build+flash)

`91021b01a` (`0002-isp-m0-procfs-daynightd-stats.patch`) is committed but has
NOT been flashed. The camera currently runs a stale first-cut of that patch.

The corrected patch purposefully emits `ISP EV value log2: 0` so daynightd
falls back to the integration-time ratio (`integration_time /
max_integration_time`), which IS live (1200 / 1436 observed). Expected result:
`/run/thingino/daynight_brightness` should track scene darkness instead of
being stuck at 100 (or -1).

To validate: flash the corrected build, then in a dark vs bright scene check
`cat /run/thingino/daynight_brightness` and `cat /proc/jz/isp/isp-m0`.

## Gotchas / lessons learned

- Do NOT edit files in `output/.../build/...` — those are wiped on rebuild.
  Edit `overrides/<pkg>` and wire via `local.mk`, or ship numbered patches in
  `package/<pkg>/`.

- Do NOT edit `dl/` (the shared download cache). Treat it as read-only.

- The full `cleanbuild` wipes the object tree and recompiles host deps
  (host-python3, host-libunistring, etc.) — expect ~7-8 min and it may look
  "stuck" while recompiling host tools. ccache helps but does not eliminate
  the host-dependency rebuild cost.

- A flash can fail on-device with "Failed to flash firmware" if the rootfs
  grows too close to its MTD partition limit or `/tmp` RAM is tight. The open
  driver + OpenIMP libs grew rootfs toward 5.78MB against a ~5.83MB partition.
  Keep an eye on rootfs size vs the `rootfs` MTD partition. A failed full flash
  is recoverable (the device reboots into its previous image), but it's a
  noisy failure — check `images/*.md` partition sizing before flashing.

- The `open-isp.fragment` selects `BR2_PACKAGE_THINGINO_ISP_OPEN=y` and
  `BR2_PACKAGE_THINGINO_ISP_OPEN_ABI_LIBIMP=y` (proprietary libimp). Do NOT
  switch to OpenIMP on T31 until OpenIMP implements IMP audio/IVS symbols.

- The camera root password / WiFi / SSH keys persist via the `cfg-backup`
  mechanism (mtd2 backup partition) and `S37cfg-autorestore`. After a flash
  that wipes the overlay, the first boot restores `/root/.ssh/authorized_keys`,
  `/etc/wpa_supplicant.conf`, `/etc/shadow`, etc. Re-run `cfg-backup write`
  on the camera if you change these provisioning files.
