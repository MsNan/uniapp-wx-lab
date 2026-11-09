# uniapp-wx-lab

[![test](https://github.com/MsNan/uniapp-wx-lab/actions/workflows/test.yml/badge.svg)](https://github.com/MsNan/uniapp-wx-lab/actions/workflows/test.yml)
[![npm-style](https://img.shields.io/badge/npx-github%3AMsNan%2Funiapp--wx--lab-green)](https://github.com/MsNan/uniapp-wx-lab)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**uni-app 微信小程序 · 支付 + 订阅消息联调实验室**

面向中国 uni-app 开发者的小工具包：离线校验订阅消息 `data` 字段、检查「必须点击/支付后才能弹授权」时机、本地 Mock 下发与支付回调、以及可拷贝进工程的页面示例。

> English: see [README.en.md](./README.en.md)

**免责声明**：本项目与微信 / 腾讯 / DCloud 无关，仅为开发联调辅助。Mock 不可替代正式商户与公众平台配置。**切勿**把真实 `appid` / `secret` / `mch_id` / API 密钥 / 证书提交进仓库。

---

## 为什么做这个？

日常踩坑几乎都卡在这几件事：

1. `uni.requestSubscribeMessage` **只能**在用户点击手势或支付成功回调里调用  
2. 服务端下发时，`data` 的 key / 类型 / 长度必须与模板关键词一致（thing / time / amount / name / phrase…）  
3. 支付回调验签与联调，常常还没有正式商户参数  
4. 一次性模板与长期订阅不能混在同一次请求里  

GitHub 上几乎没有专门的「联调实验室」模板，所以本仓库提供：**可跑测试的 Node 工具 + 拷贝即用的 uni-app 页面**，而不是空 README。

---

## 快速开始

```bash
# 校验示例 payload（零依赖）
npx -y github:MsNan/uniapp-wx-lab validate examples/payloads/order-shipped.json

# 打印中文踩坑清单
npx -y github:MsNan/uniapp-wx-lab checklist

# 启动本地 Mock（默认 127.0.0.1:3789）
npx -y github:MsNan/uniapp-wx-lab serve
# 或 clone 后：
git clone https://github.com/MsNan/uniapp-wx-lab.git
cd uniapp-wx-lab && npm start
```

本地开发：

```bash
npm test
node bin/cli.js validate examples/payloads/order-shipped-invalid.json   # 应失败并打印 errors
```

---

## 字段类型速查

| 类型 | 规则（本仓库实现） | 示例 |
|------|-------------------|------|
| `thing` | ≤20 个字符（汉字/字母/数字/符号） | `窑河特产礼盒` |
| `time` | 常见时间格式 | `2026-11-05 10:00` / `10:00` |
| `date` | 日期 | `2026-11-05` |
| `amount` | 金额 | `¥12.50` / `12.50元` |
| `name` | 中文 ≤10 或英文 ≤20 | `郭涛` / `Theo Tang` |
| `phrase` | ≤5 个汉字 | `已发货` |
| `number` | 数字字符串 | `42` |
| `character_string` | ≤32 | `ORD20261105001` |
| `phone_number` | 手机号基本格式 | `13800138000` |
| `car_number` | 车牌基本格式 | `京A12345` |

API：

```js
const { validateSubscribeData, checkSubscribeTiming, buildSubscribePayload } = require('uniapp-wx-lab');
// 或相对路径: require('./lib')
```

---

## Mock API（默认端口 3789）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/mock/templates` | 内置示例模板字段 |
| GET | `/mock/subscribe/recent` | 最近 N 次订阅下发记录 |
| POST | `/mock/subscribe/send` | 按示例模板校验 `data`，返回类微信 `{ errcode, errmsg }` |
| POST | `/mock/pay/notify` | 模拟支付回调；`MOCK_SKIP_SIGN=1` 跳过验签，否则用 `MOCK_API_KEY`（默认 `lab-test-key`）对 body 做 HMAC-SHA256 hex |

内置示例 `template_id`：`TMPL_ORDER_SHIPPED`、`TMPL_PAY_SUCCESS`、`TMPL_APPOINTMENT`（**不是**真实微信模板 ID）。

```bash
curl -s http://127.0.0.1:3789/health
curl -s -X POST http://127.0.0.1:3789/mock/subscribe/send \
  -H 'Content-Type: application/json' \
  -d @examples/payloads/order-shipped.json
MOCK_SKIP_SIGN=1 curl -s -X POST http://127.0.0.1:3789/mock/pay/notify \
  -H 'Content-Type: application/json' \
  -d '{"out_trade_no":"LAB001","total_fee":"1"}'
```

---

## 微信支付 APIv3 回调：本地验签 + 解密（v0.2.0）

真实 APIv3 回调是「先验签、再解密」。`lib/pay-v3.js` 用 Node 内置 `crypto` 按官方文档规则实现，零依赖、不联网、不保存密钥：

- `verifyNotifySignature({ headers, body, publicKey })`：验签串为 `时间戳\n随机串\n原始body\n`，SHA256 with RSA；
  - 用**平台证书或微信支付公钥**（不是商户 API 证书）；`body` 必须是原始请求体（先 `JSON.parse` 再 `stringify` 会失败）
  - `WECHATPAY/SIGNTEST/` 开头的签名是微信的签名探测，返回 `{ ok:false, probe:true }`
  - 可选 `expectedSerial` 比对 `Wechatpay-Serial`；默认检查时间戳偏差 300 秒（`maxSkewSeconds: 0` 关闭）
- `decryptNotifyResource(resource, apiV3Key)`：AEAD_AES_256_GCM，32 字节 APIv3 密钥，`nonce` 作 IV，`associated_data` 作 AAD，密文末尾 16 字节为认证标签
- `encryptNotifyResource(...)`：只用于本地造测试数据

```js
// npm i github:MsNan/uniapp-wx-lab
const { verifyNotifySignature, decryptNotifyResource } = require('uniapp-wx-lab');
const v = verifyNotifySignature({ headers: req.headers, body: rawBody, publicKey: wxpayPublicKeyPem });
if (!v.ok) return res.status(401).json({ code: 'FAIL', message: v.reason });
const notify = JSON.parse(rawBody);
const tx = decryptNotifyResource(notify.resource, process.env.WXPAY_APIV3_KEY);
```

命令行解密（密钥只从环境变量 `WXPAY_APIV3_KEY` 读取，避免留在 shell 历史）：

```bash
WXPAY_APIV3_KEY=你的32字节APIv3密钥 npx -y github:MsNan/uniapp-wx-lab decrypt-notify notify.json
# 仓库样例使用公开测试密钥：
npx -y github:MsNan/uniapp-wx-lab decrypt-notify examples/payloads/pay-notify-v3.json --lab-key
```

> `examples/payloads/pay-notify-v3.json` 是用公开测试密钥加密的**示例数据**，商户号、订单号都是虚构的。真实密钥请勿提交进仓库。

---

## uni-app 示例页

见 [`examples/uni-app/`](./examples/uni-app/)：

- `pages/lab/index.vue` — 实验室首页（模拟支付后订阅 / 点击后订阅 / 字段说明）  
- `pages/lab/subscribe.vue` — 订阅授权调试  
- `utils/subscribe-lab.js` / `pay-lab.js` — 封装与中文提示  

**本目录不是完整 HBuilderX 工程**，请按该目录 README 拷贝进你的项目，并在 `pages.json` 注册路由。支付示例明确为**模拟**，不会调用真实 `uni.requestPayment`。

---

## 项目结构

```
lib/                 离线校验、payload 构建、APIv3 回调验签/解密（零依赖）
server/              Mock HTTP 服务（纯 Node http，无 express 依赖）
bin/cli.js           validate / serve / checklist / decrypt-notify
examples/payloads/   合法 / 非法 JSON 样例
examples/uni-app/    可拷贝页面
test/                node:test
```

---

## License

MIT © Theo（涛哥）

不附属于 WeChat / Tencent / DCloud。

## 创作者主页

我的爱发电主页：[桥页浏览器助手](https://afdian.com/a/bridgepage)。目前正在开发连接现有 Chrome 与 MCP AI 助手的浏览器工具，产品尚未正式开售。


### 桥页浏览器助手官网

官网：[桥页 BridgePage — 连接 AI 与现有 Chrome](https://bridgepage-activation.xiaobai-noob.workers.dev/)。官网提供产品介绍、下载与安装说明，并公开关联[我的爱发电主页](https://afdian.com/a/bridgepage)。

产品发布记录：[bridgepage-releases](https://github.com/MsNan/bridgepage-releases)。桥页是我开发的另一款独立软件，与本仓库的 uni-app 工具用途不同，目前尚未正式开售。
