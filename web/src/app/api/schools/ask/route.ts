import { clientAddress, TokenBucketLimiter } from "@/lib/rate-limit";
import { isAskResponse, validateAskRequest } from "@/lib/schools-ask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };
const TIMEOUT_MS = 45_000;
const limiter = new TokenBucketLimiter({ burst: 5, perMinute: 10 });

/** Thin proxy to services/schools-assistant. Only the validated messages and client address cross; never cookies or other client headers. */
export async function POST(request: Request) {
  const address = clientAddress(request.headers);
  const retryAfter = limiter.take(address);
  if (retryAfter) {
    return Response.json({ status: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ status: "invalid", error: "Invalid JSON" }, { status: 400, headers }); }
  const validation = validateAskRequest(body);
  if (!validation.ok) return Response.json({ status: "invalid", error: validation.error }, { status: 400, headers });
  const unavailable = () => Response.json({ status: "unavailable" }, { status: 503, headers });
  const service = process.env.SCHOOLS_ASSISTANT_URL;
  if (!service) return unavailable();
  try {
    const upstream = await fetch(new URL("v1/ask", service.endsWith("/") ? service : `${service}/`), {
      method: "POST",
      // The service rate-limits per visitor. Only this derived address crosses, never the client's headers.
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(address === "unknown" ? {} : { "X-Forwarded-For": address }) },
      body: JSON.stringify({ messages: validation.messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    if (upstream.status === 429) return Response.json({ status: "rate_limited" }, { status: 429, headers });
    if (upstream.status === 400 || upstream.status === 422) return Response.json({ status: "invalid" }, { status: 400, headers });
    if (!upstream.ok) return unavailable();
    const data: unknown = await upstream.json();
    return isAskResponse(data) ? Response.json(data, { headers }) : unavailable();
  } catch {
    return unavailable();
  }
}
