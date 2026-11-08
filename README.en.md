# uniapp-wx-lab

**uni-app WeChat mini-program pay + subscribe-message debug lab**

Offline validators for subscribe-message `data` fields, timing helpers (`requestSubscribeMessage` only after tap / pay callback), a local mock server, and copy-paste uni-app pages.

Chinese docs (primary): [README.md](./README.md)

Not affiliated with WeChat / Tencent / DCloud. Never commit real secrets.

```bash
npx -y github:MsNan/uniapp-wx-lab validate examples/payloads/order-shipped.json
npx -y github:MsNan/uniapp-wx-lab serve
npx -y github:MsNan/uniapp-wx-lab checklist
npm test
```

## WeChat Pay APIv3 notify: local signature check + decrypt (v0.2.0)

`lib/pay-v3.js` (zero deps, Node `crypto` only, offline):

- `verifyNotifySignature({ headers, body, publicKey })` — message is `timestamp\nnonce\nrawBody\n`, SHA256 with RSA using the WeChat Pay platform certificate / WeChat Pay public key (not your merchant API cert). Use the raw body. Signatures starting with `WECHATPAY/SIGNTEST/` are probe traffic and return `{ ok:false, probe:true }`. Optional `expectedSerial`; timestamp skew checked at 300 s by default (`maxSkewSeconds: 0` disables).
- `decryptNotifyResource(resource, apiV3Key)` — AEAD_AES_256_GCM with the 32-byte APIv3 key, `nonce` as IV, `associated_data` as AAD, last 16 bytes of the ciphertext are the auth tag.
- `encryptNotifyResource(...)` — for generating local test data only.

```bash
WXPAY_APIV3_KEY=<32-byte key> npx -y github:MsNan/uniapp-wx-lab decrypt-notify notify.json
npx -y github:MsNan/uniapp-wx-lab decrypt-notify examples/payloads/pay-notify-v3.json --lab-key   # sample, public test key
```

---

MIT © Theo（涛哥）
