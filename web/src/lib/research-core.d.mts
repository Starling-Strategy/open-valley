import type { ResearchChunk, LibraryDocument, Story } from './research-types';
export function normalizeQuote(text: string): string;
export function terms(text: string): string[];
export function chunkDocument(doc: Pick<LibraryDocument,'id'|'title'|'date'|'kind'|'description'>, pages: LibraryDocument['pages']): ResearchChunk[];
export function lexicalSearch(question: string, chunks: ResearchChunk[], limit?: number): ResearchChunk[];
export function fuseRanks(lists: ResearchChunk[][], limit?: number, perDocument?: number): ResearchChunk[];
export function validateStory(value: unknown, chunks: ResearchChunk[]): Story;
export function validateVectors(value: unknown, count: number, dimensions: number): number[][];
export interface QuoteSpan { id: string; chunkId: string; quote: string }
export function quoteSpans(chunks: ResearchChunk[]): QuoteSpan[];
export function resolveStoryQuotes(value: unknown, spans: QuoteSpan[], chunks: ResearchChunk[]): Story;
