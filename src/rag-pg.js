// rag-pg.js
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { Document } from "@langchain/core/documents";

dotenv.config();

// --- DB client for raw SQL (init / count)
function neonClient() {
  const sql = neon(process.env.DATABASE_URL);
  return {
    async query(text, params) {
      const rows = await sql(text, params);
      return { rows };
    },
    sql,
  };
}

// Connect to Neon (low-level sql client)
const sql = neon(process.env.DATABASE_URL);

// Embeddings (free from HuggingFace Inference API)
const embeddings = new HuggingFaceInferenceEmbeddings({
  model: "sentence-transformers/all-MiniLM-L6-v2", // 384-dim embeddings
  apiKey: process.env.HUGGINGFACE_API_KEY,
});

let store;

/** Create extension/table/index if missing (idempotent) */
export async function initSchema() {
  const { sql } = neonClient();

  // Ensure required extensions
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`; // for gen_random_uuid

  // Create table if missing
  await sql`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      embedding VECTOR(384) NOT NULL
    )
  `;

  // Create IVFFlat index if missing
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rag_documents_embedding'
      ) THEN
        EXECUTE 'CREATE INDEX idx_rag_documents_embedding
                 ON rag_documents
                 USING ivfflat (embedding vector_cosine_ops)
                 WITH (lists = 100)';
      END IF;
    END $$;
  `;
}

/** Initialize LangChain PGVector store */
export async function initRagStore() {
  if (store) return store;

  store = await PGVectorStore.initialize(embeddings, {
    postgresConnectionOptions: { client: neonClient() },
    tableName: "rag_documents",
    columns: {
      idColumnName: "id",
      vectorColumnName: "embedding",
      contentColumnName: "content",
      metadataColumnName: "metadata",
    },
  });

  return store;
}

/** Insert documents (array of { content, metadata }) */
export async function upsertRagDocuments(docs) {
  const vs = await initRagStore();
  const docsLC = docs.map(
    (d) =>
      new Document({
        pageContent: d.content,
        metadata: d.metadata ?? {},
      })
  );
  await vs.addDocuments(docsLC);
}

/** Count rows */
export async function countDocuments() {
  const { rows } = await neonClient().query(
    "SELECT COUNT(*)::int AS count FROM rag_documents",
    []
  );
  return rows[0].count;
}

/** First-stage retrieval from pgvector (k candidates) */
export async function retrieveCandidates(query, k = 20) {
  const vs = await initRagStore();
  const docs = await vs.similaritySearch(query, k);
  return docs;
}

/** Local semantic re-ranking (cosine similarity on candidates) */
export async function rerank(query, candidates, topK = 5) {
  if (!candidates.length) return [];

  const qVec = await embeddings.embedQuery(query);
  const docsVecs = await embeddings.embedDocuments(
    candidates.map((d) => d.pageContent)
  );

  const cosine = (a, b) => {
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb) || 1e-9;
    return dot / denom;
  };

  const scored = candidates.map((d, i) => ({
    content: d.pageContent,
    metadata: d.metadata,
    score: cosine(qVec, docsVecs[i]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
