# FE local IDs / publication integration (2026-11-05)

## Integration scope

Base: `6c726d7ea85572704ab047604ee7db4f1d1b1918` on
`feat/SJ-publication-policy-integration`. Work continues independently on
`feat/SJ-publication-local-ids-integration`.

`origin/feat/SJ-naju-local-ids` was verified at
`3474073f5e9805a604d5f8ad4efcaf0e9c02c173`. Its sole parent / merge-base was
`85a6e505388e35763e7a23874496f6c3ae6d9149`; only this one missing commit was
needed. Its nine paths did not overlap the previous integration's changes.
Cherry-pick with provenance produced `c1c6b2139f1c02cf43c55de347e7fb59275ba503`
without conflict. NPC v0.4.15, client_skill, publication and NG/U contracts
are retained. No content branch was merged and no actual content was edited.

Follow-up hardening rejects blank codes/groups and unsafe/noninteger placement
numbers, records actual runtime/provenance rather than assuming a bare URL has
no options, fails if baked terrain is not ready, and adds synthetic publication
gate tests. The browser exporter blocks non-GET, external-origin and `/api`
requests and can capture the rendered canvas. The checker explicitly labels
its result as LOCAL_IDS only, not publication approval.

## Contract and commands

The JSON passed to `publish_case_content --local-ids` has exactly five keys:
`zones`, `navigation`, `blockers`, `objects`, `scenes`, each a string list.
The strict exporter/checker rejects empty kinds, duplicate values, blank IDs,
duplicate groups and invalid placement numbers. Original sparse placement
numbers and manually added numbers are retained; no renumbering is performed.
Object keys come from rendered batch ID arrays, including `씬N.무리#번호` keys.
Extra background placement keys are allowed; idmap references must be present.

From repository root, with the Naju Vite server running:

```powershell
node naju01/tools/export-local-ids.mjs http://127.0.0.1:5187/ --channel msedge --out <ids.json> --report <report.json> --screenshot <scene.png>
node --test naju01/tests/localIds.test.ts naju01/tests/exportLocalIds.test.mjs
```

From `backend`, using the dedicated Python 3.13 environment:

```powershell
python -B -m scripts.check_idmap_local_ids --idmap <existing-idmap.json> --local-ids <ids.json>
```

The emitted ID list is accepted unchanged by the existing publication CLI
loader. The stricter standalone extraction checks do not redefine the existing
publication loader's compatibility rules. Missing local references fail;
omitting the list leaves LOCAL_IDS UNVERIFIED; malformed types/unknown sixth
keys are blocked. Synthetic CLI dry-run tests preserve all other gates: a
LOCAL_IDS PASS cannot override SCENES UNVERIFIED. A fully specified synthetic
scene and matching synthetic approvals permit dry-run PASS, without DB writes
or invoking publication.

## Actual rendered extraction

Evidence directory (outside the repository):
`C:\dev\kgeseo-publication-local-ids-integration-20261105`.
Final artifacts: `final-local-ids.json`, `final-extraction-report.json`,
`final-scene.png`; preceding runs are `verified-run1-*`, `verified-run2-*`.

Three fresh Edge headless runs of the real Naju scene produced byte-identical
lists, SHA-256:
`5f5b2493bf5a5f6e01e3441fa4c059f79e9f76e2272317ce5792b39e80b314cf`.
The first two runs also had identical recorded source hashes. The third records
more precise URL/renderer metadata; its seven recorded input hashes match the
final integrated FE source bytes. Its recorded commit is the cherry-pick HEAD
with `+dirty`, honestly representing the uncommitted hardening at extraction.

| Kind | Count |
| --- | ---: |
| zones | 4 |
| navigation | 4 |
| blockers | 5 |
| objects | 4786 |
| scenes | 5 |

Objects comprise 65 groups: 41 scene-prefixed keys and 4745 other/background
keys. There are 160 manually added numbers at or above 1000000. No duplicates,
invalid numbers or empty-kind problems were reported.

Requested URL was `http://127.0.0.1:5187/`, but the application automatically
selected `http://127.0.0.1:5187/?aihub&src=sf&r=15`. Viewport was 960x600,
device pixel ratio 1, renderer pixel ratio 1.25, canvas 1200x750, baked terrain
128000 triangles. Collection waited for terrain and at least ten seconds of
stable IDs. Input hashes include edits, edit anchors, site plan, collector,
dev hook and browser tooling. No blocked requests occurred in these runs.
`backend_content_version` is null: this is NOT evidence of a specific backend
content version. Different query options, edited placements, progress state or
content versions require their own extraction and cross-check.

## Existing idmaps, read-only comparisons

PM draft: `docs/naju/naju-angam-01.idmap.draft.json` in this checkout.
Development draft exists in Git at
`dbb7e0dd7313ad3dd584a0411cf18044714d0a35`
(`origin/feat/SJ-naju-content-skeleton-1103`), path
`backend/content_drafts/naju/naju-angam-01.idmap.dev.json`.
The latter was copied byte-for-byte as an external audit reference, with source
SHA/path/hash in `reference-provenance.json`. No missing idmap was invented.

| Map | zones/nav/blockers/scenes | Object references | Missing | LOCAL_IDS |
| --- | --- | ---: | ---: | --- |
| PM draft | 4 / 4 / 5 / 5 | 13 / 13 | 0 | PASS |
| Development draft | 4 / 4 / 5 / 5 | 20 / 20 | 0 | PASS |

Both standalone comparisons exit 0. Their schema/internal checks also pass.
These are still draft maps: PM has 51 pending items, development has 21; both
have no content_version. Standalone full-map analysis blocks on draft status,
pending items, missing version header, cross-check not run and fingerprint not
verified. This analysis is not a full publication gate approval.

Using the unchanged actual PM idmap, a TEST_ONLY copy of the extracted list
with `씬1.그물틀#0` removed exits 2 (missing reference). A TEST_ONLY list with
sixth key `interactables` exits 1 (malformed contract). These negative-test lists
are external audit artifacts and must not be used as publication inputs.

## Dynamic interaction limits

`registerInteractable` IDs are runtime interaction identifiers, not an idmap
local kind. The dev hook exposes them read-only as diagnostic information;
they are never added to the five-key input. Initial runtime registration counts
were 59, 59 and 56 across runs, while five-kind placement lists stayed identical.
Static IDs not seen initially were 19, 19 and 21. Registration varies with
timing/conditional state. Static scanning is a regex heuristic, not exhaustive
AST analysis. Neither initial rendering nor this static comparison certifies
all later gameplay interactions. Progress-driven interaction verification needs
separate scenario tests under the existing interaction contract.

## Conditions before real publication

Resolve PM/development pending content and assign an approved version; obtain
matching client/server/NPC/scenes documents and a coherent idmap/content root.
Extract again from the intended FE build, query/options, placements and progress
conditions, then bind the provenance to that exact content snapshot. Verify
LOCAL_IDS, cross-document references, scene completion and NPC v0.4.15/NG/U
policies. Keep open-missing conservative behavior and unresolved PM policy
choices unchanged. Obtain authorized G1-G3 approvals for that same fingerprint;
changed bytes require reevaluation. CLI dry-run and real publish must evaluate
the identical snapshot through the existing shared gate. No real approvals,
registration or Naju publication were performed by this integration.

## Verification and preservation

Full test results and final commit are recorded in the external audit report.
General BE run: 2371 passed, 163 skipped. Focused policy/publication/API tests:
235 passed, 10 skipped. New checker/publication integration tests: 20 passed;
FE extraction tests: 12 passed. Backend Ruff passes. Root FE, Naju and website
typecheck/build pass. FE lint has the exact same 39 baseline errors, with no
new errors. An extra repository-root Ruff scan reports 115 existing errors in
31 unchanged documentation/tool Python files; these files are byte-equivalent
to the integration base and are outside the passing Backend Ruff scope.
BE tests use the existing isolated launcher: ordinary mode blocks network;
MySQL mode checks identity/datadir and permits only 127.0.0.1:33317 under
`codex_test`. Port 3306 is rejected before a connection. Test schemas are the
three dedicated `test_*codex_next*` schemas, never a shared/production database.
Full isolated MySQL run: 2533 passed, 1 skipped (Windows symlink privilege),
40 pre-existing dependency/datetime deprecation warnings. Ordinary run has two
dependency deprecation warnings. After tests, all three isolated schemas have
zero tables. No production/shared DB was contacted. Existing FE lint 39
errors are compared against baseline, not suppressed or fixed incidentally.

Original 24 worktrees, 82/38/25 dirty-file repositories and the preservation
backup were verified unchanged against the existing snapshot (2670 backup
files), including branch, HEAD,
status, index, refs, worktree lists and file hashes. Work stays in the independent
clone and new branch. No push, PR, main merge or real approval/publication is
part of this work.
