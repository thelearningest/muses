import { createRuntimeBookJobApi } from "@/app/lib/book-pipeline/http";

type Context = { params: Promise<{ jobId: string }> };

export async function PUT(request: Request, context: Context) {
  const { jobId } = await context.params;
  return (await createRuntimeBookJobApi()).upload(jobId, request);
}

export async function GET(request: Request, context: Context) {
  const { jobId } = await context.params;
  return (await createRuntimeBookJobApi()).source(jobId, request);
}
