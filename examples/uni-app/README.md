# uni-app 示例页（拷贝即用）

本目录**不是**完整的 HBuilderX / Vite uni-app 工程，请把文件拷贝进你自己的项目：

1. 复制 `pages/lab/*.vue` → 你的 `pages/lab/`
2. 复制 `utils/*.js` → 你的 `utils/`（或 `@/utils/`）
3. 在 `pages.json` 注册：

```json
{
  "path": "pages/lab/index",
  "style": { "navigationBarTitleText": "联调实验室" }
},
{
  "path": "pages/lab/subscribe",
  "style": { "navigationBarTitleText": "订阅调试" }
}
```

4. 在微信小程序后台申请订阅消息模板，把 tmplId 填进首页输入框
5. 真机或开发者工具打开「模拟支付成功后订阅 / 仅点击后订阅」

支付相关代码明确标注为**模拟**，不会调用 `uni.requestPayment`。
