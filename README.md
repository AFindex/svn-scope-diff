# SVN Scope

一个面向 Windows 的 Tauri 2 小工具：从资源管理器右键打开 SVN 工作副本内的任意目录，只展示这个目录及其子目录的本地修改，不包含父目录，也没有 Git 式 stage 暂存区。选择文件后，右侧直接显示 `BASE ↔ 工作副本` 的并排 diff。

![SVN Scope 界面预览](docs/svn-scope-preview.png)

## 已实现

- 指定目录范围内递归扫描；使用 `svn status --xml --depth infinity <目录>`，不会扫描父目录。
- 文件树展示 `M / A / D / R / C / ! / U / ~`，其中 `U` 表示未版本化；内部仍保留 SVN 原始状态码 `?`。
- 左侧可在“层级 / 列表”间切换；列表支持按相对路径、文件名、所在目录、修改状态、扩展名排序，并可切换升降序。
- 完全本地的 Monaco 并排 diff；编辑器资源随 EXE 打包，不依赖 CDN。
- diff 顶部右侧可直接在“差异 / 全部”间切换：“差异”折叠长段未修改内容，“全部”显示完整文件。
- 左侧变更区和右侧 diff 各自独立滚动；diff 滑块尺寸及位置由 Monaco 按实际内容自动计算。
- 扫描合并 SVN 元数据查询并缓存工具探测；文本 diff 复用扫描得到的文件类型与 BASE revision，属性差异仅在展开时读取。
- 最近查看的 12 个文本 diff 使用内存 LRU 缓存；切回文件时只校验大小与纳秒级修改时间，未更新就不再读取工作文件或调用 `svn cat`。
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

## 本地开发

### 前置条件

- Windows 10/11 x64
- Node.js 20+ 与 npm
- Rust stable MSVC 工具链
- Visual Studio 2022 C++ Build Tools（勾选“使用 C++ 的桌面开发”）
- Microsoft Edge WebView2 Runtime（Windows 10/11 通常已安装）
- SVN 命令行客户端 1.9+；TortoiseSVN 安装时可勾选 command line client tools

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
cd F:\my_work\ai-playground\svn-scope-diff
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
├─ SVN Scope 0.1.5\
│  ├─ SVN Scope.exe
│  ├─ Register-ContextMenu.cmd
│  ├─ Unregister-ContextMenu.cmd
│  ├─ 对应 PowerShell 脚本
│  ├─ README-便携版.txt
│  └─ SHA256SUMS.txt
└─ SVN-Scope-0.1.5-win-x64.zip
```

首次构建会下载 npm/crates.io 依赖；之后是纯本机构建。产物不包含安装器、自动更新器、遥测或云服务。

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
- 传入子目录时，状态命令的 target 就是该子目录，结果还会再次按路径边界过滤，因此父目录修改不会出现。
- 被 SVN ignore 的内容保持隐藏，避免把 `node_modules` 等目录误当作修改。

## 限制

- 右键菜单使用无需安装/打包身份的经典 Shell 注册方式；Windows 11 通常把它放在“显示更多选项”。要进入新版一级菜单需要实现并注册 `IExplorerCommand`/稀疏包，这与纯便携目标冲突。
- 未版本化目录由 SVN 作为一个目录项返回，不主动遍历其内部文件，以遵守 SVN ignore 规则。
- 未签名的 EXE 若从互联网下载，Windows SmartScreen 可能提示未知发布者；本地构建不影响运行。
- 便携 EXE 使用系统 WebView2 Runtime，不携带体积很大的 Fixed Version Runtime。

## 参考

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri build / `--no-bundle`](https://v2.tauri.app/distribute/)
- [Subversion `svn cat`](https://svnbook.red-bean.com/en/1.8/svn.ref.svn.c.cat.html)
- [Beyond Compare command-line reference](https://www.scootersoftware.com/v5help/command_line_reference.html)
