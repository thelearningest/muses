// Read-only inspection of this project's local Miniflare storage. No provider
// calls, browser automation, remote storage, capabilities, or credentials.
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

const jobId = process.argv[2];
if (!jobId || !/^[a-zA-Z0-9-]{1,128}$/.test(jobId)) throw new Error("Supply a local test job ID");
const root = path.resolve(".wrangler/state/v3/r2");
const output = path.resolve("outputs/full-book-local", jobId);
const prefix = `book-jobs/${jobId}/`;
let count = 0;
for (const name of (await readdir(path.join(root, "miniflare-R2BucketObject"))).filter((n) => /^[a-f0-9]+\.sqlite$/.test(n))) {
  const db = new DatabaseSync(path.join(root, "miniflare-R2BucketObject", name), { readOnly: true });
  try {
    const objects = db.prepare("SELECT key, blob_id, size FROM _mf_objects WHERE key LIKE ?").all(`${prefix}%`);
    for (const object of objects) {
      const relative = object.key.slice(prefix.length);
      if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..") || !/^[a-f0-9]+$/.test(object.blob_id) || !relative.endsWith(".json")) continue;
      const source = path.join(root, "site-creator-r2/blobs", object.blob_id);
      const target = path.join(output, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target); count++;
      if (relative.startsWith("extraction/assets/") && process.argv.includes("--images")) {
        const asset = JSON.parse(await readFile(source, "utf8"));
        for (let i = 0; i < asset.images.length; i++) {
          if (asset.images[i].imageUrl.startsWith("data:image/png;base64,")) await writeFile(`${target}-${i}.png`, Buffer.from(asset.images[i].imageUrl.slice(22), "base64"));
        }
      }
      if (relative === "extraction/state.json") {
        const state = JSON.parse(await readFile(source, "utf8"));
        console.log(JSON.stringify({ pages: `${state.cursor}/${state.pageCount}`, revision: state.revision, failure: state.failure, usage: state.usage }));
      }
    }
  } finally { db.close(); }
}
console.log(JSON.stringify({ savedJsonArtifacts: count, output }));
