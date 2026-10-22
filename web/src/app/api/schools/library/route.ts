import { readSchoolsPublication } from "@/lib/schools.server";
import { buildLibraryCatalog, parseLibraryQuery, payloadReferences, queryLibrary } from "@/lib/schools-library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

/** Full-library browsing for /schools, read from the active publication on every request. */
export async function GET(request: Request) {
  const parsed = parseLibraryQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return Response.json({ status: "invalid", error: parsed.error }, { status: 400, headers });
  const publication = await readSchoolsPublication();
  if (!publication) return Response.json({ status: "unavailable" }, { status: 503, headers });
  const { payload, releaseId } = publication;
  const result = queryLibrary(buildLibraryCatalog(payload.sources, payloadReferences(payload)), parsed.query);
  if (!result) return Response.json({ status: "not_found", release_id: releaseId }, { status: 404, headers });
  return Response.json({ release_id: releaseId, ...result }, { headers });
}
