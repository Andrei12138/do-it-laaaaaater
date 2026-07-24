# 第三方素材说明

本项目的界面使用了 **Animal Island UI** 的组件与视觉素材。

- 作者：guokaigdg
- 项目：https://github.com/guokaigdg/animal-island-ui
- 组件版本：1.2.2
- 示例素材来源提交：b203a0bb8899f9cab84dd45cc2677cd8a849fb10
- 许可：Creative Commons Attribution-NonCommercial 4.0 International（CC BY-NC 4.0）

本项目保留原作者署名，仅用于个人、非商业用途。完整许可文本见
`licenses/animal-island-ui-CC-BY-NC-4.0.txt`。

项目直接复用了 Button、Input、Card、Modal、Tabs、Select、Tag、Icon、Divider、Footer、Checkbox、Radio、Progress 和 Notification 等正式组件。登录、首页、快速保存、备份恢复、批量操作与 PWA 提示使用的背景、菜单、海面、树木和功能图标来自固定版本的正式素材；构建中只包含实际使用的文件，没有打包全部物品图标。

正式库没有星标、今日、恢复、重试、上传下载等对应功能图标，因此这些图标由本项目按 Animal Island UI 的圆角、线宽与配色规则补充绘制，不冒充原库素材。

design-atlas 中对应风格条目的许可字段与当前正式包不一致；本项目以正式包和源仓库中声明的 CC BY-NC 4.0 为准。

## Flat Design 2013

本项目的可切换界面使用了 **Flat Design 2013** 的设计变量、组件规则和预览素材。

- 作者：NovusGFX
- 项目：https://github.com/novusgfx/retro-design-system
- design-atlas ID：`rds-35-flat-2013`
- 固定来源提交：`911d9b100467655b9f43be401678b89a1a12d61e`
- 许可：MIT

项目另行绘制的功能 SVG 图标属于 Do It Laaaaaater 自身界面代码，不来自第三方图标包。
完整许可文本见 `licenses/flat-design-2013-MIT.txt`。

Flat Design 2013 原项目主要提供色板、排版、磁贴、按钮与输入框规则，并不包含覆盖本应用全部功能的图标包。新增工作流继续使用其原版色板、直角组件和零阴影规则，缺少的图标以统一的 24×24 几何 SVG 补充。

## Excalidraw 与画布字体

唯一备忘录画布使用 **Excalidraw 0.18.1** 作为绘图与无限画布基础。

- 项目：<https://github.com/excalidraw/excalidraw>
- 固定版本：`@excalidraw/excalidraw@0.18.1`
- 许可：MIT
- 完整许可文本：`licenses/excalidraw-MIT.txt`

为保证画布断网时仍能正常显示文字，本项目按照 Excalidraw 的自托管说明，将该固定版本正式包中的字体文件保存在 `public/excalidraw-assets/fonts`，运行时不会再从外部字体服务器下载。

其中 Excalifont、Assistant、Cascadia Code、Liberation Sans、Lilita One、Nunito、Virgil 和 Xiaolai 继续遵守各字体文件内记录的原始许可；适用的 SIL Open Font License 1.1 全文见 `licenses/SIL-OFL-1.1.txt`。Comic Shanns Mono 使用 MIT 许可，完整文本与作者署名见 `licenses/comic-shanns-MIT.txt`。这些字体仅随画布功能一起分发，没有被单独出售。
