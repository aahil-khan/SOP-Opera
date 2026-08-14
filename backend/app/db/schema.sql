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
    plant_id TEXT NOT NULL DEFAULT 'plant-1',
    floor TEXT NOT NULL DEFAULT 'ground'
);

CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
    department_id UUID REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS zone_owners (
    zone TEXT PRIMARY KEY,
    worker_id UUID NOT NULL REFERENCES workers(id),
    role TEXT NOT NULL DEFAULT 'Area Supervisor'
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
    origin TEXT NOT NULL DEFAULT 'system',
    raised_by_worker_id UUID REFERENCES workers(id),
    tagged_worker_ids UUID[] NOT NULL DEFAULT '{}',
    report_description TEXT,
    report_concern_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

-- Dead table removed: tagging uses reviews.tagged_worker_ids.
DROP TABLE IF EXISTS review_participants;

-- HITL backlog items created by decisions (and optionally supervisor actions).
CREATE TABLE IF NOT EXISTS review_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID NOT NULL REFERENCES reviews(id),
    decision_id UUID REFERENCES decisions(id),
    assigned_worker_id UUID NOT NULL REFERENCES workers(id),
    task_type TEXT NOT NULL DEFAULT 'follow_up', -- follow_up | unblock
    title TEXT NOT NULL,
    detail TEXT,
    status TEXT NOT NULL DEFAULT 'open', -- open | acknowledged | done | cancelled
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    done_at TIMESTAMPTZ,
    done_note TEXT
);

-- Chronological discussion thread per review.
CREATE TABLE IF NOT EXISTS review_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID NOT NULL REFERENCES reviews(id),
    author_kind TEXT NOT NULL, -- user | worker
    author_id UUID NOT NULL,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    mentioned_worker_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Soft ambient telemetry ring (WS samples). Not context_entries — does not
-- trigger derived facts or reviews. Kept for chart hydration on app open.
CREATE TABLE IF NOT EXISTS telemetry_samples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id),
    asset_name TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    payload JSONB NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    mode TEXT NOT NULL DEFAULT 'ambient'
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
    embedding_model TEXT,
    failure_reason TEXT,  -- validation | provider_error | NULL on success
    reasoning_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_trace JSONB NOT NULL DEFAULT '[]'::jsonb
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
    comments TEXT,
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

-- Append-only AI pipeline metrics — survives demo reset (no FK to reviews/assessments).
CREATE TABLE IF NOT EXISTS ai_ops_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID NOT NULL UNIQUE,
    review_id UUID,
    status TEXT NOT NULL, -- complete | failed
    provider TEXT NOT NULL,
    model TEXT,
    tokens_in INT,
    tokens_out INT,
    cost_usd REAL,
    latency_ms INT,
    retrieval_mode TEXT,
    retrieval_score REAL,
    failure_reason TEXT,
    llm_attempt_count INT NOT NULL DEFAULT 0,
    llm_fallback_count INT NOT NULL DEFAULT 0,
    degraded BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_entries_asset ON context_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_samples_asset_ts ON telemetry_samples(asset_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_derived_facts_asset ON derived_facts(asset_id);
CREATE INDEX IF NOT EXISTS idx_reviews_state ON reviews(state);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_assessments_review ON assessments(review_id);
CREATE INDEX IF NOT EXISTS idx_ai_ops_events_recorded ON ai_ops_events(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_tasks_assignee_status ON review_tasks(assigned_worker_id, status);
CREATE INDEX IF NOT EXISTS idx_review_comments_review ON review_comments(review_id, created_at DESC);

-- Backfill historical AI runs into the append-only log (idempotent).
INSERT INTO ai_ops_events (
    assessment_id, review_id, status, provider, model,
    tokens_in, tokens_out, cost_usd, latency_ms,
    retrieval_mode, retrieval_score, failure_reason, recorded_at
)
SELECT
    a.id, a.review_id, a.status, m.provider, m.model,
    m.tokens_in, m.tokens_out, m.cost_usd, m.latency_ms,
    m.retrieval_mode, m.retrieval_score, m.failure_reason,
    COALESCE(a.created_at, now())
FROM assessments a
JOIN assessment_metadata m ON m.assessment_id = a.id
WHERE a.assessment_type = 'ai'
  AND a.status IN ('complete', 'failed')
ON CONFLICT (assessment_id) DO NOTHING;

-- Soft migrations for DBs created before Phase 3/4/7 column additions
ALTER TABLE assets ADD COLUMN IF NOT EXISTS floor TEXT NOT NULL DEFAULT 'ground';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS applies_to_category TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS retrieved_context_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS retrieved_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS reasoning_factors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assessment_metadata ADD COLUMN IF NOT EXISTS agent_trace JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_ops_events ADD COLUMN IF NOT EXISTS llm_attempt_count INT NOT NULL DEFAULT 0;
ALTER TABLE ai_ops_events ADD COLUMN IF NOT EXISTS llm_fallback_count INT NOT NULL DEFAULT 0;
ALTER TABLE ai_ops_events ADD COLUMN IF NOT EXISTS degraded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS comments TEXT;

-- Supervisor raised issue tracking (HITL narrative)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'system';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS raised_by_worker_id UUID REFERENCES workers(id);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tagged_worker_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS report_description TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS report_concern_type TEXT;

-- Escalation state removed; map leftover rows to pending_decision.
UPDATE reviews SET state = 'pending_decision' WHERE state = 'escalated';

-- Clause-level provenance for the statutory corpus, so a citation can be checked
-- against its source text rather than taken on trust.
ALTER TABLE regulations ADD COLUMN IF NOT EXISTS clause TEXT;
ALTER TABLE regulations ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Tamper-evident audit chain. Each entry hashes its own content together with the
-- previous entry's hash, so altering or removing any row invalidates every hash
-- after it. `seq` gives the chain a total order independent of clock skew.
ALTER TABLE audit_entries ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
ALTER TABLE audit_entries ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_entries ADD COLUMN IF NOT EXISTS entry_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_entries_seq ON audit_entries(seq);

-- Evidence froze context *ids* only, so a later edit to a context row silently
-- changed what a recorded decision appeared to rest on. Snapshot the content too.
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS frozen_context_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS frozen_assessment_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS snapshot_hash TEXT;

-- Assessment queue scalability.
-- `claimed_at` gives claims a lease: a worker that dies mid-job (or throws after
-- generation) leaves a `generating` row that would otherwise sit stranded until
-- the next process restart, with its review stuck in `assessing` forever.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- The claim and the periodic supersede sweep both filter on status; without this
-- they sequential-scan the table on every poll tick.
CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status);

-- Make "never double-run" true at the database rather than by convention.
-- `enqueue_for_review` was a check-then-insert with no constraint behind it, so
-- two concurrent transitions could both pass the check and insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessments_active_per_review
    ON assessments(review_id)
    WHERE status IN ('pending', 'generating');

-- Every RAG query is `ORDER BY embedding <=> $1`, which is a full scan without
-- an ANN index. Cheap at seed size, O(corpus) forever.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
    ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Provider override lived in a module-level dict on the orchestrator, so with
-- more than one worker process a supervisor's "retry with provider X" could be
-- read by a process that never saw it. It belongs on the job.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS provider_override TEXT;

-- Shift handover — a custody transfer between panel operators.
--
-- The incident premise this product is built on is information that existed but
-- never reached the person who could act on it, and the shift boundary is where
-- that fails most often. A handover is therefore an accountable act like a
-- decision: a named outgoing operator issues a carry-forward list to a named
-- incoming operator, who must acknowledge every high-risk item before taking
-- custody. Audit entries for it are hash-chained like everything else.
CREATE TABLE IF NOT EXISTS handovers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Actors are polymorphic (users | workers, see auth/schemas.ActorMeOut), so
    -- these cannot be foreign keys. The name is snapshotted for the same reason
    -- evidence snapshots context: a later roster edit must not rewrite who was
    -- accountable at the moment custody changed hands.
    outgoing_actor_id UUID NOT NULL,
    outgoing_actor_name TEXT NOT NULL,
    outgoing_actor_kind TEXT NOT NULL DEFAULT 'user',
    incoming_actor_id UUID NOT NULL,
    incoming_actor_name TEXT NOT NULL,
    incoming_actor_kind TEXT NOT NULL DEFAULT 'user',
    state TEXT NOT NULL DEFAULT 'draft', -- draft | issued | accepted | expired
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    brief TEXT,
    narration_mode TEXT NOT NULL DEFAULT 'deterministic', -- llm | deterministic
    issued_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handover_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handover_id UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    -- open_review | active_fact | open_task | decision_condition | note
    item_type TEXT NOT NULL,
    -- The item snapshots its own title/detail, so these are links, not the
    -- record. ON DELETE SET NULL keeps the handover intact if the referenced
    -- row is ever removed (there is no such path in production; this matters
    -- only for test cleanup, which deletes reviews wholesale).
    review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    task_id UUID REFERENCES review_tasks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    detail TEXT,
    risk_level TEXT NOT NULL DEFAULT 'nominal',
    hazard_dimensions TEXT[] NOT NULL DEFAULT '{}',
    requires_ack BOOLEAN NOT NULL DEFAULT FALSE,
    ack_state TEXT NOT NULL DEFAULT 'pending', -- pending | acknowledged | queried
    ack_note TEXT,
    acknowledged_by UUID,
    acknowledged_by_name TEXT,
    acknowledged_at TIMESTAMPTZ,
    source TEXT NOT NULL DEFAULT 'auto', -- auto | manual
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handover_items_handover ON handover_items(handover_id);
CREATE INDEX IF NOT EXISTS idx_handover_items_asset ON handover_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_handovers_state ON handovers(state);

-- At most one handover in flight at a time. Two operators ending their shift
-- concurrently would otherwise each compose a list from the same window and
-- split custody in half, with neither list complete.
--
-- `(state IS NOT NULL)` is `true` for every row (state is NOT NULL), so this is
-- a unique index over a single constant value restricted to active rows — i.e.
-- "at most one". A bare constant is not a legal index expression, hence the
-- roundabout predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_handovers_active
    ON handovers((state IS NOT NULL))
    WHERE state IN ('draft', 'issued');
-- Reports were rebuilt from LIVE tables at close time, so a report "of" a review
-- reflected whatever the tables said when the generator ran rather than what the
-- supervisor actually decided on. They are now built from the evidence.frozen_*
-- snapshots and are immutable once written; a reopen mints a new version instead
-- of mutating v1.

-- Fingerprint of `content`, over the same canonical JSON the audit chain uses.
-- Without it "immutable" is a convention; with it, an edit is detectable.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Packet shape version. Rows written before the rework carry the v1 shape and are
-- hydrated through a compatibility path rather than parsed as v2.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS packet_version INT NOT NULL DEFAULT 1;

-- Backward-only supersession link, written once at insert. Deliberately no FK:
-- `_RESET_DELETE_ORDER` in simulator/engine.py wipes reports in a single
-- statement, which a self-FK would reject row by row. "Is current" is derived
-- (max seq per review), never stored, so superseding v1 never writes to v1.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS supersedes_report_id UUID;

-- Who closed the review. The audit chain had it; the packet did not, so a report
-- could not name the actor whose action froze it.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS closed_by TEXT;

-- Freeze instant, kept distinct from generated_at, which carries a DEFAULT now()
-- and would drift if a row were ever re-rendered.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;

-- The evidence row this packet was built from, with its snapshot_hash copied
-- forward so the packet stays verifiable after a demo reset deletes evidence.
-- No FK for the same reason as above (evidence is deleted before reports).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS snapshot_hash TEXT;

-- closure_event_seq was COUNT(*)+1 with nothing enforcing it, so a concurrent or
-- retried close could mint a duplicate, and a demo reset (which deletes reports)
-- could reuse one. Renumber existing duplicates before constraining: apply_schema
-- runs this file as one unit, so a failing CREATE UNIQUE INDEX would abort every
-- statement after it on an existing dev database.
WITH renumbered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY review_id ORDER BY generated_at, id
           )::int AS rn
    FROM reports
)
UPDATE reports r
SET closure_event_seq = renumbered.rn
FROM renumbered
WHERE r.id = renumbered.id
  AND r.closure_event_seq IS DISTINCT FROM renumbered.rn;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_review_seq
    ON reports(review_id, closure_event_seq);

-- Every report read path filters or orders by review_id; there was no index.
CREATE INDEX IF NOT EXISTS idx_reports_review
    ON reports(review_id, closure_event_seq DESC);
