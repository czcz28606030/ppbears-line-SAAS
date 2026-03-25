-- Vector similarity search function for knowledge base RAG
-- Run this in Supabase SQL editor

CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int,
  p_tenant_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  document_id uuid,
  chunk_index integer,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.content,
    kc.document_id,
    kc.chunk_index,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.tenant_id = p_tenant_id
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
