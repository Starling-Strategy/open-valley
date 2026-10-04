import "server-only";
import type { SchoolsPayload } from "./schools";
import { readSchoolsPublication as readPublication } from "./schools-read.mjs";

export async function readSchoolsPublication(): Promise<{
  releaseId: string;
  payload: SchoolsPayload;
} | null> {
  return readPublication();
}
