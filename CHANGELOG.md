# Changelog

All notable changes to this package are documented here.

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
