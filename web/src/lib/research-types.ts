export interface ResearchFile { id: string; label: string; mime: string; href: string }
export interface ResearchDocument { id: string; title: string; date: string | null; topic: string; kind: string; description: string; url: string; reviewedAt: string; pageCount: number; ocrPages: number; files: ResearchFile[] }
export interface ResearchChunk { id: string; documentId: string; title: string; date: string | null; kind: string; page: number | null; method: string; text: string; input: string; inputHash: string; score?: number }
export interface LibraryDocument extends Omit<ResearchDocument, 'files'> { aliases: string[]; pagesPath: string; pagesSha256: string; files: (Omit<ResearchFile,'href'> & { localPath: string; sha256: string })[]; pages: { page: number | null; text: string; method: string }[] }
export interface ResearchLibrary { root: string; documents: LibraryDocument[]; chunks: ResearchChunk[]; corpusDigest: string; policyDigest: string }
export interface Story { headline: string; paragraphs: { heading: string; text: string; citations: { chunkId: string; quote: string }[] }[]; limitation: string }
export interface StorySource { id: string; documentId: string; title: string; url: string; libraryUrl: string; fileUrl?: string; page: number | null; date: string | null; kind: string; method: string }
export interface ResearchAnswer extends Story { sources: StorySource[]; mode: 'generated' | 'excerpts'; retrieval: { mode: string; reason: string } }
