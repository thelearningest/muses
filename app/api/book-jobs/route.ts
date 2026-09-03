import { createRuntimeBookJobApi } from "@/app/lib/book-pipeline/http";

export async function POST(request: Request) {
  return (await createRuntimeBookJobApi()).create(request);
}
