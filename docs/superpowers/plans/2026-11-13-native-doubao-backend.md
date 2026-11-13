# Native Doubao Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有面板变为只依赖 Node 与用户主动登录的浏览器、使用自有存储和豆包协议客户端的独立项目。

**Architecture:** 单 Node 进程提供模型端口 43861 和管理端口 43862。账号与 Key 进入加密存储，面板直接调用自有服务，原生协议客户端接入官方网页服务；验证状态机由请求路由持久化管理。

**Tech Stack:** Node.js 22+ 内置 http / crypto / fs / streams，现有无构建前端、Windows ACL 与独立浏览器管道。

**Spec:** `docs/superpowers/specs/2026-11-13-native-doubao-design.md`

## Global Constraints

- 不启动 Agent2API 核心、旧 App、server 或插件进程。
- Windows / macOS / Linux，Node.js 22+，不增加 npm 第三方运行依赖。
- 保留两个默认回环端口及已有 UI、账号 JSON、节点 JSON、自建 API Key。
- Cookie 与可复制的 Key 使用 AES-256-GCM，主密钥独立保存；Unix 私有权限与 Windows ACL。
- `710022004` 只标记实际触发账号并持久化暂停，本次请求不自动接力；人工确认恢复后进行一次用户发起的复测。
- 现有云服务器和旧数据不替换、不删除；实际账号验证、真实调用及部署分别验收。
- 每个任务完成一次测试与提交；真实协议和真实账号结果不由模拟测试替代。

---

## Task 1: 协议事实和适配器契约

**Files:** Create `native/protocol.mjs`, `native/doubao-client.mjs`, `test/native-client.test.mjs`, `docs/native-protocol.md`.

**Interfaces:** `createDoubaoClient({fetchImpl,now})` produces `identity(session)`, `models(session)`, `quota(session)`, `checkin(session)`, `chat(session,request,{signal})`. `session` contains a cookie array and necessary observed device fields; responses are normalized domain objects, not raw credential-bearing replies.

- [ ] 读取官方页面与观察到的前端资源，将原始材料存于仓库之外的私有 research 目录；只将方法、路径、非敏感字段、SSE 事件与证据来源写入协议说明。

```sh
mkdir -p ../../work/native-research
chmod 700 ../../work/native-research
```

- [ ] 先写客户端边界测试，确保只向观察确认的官方 HTTPS 主机发送 Cookie，不跟随重定向到其他目的地；不打印原始响应或输入凭据。

```js
assert.equal(normalizeProviderError({code:710022004}).type,'account_verification_required');
assert.equal(normalizeProviderError({code:710022004}).retryable,false);
```

- [ ] 执行 `node --test test/native-client.test.mjs`，确认缺失实现时失败；依据协议事实实现对应请求和响应转换，按方法逐项由红转绿。
- [ ] 不通过聊天请求探测验证状态；身份、目录等只读调用与真实聊天分开。协议不明确时停止相应真实请求并继续离线测试，不发送猜测的签到或聊天参数。
- [ ] 提交协议事实、适配器与测试，不提交原始 Cookie / HAR / 个人资料。

## Task 2: 加密存储和账号状态机

**Files:** Create `native/store.mjs`, `native/account-state.mjs`, `test/native-store.test.mjs`, `test/native-state.test.mjs`.

**Interfaces:** `openStore({dir,now})` produces `snapshot()`, `mutate(fn)`, `close()`; records include accounts, keys, scheduler and bounded diagnostics. `accountState.onFailure(account,error)` and `accountState.restore(account,{confirmed:true})` return persisted state transitions. Session ciphertext decrypts only inside account operations.

- [ ] 先写加密往返、篡改认证失败、原子更新和重启状态保持测试。

```js
const store=await openStore({dir});
await store.mutate(s=>{s.accounts.push({id:'A',state:'ready',session:{cookies:[{name:'sessionid',value:'FIXTURE_ONLY'}]}});});
assert(!String(await readFile(join(dir,'native-vault.json'))).includes('FIXTURE_ONLY'));
await store.close();
assert.equal((await openStore({dir})).snapshot().accounts[0].state,'ready');
```

- [ ] 测试 `710022004` 转换和持久化；正常身份查询不清除 `needs_verification`。

```js
assert.equal(onFailure({state:'ready'},{upstream_code:710022004}).state,'needs_verification');
assert.throws(()=>restore({state:'needs_verification'},{confirmed:false}));
```

- [ ] 使用独立随机主密钥、12 字节随机 nonce 与 GCM tag；只在成功认证后解析 JSON。初始化已损坏文件时停止，不静默清空。
- [ ] 调用现有 private-files 接口保护文件与目录；并发写入串行，持久化成功后才更新内存。
- [ ] 运行对应测试并提交。

## Task 3: 自有账号、Key、JSON 与调度服务

**Files:** Create `native/services.mjs`, `native/migration.mjs`, `test/native-services.test.mjs`; modify `server.mjs`, `keys.mjs`, `transfers.mjs`.

**Interfaces:** `createNativeServices({store,client})` produces `accounts`, `catalog`, `usage`, `records`, `keys`, `importAccounts`, `exportAccounts`, `importCookies`, `checkin`, `setSchedule` and state recovery methods. Panel receives service objects directly. Client contract is Task 1; store contract is Task 2.

- [ ] 从账号列表、密钥创建及 JSON 往返三条公共服务接口开始写失败测试，保留掩码与固定模型权限。

```js
const result=await services.keys.create({name:'fixture',requestId:'fixture-create-0001'});
assert(!JSON.stringify(await services.keys.list()).includes(result.secret));
assert.equal((await services.exportAccounts(['A'])).accounts.length,1);
```

- [ ] 迁移旧 JSON 时只读取必要豆包字段，转换为原生账号格式；身份核验与导入结果分开标记。保留预览、重复策略、有效期和一次性提交，禁止导入其他提供商及任意代理。
- [ ] 面板改为直接调用服务，删除运行链路中的旧核心 request 桥接、插件 ready 检查和模型目录依赖；既有前端路由及来源校验保持。
- [ ] 签到通过 `client.checkin`，提交前先落盘当天尝试标记；跳过需要验证 / 登录的账号。未知结果不自动再次提交。
- [ ] 使用协议确认后的身份方法接入 BrowserLogin 回调；验证模式保留窗口直到用户确认。先通过模拟接口测试，再由持有人完成真实登录验收。
- [ ] 运行 HTTP 与服务测试，提交。

## Task 4: 模型 API、SSE 与验证码暂停恢复

**Files:** Create `native/model-api.mjs`, `native/sse.mjs`, `test/native-model-api.test.mjs`, `test/native-sse.test.mjs`; modify `public/ui.js`, `public/manage.js`, `public/index.html`.

**Interfaces:** `createModelHandler({services,client,store})` returns an http request handler for `/v1/models` and `/v1/chat/completions`. `decodeEvents(stream)` yields confirmed upstream events; `toOpenAI(event,context)` emits compatible chunks without credentials. Services hold account selection and per-account concurrency.

- [ ] 先测试模型 Key 与管理入口分离、输入上限及账号单并发。
- [ ] 用两次用户请求测试第一次验证码失败后不再调用相同账号。

```js
await requestChat();
assert.equal(store.snapshot().accounts[0].state,'needs_verification');
const callsAfterFirst=calls;
await requestChat();
assert.equal(calls,callsAfterFirst);
```

- [ ] 实现真实流式客户端调用，支持 UTF-8 分片、正常完成、错误事件、断流及客户端取消；只有真实完成事件才发送正常完成标记。
- [ ] 验证码错误在发出头之前返回 429 和 `account_verification_required`；流已开始则发送错误并终止。本次失败不在其他账号自动重试。
- [ ] 前端显示准确的账号暂停原因、官网验证指引、明确的人工确认恢复操作及私有诊断请求标识。身份成功或周期刷新不自动恢复。
- [ ] 测试“恢复后单次复测、再次失败重新暂停”，检查截图不含凭据后提交。

## Task 5: 独立启动、迁移与三系统交付

**Files:** Modify `launcher.mjs`, `platform.mjs`, `start.*`, `stop.*`, `.github/workflows/ci.yml`, `package.json`, `README.md`, `docs/platforms.md`; create `test/native-lifecycle.test.mjs`, `scripts/native-smoke.mjs`, `docs/validation-native.md`.

**Interfaces:** `startNative({env,log})` creates both http servers, browser controller and authenticated local stop control in one process; returns `{stop,closed,paths}`. It imports native services rather than spawning a core. `npm start`, `npm stop`, `npm run status` and `npm run doctor` remain user entry points.

- [ ] 先写在空 runtime 目录启动的测试，断言无需上游二进制，正常停止仅清理本项目资源。

```js
const app=await startNative({env:{DW_RUNTIME_ROOT:root},client:fixtureClient});
assert.equal((await app.services.accounts()).length,0);
await app.stop();
assert.equal(await portIsOpen(app.modelPort),false);
```

- [ ] 删除核心查找、插件安装、核心日志和外部核心子进程运行路径；保留锁、端口冲突检查、私有权限和认证停止。
- [ ] CI 改为三系统纯 Node 原生服务测试与独立空白页浏览器管道检查，不下载 Agent2API 或插件。选择当前可用的 runner，修复实际失败后再记录通过。
- [ ] 只读迁移旧资料到新独立状态目录，原文件保留，核对身份与开关；真实账号信息只保存在私有路径。
- [ ] 本地与三系统测试后，等待持有人完成官网验证及授权一次真实文本流式请求，再分别记录结果。实际云端替换需要备份、部署确认和单次复测，不在 CI 中进行。
- [ ] 执行 `npm run check`、`npm test`、链接 / 图片路径检查及凭据扫描；更新独立运行说明与 Linux DO 致谢，推送经验证版本，报告 commit 和 CI 证据。
