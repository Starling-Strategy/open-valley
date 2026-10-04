import { readSchoolsPublication } from "@/lib/schools.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const publication = await readSchoolsPublication();
  return Response.json(publication ?? { status: "unavailable" }, {
    status: publication ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
