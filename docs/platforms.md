# Windows / macOS / Linux

本项目保持无 npm 第三方依赖的源码运行方式。通用命令是 `npm start`、`npm stop`、`npm run status`、`npm run doctor`，需要 Node.js 22+。各系统的 start / stop 薄脚本只负责转交同一个 Node 启动器。

## 核心与数据

默认沿用项目 `.local`，优先级保持为 `DW_RUNTIME_ROOT`、`.runtime-root`、项目 `.local`。旧的本机账号无需复制或重新创建。`.runtime-root` 是单行绝对路径文本，不会作为命令执行。

- macOS 默认核心：`runtime/Agent2API.app/Contents/MacOS/agent2api`。
- Windows x64 默认核心：`runtime/agent2api-server.exe`。
- Linux x64 / arm64 默认核心：`runtime/agent2api-server`。
- Windows / Linux server 包需要完整解压，保留同目录 `ui`。对应系统的签名插件 ZIP 放在 `runtime/providers.zip`。
- 初次启动检测到缺少豆包插件时，向本机核心提交本地 ZIP，由核心检查签名；已安装且停用的插件保持原样。

核心与面板都只监听回环地址。启动器先检查端口，不接管其他服务；启动失败会关闭自己创建的子进程并释放自己的锁，不删除账号或设置。`npm stop` 使用随机令牌联系本机控制端口，不直接信任 PID 文件来结束进程。正常退出通过 IPC 让面板清理自己的登录会话，再关闭核心；断电和强制终止仍需自行检查临时目录。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DW_RUNTIME_ROOT` | 运行根目录，含 runtime / state / tmp |
| `DW_STATE_DIR` | 明确指定状态目录，一般保留默认 |
| `DW_CORE_BIN` | 当前系统核心的本机路径 |
| `DW_PROVIDER_PACK` | 对应系统的签名提供商 ZIP 路径 |
| `DW_UPSTREAM_PORT` / `DW_PANEL_PORT` | 默认 43861 / 43862，需分别设置 |
| `DW_CHROME_BIN` / `DW_EDGE_BIN` | 标准安装位置之外的已安装浏览器绝对路径 |
| `DW_CLOUD_CONFIG` | 本机私有云端连接 JSON，默认项目 `.cloud-target.json` |

网页不接受这些程序路径或云端连接密码，只能由运行电脑的操作人员在环境或私有文件中设置。

## 浏览器登录

Windows 检查 Program Files 和 LocalAppData；macOS 检查系统与用户 Applications；Linux 检查 Chrome / Chromium / Edge 常见安装位置。仅检查程序，不扫描日常浏览器资料。

所有系统使用新建、私有的临时资料目录与匿名调试管道，不打开调试监听端口，不加关闭沙箱或忽略证书验证的参数。协议行为依据 [Chromium 管道实现](https://chromium.googlesource.com/chromium/src/+/lkgr/content/browser/devtools/devtools_agent_host_impl.cc) 与 [Chrome 非默认资料目录要求](https://developer.chrome.com/blog/remote-debugging-port)。

Linux 本机浏览器登录要求非 root 图形会话及 DISPLAY / WAYLAND_DISPLAY。无桌面服务器适合账号 JSON 迁入，或由有桌面的登录电脑通过本机助手同步。WebKit 备用助手仍只属于 macOS，不向 Windows / Linux 展示其编译入口。

## 私有文件

macOS / Linux 使用 0700 目录和 0600 文件。Windows 创建运行目录与敏感文件时设置当前用户和 SYSTEM 的 ACL；读取时允许当前用户、SYSTEM 和管理员身份，其他允许访问的规则会停止敏感配置读取。权限检查只读取 ACL 元数据，不输出密码或 Cookie。短时缓存按文件变更信息失效。

云端连接 JSON 在运行电脑上手工创建后，可运行 `npm run secure-cloud` 收紧文件权限。此命令不输出其内容。不要将运行目录放在共享文件夹、其他用户可改写的目录或公开仓库中。

## 验证层级

- 三系统 Node.js 22 / 24 自动测试：路由、JSON、权限、启动与认证停止等，不使用真实账号。
- 三系统真实 Chrome / Edge 匿名管道 smoke：新临时资料、空白页、取版本与关闭；不访问账号页面。
- Windows x64 / Linux x64：下载固定版本官方核心并检查配套 SHA-256，安装签名插件，验证空账号面板、受限 Key 和停止流程。插件验证交由上游核心，不跳过签名。
- Linux arm64 有资源选择与路径支持，尚未做 arm64 runner 实机验收。
- CI 通过不等同于 Windows / Linux 真实账号登录、模型生成或定时签到完成。这些需要相应系统与账号单独验收。

现有云服务器不是此轮 CI 的运行目标；GitHub 推送不会自动部署。
