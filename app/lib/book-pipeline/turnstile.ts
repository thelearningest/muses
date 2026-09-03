const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  responseToken: string,
  secret: string,
  remoteIp: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<boolean> {
  if (!responseToken || !secret || !remoteIp) return false;
  const body = new URLSearchParams({
    secret,
    response: responseToken,
    remoteip: remoteIp,
  });
  const response = await fetcher(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}
