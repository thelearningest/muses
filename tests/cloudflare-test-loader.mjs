// The HTML smoke test runs in Node, which cannot import Workers' runtime module.
// Only public page configuration is supplied here; API bindings are tested elsewhere.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: "data:text/javascript,export const env = {};", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
