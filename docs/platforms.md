# Windows / macOS / Linux

所有系统使用 Node.js 22 或更高版本、同一份源码，无第三方 npm 依赖。需要添加账号时安装 Chrome / Edge；Linux 可用 Chromium，需可用图形桌面。无桌面的 Linux 服务使用账号 JSON。

| 系统 | 启动 | 停止 |
| --- | --- | --- |
| Windows | `start.cmd` 或 `npm start` | `stop.cmd` 或 `npm stop` |
| macOS | `./start.command` 或 `npm start` | `./stop.command` 或 `npm stop` |
| Linux | `./start.sh` 或 `npm start` | `./stop.sh` 或 `npm stop` |

默认管理地址为 `http://127.0.0.1:43862`，模型地址为 `http://127.0.0.1:43861/v1`。在终端使用 `npm run doctor` 检查运行目录和可用浏览器。自定义浏览器位置可设置绝对路径 `DW_CHROME_BIN` 或 `DW_EDGE_BIN`。

Unix 上使用 0700 / 0600，Windows 上使用当前用户与 SYSTEM 的受限 ACL。运行目录建议放在本机磁盘，不与他人共享。变更端口用 `DW_PANEL_PORT` / `DW_UPSTREAM_PORT`，两个端口必须不同。

CI 对三个系统运行 Node 测试；真实浏览器登录和官网验证仍以账号持有人实测为准。不要把平台路径测试视为真实登录结果。
