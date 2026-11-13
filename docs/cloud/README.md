# Linux 云端模式（手工部署）

云端模式复用本项目的管理页面与调度器，底层运行 Linux 版 Agent2API + 匹配架构/版本的提供商插件。本目录是部署约束说明，不是一键安装器。请先备份已有反向代理配置并确认资源与端口。

## 必要组件

- Node.js 22+、Linux 版 Agent2API 3.4.2、匹配的签名提供商插件。
- 独立、非登录服务用户和私有状态目录；核心与面板都只监听回环地址。
- TLS 反向代理；管理页面必须先经过管理员认证。`/v1/*` 单独保留 Bearer 模型 Key 认证，不注入管理 Key。
- 固定 HTTPS Origin 和专用反代凭据。代理凭据应放在仅代理及服务用户可读的私有配置中，不写进仓库。

## 面板环境变量

```text
DW_STATE_DIR=/var/lib/doubao-work/state
DW_PANEL_PORT=43862
DW_UPSTREAM_PORT=43861
DW_PUBLIC_ORIGIN=https://YOUR_DOMAIN:YOUR_PORT
DW_PROXY_TOKEN_FILE=/var/lib/doubao-work/state/proxy-token.key
```

`DW_PUBLIC_ORIGIN` 必须是**不含路径和末尾斜杠**的 HTTPS Origin。云端面板仅接受回环代理、精确 Host 以及 `X-Doubao-Proxy-Token` 的组合。私有代理凭据应为 48–128 位字母、数字、下划线或短横线；随机生成，不与管理员密码或模型 Key 混用。

服务器上准备相同格式的 `panel-management.key` 和 `probe-model.key`，分别用于核心管理和受限模型访问；不要复制日常其他网关的完整数据库。安装插件、创建受限模型 Key 后，再启动：

```sh
node /path/to/doubao-work-gateway/server.mjs
```

核心环境变量使用 `AGENT2API_HOST=127.0.0.1`、`AGENT2API_PROXY_PORT=43861`，与面板配置一致。账号、密钥、插件状态均保存在 `DW_STATE_DIR`，服务启动配置由 systemd 或其他进程管理器负责。新目录权限建议为 0700，密钥文件为 0600。

## Caddy 路由约束

参考 [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth) 和 [handle](https://caddyserver.com/docs/caddyfile/directives/handle)。独立站点或端口中：

1. `/v1/*` → 回环核心。要求请求含 `Authorization: Bearer ...`，最终 Key 有效性由核心判断，避免底层匿名模型目录探针在公网开放。
2. 其余路径 → **先管理员认证**，再转发回环面板。Caddy 只保存密码哈希；不要使用 HTTP 明文认证。
3. 反代覆盖 `X-Doubao-Proxy-Token` 为私有凭据，不信任客户端传入值；保留外部 Host。
4. 保持管理 API 的精确 Origin 与自定义请求头检查，不将管理入口直接映射到底层网关。
5. SSE 设置合适的长请求时间与即时刷新；不添加固定上游 Authorization 管理密钥。

已有域名的 443 被其他服务使用时，应保留现有服务，选择经确认的新端口或独立子域名，并验证外部端口实际可达与证书有效。

## 在桌面电脑登录、同步到云端

云端不启动图形浏览器，使用本机管理台完成账号登录。在本项目根目录创建私有 `.cloud-target.json`：

```json
{
  "origin": "https://YOUR_DOMAIN:YOUR_PORT",
  "user": "ADMIN_USER",
  "password": "ADMIN_PASSWORD"
}
```

先将配置文件权限设为私有（可运行 `npm run secure-cloud`；Unix 使用 `0600`，Windows 使用 ACL），使用 `npm start` 启动本机项目，随后：

1. 云端工作台点击「添加账号」→「打开本机登录助手」。
2. 本机会打开 `http://127.0.0.1:43862/#cloud-login`，明确显示已配置的云端地址。
3. 点击「登录并接入云端」，在独立 Chrome / Edge 窗口完成登录。
4. 本机核验成功后，仅将本次账号通过 HTTPS 自动同步到已配置云端。回到云端页面即可看到账号；无需运行终端命令。

「同步现有账号到云端」用于已在本机登录的账号。相同身份更新登录状态，不重复创建；同步不更改云端每日计划。云端的浏览器按钮指向**当前电脑**的回环地址，本机助手需要正在运行。换电脑后应在该电脑安装项目并配置其私有连接；手机端不包含本机助手。

此过程将账号登录凭据保存在你指定的服务器，配置前应确认服务器归属和访问控制。目标只从本机私有配置读取，网页不接收任意云端 URL 或管理员密码。状态接口只返回目标地址，不返回密码或 Cookie。结果待核对时先查看两端账号列表，不自动重复提交。

配置文件已加入 `.gitignore`，不要强制提交。原命令 `node ./sync-to-cloud.mjs` 保留为手工运维入口；该命令另支持 `DW_CLOUD_CONFIG`。本机运行路径解析沿用 `DW_RUNTIME_ROOT` / `.runtime-root` / `.local`，也可用 `DW_STATE_DIR` 明确状态目录。

## 验收边界

- 服务 active、页面可登录、模型目录成功、真实生成请求是四个不同的验收层次。
- 云服务器出口可能触发上游限流或人机验证。遇到 429 时应停止连续重试，先按上游提示处理；账号显示可用并不保证模型请求已获放行。
- 已完成一次 Debian 12 云端实机部署、HTTPS 管理认证、两个账号迁入与同步、目录和权限验证；该次文本生成遇到上游 429 / 人机验证，尚未通过生成验收。
- 云端自动签到默认关闭。仅在确认总开关、账号选择和每日时间后开启，避免本机与云端双重调度。
