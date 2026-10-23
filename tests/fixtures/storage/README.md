# Pre-scope upgrade fixture

`pre-scopes-v16.db` is a real SQLite database with migrations 001 through 016,
before scope storage existed. It contains memories from two projects, a raw
session event, entities and a relation, a claim, feedback, a failure record,
a transcript checkpoint and binary semantic vectors. Scope upgrade tests copy
this file, compare every populated table's original columns and values after
upgrade, check integrity and foreign keys, and exercise failure in both DELETE
and WAL journal modes using byte comparisons of the original file.

Regenerate locally with `node scripts/create-scope-upgrade-fixture.mjs`. The
generator explicitly selects only the original sixteen SQL migrations and uses
synthetic records. Tests consume the committed file rather than creating an old
database through the current schema.

`scope-defaults.json` records SHA-256 checksums of ten full serialized retrieval
and compact-index responses from main at `869ce6e`, using a pinned clock and the
90-memory synthetic seed described in the fixture. The compatibility test
replays that capture, assigns mixed labels, and compares complete response bytes
to those baseline checksums. This covers sparse fallback, candidate limits,
aliases and entity scoring without adding fields to default responses.
