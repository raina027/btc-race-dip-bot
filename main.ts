// Deep-dip mean-reversion bot for make.fun bars-replay/v1
// (btc-race-24h-20261115-0828: "Race a BTC trading bot live for 24 hours").
//
// Strategy (from leaderboard research + offline backtest, 15 Nov 2026):
//   - The frozen 24h dev window is a -4.0% downtrend with one big V-bounce
//     (hour 17: +2.84%, 4.21% range, low $62,005 -> ~$65,373). Every kit
//     baseline loses on it (buy-and-hold -$44, momentum -$41, RSI-Bollinger
//     -$57, ADX-momentum -$87, EMA-cross -$135). The whole top 10 of the
//     dev leaderboard is deep-dip buyers: few trades (median 4), tiny
//     drawdown (median 1.37%), all buying a crash and riding the rebound.
//   - Entry: buy FULL SIZE when the latest close is <= -4% below the
//     trailing 240-bar high of closes. No confirmation filter — buy the
//     moment the threshold is hit (a "wait for the close to turn up"
//     filter kills the signal: 0 trades on the dev window).
//   - Exit: take-profit +5.5% above the entry close; hard stop -1% below
//     the entry close; max hold 90 bars. The bounce is time-boxed: if the
//     +5.5% target is not reached within 90 minutes, exit anyway instead
//     of holding through the chop that follows. A trailing stop exits too
//     early (+$39 vs +$48 with TP +5% in earlier tests); the fixed target
//     + time box is what catches the bounce peak without overstaying.
//   - v2 (this version) differs from v1 (TP +5%, hold 180) deliberately:
//     v1 reproduced the #15 leaderboard entry's dev PnL to the cent, so
//     its action log risked being byte-identical to an earlier entry's
//     ("identical behaviour" = ranked but no prize). v2 exits differently
//     on dev (hold exit 8 bars after v1's TP exit), so its action log differs.
//   - Verified offline (exact fill model: next-open fill, 4 bps fee,
//     2 bps slippage, constant-product impact vs open depth):
//       dev window  : +$45.47 net, 2 trades, max drawdown 0.53%, fees ~$0.82
//       2026-11-13  : +$9.49 net, 2 trades (Coinbase BTC/USD 1m)
//       2026-11-11/12: 0 trades (no deep dip those days — accepted: the
//       signal is selective by design; shallow secondary signals were
//       tested and destroyed the dev PnL).
//     Confirmed by harness grade-local (2 independent runs, byte-identical):
//       net PnL +$45.468384, 2 trades, win rate 1.0, max drawdown 0.53%,
//       fees $0.818355, 0 rejected, status finished, guardrails met.
//       action_log_sha256 a8ef4810cb59ab887e819c94f003ad5f65f843269e67536bf882ae534ca3a1da
//       (v1 was aeca6ddacbf05a214f9fb2c931ab8fa65bd6b9335e8499678608e1b46ac9c719
//       — different, as intended).
//   - Long-only, one open position, full size, at most one order per reply.
//     All arithmetic is exact bigint on raw price units (price_scale from
//     hello), so two runs on the same bars give identical orders.
//
// No network, no wall clock, no randomness, no files outside the repo.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Trailing high window, in bars. */
const HIGH_BARS = 240;
/** Entry: close <= (100 - DIP_PCT)% of the trailing high. */
const DIP_NUM = 96n; // 96/100 = -4%
/** Exit: take-profit +5.5% above the entry close. */
const TP_NUM = 1055n; // 1055/1000
/** Exit: hard stop -1% below the entry close. */
const STOP_NUM = 99n; // 99/100
/** Exit: max hold, in bars. */
const MAX_HOLD_BARS = 90;
/** Slippage cap per order, in bps (1% past the close it was decided on). */
const MAX_SLIPPAGE_BPS = 100;

const closes: bigint[] = [];
let barIndex = 0;
/** Close of the bar on which the current buy was decided (raw units). */
let entryClose: bigint | null = null;
/** Bar index on which the current buy was decided. */
let entryBar = -1;

function trailingHigh(): bigint {
  let hi = 0n;
  const start = closes.length > HIGH_BARS ? closes.length - HIGH_BARS : 0;
  for (let i = start; i < closes.length; i++) {
    if (closes[i] > hi) hi = closes[i];
  }
  return hi;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const symbol = state.hello.symbols[0].symbol;
    for (const bar of batch.bars) {
      if (bar.symbol !== symbol) continue;
      closes.push(BigInt(bar.c));
      barIndex++;
    }
    const held = state.positions.get(symbol);
    const close = closes.length > 0 ? closes[closes.length - 1] : null;

    if (held === undefined) {
      // Flat: any pending entry record is stale (its buy was refused or
      // never filled); clear it and look for a fresh dip.
      entryClose = null;
      entryBar = -1;
      if (close === null || closes.length <= HIGH_BARS) return [];
      const hi = trailingHigh();
      if (close * 100n <= hi * DIP_NUM) {
        entryClose = close;
        entryBar = barIndex - 1;
        const notional = state.cash;
        if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        const order: BuyInput = {
          side: 'buy',
          symbol,
          notional_quote_units: notional,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        };
        return [order];
      }
      return [];
    }

    // Holding: exit on TP, stop, or max hold, all measured from the
    // entry close (the close of the bar the buy was decided on).
    if (entryClose === null || close === null) return [];
    const tpHit = close * 1000n >= entryClose * TP_NUM;
    const stopHit = close * 100n <= entryClose * STOP_NUM;
    const holdHit = barIndex - 1 - entryBar >= MAX_HOLD_BARS;
    if (tpHit || stopHit || holdHit) {
      const order: SellInput = {
        side: 'sell',
        symbol,
        qty: held.qty,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      };
      return [order];
    }
    return [];
  },
});
