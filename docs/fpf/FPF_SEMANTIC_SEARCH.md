# FPF Semantic Search Implementation

This document describes the semantic search implementation for Front Porch Forum (FPF) posts in the Open Valley project.

## Overview

We've implemented vector similarity search over 58,174 community posts from the Mad River Valley Front Porch Forum, enabling natural language queries like "lost dog", "firewood for sale", or "road construction warning".

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Query Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Query ──► Pydantic AI Embedder ──► OpenAI Gateway         │
│       │                                        │                 │
│       │                                        ▼                 │
│       │                              text-embedding-3-large      │
│       │                                   (3072 dims)            │
│       │                                        │                 │
│       ▼                                        ▼                 │
│  search_fpf_posts() ◄──────────────── Query Embedding           │
│       │                                                          │
│       ▼                                                          │
│  PostgreSQL + pgvector                                          │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ SELECT * FROM fpf_posts                                 │     │
│  │ ORDER BY embedding <=> query_embedding                  │     │
│  │ LIMIT 10                                                │     │
│  └────────────────────────────────────────────────────────┘     │
│       │                                                          │
│       ▼                                                          │
│  Ranked Results (by cosine similarity)                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Details |
|-----------|------------|---------|
| **Embedding Model** | OpenAI `text-embedding-3-large` | 3072 dimensions, highest quality |
| **Embedding API** | Pydantic AI `Embedder` | Via Gateway for unified billing |
| **Vector Database** | PostgreSQL + pgvector 0.7.4 | Cosine similarity search |
| **Agent Framework** | Pydantic AI | Tool-based agent with typed outputs |
| **Gateway** | Pydantic AI Gateway | Routes to OpenAI with cost tracking |

## Data Statistics

| Metric | Value |
|--------|-------|
| Total Posts | 58,174 |
| Unique Authors | 6,438 |
| Daily Digests | 3,298 |
| Embedding Dimensions | 3,072 |
| Vector Column Size | ~700MB |
| Towns Covered | Warren, Waitsfield, Fayston, Moretown, Duxbury, Granville |

## Database Schema

### fpf_posts table (with embeddings)

```sql
CREATE TABLE fpf_posts (
    id UUID PRIMARY KEY,
    issue_id UUID REFERENCES fpf_issues(id),
    person_id UUID REFERENCES fpf_people(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50),
    is_reply BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMP NOT NULL,

    -- Embedding columns
    embedding VECTOR(3072),           -- OpenAI text-embedding-3-large
    embedding_model VARCHAR(50),       -- 'gateway/openai:text-embedding-3-large'
    embedded_at TIMESTAMP
);

-- Category index for filtering
CREATE INDEX idx_fpf_posts_category ON fpf_posts(category);
```

### Note on Indexing

pgvector 0.7.4 limits HNSW and IVFFlat indexes to 2000 dimensions. With `text-embedding-3-large` (3072 dims), we use sequential scan for similarity search. This is still fast for ~60k posts (typically <100ms).

For larger datasets, consider:
- Using `text-embedding-3-small` (1536 dims) with HNSW indexing
- Upgrading to pgvector 0.8+ when available (higher dimension support)

## Agent Tool

### search_fpf_posts

```python
@warren_agent.tool
async def search_fpf_posts(
    ctx: RunContext[WarrenContext],
    query: str,
    limit: int = 10,
    category: str | None = None,
    town: str | None = None,
) -> FPFSearchResult:
    """Search Front Porch Forum posts using semantic similarity.

    Args:
        query: Natural language search (e.g., "lost dog", "firewood for sale")
        limit: Max results (default 10, max 50)
        category: Filter by category ("Announcements", "For sale", etc.)
        town: Filter by author's town ("Warren", "Waitsfield", etc.)
    """
```

### Response Model

```python
class FPFPostSummary(BaseModel):
    id: str
    title: str
    content_preview: str      # First 200 chars
    author: str | None
    town: str | None
    category: str | None
    published_at: str         # ISO format
    similarity_score: float   # 0-1, higher is more relevant

class FPFSearchResult(BaseModel):
    query: str
    results: list[FPFPostSummary]
    total_matches: int
```

## Example Queries & Results

### "lost dog"
```
[0.824] Seeking Lost Dog - Jake Durand (Moretown)
[0.822] Lost Dog - David Bondi (Waitsfield)
[0.818] Lost Dog - Andrea Rowlee
```

### "firewood for sale"
```
[0.865] Firewood
[0.862] Firewood for Sale (For sale)
```

### "road construction warning"
```
[0.739] Large Sharp Crushed Stone on Town Roads in Warren?
[0.732] Warren Road Repairs - Expect Delays
```

### "school budget meeting"
```
[0.798] Re: Next School Budget Vote on May 30
[0.773] Support the Budget
```

## Pipeline Scripts

### Full Pipeline

```bash
cd api

# Run complete pipeline (fetch → parse → embed)
uv run python scripts/run_fpf_pipeline.py

# Skip fetch (use existing emails)
uv run python scripts/run_fpf_pipeline.py --skip-fetch

# Only generate embeddings
uv run python scripts/run_fpf_pipeline.py --embed-only
```

### Individual Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `fetch_fpf_emails.py` | Download from Gmail | `uv run python scripts/fetch_fpf_emails.py` |
| `parse_fpf_emails.py` | Parse HTML → Database | `uv run python scripts/parse_fpf_emails.py` |
| `embed_fpf_posts.py` | Generate embeddings | `uv run python scripts/embed_fpf_posts.py` |

### Embedding Script Options

```bash
# Test with limited posts
uv run python scripts/embed_fpf_posts.py --limit 100

# Re-embed all posts (if model changes)
uv run python scripts/embed_fpf_posts.py --force
```

## Configuration

### Environment Variables

```bash
# api/.env
DATABASE_URL=postgresql://openvalley:openvalley@localhost:5432/openvalley
PYDANTIC_AI_GATEWAY_API_KEY=<your-gateway-key>  # Required for embeddings
LOGFIRE_TOKEN=<optional>                         # For observability
```

### Embedding Model

Configured in `src/agent.py` and `scripts/embed_fpf_posts.py`:

```python
EMBEDDING_MODEL = "gateway/openai:text-embedding-3-large"
fpf_embedder = Embedder("gateway/openai:text-embedding-3-large")
```

## Cost Estimation

| Model | Dimensions | Price per 1M tokens | Est. Cost for 58k posts |
|-------|------------|---------------------|-------------------------|
| text-embedding-3-small | 1536 | $0.02 | ~$0.23 |
| text-embedding-3-large | 3072 | $0.13 | ~$1.50 |

We chose `text-embedding-3-large` for maximum quality semantic search.

## Verification Queries

```sql
-- Check embedding progress
SELECT
    COUNT(*) as total,
    COUNT(embedding) as embedded,
    COUNT(DISTINCT embedding_model) as models
FROM fpf_posts;

-- Sample embedded posts
SELECT title, embedding_model, embedded_at
FROM fpf_posts
WHERE embedding IS NOT NULL
LIMIT 5;

-- Check vector dimensions
SELECT
    title,
    vector_dims(embedding) as dims
FROM fpf_posts
WHERE embedding IS NOT NULL
LIMIT 1;
```

## Files Modified/Created

| File | Changes |
|------|---------|
| `pyproject.toml` | Added `pgvector>=0.3.0` |
| `src/database.py` | Added pgvector extension init |
| `src/models.py` | Added embedding columns to FPFPost |
| `src/agent.py` | Added `search_fpf_posts` tool + embedder |
| `scripts/embed_fpf_posts.py` | **NEW** - Embedding generation |
| `scripts/run_fpf_pipeline.py` | **NEW** - Pipeline orchestration |
| `CLAUDE.md` | Updated with pipeline docs |
| `Dockerfile.db` | Updated for pgvector support |

## Future Improvements

1. **Hybrid Search**: Combine semantic + keyword search for better precision
2. **Dimension Reduction**: Use OpenAI's dimension parameter for indexable embeddings
3. **Category Embeddings**: Pre-compute category centroids for faster filtering
4. **Caching**: Cache frequent query embeddings to reduce API calls
5. **Incremental Updates**: Embed new posts as they arrive (webhook/cron)

## References

- [Pydantic AI Embeddings](https://ai.pydantic.dev/embeddings/)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Pydantic AI Gateway](https://pydantic.dev/ai-gateway)
