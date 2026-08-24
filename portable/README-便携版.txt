SVN Scope 0.1.6（Windows x64 便携版）
====================================

直接运行：
  双击“SVN Scope.exe”，然后选择 SVN 工作副本内的目录。

启用资源管理器右键菜单（无需管理员）：
  双击“Register-ContextMenu.cmd”。
  之后可右键一个文件夹，或在文件夹空白处右键，选择
  “用 SVN Scope 查看本地修改”。

Windows 11：
  经典注册表菜单通常位于“显示更多选项”中。

移除：
  先双击“Unregister-ContextMenu.cmd”，再删除整个便携目录。
  如果移动了便携目录，请重新运行注册脚本。

运行条件：
  1. Windows 10/11 与 Microsoft Edge WebView2 Runtime（通常系统已自带）。
  2. svn.exe：支持 PATH、TortoiseSVN/SlikSVN 常见安装位置，或环境变量
     SVN_SCOPE_SVN_EXE 指定的完整路径。
  3. Beyond Compare 4/5 为可选项，需自行持有许可证；没有它也能使用内嵌 diff。

本工具不联网：状态来自本地 working copy，BASE 内容来自 SVN pristine storage。
重复查看未更新的文件会直接使用内存 Diff 缓存；当前文件在磁盘上更新时会提示是否重新加载。
左侧“更新全部文本 Diff”可一次预热常见代码文本后缀，并显示处理进度。
