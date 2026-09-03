import { createRuntimeBookJobApi } from "@/app/lib/book-pipeline/http";

type Context = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Context) {
  const { jobId } = await context.params;
  return (await createRuntimeBookJobApi()).status(jobId, request);
}

export async function DELETE(request: Request, context: Context) {
  const { jobId } = await context.params;
  return (await createRuntimeBookJobApi()).cancel(jobId, request);
}
