export async function POST() {
  return Response.json(
    {
      error: {
        code: "job_api_required",
        message: "Direct whole-PDF generation has been retired. Create a resumable job at /api/book-jobs.",
      },
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
