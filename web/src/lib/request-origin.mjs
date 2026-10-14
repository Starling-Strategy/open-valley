/** Explicit public/tunnel addresses; never trust a caller's forwarding headers. */
export function isAllowedRequestOrigin(request, primary = process.env.OPENVALLEY_PREVIEW_ORIGIN, additional = process.env.OPENVALLEY_PREVIEW_ORIGINS || '') {
  const origin=request.headers.get('origin');
  if(origin===null)return true; // Non-browser clients, as before.
  try {
    const parsed=new URL(origin);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)return false;
  } catch { return false; }
  const allowed=[new URL(request.url).origin,primary,...additional.split(',').map(value=>value.trim())];
  return allowed.includes(origin);
}
