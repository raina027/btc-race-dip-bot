# Deep-Dip cbBTC Bot

Entry for make.fun **btc-race-24h-20261115-0828** — "Race a BTC trading bot
live for 24 hours". Protocol `agent-fun/bars-replay/v1`, Node 22,
`main.ts` in the repo root, stdlib only plus the vendored kit shim
(`vendor/makefun-bars.ts`, byte-identical copy of the kit SDK).

## Strategy

Deep-dip mean reversion on 1-minute cbBTC bars, long-only, one open
position, full size:

- **Entry** — buy 100% of cash when the latest close is at least 4% below
  the trailing 240-bar high of closes. No confirmation filter: the buy is
  sent the moment the threshold is hit.
- **Exit** — take-profit at +5% above the entry close, hard stop at −1%
  below the entry close, max hold 180 bars (3 hours). Sells the whole
  position.
- At most one order per reply; slippage cap 100 bps per order.

## Why this design

The frozen 24h dev window is a −4.0% downtrend with a single big V-bounce
(hour 17: +2.84%, low $62,005 → ~$65,373). Every kit baseline loses on it
(buy-and-hold −$44, momentum −$41, RSI-Bollinger −$57, ADX-momentum −$87,
EMA-cross −$135), and the whole dev-leaderboard top 10 is deep-dip buyers
(median 4 trades, median max drawdown 1.37%). Shallow dips, EMA crosses,
RSI and Bollinger all lose on this window; only a deep dip with a +5% take
profit catches the bounce peak. A trailing stop exits too early
(+$39 vs +$48). The design was verified in an offline simulator with the
exact harness fill model (next-open fill, 4 bps fee, 2 bps slippage,
constant-product impact vs open depth) before the bot was written.

## Backtest (dev window, frozen, 1,440 bars)

| Metric | Value |
|---|---|
| Net PnL | **+$47.52** (gate: > $0) |
| Trades | 2 |
| Max drawdown | 0.53% |
| Fees | $0.82 |

Cross-check on other days (Coinbase BTC/USD 1m): 2026-11-13 +$7.40 (2
trades); 2026-11-11 and 2026-11-12: 0 trades — the signal is selective by
design; shallow secondary signals were tested and destroyed the dev PnL,
so none were added.

## Determinism

All arithmetic is exact `bigint` on raw price units, no clock, no
randomness, no network, no files outside the repo. Two runs on the same
bars produce identical orders.

## Grade locally

```sh
makefun grade-local --kit <kit-dir> --bot . --driver process
```

## License

MIT — see `LICENSE`.
