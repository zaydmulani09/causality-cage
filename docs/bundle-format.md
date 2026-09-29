# `.cage` bundle format (schemaVersion 1)

A `.cage` file is a zip archive. Every JSON file validates against a definition in
[`packages/core/schema/bundle.schema.json`](../packages/core/schema/bundle.schema.json), which is generated from
[`packages/core/src/types.ts`](../packages/core/src/types.ts) by `scripts/gen-schema.ts`. A unit test fails if the
checked-in schema drifts from the types. `cage report`, `cage repro` and `cage export-test` refuse bundles that do not
validate and name the first offending field.

## Files

| Path | Schema definition | Content |
|---|---|---|
| `manifest.json` | `Manifest` | `schemaVersion`, `toolVersion`, `createdAt` (ISO time the bundle was written), `baseOrigin` (origin only, no path or query), `flowHash` (sha256 prefix of the flow source), `flowFile` (absolute path at explain time), `oracle` (built-in flags and oracle file path), `apiGlobs`, `allowUnmatched`, `freezeRandom`, `freezeTime`, `redaction` (counts per category, or `null` with `--no-redact`). |
| `sessions/bad.json` | `Session` | The failing session. |
| `sessions/good.json` | `Session` | The passing session. |
| `sessions/good.synthesized.json` | `Session` | Instead of `good.json` in single-session mode (`synthesized: true`). |
| `factors.json` | `{ factors: Factor[], tree: FactorNode }` | Every factor with its `observed` and `neutral` value, and the tree used by hierarchical search. |
| `experiments.jsonl` | `ExperimentRecord` per line | Every experiment in creation order: `phase`, config `bits` (one char per factor, factor order), `overrides`, `runs`, `fails`, `errors`, `decision`, `wallMs`, distinct request-sequence hashes, first failure reason. This is also the memo cache: `key` identifies the configuration. |
| `result.json` | `Result` | Verdict, reason, templated sentence, gate rates, minimal sets, structure, truth table, verification rows, variant probes, delay curves, budget, warnings. |
| `report.html` | - | Self-contained report (see `packages/report`). |
| `repro/flow.ts` | - | The flow source, verbatim. |
| `repro/oracle.ts` | - | The oracle source, verbatim, when an oracle file was used. |
| `repro/cage-repro.spec.ts`, `repro/fixtures/plan.ts`, `repro/playwright.config.ts`, `repro/README.md` | - | The exported regression test (same as `cage export-test --expect fixed`). |

## Values

- Missing keys are written as `{ "$absent": true }` (distinct from `null`).
- Factor ids are `f0`, `f1`, ... in extraction order. Labels are stable and human readable: `body GET /api/cart customer.tax_id`, `delay GET /api/prices`, `order GET /a before GET /b`, `storage localStorage exp_assignment`, `cookie locale`, `header GET /api/cart x-region`, `env locale`, `presence GET /x`. A `#n` suffix marks the n-th (0-based) occurrence of a repeated request.
- Exchange keys are `METHOD normalized-url`: query params sorted, volatile params (`_`, `ts`, `t`, `nonce`, `cacheBust`) and secret-named params dropped, origin dropped when it is the app's.
- Bodies are UTF-8 text when the content type is textual, else base64 (`bodyEncoding`).

## Redaction (default on)

Applied to sessions, factors, the factor tree, experiments and the result before anything is written:

- Headers `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `Api-Key`, `X-Auth-Token`, `X-CSRF-Token`, `X-XSRF-Token`: masked.
- Values under keys matching `token|secret|password|passwd|session|auth|jwt|key` (case-insensitive) in JSON bodies, cookies, local/session storage and URL query strings: masked. Objects under such keys are masked leaf by leaf.
- Anywhere in text: emails, JWT-shaped strings, and 13-19 digit numbers that pass the Luhn check (card-like).
- Masks keep the value class: strings stay strings (`redacted-<10 hex>`, emails become `redacted-<hex>@example.invalid`, card numbers become other digits of the same length), numbers stay numbers, `null` stays `null`, booleans are kept. Masks are HMAC-SHA256 with a random per-bundle key that is not stored: equal inputs map to equal masks and different inputs to different masks, so factors keep working and replay from a bundle still behaves the same. A final sweep replaces every registered secret wherever it was copied (labels, reasons, the verdict sentence).
- `--redact-allow <path>` leaves a JSON body path (e.g. `customer.email`) unmasked everywhere. `manifest.redaction` records counts only, never values.
- Not redacted: `repro/flow.ts` and `repro/oracle.ts` (your source code, verbatim) and base64 (binary) bodies. Keep credentials out of flow files.
