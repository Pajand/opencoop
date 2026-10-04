import http from "http";
import { logger } from "../utils/logger.js";
import { PUBLIC_TUNNEL_HEADER } from "../security/guard.js";

/**
 * Tunnel edge proxy (v1.15.0 security).
 *
 * The public SSH tunnel forwards to THIS listener only (127.0.0.1:<edgePort>).
 * Every request gets the per-process secret stamp before being forwarded to
 * the real server (127.0.0.1:<mainPort>). The main server treats any request
 * bearing the stamp as PUBLIC (internet) traffic and demands a token, while
 * unstamped loopback traffic is the user's own trusted session.
 *
 * This is what lets the plugin distinguish "my own OpenCode/browser" from
 * "someone coming through the public tunnel" even though both arrive from
 * 127.0.0.1 (SSH -R forwards from localhost).
 */
export class TunnelProxy {
  private server: http.Server | null = null;
  private edgePort: number;
  private targetPort: number;
  private secret: string;

  constructor(edgePort: number, targetPort: number, secret: string) {
    this.edgePort = edgePort;
    this.targetPort = targetPort;
    this.secret = secret;
  }

  getPort(): number {
    return this.edgePort;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.forward(req, res));
      this.server.on("error", (err) => {
        logger.warn(`TunnelProxy error: ${err.message}`);
        reject(err);
      });
      // Never timeout long-lived SSE streams.
      this.server.requestTimeout = 0;
      this.server.headersTimeout = 0;
      this.server.timeout = 0;
      this.server.listen(this.edgePort, "127.0.0.1", () => {
        logger.info(`Tunnel edge proxy listening on 127.0.0.1:${this.edgePort}`);
        resolve();
      });
    });
  }

  private forward(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const headers: http.OutgoingHttpHeaders = { ...clientReq.headers };

    // Strip hop-by-hop + any inbound stamp (spoof prevention), then stamp.
    delete headers["connection"];
    delete headers["proxy-connection"];
    delete headers["keep-alive"];
    delete headers["transfer-encoding"];
    delete headers["upgrade"];
    delete headers["host"];
    const inboundStamp = Object.keys(headers).filter(
      (k) => k.toLowerCase() === PUBLIC_TUNNEL_HEADER
    );
    for (const k of inboundStamp) delete headers[k];

    headers[PUBLIC_TUNNEL_HEADER] = this.secret;
    headers["host"] = clientReq.headers.host || `127.0.0.1:${this.targetPort}`;

    // Preserve original client address for logs/rate-limiting (best effort;
    // the SSH tunnel itself collapses it to 127.0.0.1).
    const existingXff = clientReq.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = existingXff
      ? `${existingXff}, 127.0.0.1`
      : "127.0.0.1";

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: this.targetPort,
        method: clientReq.method,
        path: clientReq.url,
        headers,
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      }
    );

    upstream.on("error", (err) => {
      logger.warn(`TunnelProxy upstream error: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify({ error: "Bad Gateway" }));
      } else {
        clientRes.end();
      }
    });

    // If the client goes away (browser closed a stream), abort upstream.
    clientReq.on("aborted", () => upstream.destroy());
    clientRes.on("close", () => upstream.destroy());

    clientReq.pipe(upstream);
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // Ignore
      }
      this.server = null;
    }
  }
}
