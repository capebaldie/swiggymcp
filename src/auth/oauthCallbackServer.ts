import http from "node:http";
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.js";

export interface AuthCallbackEvent {
  code: string;
  state: string;
}

export class OAuthCallbackServer extends EventEmitter {
  private server: http.Server;
  private port: number;

  constructor(port: number) {
    super();
    this.port = port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.port, () => {
        logger.info(`OAuth callback server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (url.pathname === "/callback") {
      this.handleCallback(url, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }

  private handleCallback(url: URL, res: http.ServerResponse): void {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>Missing code or state parameter</h1>");
      return;
    }

    logger.info("Received OAuth callback", { state: state.substring(0, 8) + "..." });

    this.emit("authCallback", { code, state } as AuthCallbackEvent);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Swiggy MCP Bot - Authentication</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 50px;">
  <h1>Authentication Successful!</h1>
  <p>You can close this tab and return to Telegram.</p>
</body>
</html>`);
  }
}
