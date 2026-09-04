import type { Plugin } from "vite";

/** Cloudflare supplies this header in production. A loopback-only dev server
 * derives it from the socket, never from a client-provided forwarding header. */
export function localNetworkSignal(): Plugin {
  return { name: "local-network-signal", apply: "serve", enforce: "pre", configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const address = request.socket.remoteAddress;
      delete request.headers["x-book-local-network"];
      for (let i = request.rawHeaders.length - 2; i >= 0; i -= 2) {
        if (request.rawHeaders[i].toLowerCase() === "x-book-local-network") request.rawHeaders.splice(i, 2);
      }
      // Miniflare intentionally strips cf-connecting-ip during local dispatch.
      if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") {
        request.headers["x-book-local-network"] = address;
        request.rawHeaders.push("x-book-local-network", address);
      }
      next();
    });
  } };
}
