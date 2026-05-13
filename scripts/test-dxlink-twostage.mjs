#!/usr/bin/env node
// Per TT support: the FIRST AUTH_STATE message is the pre-auth state of the
// channel (almost always UNAUTHORIZED) and must be ignored. The SECOND
// AUTH_STATE is the actual outcome. This probe waits for the second.

import WebSocket from "ws";

const must = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
  return v;
};

const BASE = process.env.TASTYTRADE_BASE_URL ?? "https://api.tastyworks.com";
const SCOPE = process.env.TASTYTRADE_SCOPE ?? "read trade openid";

const refreshAccessToken = async () => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: must("TASTYTRADE_REFRESH_TOKEN"),
    client_secret: must("TASTYTRADE_CLIENT_SECRET"),
    scope: SCOPE,
  });
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "tastytrade-twostage/1.0.0",
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`oauth refresh failed (${res.status})`);
  return (await res.json()).access_token;
};

const fetchQuoteToken = async (accessToken) => {
  const res = await fetch(`${BASE}/api-quote-tokens`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "tastytrade-twostage/1.0.0",
    },
  });
  if (!res.ok) throw new Error(`api-quote-tokens failed (${res.status})`);
  const body = await res.json();
  const inner = body.data ?? body;
  return { token: inner.token, dxlinkUrl: inner["dxlink-url"] ?? inner.dxlinkUrl };
};

const main = async () => {
  console.log("=== TT DXLink two-stage AUTH probe ===");
  const accessToken = await refreshAccessToken();
  console.log("[oauth] ok");
  const { token, dxlinkUrl } = await fetchQuoteToken(accessToken);
  console.log(`[api-quote-tokens] ok (length=${token.length}, url=${dxlinkUrl})`);

  const ws = new WebSocket(dxlinkUrl);
  let authStateCount = 0;
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 15_000);
    const done = (r) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(r);
    };
    ws.on("open", () => {
      console.log("[ws] open — sending SETUP + AUTH");
      ws.send(
        JSON.stringify({
          type: "SETUP",
          channel: 0,
          version: "0.1-DXF-JS/0.3.0",
          keepaliveTimeout: 60,
          acceptKeepaliveTimeout: 60,
        }),
      );
      ws.send(JSON.stringify({ type: "AUTH", channel: 0, token }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "SETUP") {
        console.log("[ws] SETUP echo");
      } else if (msg.type === "AUTH_STATE") {
        authStateCount += 1;
        console.log(`[ws] AUTH_STATE #${authStateCount}: state=${msg.state}`);
        if (authStateCount === 1) {
          // Pre-auth state. Ignore per protocol.
          console.log("       (pre-auth — ignoring)");
          return;
        }
        if (msg.state === "AUTHORIZED") done({ ok: true });
        else done({ ok: false, reason: `2nd AUTH_STATE: ${JSON.stringify(msg)}` });
      } else if (msg.type === "ERROR") {
        done({ ok: false, reason: `ERROR: ${JSON.stringify(msg)}` });
      }
    });
    ws.on("error", (err) => done({ ok: false, reason: `ws error: ${err.message}` }));
    ws.on("close", (code, reason) => {
      // Only matters if we haven't resolved yet
      done({ ok: false, reason: `closed: code=${code} reason=${reason.toString()}` });
    });
  });

  console.log(`\n=== RESULT: ${result.ok ? "AUTHORIZED ✓" : `FAILED — ${result.reason}`} ===`);
  process.exit(result.ok ? 0 : 1);
};

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
