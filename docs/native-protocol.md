# 原生上游适配

网关通过固定的 `https://www.doubao.com` 访问豆包工作，重定向视为失败。地址不接受账号备份、节点配置或模型输入覆盖。协议实现参考现有独立适配源码及豆包官网公开前端资源；无需旧核心、插件宿主或其二进制。源码来源和许可见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

| 能力 | 适配请求 | 说明 |
| --- | --- | --- |
| 身份 | `GET /passport/account/info/v2/` | 取无损账号 ID 与企业身份字段；身份成功不自动恢复转发 |
| 模型 | `/alice/user/launch`、`/alice/slot/action_bar_v3/brief_list` | 以此账号返回的可选模式与模型为准 |
| 额度 | `/alice/commerce/sale/subscription/overview/`、`/alice/commerce/sale/subscription/entry/config/` | 只显示上游提供的额度字段 |
| 签到 | `/alice/ug/campaign/v3/detail/` 或 `/alice/ug/campaign/list/`；`/alice/ug/campaign/item/reward/claim/` | 仅在唯一每日任务可领、且持久化当天预约后提交；成功需回查 |
| 聊天 | `POST /chat/completion` | 文本和流式回复；只在收到明确结束事件时完成 |

`710022004` 或上游明确返回验证决定时记录为人工验证；普通 429 独立限流。原始响应、会话和提示词不写入诊断记录。原生适配的真实账号与新加坡出口需分别验收；本地固定测试并不证明线上行为。
