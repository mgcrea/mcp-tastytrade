# @mgcrea/mcp-tastytrade

Model Context Protocol server for the [TastyTrade](https://tastytrade.com) brokerage API. Exposes accounts, balances, positions, orders, transactions, instruments, market metrics, watchlists, and on-demand DXLink quote snapshots as MCP tools — for use with Claude Desktop, Claude Code, or any MCP-compatible client.

## Features

- **OAuth2 personal grant** auth (client_secret + refresh_token), automatic refresh on expiry and on 401.
- **Native `fetch`** HTTP client. No axios, no `@tastytrade/api` dependency.
- **TastyTrade dash-case ↔ camelCase** transparent translation.
- **DXLink quote snapshots** via a short-lived WebSocket — `get_quote(symbol)` returns once and disconnects.
- **Trading is opt-in.** Mutating tools (`place_order`, `cancel_order`, `replace_order`, `create_watchlist`, `update_watchlist`, `delete_watchlist`) are only registered when `TASTYTRADE_ALLOW_TRADING=1`. Order-placement tools additionally require `confirm: true` in the call args; otherwise they return a dry-run preview. Set `TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1` to flip the `confirm` default to `true` (auto-submit) — only use if you trust whatever's driving the MCP.

## Stack

- Node 22+, ESM, `pnpm`
- TypeScript (strict, NodeNext, ES2023)
- [`tsdown`](https://tsdown.dev) for builds
- [`oxlint`](https://oxc.rs) + [`oxfmt`](https://oxc.rs) for lint/format
- [`vitest`](https://vitest.dev) for tests
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), [`zod`](https://zod.dev), [`ws`](https://github.com/websockets/ws)

## Install

```bash
pnpm install
pnpm build
```

## Configure

Provision a personal OAuth grant via the TastyTrade developer portal (https://developer.tastytrade.com/oauth/) and copy `.env.example` to `.env`:

```
TASTYTRADE_CLIENT_SECRET=...
TASTYTRADE_REFRESH_TOKEN=...
TASTYTRADE_SCOPE=read trade
TASTYTRADE_ENV=prod        # or "cert" for the sandbox
TASTYTRADE_ALLOW_TRADING=             # "1" to register mutating tools (still gated by per-call confirm:true)
TASTYTRADE_DANGEROUSLY_ALLOW_TRADING= # "1" to also flip the per-call confirm default to true (auto-submit)
```

## Run

```bash
pnpm start                 # speaks JSON-RPC over stdio
```

## Wire up to Claude Code / Claude Desktop

In `~/.claude.json` (or the desktop config):

```json
{
  "mcpServers": {
    "tastytrade": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tastytrade/dist/cli.js"],
      "env": {
        "TASTYTRADE_CLIENT_SECRET": "...",
        "TASTYTRADE_REFRESH_TOKEN": "...",
        "TASTYTRADE_SCOPE": "read trade",
        "TASTYTRADE_ENV": "prod"
      }
    }
  }
}
```

Or, after `pnpm link --global`:

```json
{ "command": "tastytrade-mcp", "args": [], "env": { "...": "..." } }
```

Inspect tool wiring with the official inspector:

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

## Run via Docker

The published image is [`mgcrea/mcp-tastytrade`](https://hub.docker.com/r/mgcrea/mcp-tastytrade) on Docker Hub. Pull the latest tag or pin a version:

```bash
docker pull mgcrea/mcp-tastytrade:latest
```

Or build locally:

```bash
pnpm docker:build          # tags mgcrea/mcp-tastytrade:latest and :<version>
```

The container runs `node /app/dist/cli.js` as PID 1 and speaks JSON-RPC over stdio. Pass credentials via `-e VAR` (forwarded from the spawning shell) or `--env-file`.

`.mcp.json` for Claude Code (project-scoped) / Claude Desktop:

```json
{
  "mcpServers": {
    "tastytrade": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "TASTYTRADE_CLIENT_SECRET",
        "-e",
        "TASTYTRADE_REFRESH_TOKEN",
        "-e",
        "TASTYTRADE_SCOPE",
        "-e",
        "TASTYTRADE_ENV",
        "-e",
        "TASTYTRADE_ALLOW_TRADING",
        "mgcrea/mcp-tastytrade:latest"
      ],
      "env": {
        "TASTYTRADE_CLIENT_SECRET": "...",
        "TASTYTRADE_REFRESH_TOKEN": "...",
        "TASTYTRADE_SCOPE": "read trade openid",
        "TASTYTRADE_ENV": "prod"
      }
    }
  }
}
```

Notes:

- `-i` keeps stdin open (required); do **not** add `-t` — Claude Code spawns the process without a TTY.
- `-e VAR` (no `=value`) forwards the value from the host env, which is what Claude Code sets from the `env` block above. Don't put secrets in `args`.
- `--rm` cleans up the container after each MCP session.
- Omit `TASTYTRADE_ALLOW_TRADING` (or leave it unset) to ship without order-placement / watchlist-mutation tools registered.

If you'd rather not commit secrets to `.mcp.json`, point `--env-file` at a local `.env` instead:

```json
"args": ["run", "--rm", "-i", "--env-file", "/abs/path/to/.env", "mgcrea/mcp-tastytrade:latest"]
```

### Publishing

```bash
docker login                    # once, against docker.io
pnpm docker:release             # multi-arch (amd64 + arm64) buildx + push
```

Or, for a single-arch local image:

```bash
pnpm docker:build
pnpm docker:push                # pushes both :latest and :<package.json version>
```

## Tools

### Read-only (always available)

| Tool                                                                                 | Description                                                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_accounts`                                                                      | Customer accounts.                                                                                                                           |
| `get_account`                                                                        | Single account detail.                                                                                                                       |
| `get_customer`                                                                       | Customer profile.                                                                                                                            |
| `get_balances`                                                                       | Cash + margin balances.                                                                                                                      |
| `get_positions`                                                                      | Open / closed positions.                                                                                                                     |
| `list_orders`, `get_order`                                                           | Order history / lookup.                                                                                                                      |
| `list_transactions`, `get_transaction`                                               | Account transactions.                                                                                                                        |
| `search_symbols`                                                                     | Symbol search by prefix.                                                                                                                     |
| `get_equity`, `get_equity_option`, `get_future`, `get_cryptocurrency`                | Instrument metadata.                                                                                                                         |
| `get_option_chain_summary`                                                           | Per-expiration summary (strike counts, min/max strike). Slim payload.                                                                        |
| `get_option_chain`                                                                   | Filtered chain slice (by expiration / strike range / type), one flat leg per call/put with both OCC and DXLink symbols.                      |
| `get_market_metrics`                                                                 | IV rank/percentile, beta, liquidity, IV term structure.                                                                                      |
| `get_expected_move`                                                                  | ATM straddle expected ±1σ move for an underlying at a given expiration (spot, ATM strike, call/put mids, straddle, IV-implied move).         |
| `get_dividend_history`, `get_earnings_history`                                       | Corporate event history.                                                                                                                     |
| `list_watchlists`, `get_watchlist`, `list_public_watchlists`, `get_public_watchlist` | Watchlists.                                                                                                                                  |
| `get_quote`                                                                          | Snapshot for one symbol via DXLink. Quote (bid/ask/sizes) plus Greeks (delta/gamma/theta/vega/IV) for options. Accepts OCC or DXLink format. |
| `get_quotes`                                                                         | Batch snapshot for many symbols in a single DXLink connection.                                                                               |

### Mutating (only when `TASTYTRADE_ALLOW_TRADING=1`)

| Tool                                                       | Description                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `place_order`                                              | Submit an order. Without `confirm: true`, returns a dry-run preview.      |
| `cancel_order`                                             | Cancel an open order. Requires `confirm: true`.                           |
| `replace_order`                                            | Replace an open order. Without `confirm: true`, dry-runs the replacement. |
| `create_watchlist`, `update_watchlist`, `delete_watchlist` | Private watchlist management.                                             |

## Development

```bash
pnpm dev          # tsdown --watch
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint
pnpm format       # oxfmt --write .
```

## License

MIT © Olivier Louvignes
