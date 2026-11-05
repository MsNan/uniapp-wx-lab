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

MIT © Theo（涛哥）
