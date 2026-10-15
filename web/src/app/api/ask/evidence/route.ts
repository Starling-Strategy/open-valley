import { readLibrary } from '@/lib/research-read.mjs';
import { readSchoolsPublication } from '@/lib/schools.server';
import { evidenceVersion } from '@/lib/research-context';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET() {
  try {
    const library=await readLibrary();
    const publication=await readSchoolsPublication();
    return Response.json({evidenceVersion:evidenceVersion(library,publication?.releaseId)},{headers});
  } catch {
    return Response.json({error:'Evidence could not be rechecked.'},{status:503,headers});
  }
}
