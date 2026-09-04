import { createVisualPageRenderer } from "../../../app/visual-page-renderer";

const button = document.querySelector<HTMLButtonElement>("#render")!;
const status = document.querySelector<HTMLPreElement>("#status")!;
button.addEventListener("click", async () => {
  button.disabled = true;
  let renderer: Awaited<ReturnType<typeof createVisualPageRenderer>> | undefined;
  try {
    status.textContent = "Loading the supplied local PDF…";
    const response = await fetch("/__source.pdf");
    if (!response.ok) throw new Error("Source unavailable");
    renderer = await createVisualPageRenderer(new File([await response.blob()], "691f9193faa81670cd1a6f07d497bf8d.pdf", { type: "application/pdf" }));
    for (const pageIndex of [5, 11, 31]) for (const revision of [0, 1, 2]) {
      status.textContent = `Rendering page ${pageIndex + 1}, revision ${revision}…`;
      const packet = await renderer.prepareExtraction({ pageIndex, revision, parts: 2 ** revision, allowNative: revision === 0 }, renderer.fingerprint);
      const saved = await fetch("/__asset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(packet) });
      if (!saved.ok) throw new Error(`Asset save rejected: ${saved.status}`);
    }
    status.textContent = "Complete: 9 browser-rendered packets saved locally. Every image respects the production upload limits. No model calls made.";
  } catch (error) { status.textContent = String(error); }
  finally { await renderer?.destroy(); button.disabled = false; }
});
