interface Policy { schema_version?: number; source_ids: string[]; paths: string[]; sha256: string[] }
interface CatalogRow { source_id: string; files: { local_path: string; sha256: string }[] }
export function canonicalId(value: unknown): string;
export function digest(bytes: string | Uint8Array): string;
export function validateRules(rules: unknown): Policy;
export function exclusionClosure(catalog: CatalogRow[], policy: Policy): Set<string>;
export function officialUrl(value: string): boolean;
export function filterMeetings(meetings: unknown[], catalog: CatalogRow[], rules: Policy): { id: string; date: string; body: string; status: string; links: { kind: string; url: string; sourceId: string }[] }[];
export function retrievePassages<T extends { id: string; title: string; text: string }>(question: string, sources: T[]): (T & { score: number })[];
export function validateAnswer(answer: unknown, allowedIds: string[]): { paragraphs: { text: string; sourceIds: string[] }[]; limitation: string };
