# FindIP Shield JavaScript SDK

[FindIP Shield](https://findip.net/docs/shield) adds visitor risk intelligence to a website. The SDK reports VPN, proxy, Tor, relay, hosting, datacenter, malicious-IP, and network signals without collecting form values.

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

## Install from the CDN

```html
<script
  src="https://cdn.findip.net/shield/v1.js"
  data-site-key="pub_xxxxxxxxx"
  data-auto-track="true"
  data-privacy-mode="balanced">
</script>
```

The CDN build exposes `window.FindIP`:

```js
await FindIP.track('login_attempt');
const { sessionId } = FindIP.getSession();
```

For reproducible deployments, use a [pinned release with SRI](https://findip.net/docs/shield/quickstart) instead of the auto-updating `v1.js` alias.

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

