---
name: caddy-upstream-cap-semantics
description: Verified Go/Caddy semantics behind lt dev's `max_conns_per_host` cap (WS upgrades free the slot, queue has no timeout, defaults unchanged) + which lt-stack responses are long-held
metadata:
  type: reference
---

Verified 2026-10-08 against Go **go1.26.0** `net/http/transport.go` and Caddy **v2.11.2** sources (the versions `caddy build-info` reports on Kai's machine; no local Go toolchain, so fetch the raw files from GitHub at those tags into the scratchpad).

- **A WebSocket upgrade frees its `MaxConnsPerHost` slot right after the 101 response.** `readLoop` sets `alive = false` and `closeErr = errCallerOwnsConn` for a writable (protocol-switch) body. The deferred `pc.close` then calls `decConnsPerHost` but leaves the socket open. So Vite/Nuxt HMR, DevTools and graphql-ws sockets do not count toward the cap.
- **A request waiting for a slot has no timeout of its own.** It waits on both `idleConnWait` and `connsPerHostWait` until the request context ends. Caddy's 3 s `dial_timeout` lives in `net.Dialer` and starts only once a slot is granted. A finished keep-alive connection goes straight to a waiter (`tryPutIdleConn` → `tryDeliver`).
- **`transport http { max_conns_per_host N }` changes nothing else.** A bare `reverse_proxy` gets `&HTTPTransport{}`, and both forms go through the same `Provision`/`NewTransport`: versions `1.1`+`2` (plain-http upstream means HTTP/1.1), dial timeout 3 s, keepalive probe 30 s, idle 2 m, `MaxIdleConnsPerHost` 32. `caddy adapt` on a scratch Caddyfile is a safe offline check, and its JSON differs only by the `transport` object.
- **Long-held plain-HTTP responses in the lt stack:** the only one is nest-server `POST /ai/stream` (SSE, `core-ai.controller.ts`). It lives for one AI generation. nest-server core makes no JWKS or BASE_URL self-fetch through Caddy, so no slot-holding request cycle exists.
- The cap is per route. Every Caddy site block (dev, `-test`, each shard) has its own transport and upstream port.

**How to apply:** use this when a diff touches the cap value or adds a long-lived endpoint such as SSE or long-poll. Starvation needs N concurrent non-upgraded long responses on ONE upstream. Count them before raising a finding. See [[cli-repo-static-only]].
