# V1.4 UI 实现记录

## 当前状态

V1.4 已进入 UI 基础落地阶段。本轮以 Figma Page 1 的页面为视觉来源，完成了中控屏三种关键状态的代码化承载：

- 游戏准备页
- 游戏进行中页
- 答案揭晓页与结算页的统一结构

Figma 只负责视觉坐标、尺寸、切片和效果参考；游戏文案、Workflow 契约和交互逻辑继续以项目现有代码与产品文档为准。

## 已实现内容

### 1. 固定舞台与页面资源

- 外层继续使用 `1920 x 1080` 固定舞台，随窗口等比例缩放。
- 中控屏内部按 `1440 x 810` 画布承载 Figma 坐标。
- 游戏准备页、游戏中、揭晓、结算均支持独立背景和主持人人偶资源。
- Figma 导出的 PNG/SVG 资源统一放在 `assets/figma-*`。

### 2. 游戏准备页

- 增加准备页 Logo、背景、光束、环形马赛克、马赛克氛围背景和开始按钮切片。
- “开始游戏”按钮文字由代码渲染，底图由切片提供。
- 光束右按 Figma 方向做翻转处理。
- 马赛克氛围背景使用 Figma 最新坐标和透明度。
- Logo 使用透明 PNG 轮廓阴影，避免透明画布出现矩形阴影。
- 规则文案保留产品原文，只调整字号、透明度、行高和文字阴影。

### 3. 主持人媒体接口

主持人区域已经从单一图片组件升级为媒体无关接口：

```js
const HOST_MEDIA_SOURCES = {
  ready: { kind: "image", src: "./assets/figma-ready-host.png" },
  playing: { kind: "image", src: "./assets/figma-playing-host.png" },
  reveal: { kind: "image", src: "./assets/figma-reveal-host.png" },
  summary: { kind: "image", src: "./assets/figma-summary-host.png" },
};
```

当前全部使用 PNG。后续替换为视频时，只需将对应状态改为：

```js
{ kind: "video", src: "./assets/host-playing.webm", poster: "./assets/figma-playing-host.png" }
```

页面布局、Workflow 输入输出和状态机不需要改动。

### 4. 主持人气泡

- 所有页面统一增加指向主持人人偶的小三角。
- 小三角按 Figma 内层图标的 `26 x 21` 尺寸用 CSS 还原，并随气泡高度自动移动。
- 旧的空 SVG 气泡资源不再显示，避免资源为空时页面缺少指向关系。
- 气泡文字继续按内容长度切换字号和高度；长文本在最小字号下超过 4 排时截断。

### 5. 透明切片阴影规则

阴影必须加在带透明通道的图片元素上，而不是外层按钮或容器：

```css
.ready-logo {
  filter: drop-shadow(4px 4px 30px rgba(0, 0, 0, 0.6));
}

.ready-start-button img,
.summary-continue img {
  filter: drop-shadow(0 2px 30px #6d30bd);
}
```

这样阴影会沿非透明像素轮廓生成，不会在切片透明区域形成矩形阴影。

## 资源与加载约定

- 首屏准备页使用的背景、Logo、主持人和按钮资源保留高优先级加载。
- 非当前页面资源通过页面状态切换使用，后续可继续改为预加载队列或懒加载。
- 主持人视频接口已预留 `preload="none"`、`poster` 和播放失败保护。
- 新增大图或视频前先检查尺寸、格式、透明通道和文件体积。
- 不要把 Figma 的临时导出文件、截图和渲染脚本放入生产资源目录；临时文件统一放在 `tmp/`。

## 本轮验收

已通过：

- `node --check app.js`
- `git diff --check`
- 资源引用与 HTML 标记检查

后续视觉验收重点：

- 在目标横屏尺寸下检查准备页光束方向和马赛克层级。
- 检查 Logo、开始游戏、继续挑战的阴影只沿透明切片轮廓出现。
- 检查四种主持人页面状态的气泡小三角均指向人偶。
- 检查气泡长文本在 3 排、4 排和超长截断状态下不溢出。
