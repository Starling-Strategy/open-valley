import { digest } from './evidence-core.mjs';
import { CHUNK_VERSION, validateVectors } from './research-core.mjs';

export const EMBEDDING = Object.freeze({ model: 'baai/bge-m3', dimensions: 1024,
  endpoint: 'https://openrouter.ai/api/v1/embeddings', encoding_format: 'float',
  provider: { allow_fallbacks: false, data_collection: 'deny' },
  chunkVersion: CHUNK_VERSION, template: 'title-date-kind-description-page-v1' });

export function embeddingProfile(returnedModel) {
  const configuration = { ...EMBEDDING, returnedModel };
  return { id: digest(JSON.stringify(configuration)), configuration };
}

export async function embed(inputs, { key = process.env.OPENVALLEY_CHAT_API_KEY, fetcher = fetch } = {}) {
  if (!key || !inputs.length || inputs.length > 24 || inputs.some(t => typeof t !== 'string' || !t.trim() || Buffer.byteLength(t) > 7800)) throw new Error('Invalid embedding input');
  const response = await fetcher(EMBEDDING.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING.model, input: inputs, encoding_format: 'float', provider: EMBEDDING.provider }) });
  if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`);
  const body = await response.json();
  const vectors = validateVectors(body, inputs.length, EMBEDDING.dimensions);
  // OpenRouter may return an adapter alias. The observed identity is part of the
  // immutable profile; a changed alias requires a rebuild, never mixed vectors.
  const profile = embeddingProfile(body.model);
  return { vectors, profile };
}
