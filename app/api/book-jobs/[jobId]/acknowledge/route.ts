import { createRuntimeBookJobApi } from "@/app/lib/book-pipeline/http";

type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Context) {
  const { jobId } = await context.params;
  return (await createRuntimeBookJobApi()).acknowledge(jobId, request);
}
