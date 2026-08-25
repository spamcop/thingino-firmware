# Fix: open-tx-isp `/proc/jz/isp/isp-m0` daynightd stats

## Problem

daynightd reads `/proc/jz/isp/isp-m0` and parses these OEM keys (see
`package/thingino-daynightd/files/daynightd.c::parse_isp_m0`):

- `ISP Runing Mode : %s`
- `SENSOR Integration Time : %d lines`
- `SENSOR Max Integration Time : %d lines`
- `MAX SENSOR analog gain : %d`
- `SENSOR analog gain : %d`
- `SENSOR digital gain : %d`
- `MAX ISP digital gain : %d`
- `ISP digital gain : %d`
- `ISP EV value log2: %d`      <- primary decision signal
- `ISP EV value us: %d`
- `ISP EV value: %d`
- `ISP WB weighted rgain: %d`
- `ISP WB weighted bgain: %d`
- `ISP WB color temperature: %d`

The open-tx-isp driver's `isp-m0` node is currently bound to a CSI stub /
`frame_count` only (`tx_isp_proc.c::tx_isp_proc_m0_show` prints `%u`
frame_count; `tx_isp_proc_csi_show` prints `"csi"`). None of the keys above
are emitted, so daynightd's `ev_log2` stays 0 and brightness is `-1`.

## Where the data already lives (confirmed in-tree)

The driver already tracks the needed state; nothing new must be reverse
engineered, only *wired into* the proc show:

- `tx_isp_core.c::isp_info_show()` already emits OEM-style lines reading
  `isp->sensor->attr.integration_time` and `isp->sensor->attr.again`, plus
  `ISP Runing Mode : Day/Night`.
- `struct tx_isp_sensor_attribute` (`tx_isp_tuning_abi.h:140-151`) carries
  `integration_time`, `again` (u32), `dgain` (u32) live values.
- `struct tisp_sensor_ctrl_state` (`tx_isp_core.h:30-44`) carries the
  *limits*: `max_again`, `max_dgain`, `min_integration_time`,
  `max_integration_time`.
- `tx_isp_tuning_ev_pack()` (`tx_isp_tuning_abi.h:209`) already knows how to
  pack `ev`, `expr_us`, `ev_log2`, `again`, `dgain`, `gain_log2`.

## Plan

1. In `driver/t31/tx_isp_proc.c`, replace `tx_isp_proc_m0_show` body with a
   full OEM-format dump. Pull the device via `m->private` (it is
   `PDE_DATA(inode)` = `struct tx_isp_dev *`).

2. Emit, in order (match the exact strings daynightd sscanf()s):

   ```
   ISP Runing Mode : <Day|Night>\n
   SENSOR Integration Time : <integration_time> lines\n
   SENSOR Max Integration Time : <max_integration_time> lines\n
   MAX SENSOR analog gain : <max_again>\n
   SENSOR analog gain : <again>\n
   SENSOR digital gain : <dgain>\n
   MAX ISP digital gain : <max_dgain>\n
   ISP digital gain : <dgain>\n
   ISP EV value log2: <ev_log2>\n
   ISP EV value us: <expr_us>\n
   ISP EV value: <ev>\n
   ISP WB weighted rgain: <rgain>\n
   ISP WB weighted bgain: <bgain>\n
   ISP WB color temperature: <ct>\n
   ```

3. Compute `ev_log2`/`expr_us` from the live values:
   `expr_us = integration_time_line_us * integration_time`
   `ev_total = again * dgain * integration_time` (monotonic proxy)
   `ev_log2 = ilog2(ev_total)` (log2 of exposure-gain product)
   These need the sensor `one_line_expr_in_us`; fall back to a nominal
   value if not available.

4. WB rgain/bgain/ct: read from the AWB state if a getter exists; otherwise
   emit a safe default (daynightd tolerates missing WB keys; only ev_log2 is
   required for the -1 fix).

## Minimal first cut (unblocks daynightd immediately)

Even without WB, emitting just `SENSOR Integration Time`, gains, and
`ISP EV value log2` (computed from it/again/dgain) makes daynightd's
`primary_signal = ev_log2` valid and un-breaks brightness. WB lines can be a
follow-up.

## Open questions before coding

1. Exact field name for current `dgain` on `sensor->attr` (confirmed `dgain`
   u32 in `tx_isp_tuning_abi.h:151`, but verify it is *live-updated*, not a
   config default).
2. `one_line_expr_in_us` accessor for the `expr_us` (lines -> us) conversion;
   otherwise use the FPS-derived per-line time.
3. Whether daynightd's `ev_log2` threshold semantics (EV_LOG2_NIGHT_THRESHOLD
   etc.) match a *product-of-gains* log2 vs the OEM's specific EV encoding.
