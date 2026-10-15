import type { ResearchLibrary, ResearchDocument, LibraryDocument } from './research-types';
export function checkedBytes(root: string, relative: string, expected: string, max?: number): Promise<Buffer>;
export function readLibrary(root?: string): Promise<ResearchLibrary>;
export function publicDocument(doc: LibraryDocument): ResearchDocument;
