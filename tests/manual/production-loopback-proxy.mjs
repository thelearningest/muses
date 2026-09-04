// Local test ingress only. Cloudflare supplies this header on hosted requests;
// wrangler's local production runner does not. Never import into the app.
import http from "node:http";

const server = http.createServer((request, response) => {
  if (request.headers.host !== "localhost:3003") { response.writeHead(403).end(); return; }
  const upstream = http.request({ hostname: "localhost", port: 3005, path: request.url,
    method: request.method, headers: { ...request.headers, "cf-connecting-ip": "127.0.0.1" } }, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Local production runner unavailable"); });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
});
server.listen(3003, "localhost", () => console.log("Local production test ingress: http://localhost:3003 -> localhost:3005"));
