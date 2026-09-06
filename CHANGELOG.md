# Changelog

All notable changes to this package are documented here.

## 1.0.9 - 2026-09-06

- Add visitor identification: `init({ identify: { userId, email, plan, salt } })`,
  the matching `data-user-id`, `data-user-email`, `data-plan` and
  `data-hash-salt` script-tag attributes, and `FindIP.identify()` for apps that
  log the user in after load. The SDK hashes the user ID and email with SHA-256
  in the browser (WebCrypto) and attaches only `user_id_hash`, `email_hash`,
  `email_domain` and `plan` to every event; the raw values never leave the page.
  Automatic events wait for hashing to finish, so the first `session_start`
  already carries the identity.
- Fix quadratic backtracking in the customer-context sanitizer: the email
  pattern is only evaluated for values containing `@`, and values are capped
  to 256 characters before pattern matching. Oversized `custom` strings no
  longer cost seconds of CPU (and the payload-size test no longer times out on
  slow CI runners).

## 1.0.8 - 2026-08-23

- Fix integration attribution: the SDK no longer reports `gtm` for plain
  JavaScript installations after creating `window.dataLayer` itself; only a
  pre-existing dataLayer or the GTM container global counts as a GTM install.
- Add a validated `integration` init option (and `data-integration` script-tag
  attribute) so first-party adapters can identify themselves as `wordpress`,
  `woocommerce`, or `shopify`; unknown values fall back to auto-detection.

## 1.0.7 - 2026-08-20

- Persist a session-start marker (cookie, session storage, and in-memory
  fallbacks) so full page navigations within one session emit `page_view`
  without a duplicate `session_start`.

## 1.0.6 - 2026-08-20

- Serialize queued event delivery so concurrent startup and form events cannot send the same payload twice.
- Preserve the response associated with each queued tracking call.

## 1.0.5 - 2026-08-15

- Add the Shield overview video preview to the GitHub and npm package documentation.

## 1.0.4 - 2026-08-15

- Align the npm and CDN release versions and document the shared version policy.
- Publish a canonical immutable CDN artifact for reproducible script-tag installations.

## 1.0.3 - 2026-08-11

- Publish releases from GitHub Actions using npm trusted publishing.
- Generate npm provenance automatically through the OIDC release workflow.

## 1.0.2 - 2026-08-10

- Publish the SDK from its public source repository.
- Provide working ESM and CommonJS package entry points.
- Add standalone package validation and public CI.

## 1.0.1 - 2026-08-08

- Send ingestion payloads as CORS-simple `text/plain` requests.
- Use `https://shield.findip.net/v1/shield/track` by default.
- Report unavailable intelligence as unknown rather than safe.

## 1.0.0 - 2026-08-07

- Initial browser SDK release.
