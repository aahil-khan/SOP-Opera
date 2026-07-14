-- SOP Opera schema (TDS §9). Applied on startup/reset.
-- Requires PostgreSQL with pgvector.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Master / fixture tables
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    zone TEXT NOT NULL,
    plant_id TEXT NOT NULL DEFAULT 'plant-1'
);

CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
    department_id UUID REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS permits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id),
    worker_ids UUID[] NOT NULL DEFAULT '{}',
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    work_type TEXT
);

CREATE TABLE IF NOT EXISTS review_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES assets(id),
    description TEXT NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL,
    linked_review_ids UUID[] NOT NULL DEFAULT '{}',
    applies_to_category TEXT
);

CREATE TABLE IF NOT EXISTS regulations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    body_summary TEXT NOT NULL,
    applies_to_category TEXT
);

CREATE TABLE IF NOT EXISTS sops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    body_summary TEXT NOT NULL,
    applies_to_category TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type TEXT NOT NULL, -- regulations | historical_incidents | sops
    source_id UUID NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector(1536),
    applies_to_category TEXT,
    token_count INT
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    role TEXT NOT NULL
);

-- Transactional
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id),
    state TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id),
    triggered_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS review_participants (
    review_id UUID NOT NULL REFERENCES reviews(id),
    worker_id UUID NOT NULL REFERENCES workers(id),
    role TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (review_id, worker_id)
);

CREATE TABLE IF NOT EXISTS context_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id),
    category TEXT NOT NULL,
    payload JSONB NOT NULL,
    provider TEXT NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS derived_facts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id),
    fact_type TEXT NOT NULL,
    value JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_context_ids UUID[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID NOT NULL REFERENCES reviews(id),
    assessment_type TEXT NOT NULL, -- ai | manual
    status TEXT NOT NULL,
    risk_level TEXT,
    summary TEXT,
    derived_fact_ids UUID[] NOT NULL DEFAULT '{}',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_metadata (
    assessment_id UUID PRIMARY KEY REFERENCES assessments(id),
    provider TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT,
    tokens_in INT,
    tokens_out INT,
    cost_usd REAL,
    latency_ms INT,
    confidence REAL,
    retrieved_context_ids UUID[] NOT NULL DEFAULT '{}',
    retrieved_evidence_ids UUID[] NOT NULL DEFAULT '{}',
    retrieved_references JSONB NOT NULL DEFAULT '[]'::jsonb,
    retrieval_mode TEXT,
    retrieval_quality TEXT,
    retrieval_score REAL,
    embedding_model TEXT
);

CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID NOT NULL REFERENCES assessments(id),
    text TEXT NOT NULL,
    rationale TEXT NOT NULL,
    disposition TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID NOT NULL REFERENCES reviews(id),
    assessment_id UUID NOT NULL REFERENCES assessments(id),
    decided_by UUID NOT NULL REFERENCES users(id),
    outcome TEXT NOT NULL,
    conditions TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID NOT NULL REFERENCES reviews(id),
    decision_id UUID NOT NULL REFERENCES decisions(id),
    frozen_context_ids UUID[] NOT NULL DEFAULT '{}',
    frozen_assessment_id UUID NOT NULL REFERENCES assessments(id),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID NOT NULL REFERENCES reviews(id),
    closure_event_seq INT NOT NULL,
    content JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID REFERENCES reviews(id),
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    recipient_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_entries_asset ON context_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_derived_facts_asset ON derived_facts(asset_id);
CREATE INDEX IF NOT EXISTS idx_reviews_state ON reviews(state);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_assessments_review ON assessments(review_id);

-- Soft migrations for DBs created before Phase 3/4 column additions
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS applies_to_category TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS retrieved_context_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS retrieved_references JSONB NOT NULL DEFAULT '[]'::jsonb;
