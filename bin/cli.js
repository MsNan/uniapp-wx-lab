#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateSubscribeData } = require('../lib/validate-subscribe-data');
const { SAMPLE_TEMPLATES } = require('../server/templates');
const { decryptNotifyResource, LAB_APIV3_KEY } = require('../lib/pay-v3');

const CHECKLIST = `# uni-app 微信小程序 · 支付 + 订阅消息联调清单

## 订阅消息（requestSubscribeMessage）

- [ ] **必须在用户手势或支付回调里调用** — 页面 onLoad/onShow、接口返回后自动弹都会失败
- [ ] **一次最多拉起的模板数** — 历史上一次最多 3 个 tmplId；后续平台有放开，仍建议 ≤3 提升通过率
- [ ] **一次性模板 vs 长期订阅** — 不能混在同一次 requestSubscribeMessage 调用里
- [ ] **tmplId 必须是小程序后台「订阅消息」里自己的模板 ID** — 别用别人的或文档示例 ID
- [ ] **用户拒绝 / 总是保持以上选择** — 再次弹窗会被系统拦截，引导去设置页开启
- [ ] **iOS / Android / 开发者工具差异** — 真机与开发者工具表现可能不同，务必双端验证
- [ ] **基础库版本** — 订阅消息需要足够高的微信基础库；uni-app 注意条件编译

## 服务端下发（subscribeMessage.send）

- [ ] **data 字段 key 必须与模板关键词完全一致** — thing2 / time3 这种带序号的 key 不能写错
- [ ] **value 类型与长度符合关键词类型** — thing≤20、phrase≤5、name 中文≤10/英文≤20、amount 带币种等
- [ ] **access_token 缓存** — 不要每次请求都重新获取，注意过期与并发刷新
- [ ] **errcode 47003** — 基本是 data 校验失败；用本仓库 \`validate\` 命令本地先过一遍
- [ ] **用户未授权或授权过期** — 客户端 accept 后才有下发资格；长期订阅另有规则

## 支付联调

- [ ] **本仓库支付仅为模拟** — 不要把真实 mch_id / api_key / 证书提交进仓库
- [ ] **支付成功回调后再订阅** — 常见路径：requestPayment success → requestSubscribeMessage
- [ ] **支付回调验签** — 生产必须验签；本 mock 可用 MOCK_SKIP_SIGN=1 或 lab-test-key HMAC
- [ ] **APIv3 回调先验签再解密** — 验签串是 \`时间戳\\n随机串\\n原始body\\n\`，用平台证书 / 微信支付公钥（不是商户证书）；可用 \`verifyNotifySignature\` / \`decrypt-notify\` 本地核对
- [ ] **WECHATPAY/SIGNTEST/ 开头的签名是探测流量** — 必须当验签失败，返回 4xx/5xx
- [ ] **用原始请求体验签** — 框架先 JSON.parse 再 stringify 会导致验签失败
- [ ] **APIv3 回调应答** — 验签通过回 HTTP 200/204 且无包体；失败回 4xx/5xx + \`{"code":"FAIL","message":"..."}\`；5 秒内应答，业务处理放到应答之后（可用 Mock \`/mock/pay/notify-v3\` 对照）
- [ ] **notify 幂等** — 微信可能重复通知，按 out_trade_no 去重

## 推荐本地流程

1. \`npx -y github:MsNan/uniapp-wx-lab validate examples/payloads/order-shipped.json\`
2. \`npx -y github:MsNan/uniapp-wx-lab serve\` 启动 mock（默认 3789）
3. 把 \`examples/uni-app/\` 页面拷进自己的 uni-app 工程联调 UI 时机
4. 真机支付 + 订阅走微信公众平台 / 商户平台正式配置（切勿提交密钥）
`;

function printHelp() {
  console.log(`uniapp-wx-lab — 支付 + 订阅消息联调实验室

Usage:
  uniapp-wx-lab validate <payload.json>
  uniapp-wx-lab serve [--port 3789]
  uniapp-wx-lab checklist
  uniapp-wx-lab decrypt-notify <notify.json> [--lab-key]
  uniapp-wx-lab help

decrypt-notify 从环境变量 WXPAY_APIV3_KEY 读取 32 字节 APIv3 密钥（不从命令行参数读，避免进 shell 历史）；
--lab-key 使用仓库样例 examples/payloads/pay-notify-v3.json 的公开测试密钥。

Examples:
  npx -y github:MsNan/uniapp-wx-lab validate examples/payloads/order-shipped.json
  npx -y github:MsNan/uniapp-wx-lab serve
  npx -y github:MsNan/uniapp-wx-lab checklist
  npx -y github:MsNan/uniapp-wx-lab decrypt-notify examples/payloads/pay-notify-v3.json --lab-key
`);
}

function cmdValidate(file) {
  if (!file) {
    console.error('请指定 payload JSON 路径');
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在: ${abs}`);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const templateId = payload.template_id || payload.templateId;
  let fields = payload.templateFields || payload.fields;
  if (!fields && templateId && SAMPLE_TEMPLATES[templateId]) {
    fields = SAMPLE_TEMPLATES[templateId];
  }
  if (!fields) {
    console.error('payload 需包含 templateFields，或使用内置 SAMPLE template_id（TMPL_ORDER_SHIPPED 等）');
    process.exit(1);
  }
  const data = payload.data || {};
  const result = validateSubscribeData(fields, data);
  if (result.ok) {
    console.log(JSON.stringify({ ok: true, template_id: templateId || null, message: '校验通过' }, null, 2));
    process.exit(0);
  }
  console.error(JSON.stringify({ ok: false, template_id: templateId || null, errors: result.errors }, null, 2));
  process.exit(1);
}

function cmdServe(argv) {
  let port = Number(process.env.PORT) || 3789;
  const idx = argv.indexOf('--port');
  if (idx >= 0 && argv[idx + 1]) port = Number(argv[idx + 1]);
  process.env.PORT = String(port);
  require('../server/index.js');
}

function cmdDecryptNotify(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('请指定回调通知 JSON 路径（完整通知或其中的 resource 对象）');
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在: ${abs}`);
    process.exit(1);
  }
  const key = argv.includes('--lab-key') ? LAB_APIV3_KEY : process.env.WXPAY_APIV3_KEY;
  if (!key) {
    console.error('请设置环境变量 WXPAY_APIV3_KEY（32 字节 APIv3 密钥），或用 --lab-key 解密仓库样例');
    process.exit(1);
  }
  let notify;
  try {
    notify = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error(`JSON 解析失败: ${err.message}`);
    process.exit(1);
  }
  const resource = notify.resource || notify;
  try {
    const plain = decryptNotifyResource(resource, key);
    console.log(JSON.stringify({ ok: true, event_type: notify.event_type || null, resource: plain }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

function cmdChecklist() {
  process.stdout.write(CHECKLIST);
}

function main(argv) {
  const cmd = argv[0] || 'help';
  switch (cmd) {
    case 'validate':
      return cmdValidate(argv[1]);
    case 'serve':
      return cmdServe(argv.slice(1));
    case 'checklist':
      return cmdChecklist();
    case 'decrypt-notify':
      return cmdDecryptNotify(argv.slice(1));
    case 'help':
    case '-h':
    case '--help':
      return printHelp();
    default:
      console.error(`未知命令: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main(process.argv.slice(2));
