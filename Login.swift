import AppKit
import WebKit

final class Login: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private let root = CommandLine.arguments.dropFirst().first ?? ""
    private let web = WKWebView(frame: .zero, configuration: {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .nonPersistent()
        return c
    }())
    private let status = NSTextField(labelWithString: "请在豆包官方页面登录。")
    private let submit = NSButton(title: "将此账号接入本机网关", target: nil, action: nil)
    private var window: NSWindow!
    private var busy = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:1040,height:760),
                          styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.minSize = NSSize(width:660,height:470)
        window.title = "豆包工作 · 独立账号登录"
        window.delegate = self
        submit.target = self; submit.action = #selector(attachAccount)
        submit.bezelStyle = .rounded
        let bar = NSStackView(views:[status,NSView(),submit])
        bar.orientation = .horizontal
        bar.edgeInsets = NSEdgeInsets(top:8,left:13,bottom:8,right:13)
        status.setContentHuggingPriority(.required, for:.horizontal)
        let layout = NSStackView(views:[bar,web])
        layout.orientation = .vertical; layout.alignment = .width; layout.spacing = 0
        window.contentView = layout
        web.navigationDelegate = self; web.uiDelegate = self
        web.load(URLRequest(url:URL(string:"https://www.doubao.com/chat/")!))
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }

    func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }

    private func allowed(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", url.port == nil || url.port == 443,
              url.user == nil, url.password == nil, let host = url.host?.lowercased() else { return false }
        return ["doubao.com","feishu.cn","larksuite.com"].contains { host == $0 || host.hasSuffix("." + $0) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        decisionHandler(allowed(navigationAction.request.url) ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if allowed(navigationAction.request.url) { web.load(navigationAction.request) }
        return nil
    }
    @objc private func attachAccount() {
        guard !busy else { return }
        guard let host = web.url?.host?.lowercased(), host == "doubao.com" || host.hasSuffix(".doubao.com") else {
            status.stringValue = "请在豆包页面完成登录后再接入。"; return
        }
        guard !root.isEmpty, let key = try? String(contentsOf:URL(fileURLWithPath:root).appendingPathComponent("panel-management.key"),encoding:.utf8).trimmingCharacters(in:.whitespacesAndNewlines),
              key.range(of:"^dw-admin-[0-9a-f]{64}$",options:.regularExpression) != nil else {
            status.stringValue = "未找到本机管理凭据。"; return
        }
        busy=true; submit.isEnabled=false; status.stringValue = "正在核验登录状态…"
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let filtered = cookies.filter { cookie in
                let domain = cookie.domain.lowercased().trimmingCharacters(in:CharacterSet(charactersIn:"."))
                return ["doubao.com","www.doubao.com"].contains(domain) && cookie.path == "/" &&
                       (cookie.expiresDate.map{$0 > Date()} ?? true)
            }
            guard filtered.contains(where:{["sessionid","sessionid_ss"].contains($0.name) && !$0.value.isEmpty}) else {
                self.finish("还没检测到登录态。请在页面里完成登录。"); return
            }
            let values:[[String:String]] = filtered.map {["name":$0.name,"value":$0.value,"domain":$0.domain,"path":$0.path]}
            var request=URLRequest(url:URL(string:"http://127.0.0.1:43861/api/accounts")!, timeoutInterval:35)
            request.httpMethod="POST"
            request.setValue("application/json",forHTTPHeaderField:"Content-Type")
            request.setValue("Bearer " + key,forHTTPHeaderField:"Authorization")
            guard let data=try? JSONSerialization.data(withJSONObject:["provider":"doubaowork","cookies":values]) else {
                self.finish("本机接入请求创建失败。"); return
            }
            request.httpBody=data
            let config=URLSessionConfiguration.ephemeral
            config.connectionProxyDictionary=[:]
            let session=URLSession(configuration:config,delegate:NoRedirect(),delegateQueue:nil)
            session.dataTask(with:request) { [weak self] data,response,_ in
                let result=(data.flatMap{try? JSONSerialization.jsonObject(with:$0)} as? [String:Any])
                let good=(response as? HTTPURLResponse)?.statusCode==200 && result?["success"] as? Bool == true
                session.finishTasksAndInvalidate()
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    if good {
                        self.status.stringValue = "接入成功；返回控制台点击刷新。"
                        self.submit.title = "接入成功"
                    } else { self.finish("登录态未通过网关核验，请检查登录或重试。") }
                }
            }.resume()
        }
    }
    private func finish(_ message:String) { busy=false; submit.isEnabled=true; status.stringValue=message }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
let app=NSApplication.shared
let delegate=Login()
app.setActivationPolicy(.regular)
app.delegate=delegate
app.run()
