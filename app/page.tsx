import { BookRpgApp } from "./BookRpgApp";
import { getBookPipelineRuntimeEnv } from "./lib/book-pipeline/runtime-env";

export default async function Home() {
  const env = await getBookPipelineRuntimeEnv();
  // The site key is public; the verification secret never enters client props.
  const siteKey = typeof env.NEXT_PUBLIC_TURNSTILE_SITE_KEY === "string" ? env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : "";
  return <BookRpgApp turnstileSiteKey={siteKey} />;
}
