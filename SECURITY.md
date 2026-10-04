# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.15.x  | ✅ Active security support |
| < 1.15  | ❌ Upgrade required (unauthenticated MCP transport) |

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

- Open a private [GitHub Security Advisory](https://github.com/Pajand/opencoop/security/advisories/new), or
- Contact the maintainer directly (see the repository profile).

You will receive an acknowledgement as soon as possible. We aim to:

1. Confirm the report within **72 hours**.
2. Provide a fix or mitigation plan within **7 days** for confirmed high-severity issues.
3. Credit researchers in the advisory/release notes unless they prefer to stay anonymous.

## Security Model (v1.15.0+)

OpenCOOP distinguishes **trusted local** traffic from **remote** traffic:

- **Local** (loopback, not via the public tunnel): trusted — the machine's own
  OpenCode instance and browser. No token needed.
- **Remote** (public tunnel or LAN): **every** `/mcp`, `/sse`, `/messages` and
  `/ui/api/*` request requires a token:
  - **Admin token** (host secret, auto-generated, never sent to remote clients), or
  - **Member token** obtained by redeeming an invite link (default 30 days).
- The SSH tunnel forwards to a local **edge proxy** which stamps requests with a
  per-process secret. Public traffic can therefore never impersonate the local
  user, even though both arrive from `127.0.0.1`.
- Permissions are enforced per call: `read`, `write` (write/edit/rollback/locks),
  `admin` (invites/revocation/config). Revoking a member invalidates their token
  instantly (fresh DB lookup on every request).
- The MCP server binds to `127.0.0.1` by default. LAN/public exposure is opt-in
  (`bindAddress`), and even then tokens are required for non-local callers.
- Additional hardening: Host-header allowlist (anti DNS-rebinding), strict CORS,
  CSRF guard header for browser mutations, rate limiting, security event log,
  and `.opencoop/` project store blocked from file tools.

## Acknowledgements

We thank the following researchers for responsibly disclosing issues:

- **Christian Terorde (0xwaidwerk)** — reported the unauthenticated MCP transport
  vulnerability (host mode) fixed in **v1.15.0** (unauthenticated read/write via
  `/mcp`, missing permission enforcement, and 0.0.0.0 binding). Thank you for the
  clear reproduction and the constructive remediation guidance!
