# Changelog

All notable changes to this package are documented here.

## 1.5.0 - 2026-09-08

- The challenge text (above the Turnstile widget) and the slow-down
  countdown text are configurable per site in the dashboard and per custom
  rule; `{seconds}` in the slow-down text is replaced by the remaining
  seconds. Built-in texts remain the default.

## 1.4.0 - 2026-09-08

- In-page enforcement honours the dashboard's two sub-switches: Shield's
  score-based verdicts and custom-rule verdicts can each be enforced in the
  page independently (`apply` in the setting; verdicts decided by a rule are
  marked as such in the track response).
- A custom rule may override the site's in-page action, slow-down delay,
  message and redirect URL; the overrides arrive only with the responses
  that rule decided, so site defaults stay in force otherwise.

## 1.3.0 - 2026-09-08

- Form events carry a fingerprint of the form — `form_id`, `form_name` and
  `form_action` (the action's path, without query string) — so the Shield
  dashboard can list the forms it has seen on a site. Metadata only; field
  values are never collected.
- In-page enforcement can be scoped to specific forms: the dashboard's
  per-category form selection arrives as `form_filters` next to `scope`
  and the SDK enforces only matching forms. Sites without a selection keep
  category-wide enforcement.

## 1.2.0 - 2026-09-08

- In-page enforcement, switched on per site in the Shield dashboard
  (Settings → Enforcement). The setting arrives inside `/track` responses,
  so nothing changes in the snippet and no extra request is made. On a
  signup, login, checkout, lead or password-reset form submit the SDK acts
  on the API's recommendation: **stop** (block the submit and show a
  message), **slow down** (a countdown, then one automatic re-submit),
  **challenge** (a Cloudflare Turnstile widget under the form; the token is
  verified by Shield and the pass sticks for the session), or **redirect**
  (send blocked visitors to a URL as soon as the decision is known). Every
  action is reported on the event (`enforcement: { action, outcome }`).
  Fails open whenever the setting, the decision or Turnstile is missing.
  This is friction for bots and casual abuse that run the page; the verify
  endpoint remains the server-side boundary.

## 1.1.1 - 2026-09-07

- `identify({ custom: { … } })`: attach account facts (for example an
  account tier, a seat count, or the signup channel) to every event, with
  the same rules and sanitizer as the `custom` object of `track()` (up to 20
  keys, string / number / boolean values, sensitive keys and values dropped).
  Per-event `custom` passed to `track()` merges on top. Numeric strings (as
  GTM variables render them) become numbers; `undefined` / `null`
  placeholders are ignored.
- The custom-object sanitizer now also drops sensitive key names in the
  browser (password, card, cvv, ssn, secret, …), matching the server, and no
  longer drops every key that merely contains the word "credit" — `card`
  still covers credit_card and creditCard.

## 1.1.0 - 2026-09-07

- Identified visitors can now be shown by email and user ID in the Shield
  dashboard. When `identify` carries an email or user ID, the SDK fetches the
  site's identity public key once per page (`GET /v1/shield/identity-key`,
  only after tracking is allowed), encrypts the values in the browser with
  WebCrypto RSA-OAEP/SHA-256, and attaches `email_enc` / `user_id_enc` next to
  the existing `email_hash` / `user_id_hash` / `email_domain` / `plan`. The
  plain values still never leave the page; only the Shield dashboard, holding
  the site's private key, can open the ciphertext. Sites without a key (or
  with identity reveal switched off) keep working exactly as in 1.0.9.
- New `identityKey` init option and `data-identity-key` attribute to supply
  the key directly and skip the fetch.

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
