# FindIP Shield JavaScript SDK

[![npm version](https://img.shields.io/npm/v/%40findip%2Fshield.svg)](https://www.npmjs.com/package/@findip/shield)
[![CI](https://github.com/findip-net/findip-shield-js/actions/workflows/ci.yml/badge.svg)](https://github.com/findip-net/findip-shield-js/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40findip%2Fshield.svg)](LICENSE)

[FindIP Shield](https://findip.net/docs/shield) adds visitor risk intelligence to a website. The SDK reports VPN, proxy, Tor, relay, hosting, datacenter, malicious-IP, and network signals without collecting form values.

Published on npm as [`@findip/shield`](https://www.npmjs.com/package/@findip/shield).

## See Shield in action

[![A sample sign-up arrives through a VPN. FindIP Shield shows the reasons behind its risk score, follows the session across networks, and records what the page did](https://raw.githubusercontent.com/findip-net/findip-shield-js/main/.github/media/shield-signup-insight-teaser.gif)](https://www.findip.net/assets/videos/shield-signup-insight.mp4)

▶ **[Watch with sound (0:30)](https://www.findip.net/assets/videos/shield-signup-insight.mp4)** · [Try the interactive demo](https://www.findip.net/shield/demo?utm_source=sdk_readme&utm_medium=readme&utm_campaign=shield_clips&utm_content=findip-shield-js) · [Explore FindIP Shield](https://www.findip.net/shield/overview?utm_source=sdk_readme&utm_medium=readme&utm_campaign=shield_clips&utm_content=findip-shield-js)

The clip uses sample data, and its captions are on screen. Three more short clips:

| Add Shield with a website snippet | Choose what happens on a form | Connect through Cloudflare |
| :---: | :---: | :---: |
| <a href="https://www.findip.net/assets/videos/shield-install-snippet.mp4"><img src="https://raw.githubusercontent.com/findip-net/findip-shield-js/main/.github/media/shield-install-snippet-thumb.jpg" width="260" alt="Play: Add Shield with a website snippet (0:34)"></a> | <a href="https://www.findip.net/assets/videos/shield-form-response.mp4"><img src="https://raw.githubusercontent.com/findip-net/findip-shield-js/main/.github/media/shield-form-response-thumb.jpg" width="260" alt="Play: Choose what happens on a form (0:31)"></a> | <a href="https://www.findip.net/assets/videos/shield-install-cloudflare.mp4"><img src="https://raw.githubusercontent.com/findip-net/findip-shield-js/main/.github/media/shield-install-cloudflare-thumb.jpg" width="260" alt="Play: Connect Shield through Cloudflare (0:35)"></a> |
| Create a site, paste the snippet, see your first visit. | Protect a sign-up form and see what was recommended and what happened. | No code: authorize, choose a hostname, start in Monitor mode. |

## Install from npm

```bash
npm install @findip/shield
```

```ts
import { init, track, getSession, setConsent } from '@findip/shield';

init({
  siteKey: 'pub_xxxxxxxxx',
  privacyMode: 'balanced',
  autoTrack: true,
  autoDetectForms: true,
});

await track('signup_attempt', {
  email_domain: 'example.com',
  plan: 'free',
});

const { sessionId } = getSession();
```

The package provides ESM, CommonJS, and TypeScript declarations.

### Identify the visitor

Tell Shield which of your users a session belongs to. The plain user ID and
email never leave the page: the SDK hashes them in the browser with SHA-256,
and encrypts them with your site's identity public key (RSA-OAEP, fetched
from Shield once per page) so that only the Shield dashboard can show them
next to each event. Shield's ingest and storage only ever see the hashes,
the email domain, the plan, and the ciphertext.

```ts
init({
  siteKey: 'pub_xxxxxxxxx',
  identify: {
    userId: currentUser.id,      // sent as user_id_hash + user_id_enc
    email: currentUser.email,    // sent as email_hash + email_domain + email_enc
    plan: currentUser.plan,      // sent as plan
    salt: 'optional-secret',     // mixed into both hashes: SHA-256(salt + ':' + value)
    custom: {                    // account facts on every event (no PII)
      account_tier: currentUser.tier,
      signup_channel: 'google',
    },
  },
});

// Or later, e.g. after a login. Pass null on logout.
identify({ userId: user.id, email: user.email });
```

The dashboard shows the email and user ID on every identified event and
session. Switch "Show visitor emails and user IDs" off in the site's settings
to keep identities hash-only; the SDK then sends no ciphertext at all. Pass
`identityKey` (or `data-identity-key`) with the key shown in the dashboard to
skip the per-page fetch.

## Install from the CDN

```html
<script
  src="https://cdn.findip.net/shield/v1.js"
  data-site-key="pub_xxxxxxxxx"
  data-auto-track="true"
  data-privacy-mode="balanced">
</script>
```

To identify the visitor from a script tag, add `data-user-id`,
`data-user-email`, `data-plan` and optionally `data-hash-salt`. Render them
server-side for the logged-in user; the SDK hashes them before sending. Inside
a Google Tag Manager Custom HTML tag, call `FindIP.init({ siteKey, identify })`
with your GTM variables instead, because GTM strips `data-*` attributes.

The CDN build exposes `window.FindIP`:

```js
await FindIP.track('login_attempt');
const { sessionId } = FindIP.getSession();
```

For reproducible deployments, use a [pinned release with SRI](https://findip.net/docs/shield/quickstart) instead of the auto-updating `v1.js` alias.

### Version policy

npm and CDN releases use the same SDK semantic version. The mutable `v1.js`
alias serves the latest compatible 1.x SDK, while versioned CDN URLs are
immutable and can be verified with SRI.

## In-page enforcement

Switch **Enforcement** on in the site's Settings in the Shield dashboard and
the SDK acts on Shield's recommendation for signup, login, checkout, lead and
password-reset forms: stop the submit with a message, slow it down with a
countdown, ask for a Cloudflare Turnstile challenge that Shield verifies, or
redirect blocked visitors. No snippet change is needed; the setting travels
inside the `/track` responses. This is friction against bots and casual abuse
that run the page, not a security boundary: confirm sensitive actions on
your server with the
[verify endpoint](https://findip.net/docs/shield/server-verification), which
also reports whether the session passed a challenge.

## Consent

Shield supports a direct consent API and Google Consent Mode-style storage signals:

```js
setConsent(true);

setConsent({
  security_storage: 'granted',
  analytics_storage: 'denied',
});
```

Set `consentRequired: true` when tracking must wait for an explicit decision. See [Privacy Modes](https://findip.net/docs/shield/privacy-modes) and [Data Collection](https://findip.net/docs/shield/data-collection) before deploying.

## Documentation

- [Quickstart](https://findip.net/docs/shield/quickstart)
- [JavaScript SDK reference](https://findip.net/docs/shield/javascript-sdk)
- [Events reference](https://findip.net/docs/shield/events)
- [Google Tag Manager](https://findip.net/docs/shield/google-tag-manager)
- [Cookies](https://findip.net/docs/shield/cookies)
- [FindIP Threat Network](https://findip.net/docs/shield/threat-network)

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

Build output:

- `dist/findip-shield.cjs` — CommonJS/UMD bundle
- `dist/findip-shield.esm.js` — ES module
- `dist/findip-shield.min.js` — minified browser IIFE
- `dist/index.d.ts` — TypeScript declarations

## Security

Report suspected vulnerabilities privately to [info@findip.net](mailto:info@findip.net). Do not open a public vulnerability report.

## License

[MIT](LICENSE)
