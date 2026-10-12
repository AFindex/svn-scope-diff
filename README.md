# SVN Scope

一个面向 Windows 的 Tauri 2 小工具：从资源管理器右键打开 SVN 工作副本内的任意目录，只展示这个目录及其子目录的本地修改，不包含父目录，也没有 Git 式 stage 暂存区。选择文件后，右侧直接显示 `BASE ↔ 工作副本` 的并排 diff。

![SVN Scope 界面预览](docs/svn-scope-preview.png)

## 0.4.0 交互与刷新改进

- 点击树中的目录名称，右侧列出该目录下所有变更文件；箭头单独控制展开/折叠，文件项可继续进入 Diff。
- 修改状态支持多选，并与文件名、目录路径、扩展名组合筛选；“全部状态”重置条件。
- 工作副本侧支持文本编辑、Ctrl+S 保存、光标行列和选中字数显示。BASE 保持只读；未保存时切换文件、目录、关闭窗口会提示，刷新保留草稿。保存复用编码与磁盘内容校验，不覆盖外部修改。
- 代码区右键提供剪切/复制/粘贴、撤销/重做、保存，以及还原光标处或选中差异；还原会再次确认，未提交修改不能靠 SVN 找回。
- 启动页和顶部“最近目录”记录最近 12 个成功打开的文件夹，按 Windows 路径去重。
- 自动刷新在扫描期间保留事件，失败路径每 3 秒重试；局部扫描串行处理并丢弃完整扫描之前的旧结果。持续写入最长 2 秒发送一批，监听溢出和 SVN 元数据变化触发范围刷新。异常显示具体原因，并提供“重新监听并刷新”。
- 启动时自动检查客户端新版；下载后校验 ZIP 的 SHA-256，点击“重启并更新”替换 EXE 并保留 `.backup`。发布源为本仓库 GitHub Releases，不上传工作副本内容。

## 已实现

- 支持选择一个或多个同工作副本内的小目录作为扫描范围；分别执行 `svn status --xml --depth infinity <目录>` 后合并结果，不会为了展示公共层级而扫描父目录。扫描范围可以随时添加或移除。
- SVN 只返回一个未版本化目录时，会在本地展开其内部文件和子目录，因此整棵新增目录不再只显示一个空的 `U` 项；`.svn` 管理目录和独立嵌套工作副本不会被递归进入。
- 文件树展示 `M / A / D / R / C / ! / U / ~`，其中 `U` 表示未版本化；内部仍保留 SVN 原始状态码 `?`。
- 左侧可在“层级 / 列表”间切换；列表支持按相对路径、文件名、所在目录、修改状态、扩展名排序，并可切换升降序。文本与多选后缀现在是组合筛选条件，选项按当前修改动态生成并显示数量，包含目录与无后缀类型；下拉内可一键“全选”或“清除选择”。默认只按文件名匹配，按需开启“目录路径”后才让父目录命中带出子项，避免搜索结果混入整片无关目录。
- 列表和层级模式都有两套明确分离的选择：复选框只控制提交选择；点击行控制右键批量操作选择，Ctrl 可增减单项，Shift 可连续选择，Ctrl+Shift 可把连续范围并入已有选择。批量选择、当前 Diff 文件和提交勾选使用不同强度的高亮，并提供操作选择计数与清除按钮。
- 左侧修改区和右侧 Diff 之间有可拖动分隔条；宽度限制会为 Diff 保留可用空间，支持方向键微调、Shift 加速、Home/End 边界、双击复位，并在本机记住上次宽度。拖动过程直接更新网格宽度，避免让 Monaco 高频重渲染。
- 左侧“用 TortoiseSVN 提交”把勾选项作为具体路径转交给小乌龟 Commit 窗口；大量路径使用 UTF-16LE、无 BOM、LF 分隔的临时 `/pathfile`，完成后由 `/deletepathfile` 清理。未版本化目录不会直接转交，避免意外递归加入未知文件。
- 层级和列表中的每个 item 都提供统一右键菜单：局部刷新、提交、Revert、Blame、Show Log、复制相对/完整路径、系统默认打开、在资源管理器中定位，以及冲突项专用的冲突编辑器和“标记为已解决”。操作选择包含多项时，刷新、提交、Revert、Resolve 和复制路径会自动切换为批量操作；不适用于批量的打开、Blame 与 Show Log 会隐藏。顶部扫描范围目录和层级分组目录也有精简的目录菜单。Revert 与 Resolve 只打开 TortoiseSVN 的确认窗口，不会静默执行。
- 文本、属性和树冲突使用独立红色行标与类型标签；层级目录会汇总后代冲突数。右侧 Diff 同步显示冲突警示、工作副本冲突标签和检测到的文本冲突块，并可直接打开三方冲突编辑器。
- 顶部“刷新变更”（Ctrl+R）重新扫描全部当前范围；保留仍有效的当前 Diff 文件和提交选择，已恢复干净或消失的条目会从选择中移除。
- 默认开启工作副本文件事件监听；保存、创建、删除或重命名文件后，450ms 内的事件会先合并，再只对受影响路径执行 SVN 状态查询并补丁式更新左侧列表。当前正在查看的文件仍按原规则弹窗询问是否重载 Diff，不会被静默替换。
- 顶部“SVN Update”只更新当前扫描范围，不会连带父目录；多个范围会作为多个精确目标传给同一条命令。`svn.exe` 在独立可见控制台中直接输出进度。运行时按钮切换为“取消 Update”，先发送 Ctrl+Break 让 SVN 正常收尾，超时才强制终止；完成、失败或取消后自动重新扫描变更。Update 期间会暂时禁用提交、Revert、历史查询、批量 Diff、切换目录和手动刷新，避免并发操作工作副本。
- 完全本地的 Monaco 并排 diff；编辑器资源随 EXE 打包，不依赖 CDN。
- diff 顶部右侧可直接在“差异 / 全部”间切换：“差异”折叠长段未修改内容，“全部”显示完整文件。
- Diff 配色可在“按状态区分 / 蓝橙高对比 / 经典红绿”间切换并自动记忆。默认按状态区分时，新增与未版本化文件使用蓝紫色整文件高亮，普通修改仍使用红/绿双向对照。
- Diff 工具栏显示差异块总数，并可循环跳转到上一个/下一个差异；BASE 与工作副本各有独立的常驻搜索栏、命中数及上/下一个结果导航，两个搜索框可以同时保持打开。在“差异”模式中命中折叠行会自动展开并定位；窄窗口仍保持双栏。
- 在 BASE 或工作副本侧选中一处或跨多处差异后，可在代码区右键选择“还原光标处 / 选中的差异”。写入前会再次确认，并校验磁盘内容仍与当前 Diff 一致；UTF-8/BOM、UTF-16 与有效 GBK 会按原编码写回，大文件、二进制或已在外部更新的文件会拒绝覆盖。
- 左侧变更区和右侧 diff 各自独立滚动；右侧启用 Monaco Diff Overview Ruler，以当前配色标记整份文件中的删除与新增，当前视口可点击或拖动定位；普通滚动条保持独立细尺寸。
- 扫描合并 SVN 元数据查询并缓存工具探测；文本 diff 复用扫描得到的文件类型与 BASE revision，属性差异仅在展开时读取。
- 普通浏览时最近 12 个文本 diff 使用内存 LRU 缓存；切回文件时只校验大小与纳秒级修改时间，未更新就不再读取工作文件或调用 `svn cat`。
- 左侧“更新全部文本 Diff”按显式后缀白名单预热所有代码文本 diff，三路限并发并显示进度；批量期间缓存临时扩容，切换工作目录后恢复默认。当前包含 `.py / .cs / .bat / .cmd / .ps1 / .js / .ts / .tsx / .java / .cpp / .rs / .go / .sql / .json / .yaml` 等常见后缀，不包含 `.txt`、图片和未知后缀。
- 当前打开文件每 1.5 秒仅检查轻量元数据；发现磁盘更新后先询问是否重新加载，读取期间再次变化的内容不会写入缓存。
- UTF-8、UTF-8 BOM、UTF-16、GBK 文本解码；二进制和超大文件有明确提示。
- Beyond Compare 4/5 可选集成：自动发现常见安装位置，用 SVN `BASE` 快照和工作文件启动外部比较，左侧只读。
- 当前用户级资源管理器右键菜单：既支持右键文件夹，也支持文件夹背景；无需管理员。
- 不生成 MSI/NSIS。构建脚本输出一个便携目录和 ZIP。

## Beyond Compare 的复用结论

Beyond Compare 提供的是独立桌面应用和命令行入口，并没有适合嵌入 Tauri WebView 的官方比较控件或 SDK。因此本项目采用两层方案：

1. 默认使用本地打包的 Monaco，在应用内完成 Fork 风格的并排 diff。
2. 检测到 Beyond Compare 后显示按钮，按其官方命令行格式启动两个文件：左侧是 `svn cat -r BASE` 生成的临时快照，右侧是工作文件，并传入 `/leftreadonly` 与标题参数。

这样不需要复制、破解或重新分发 Beyond Compare，也不会把它变成本工具的硬依赖。Beyond Compare 的许可证由使用者自行负责。
工具位置按应用进程缓存；如果在 SVN Scope 运行期间安装 Beyond Compare 或修改其路径环境变量，请重启 SVN Scope。

## TortoiseSVN 集成

安装 TortoiseSVN 后，SVN Scope 会从注册表、标准安装目录、便携目录和 PATH 查找 `TortoiseProc.exe`。也可以显式指定：

```powershell
$env:SVN_SCOPE_TORTOISEPROC_EXE = 'D:\Tools\TortoiseSVN\bin\TortoiseProc.exe'
```

提交按钮只负责打开小乌龟的标准 Commit 窗口，不会绕过确认或直接提交。TortoiseSVN 默认开启“Select items automatically”，因此传入的文件会预先勾选；如果用户关闭该设置，SVN Scope 会显示提示但不会擅自修改注册表。真实目录变更可能让 TortoiseSVN 展开目录，界面会提醒在提交窗口中复核；未版本化目录则明确禁止直接转交。Commit、Revert 或 Resolve 窗口关闭后，SVN Scope 会自动局部刷新这次转交的路径，使已提交或已还原的条目及时消失。

item 右键菜单通过 TortoiseSVN 官方 `TortoiseProc.exe /command:* /path:*` 接口打开 `revert / blame / log / conflicteditor / resolve` 窗口；批量操作与批量提交一样使用 UTF-16、无 BOM 的 `/pathfile`。所有目标在 Rust 侧再次校验，必须同时位于当前扫描范围和 SVN 工作副本之内。`resolve` 不传 `/noquestion`，因此仍由 TortoiseSVN 做最后确认。

## 本地开发

### 前置条件

- Windows 10/11 x64
- Node.js 20+ 与 npm
- Rust stable MSVC 工具链
- Visual Studio 2022 C++ Build Tools（勾选“使用 C++ 的桌面开发”）
- Microsoft Edge WebView2 Runtime（Windows 10/11 通常已安装）
- SVN 命令行客户端 1.9+；TortoiseSVN 安装时可勾选 command line client tools
- TortoiseSVN 1.14+（可选，提交、历史、Revert 与冲突处理功能需要）

如果 `svn.exe` 不在 PATH，本工具也会检查 TortoiseSVN、SlikSVN 的常见路径。还可以设置：

```powershell
$env:SVN_SCOPE_SVN_EXE = 'D:\Tools\Subversion\bin\svn.exe'
```

可选指定 Beyond Compare：

```powershell
$env:SVN_SCOPE_BCOMPARE_EXE = 'D:\Tools\Beyond Compare 5\BCompare.exe'
```

### 调试运行

```powershell
cd .\svn-scope-diff
npm ci
npm run desktop:dev
```

也可以把待查看目录直接作为参数传给调试程序：

```powershell
npm run tauri -- dev -- -- 'D:\work\my-svn-project\src'
```

## 构建便携版（无安装器）

在项目目录运行一条命令：

```powershell
npm run portable
```

脚本执行 Tauri release `--no-bundle` 构建，然后生成：

```text
dist-portable\
├─ SVN Scope 0.4.1\
│  ├─ SVN Scope.exe
│  ├─ Register-ContextMenu.cmd
│  ├─ Unregister-ContextMenu.cmd
│  ├─ 对应 PowerShell 脚本
│  ├─ README-便携版.txt
│  └─ SHA256SUMS.txt
└─ SVN-Scope-0.4.1-win-x64.zip
```

首次构建会下载 npm/crates.io 依赖；之后是纯本机构建。产物不包含安装器或遥测；客户端更新会连接本仓库 GitHub Releases。

## 使用便携版

1. 解压 ZIP 到一个固定目录。
2. 双击 `Register-ContextMenu.cmd`。它只写入 `HKCU\Software\Classes`，不需要管理员权限。
3. 在 SVN 项目中右键任意文件夹，或进入该文件夹后右键空白处，选择“用 SVN Scope 查看本地修改”。
4. Windows 11 的经典注册表菜单通常在“显示更多选项”中。
5. 移动便携目录后重新运行注册脚本；删除前先运行 `Unregister-ContextMenu.cmd`。

直接双击 `SVN Scope.exe` 也可以通过目录选择器使用。

## 范围与本地性

- 扫描命令没有 `-u/--show-updates`，因此不会访问 SVN 服务器。
- BASE 内容由本地 working copy pristine storage 读取；查看 diff 不需要网络。
- 传入一个或多个子目录时，每条状态命令的 target 都是对应子目录，结果还会再次按路径边界过滤，因此公共父目录中的其他修改不会出现。
- 被 SVN ignore 的内容保持隐藏，避免把 `node_modules` 等目录误当作修改。

## 限制

- 右键菜单使用无需安装/打包身份的经典 Shell 注册方式；Windows 11 通常把它放在“显示更多选项”。要进入新版一级菜单需要实现并注册 `IExplorerCommand`/稀疏包，这与纯便携目标冲突。
- 未版本化目录会做本地递归展开；如果其中包含非常大的未知目录树，首次展开的成本与本地文件数量相关。SVN 已在扫描范围根部判定为 ignored 的目录仍不会进入列表。
- 未版本化目录不会被直接转交给 TortoiseSVN；请先在工作副本中明确执行 SVN Add，或选择具体的未版本化文件。真实目录变更在提交窗口中可能展开子项，需要最终复核。
- 未签名的 EXE 若从互联网下载，Windows SmartScreen 可能提示未知发布者；本地构建不影响运行。
- 便携 EXE 使用系统 WebView2 Runtime，不携带体积很大的 Fixed Version Runtime。

## 参考

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri build / `--no-bundle`](https://v2.tauri.app/distribute/)
- [Subversion `svn cat`](https://svnbook.red-bean.com/en/1.8/svn.ref.svn.c.cat.html)
- [TortoiseSVN command-line automation](https://tortoisesvn.net/docs/release/TortoiseSVN_en/tsvn-automation.html)
- [Beyond Compare command-line reference](https://www.scootersoftware.com/v5help/command_line_reference.html)

## 客户端更新发布

维护者推送与应用版本一致的 `v0.4.1` 等标签后，`.github/workflows/release.yml` 构建便携 ZIP 并发布 `update.json`。清单包含 `version` 和 ZIP 的 `sha256`；下载地址固定在本仓库对应标签，不接受任意外部安装地址。SHA-256 用于完整性校验，发布渠道依赖 GitHub HTTPS，不是独立的代码签名。

旧的 0.3.0 客户端没有更新入口，需手动安装一次含此功能的版本。尚未发布 Release 或清单时，客户端会显示发布源不可用；本 PR 不会自行发布正式版本。

更新前请保存编辑并结束 SVN 操作。需要对客户端目录有写权限；EXE 被其他实例占用、网络/代理失败、校验不一致都会阻止安装。安装脚本等待旧进程退出，失败时尝试恢复备份；记录位于 `%TEMP%/svn-scope-update-<进程号>/install.log`，旧程序在原 EXE 旁的 `.backup` 文件中。

## 刷新异常排查与验证

已修复：切换目录时 Monaco 模型提前释放导致的编辑器异常、未版本化目录内部文件无法直接查询状态而从列表消失、扫描期间丢事件、失败后丢队列、并发扫描旧结果覆盖、Windows 短目录名与 SVN 返回长路径不一致、连续写入无限延迟，以及只改 SVN 元数据时漏刷新。系统监听错误会保留原始原因。仍可能遇到目录被删除/移动、文件权限不足、SVN 工作副本锁定/损坏或外部工具持续修改；这些情况需要恢复路径/权限、等待外部操作或用 SVN 检查工作副本，不自动执行 cleanup/revert。

验证命令：`npm run test:frontend`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`。本机测试使用临时 SVN 仓库，不操作实际项目。运行 `npm run dev` 后可打开 `http://localhost:1420/tests/preview.html` 验证前端交互；此页面使用模拟 IPC，不读写真实工作副本，也不能实际安装更新。

## 历史目录快速打开

首次成功扫描后，客户端会把该组目录的变更列表保存在本机应用缓存目录的 `scan-history` 下，最多保留最近 12 组。重启后再次打开同一历史目录，先显示上次列表及保存时间，再在后台核对完整 SVN 状态；同一窗口重复选择当前目录直接复用已打开列表，不重复扫描。

历史列表不是最新状态的保证。后台核对期间可以浏览、筛选和查看 Diff；核对成功后替换为最新列表并恢复编辑。核对失败会保留历史列表、显示原因，点击“刷新变更”可重试。首次升级到包含此功能的版本仍需完成一次扫描；缓存缺失或损坏时正常扫描，不影响项目文件。

缓存只保存路径和状态等扫描信息，不保存文件正文。界面验证可使用 `tests/preview.html?history=ok`（延迟 15 秒返回最新列表）或 `?history=fail`（模拟后台扫描失败）。
