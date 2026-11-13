<div align="center">
  <img src="public/doubao-work-avatar.png" width="72" alt="豆包工作头像" />
  <h1>豆包工作 · 账号管家</h1>
  <p>只做豆包工作：多账号、每日签到、JSON 备份、接口节点与 API Key，一个清爽的管理面板。</p>
  <p><strong>Windows / macOS / Linux</strong> · <strong>Node.js 22+</strong> · <strong>无 npm 第三方依赖</strong> · <strong>浅色 / 深色</strong></p>
</div>

> **独立第三方项目，非豆包官方产品。** 本仓库包含管理面板、浏览器登录桥接与签到调度代码；模型转发依赖 **Agent2API 3.4.2 + 匹配的提供商插件**。不包含上游二进制、账号数据或密钥，不是完整复刻豆包工作桌面端。

## 界面预览

<table>
  <tr>
    <td align="center"><strong>工作台</strong></td>
    <td align="center"><strong>接口节点</strong></td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/overview-v02.jpg" width="580" alt="新版工作台：账号勾选、批量操作、JSON 备份和今日签到" /></td>
    <td valign="top"><img src="docs/screenshots/nodes-v02.jpg" width="580" alt="接口节点：当前网关、保存的节点和 JSON 导入导出" /></td>
  </tr>
</table>

新版截图来自实际运行的本机测试实例，使用演示账号和假凭据，仅用于展示布局；账号数、模型目录与奖励以你的账号和上游实时返回为准。

更多界面：[自动签到](docs/screenshots/checkin.png) · [深色工作台](docs/screenshots/overview-dark-v02.jpg) · [手机工作台](docs/screenshots/overview-mobile-v02.jpg) · [手机节点页](docs/screenshots/nodes-mobile-v02.jpg)。

## 功能

| 功能 | 说明 |
| --- | --- |
| 多账号 | 独立浏览器登录、自动接入；同一账号再次登录更新状态，不重复新增 |
| 账号工作台 | 额度与登录状态、搜索、筛选、排序、备注、暂停转发、手动签到 |
| 批量管理 | 勾选账号后启用 / 暂停转发、加入 / 移出签到计划，确认后执行 |
| 账号 JSON | 所选账号备份、导入预览、重复跳过 / 更新；备份含登录凭据 |
| 接口节点 JSON | 保存、编辑、导入导出客户端连接资料；默认导出不含 API Key |
| 自动签到 | 北京时间每日计划、逐账号开关、同日自动提交去重、结果记录 |
| API Key 管理 | 随机生成或自定义内容、命名、复制、启用与停用 |
| 模型接入 | OpenAI 兼容接口地址、模型目录、模型 ID 与 curl 示例 |
| 外观 | 蓝白 / 深色主题、圆角头像、窄屏布局、键盘焦点与减少动画设置 |
| 异常处理 | 区分适配器离线与空账号池；部分同步失败保留并标记上次数据 |

### 项目边界

- 只管理豆包工作账号与连接资料；本机和云端模式沿用同一管理界面。
- API Key 固定限制到豆包工作模型调用，不含底层网关管理权限。
- 不是多用户后台：当前以对本机的访问权限作为管理边界，没有独立管理员/普通用户角色系统。
- 插件、云电脑、工作流和文件任务不在本版功能范围内。
- 使用 Node.js 跨平台源码启动，不捆绑大型桌面安装包。macOS 提供 `.command`，Windows 提供 `.cmd`，Linux 提供 `.sh` 入口。无图形桌面的服务器使用账号 JSON 或本机助手迁入。
- Linux 云端公开访问仍需独立服务、HTTPS 与管理员认证，见 [云端部署说明](docs/cloud/README.md)。本轮不更新现有服务器。

## 快速开始

首次使用请先完成下方「开始使用」中的核心与插件准备；源码包不包含这些上游依赖，也不包含账号数据。已经准备好运行环境时，在项目目录执行：

```sh
npm start
```

1. 打开 [本机管理面板](http://127.0.0.1:43862)，点击「添加账号」，在独立 Chrome / Edge 窗口完成登录。
2. 核验后账号会出现在工作台；添加下一个账号会使用全新的临时会话。
3. 需要迁移时，在工作台「备份账号」；已有 JSON 则选择「导入 JSON」，先预览再确认。
4. 客户端接入资料在「接口节点」单独保存与导出；账号备份和节点配置分别管理。

无需安装 npm 第三方依赖。首次完整安装流程、停止方法和运行目录设置保留在下方。

## 开始使用

### 1. 准备环境与源码

需要：

- Windows x64、macOS，或 Linux x64 / arm64；Node.js 22 或更高版本、Git。
- 浏览器登录需要 Chrome / Edge 与图形桌面；Linux 需可用的 DISPLAY / Wayland 会话。服务器可只用账号 JSON 导入，无需图形浏览器。
- 上游适配器可能使用豆包工作的设备标识；不同系统的实际账号完整登录仍需实测确认，已有登录快照可通过 JSON 迁移。
- 备用 WebKit 助手仅在 macOS 提供，首次编译需要 Xcode Command Line Tools；通用浏览器登录不依赖 Swift。

```sh
git clone https://github.com/245678000000/doubao-work-gateway.git
cd doubao-work-gateway
node --version
mkdir -p .local/runtime .local/state .local/tmp
```

前后端仅使用 Node.js 内置模块，**无需 `npm install`**。

### 2. 准备转发核心与提供商插件

仓库不捆绑上游二进制，请从 [Agent2API v3.4.2](https://github.com/aimod-cc/Agent2API/releases/tag/v3.4.2) 和 [匹配的签名提供商插件 v3.4.2](https://github.com/Agent2Builder/agent2api-providers-releases/releases/tag/v3.4.2) 下载对应系统资源：

| 系统 | 转发核心资源 | 提供商插件资源 |
| --- | --- | --- |
| Windows x64 | `agent2api-server-windows-amd64.zip` | `agent2api-providers-3.4.2-x86_64-pc-windows-msvc.zip` |
| Linux x64 | `agent2api-server-linux-amd64.tar.gz` | `agent2api-providers-3.4.2-x86_64-unknown-linux-gnu.zip` |
| Linux arm64 | `agent2api-server-linux-arm64.tar.gz` | `agent2api-providers-3.4.2-aarch64-unknown-linux-gnu.zip` |
| macOS Apple Silicon | `Agent2API_3.4.2_universal.dmg` | `agent2api-providers-3.4.2-aarch64-apple-darwin.zip` |
| macOS Intel | 同一 Universal 包 | `agent2api-providers-3.4.2-x86_64-apple-darwin.zip` |

1. Windows / Linux：将 server 资源**完整解压**到 `.local/runtime/`，保留 `ui/` 等附带文件；核心路径分别为 `agent2api-server.exe` 和 `agent2api-server`。Linux 需给予核心执行权限。
2. macOS：将 DMG 中的 `Agent2API.app` 放入 `.local/runtime/`。
3. 将对应系统的提供商 ZIP 重命名为 `providers.zip`，放入 `.local/runtime/`，不要将 Windows / Linux 插件互换。
4. 首次启动时，若尚未安装豆包工作插件，启动器会将该本地 ZIP 交给核心的签名校验和安装接口，然后准备受限模型 Key。已安装但停用的插件不会被自动改动。

已有独立状态目录或插件安装可继续使用。也可用 `DW_CORE_BIN` 和 `DW_PROVIDER_PACK` 指定本机绝对路径；不接受网页传入的任意程序路径，不自动下载或执行在线脚本。核心和插件版本需要匹配，请保留现有数据的备份。

### 3. 启动面板

```sh
npm start
```

也可使用本系统入口：Windows 双击 `start.cmd`，macOS 双击 `start.command`，Linux 执行 `sh ./start.sh`。所有入口调用同一 Node 启动器。

| 入口 | 地址 |
| --- | --- |
| 管理面板 | [http://127.0.0.1:43862](http://127.0.0.1:43862) |
| 模型 Base URL | `http://127.0.0.1:43861/v1` |

首次启动会生成本机管理凭据和默认模型 Key；它们彼此分离。默认模型 Key 留作面板连接，不在面板中停用。端口被占用时，启动脚本会提示退出，不接管其他服务。

停止服务：

```sh
npm stop
```

停止会保留账号与设置。也可在启动终端按 `Ctrl+C`；停止命令通过本机私有令牌联系当前启动器，不按未核验的 PID 结束其他进程。macOS 原有启动记录保留迁移停止处理。强制结束进程或断电不属于正常清理流程。本项目不安装系统服务或开机自启。

<details>
<summary>已有独立运行目录，或希望将数据放在其他位置？</summary>

默认运行根目录为项目内的 `.local/`。在同一终端指定 `DW_RUNTIME_ROOT`，让启动、停止和备用助手使用另一目录：

```sh
export DW_RUNTIME_ROOT="$HOME/Library/Application Support/Doubao Work Gateway"
mkdir -p "$DW_RUNTIME_ROOT/runtime" "$DW_RUNTIME_ROOT/state" "$DW_RUNTIME_ROOT/tmp"
# 将 Agent2API.app 放在 "$DW_RUNTIME_ROOT/runtime/"，并按相同 state 路径准备插件
npm start
# 在同一终端停止
npm stop
```

也可以在项目根目录的 `.runtime-root` 文件中放一行运行根目录的**绝对路径**，供 Finder 双击入口共用。它只作为文本路径读取，不作为脚本执行。

优先级：`DW_RUNTIME_ROOT` → `.runtime-root` → 项目内 `.local/`。`.runtime-root` 和运行目录均已加入 `.gitignore`；请勿提交其中的私有数据。

</details>

## 云端部署

云端模式将账号保存在服务器，由独立核心与面板运行；云端「添加账号」会打开本机登录助手，浏览器登录完成后自动同步本次账号；也支持按钮同步已有账号。HTTPS 反代必须有管理员认证与私有代理凭据，不能直接暴露本机版面板。[完整说明与已验证边界](docs/cloud/README.md)。

## 使用说明

### 添加账号

「工作台 → 添加账号 → 打开浏览器登录」：

1. 在新打开的豆包官方页面完成扫码或手机验证。
2. 后台核验账号并保存到本机网关。
3. 面板自动刷新，临时浏览器窗口关闭；可继续添加下一个账号。

每次使用全新的临时浏览器资料目录，不读取或复制日常 Chrome / Edge 的资料，也不退出日常浏览器账号。同一时间只运行一次登录；10 分钟未完成会结束，也可以主动取消。核验提交阶段需等待结果，避免误判是否已保存。

备用方式：先在运行中的项目上执行 `zsh ./add-account.command`，首次会编译并打开独立 WebKit 窗口；之后也可从添加账号弹窗的「其他登录方式与说明」打开。登录后点击窗口顶部「将此账号接入本机网关」，再回面板刷新。

### 账号 JSON 备份与恢复

- **备份全部或所选账号**：工作台点击「备份账号」，或勾选账号后点击「导出所选」。每份文件支持 1–20 个账号，账号较多时分批导出。
- **先预览，再导入**：选择 JSON 文件，查看名称、数量和重复情况。默认跳过重复账号，也可明确选择更新其登录状态。
- 格式为 `doubao-work-accounts/v1`、`version: 2`；也接受带完整豆包工作快照的 Agent2API version: 2 导出。文件上限 512 KB，仅处理非桌面的豆包工作账号。
- **文件含完整登录凭据，且为普通 JSON。** 下载前需要确认；请放在可信位置并另行加密保管，不上传公开仓库或分享给他人。
- 备份不包含管理员密钥、模型 Key 和签到计划。登录快照有时效，失效后仍需重新登录。

### 接口节点 JSON

「接口节点」保存客户端需要的名称、Base URL、模型 ID 和可选 Key，支持手工编辑和 JSON 导入导出：

- 默认导出不含 Key；携带完整 Key 时，需要额外勾选并确认。
- 格式为 `doubao-work-nodes/v1`，每次 1–50 个节点，文件上限 512 KB。见 [节点文件示例](docs/examples/nodes.json)。
- 重复节点会更新；导入文件没有 `apiKey` 字段时保留原有 Key。列表仅显示掩码。
- 节点配置与账号登录分开。保存节点不会切换网关上游、合并第三方账号池或自动发起模型请求。
- 此格式是本项目的连接配置格式，不宣称直接兼容所有 CPA、Clash、订阅文件或客户端。

完整字段、重复判断和文件保护说明见 [JSON 备份与接口节点](docs/json-transfer.md)。

### 勾选与批量操作

工作台支持搜索、状态筛选和排序；每次最多选择 20 个账号。可批量启用 / 暂停转发，或加入 / 移出自动签到，执行前会显示所选数量和动作。

加入签到不改变每日计划总开关。批量转发修改遇到失败即停止，分别报告已完成、待核对和未尝试数量，不自动重放整批操作。此版没有批量签到按钮，避免重复提交待确认的领取。

### 每日签到

1. 在「自动签到」选择参与账号。
2. 设置北京时间，开启每日计划总开关，点击 **保存计划**。
3. 保持运行电脑唤醒、网关运行并联网。

初始默认关闭，预设时间 `09:30`。逐账号开关即时保存；总开关和时间修改需要点击保存。已签到、暂停转发或登录失效的账号会跳过。每天每账号自动提交一次；不确定结果不自动重试，留给人工核对。休眠唤醒且服务仍在运行时，会继续检查当天尚未尝试的账号。

请保持底层 Agent2API 自带定时签到关闭，避免双重调度。奖励是否可领、领取结果和额度以豆包返回为准。

### 创建自己的 API Key

「接口接入 → API Key 管理 → 创建 Key」：

- 填写名称即可随机生成 Key；推荐每个客户端一把。
- 自定义内容可选：32–128 位字母、数字、下划线或短横线。
- 在列表点击 **复制 Key**，填入你使用的客户端；后续可分别改名、停用、启用。
- 列表只显示掩码，复制时才单独取值；关闭创建窗口会清空自定义输入。
- 停用阻止后续请求，已经开始的请求可能继续；不会影响其他 Key。
- 同一创建提交标识在当前服务进程内保留 15 分钟，避免重复创建。结果不确定时先刷新核对，重启后再次手动提交也需先核对。

客户端选择 OpenAI 兼容接口，填写上方 Base URL 和你的模型 Key，模型 ID 从实时目录复制。接口页会生成使用环境变量 `DOUBAO_API_KEY` 的 curl 示例；复制不执行，实际调用可能消耗额度。

## 数据与安全

默认目录结构：

```text
.local/                         # 不提交 Git
├── runtime/
│   ├── Agent2API.app            # 上游应用，自行下载
│   ├── agent2api-server[.exe]   # Windows / Linux 核心（与 Mac App 二选一）
│   ├── ui/                     # server 资源附带的页面
│   ├── providers.zip           # 对应系统、版本的签名插件
│   └── DoubaoAccountLogin.app   # 仅 macOS 可选，备用脚本编译
├── state/                      # 账号库、密钥、设置和插件状态
└── tmp/                        # 临时浏览器资料与编译缓存
```

- 面板仅监听 `127.0.0.1`，检查 Host、Origin、跨站来源和自定义请求头。**不要直接作为公网多用户面板使用。**
- 模型调用 Key 与管理凭据分离；新建 Key 强制只允许 `doubaowork`。面板不提供管理凭据复制入口。
- 登录桥接通过匿名管道连接自己创建的浏览器实例，不开放调试监听端口，不关闭浏览器沙箱或证书验证。
- 正常成功、取消、超时与退出会清理临时会话。突发断电或强制终止可能留下 `tmp/doubao-login-*`，其中可能有登录状态。
- **不要分享 `.local/`、外置运行目录、Cookie、数据库、密钥或原始日志。** 提 Issue 前移除个人名称、账号标识、文件路径及凭据。
- 账号 JSON 及含 Key 的节点导出都是敏感文件。普通节点导出省略 Key；备份文件本身未加密，建议下载后另行加密保存。
- 私有配置在 macOS / Linux 使用 0600 文件与 0700 目录；Windows 使用当前用户与 SYSTEM 的受限 ACL，读取时检查权限，避免用 Unix mode 冒充 Windows 文件保护。节点配置保存在私有状态目录；`.gitignore` 同时排除本项目命名的账号和节点导出文件。
- 上游适配器对本机设备标识的读取由其自身实现；本项目没有宣称整个运行链路与官方客户端完全无关。

更多反馈注意事项见 [SECURITY.md](SECURITY.md)。

## 验证状态

本地验证记录日期：**2026-11-13**，当前源码版本 **0.3.0**。这是本地测试记录，不是对未来上游接口或所有模型的保证。

v0.3 增加跨平台启动、浏览器发现与 Windows ACL。CI 对 Windows / macOS / Linux 运行测试，并对 Windows / Linux 的真实核心做空账号启动检查；最新结果见仓库 Actions。CI 不包含真实账号验证码登录、模型生成或定时签到验收。本轮不升级现有云端服务。

| 项目 | 状态 |
| --- | --- |
| 自动化测试 | 覆盖账号、JSON、Key、调度与跨平台启动；使用临时模拟数据，不操作真实账号。各系统通过 / 跳过数量以 CI 日志为准 |
| Chrome 登录 | 此前已验证真实双账号接入；本轮实机开窗、等待、取消与临时目录清理通过；新版验证码完整登录仍待用户实测 |
| 账号与目录 | 已验证 2 个真实账号显示可用、11 个模型目录条目 |
| 文本流式调用 | 第一个账号的 DeepSeek V4.1 Flash：HTTP 200、正文 SSE 与 `[DONE]` |
| Key 管理 | 随机 / 自定义、改名、停用、启用、重启保留已在真实本机网关验证 |
| 权限隔离 | 模型 Key 访问管理接口为 403；停用后模型目录为 401 |
| 账号 JSON | 演示账号下载后回导、重复预览与跳过已检查；过期、冲突及未知结果保护有自动测试 |
| 接口节点 JSON | 演示节点保存与回导、默认导出不含 Key、错类文件提示已检查 |
| 批量操作 | 独立测试实例的双账号勾选、确认与回执通过，不修改真实账号 |
| 视觉与交互 | 浅色 / 深色、390px 窄屏、账号勾选、搜索、排序、节点表单等已检查 |
| 自动签到 | 调度、北京时间与同日去重通过模拟测试；真实定时执行尚未专项验收 |
| 跨平台 CI | Node.js 22 / 24、Windows / macOS / Linux；包含真实浏览器管道检查。真实核心与签名插件空账号启动覆盖 Windows x64 / Linux x64；Linux arm64 尚待实机验收 |
| 待验证 | Windows / Linux 的真实账号完整登录、Edge 实机登录、同账号重登、跨账号路由、工具调用与图像能力 |

模型目录有某个条目，不等于该条目已完成端到端调用验收。截图中的已签到状态也不等于真实定时调度已经验收。详细证据与边界见 [v0.2 本地验收记录](docs/validation-v02.md)。

## 排障

| 现象 | 处理 |
| --- | --- |
| 缺少当前系统核心 | 按平台表准备 App / server 包，保留附带资源；也可用 `DW_CORE_BIN` 指定绝对路径 |
| Windows 私有文件权限检查失败 | 使用私有用户目录，检查 Windows PowerShell 可用性；云端连接文件可执行 `npm run secure-cloud` 收紧 ACL |
| Linux 浏览器未显示 | 需要非 root 图形桌面与 Chrome / Edge；无桌面服务器直接导入账号 JSON |
| 端口被占用 | 正常退出先前的底层网关 / 本项目；本项目用 `npm stop` 停止 |
| 适配器尚未运行 | 在相同状态目录的底层网关插件页确认插件与豆包工作已启用；必要时关闭后重启该插件，再刷新 |
| 浏览器未找到 | 安装 Chrome / Edge，或按上述流程准备 WebKit 备用助手 |
| Key 或账号创建结果待核对 | 先刷新列表确认，不连续重复提交 |
| 运行电脑休眠后没有执行签到 | 检查唤醒、联网、服务运行、总开关和账号选择；本项目不提供独立后台守护进程 |
| JSON 选错入口 | 账号文件在工作台导入，节点文件在接口节点页导入；先预览类型与数量 |
| 导入预览失效或结果待核对 | 预览十分钟失效；结果待核对时先刷新列表，确认状态后再重新选择文件 |
| 复制按钮未成功 | 保持页面在 `http://127.0.0.1:43862`，检查浏览器剪贴板权限 |

## 开发

```sh
npm run check
npm test
zsh -n start.command stop.command add-account.command runtime-env.zsh
```

```text
launcher.mjs        三系统启动、插件准备、受限 Key 与认证停止
platform.mjs        运行目录、核心与浏览器候选路径
private-files.mjs   Unix 权限与 Windows ACL
server.mjs          HTTP 面板与底层管理 API 桥接
core.mjs            账号视图、北京时间、签到状态与原子设置写入
browser-login.mjs   独立浏览器发现、匿名管道、登录核验与清理
keys.mjs            豆包范围 Key 管理、校验、掩码与提交去重
transfers.mjs       账号备份校验、预览、重复处理与一次性提交
nodes.mjs           接口节点配置、Key 掩码与私有持久化
cloud-sync.mjs      本机私有配置校验与账号云端同步
public/             无构建步骤的前端页面、样式与脚本
Login.swift         可选的独立 WebKit 登录助手
runtime-env.zsh     各入口共用的运行目录解析
start.* / stop.*    各系统薄入口；npm start / stop 通用
test/               Node.js 内置测试；旧版 Mac shell 回归仅在有 zsh 的系统运行
```

## 文档导航

| 想做什么 | 文档 |
| --- | --- |
| 备份账号、恢复登录、导入导出节点 | [JSON 备份与接口节点](docs/json-transfer.md) |
| 查看节点文件字段和可编辑格式 | [节点 JSON 示例](docs/examples/nodes.json) |
| 核对本轮测试与未验收事项 | [v0.2 本地验收记录](docs/validation-v02.md) |
| 配置 Linux 云端与本机登录助手 | [云端部署说明](docs/cloud/README.md) |
| 核对跨平台运行、环境变量与权限 | [跨平台说明](docs/platforms.md) |
| 查看版本变化 | [更新记录](CHANGELOG.md) |
| 保护凭据和反馈问题 | [安全与反馈](SECURITY.md) |

## 致谢

特别感谢 **[LINUX DO](https://linux.do/)** 社区的分享、讨论与交流，让这个小项目有了从想法走到可用工具的机会。

同时感谢：

- [Agent2API](https://github.com/aimod-cc/Agent2API)：本项目使用的转发核心。
- [提供商插件项目](https://github.com/Agent2Builder/agent2api-providers-releases)：提供豆包工作等适配能力，本面板只使用豆包工作通道。
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)：独立浏览器登录通信所用协议；非默认资料目录设计参考 [Chrome 官方说明](https://developer.chrome.com/blog/remote-debugging-port)。

本项目与上述平台、社区及豆包官方均无隶属、担保或官方合作关系。图标和产品名称用于识别对应服务，相关权利归各自权利人。第三方依赖与素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
