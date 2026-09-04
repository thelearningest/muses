import { describe, expect, it } from "vitest";
import { localNetworkSignal } from "../../build/local-network-signal";

describe("development network signal", () => {
  it("overwrites spoofed headers with the loopback socket address, including raw headers", () => {
    let middleware: (req: { socket: { remoteAddress: string }; headers: Record<string, string>; rawHeaders: string[] }, res: unknown, next: () => void) => void;
    const plugin = localNetworkSignal();
    expect(plugin.apply).toBe("serve");
    const configure = plugin.configureServer as (server: unknown) => void;
    configure({ middlewares: { use: (fn: typeof middleware) => { middleware = fn; } } });
    const request = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-book-local-network": "forged" }, rawHeaders: ["x-book-local-network", "forged", "host", "localhost"] };
    middleware!(request, {}, () => undefined);
    expect(request.headers["x-book-local-network"]).toBe("127.0.0.1");
    expect(request.rawHeaders).toEqual(["host", "localhost", "x-book-local-network", "127.0.0.1"]);
    request.socket.remoteAddress = "192.0.2.1";
    middleware!(request, {}, () => undefined);
    expect(request.headers["x-book-local-network"]).toBeUndefined();
    expect(request.rawHeaders).toEqual(["host", "localhost"]);
  });
});
