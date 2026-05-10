# @mgcrea/mcp-tastytrade

Model Context Protocol server for the [TastyTrade](https://tastytrade.com) brokerage API. Exposes accounts, balances, positions, orders, transactions, instruments, market metrics, watchlists, and on-demand DXLink quote snapshots as MCP tools — for use with Claude Desktop, Claude Code, or any MCP-compatible client.

## Features

- **OAuth2 personal grant** auth (client_secret + refresh_token), automatic refresh on expiry and on 401.
- **Native `fetch`** HTTP client. No axios, no `@tastytrade/api` dependency.
- **TastyTrade dash-case ↔ camelCase** transparent translation.
- **DXLink quote snapshots** via a short-lived WebSocket — `get_quote(symbol)` returns once and disconnects.
- **Trading is opt-in.** Mutating tools (`place_order`, `cancel_order`, `replace_order`, `create_watchlist`, `update_watchlist`, `delete_watchlist`) are only registered when `TASTYTRADE_ALLOW_TRADING=1`. Order-placement tools additionally require `confirm: true` in the call args; otherwise they return a dry-run preview.

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
TASTYTRADE_ALLOW_TRADING=  # set to "1" only if you want order-placement tools
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

## Tools

### Read-only (always available)

| Tool                                                                                 | Description                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `list_accounts`                                                                      | Customer accounts.                                                      |
| `get_account`                                                                        | Single account detail.                                                  |
| `get_customer`                                                                       | Customer profile.                                                       |
| `get_balances`                                                                       | Cash + margin balances.                                                 |
| `get_positions`                                                                      | Open / closed positions.                                                |
| `list_orders`, `get_order`                                                           | Order history / lookup.                                                 |
| `dry_run_order`                                                                      | Validate an order without submitting.                                   |
| `list_transactions`, `get_transaction`                                               | Account transactions.                                                   |
| `search_symbols`                                                                     | Symbol search by prefix.                                                |
| `get_equity`, `get_equity_option`, `get_future`, `get_cryptocurrency`                | Instrument metadata.                                                    |
| `get_option_chain`                                                                   | Nested or compact option chain for an underlying.                       |
| `get_market_metrics`                                                                 | IV rank/percentile, beta, liquidity for symbols.                        |
| `get_dividend_history`, `get_earnings_history`                                       | Corporate event history.                                                |
| `list_watchlists`, `get_watchlist`, `list_public_watchlists`, `get_public_watchlist` | Watchlists.                                                             |
| `get_quote`                                                                          | Real-time bid/ask snapshot via DXLink (single event, then disconnects). |

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
