# Production fixes — 2026-09-04

The September review's seven findings are fixed and deployed. The release gate, GitHub CI and live smoke checks pass. Deployment evidence is recorded below.

## Changes and evidence

| Problem                                     | Change                                                                                                                | Verification                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Text-valued drafts could publish            | Only absent/null or explicitly false draft flags pass; ambiguous values block sync                                    | Unit tests and synthetic-vault integration test                                           |
| User-Agent changes reset the quota          | Separate IP-only HMAC rate identity, stable across midnight; 24-hour row retention                                    | D1 test exhausts quota then changes User-Agent                                            |
| Mobile search hides its controls            | Results stay below the field; clear remains reachable; async errors are visible                                       | Real Chrome at 390px, result and no-overlay hit tests                                     |
| Concurrent unlikes corrupt totals           | Explicit desired-state writes, conditional insert, transactionally recalculated count; reads derive totals from votes | Concurrent D1 retries and real local like/unlike flow                                     |
| Failed likes persist selected               | Server state wins; failed writes roll back and announce errors                                                        | DOM tests for 429, stale storage, duplicate listeners and late responses after navigation |
| Markdown fragment links vanish              | Resolve the file path independently of query/fragment                                                                 | Synthetic-vault heading and PDF-page links                                                |
| Deleted parents leave public orphan replies | Reader deletion hides the subtree; reads exclude unreachable branches                                                 | D1 authorization, deletion and old-orphan tests                                           |
| Conflicting cache directives                | Generate exact immutable rules for hashed assets; stable URLs use Cloudflare revalidation                             | Actual local Worker response headers and built-output checks                              |
| Missing landmarks / unnamed like button     | Main landmark in each frame; descriptive like labels; retain the 404 H1                                               | All seven generated pages validated; Chrome accessibility snapshot                        |
| Vulnerable fflate dependency                | Override to the patched 0.7.5 series                                                                                  | npm audit: zero vulnerabilities                                                           |

The API also returns a real configuration failure when D1 is unavailable and hides engagement for unpublished pages. Comment refreshes bypass stale caches, failed deletes recover their controls, and Turnstile can reuse its loaded API after navigation. Local preview no longer ignores migration failures.

Additional regression tests cover replies racing with thread deletion: the save now checks the complete parent thread atomically, and rejects a removed thread instead of accepting an invisible reply. Reader and owner replies cannot extend an older orphan branch. Search retries index failures, removes outdated results immediately and restores the sidebar on navigation; late index failures cannot overwrite the next search. Late comment responses preserve the author's delete token without erasing a draft on the next page.

## Release gate

`npm run verify` runs type/binding checks, formatting, Node and Worker suites, the full site build, content/output privacy audits, generated HTML/link/cache validation, and the dependency audit. `npm run deploy` runs this gate before Wrangler. The desktop publishing command and the vault workflow template use the same gate. Site-repository CI builds and validates the generated artifact as well as testing source.

Results on 2026-09-04:

- 237 Node tests and 19 Worker tests passed (256 total).
- Full build and both privacy audits passed for five published notes.
- All seven generated HTML pages passed title, main landmark, local-target and control-label checks.
- Worker deployment dry run passed with the existing assets/D1 bindings; no schema migration is required.
- Dependency audit reported zero vulnerabilities.
- Chrome mobile snapshot on the article: accessibility 100, best practices 100, SEO 100; no failed audits.
- Real local Worker returned one immutable CSS cache policy, revalidation for HTML/Pagefind, and no-store for API state.
- Browser tested search and clear on mobile, local like/unlike, client navigation and series navigation. Test writes used an isolated local database, with no Telegram credentials.

The five published content files and their manifest were not changed or re-synced from the private vault. Existing test fixtures and a temporary local database were used for mutation tests.

## Deployment

The owner authorized committing, pushing and deploying this release.

- Release commit: `1c927557768d9f8a2dbead21a3cc8902184f8174`, pushed to `main`.
- [GitHub release checks](https://github.com/joealmond/mandulaj-hu/actions/runs/33921233777): passed.
- Deployed on 2026-09-04 at 21:29 UTC to [mandulaj.hu](https://mandulaj.hu).
- Cloudflare version: `7bfda8bd-152b-46aa-99db-1f7afa556842`, confirmed serving 100% of traffic.
- Previous version: `f2913cd9-b172-4496-8605-d46fc98dff62`.
- The production deployment command reran the full release gate successfully before uploading.
- Live HTML for all seven generated pages, including the custom 404, matched the local build byte for byte. The hashed stylesheet and Pagefind entry point also matched.
- Live likes/comments reads returned 200 for published pages and 404 for missing pages, with `no-store`; legacy redirects preserved the query string. HTML/Pagefind revalidated, and the hashed stylesheet had one immutable cache policy.
- Chrome at a 390px mobile viewport returned four search results, kept the input and clear control reachable, and cleared results correctly without horizontal overflow or console warnings/errors.
- Production smoke checks were read-only; no test comments, likes or notifications were created.

The private-vault repository's installed workflow is separate from `deploy/vault-publish.yml`; updating this template does not change that other repository automatically.

These checks establish the behavior covered above. They are not a guarantee against every future defect or an exhaustive infrastructure penetration test.
