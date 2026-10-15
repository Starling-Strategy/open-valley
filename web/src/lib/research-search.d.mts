import type { ResearchLibrary, ResearchChunk } from './research-types';
export function searchLibrary(question: string, library: ResearchLibrary, options?: { limit?: number; semantic?: boolean }): Promise<{ chunks: ResearchChunk[]; mode: string; reason: string }>;
