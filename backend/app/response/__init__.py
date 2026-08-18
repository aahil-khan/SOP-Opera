"""
Emergency Response Orchestrator (W1).

Turns a risk verdict into bounded, reversible, individually revocable automatic
actions — and refuses, visibly, the ones that fall outside the envelope.

Deliberately isolated from the fact/verdict path: nothing here is imported by
`app.risk`, `app.context` or `app.eval`, and nothing here writes `context_entries`.
See the header comment on the W1 tables in `app/db/schema.sql`.
"""
