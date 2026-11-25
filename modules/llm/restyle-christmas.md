请用「BJTU 课程助手」的 app 执行能力，把扩展页面改造成圣诞风格，最后写入启动脚本 api.startupScript 让每次打开/刷新自动生效。

【总原则：小步快跑 + 逐步验收】
- 严禁一次性写完几十行再"期望它能跑"。按下面的阶段顺序推进，一次只做一件事。
- 每完成一个阶段，立刻用一个独立的 app 代码块回读真实状态验收（例如 dom.get 读属性、读 innerHTML、matches 判断选择器、读 audio 的 readyState/duration/paused）。
- 验收不通过就当场修，修好后重新验收；验收通过再进入下一阶段。
- 每个阶段都要幂等：建新节点前先 dom.call(sel,"remove") 清掉同名旧节点，避免反复调试时叠加。

━━━━━━━━━━━━━━━━━━
【阶段 0｜探测环境（先摸清再动手）】
1. api.operationList() 看有哪些模块；
2. api.getDocs({module:"appearance",name:"colors"}) 确认可用颜色键；
3. 探测 AI 输入框：dom.get("#llm-chat-input","tagName")、dom.get("#llm-chat-send","tagName")。
验收：颜色键清单和 AI 输入框选择器都已确认存在。

━━━━━━━━━━━━━━━━━━
【阶段 1｜主题与配色（最容易，先跑通）】
- appearance.theme("dark") 强制深色；
- appearance.colors({...}) 一次设置：
  backgroundLight #f5f4ef，backgroundDark #0d1b12
  cardLight #ffffff，cardDark #15291d
  courseCardLight #ffffff，courseCardDark #000000
  fileCardLight #ffffff，fileCardDark #000000
  button #c0392b
  pendingCard #fff4d6，overdueCard #ffe0e0，doneCard #e3f6e8
  teacherPendingCard #dbeafe，teacherOverdueCard #ede9fe
  platformVe #1565c0，platformYkt #5096f5，platformMrjzy #29a9fc，platformJlgj #ffd243，
  platformMooc #00cc7e，platformXuetangx #1769fe，platformCitel #f98012
  resource #202000，download #202000，replay #ffd54a，assessment #116b53，archive #0c4a6e，copy #2ab86e
验收：appearance.theme() 返回 mode:"dark"；appearance.colors() 返回里 resource=#202000、replay=#ffd54a。

━━━━━━━━━━━━━━━━━━
【阶段 2｜按钮定向覆盖（小验证：改完立刻看效果）】
页面按钮带内联背景色，必须 !important 覆盖；文字色要用 -webkit-text-fill-color 兜底：
button[data-action="videos"],button.btn[data-action="videos"],.btn[data-action="videos"]{
  background:#ffd54a !important;color:#000 !important;-webkit-text-fill-color:#000 !important;font-weight:600 !important}
button[data-action="videos"] *,button.btn[data-action="videos"] *{
  color:#000 !important;-webkit-text-fill-color:#000 !important}
button[data-action="courseware"],button.btn[data-action="courseware"]{
  background:#202000 !important;color:#ffd54a !important;-webkit-text-fill-color:#ffd54a !important;
  font-weight:600;border:1px solid #ffd54a !important;box-shadow:0 0 6px rgba(255,213,74,.35) !important}
验收：dom.get("body","innerHTML") 里能看到样式已注入；肉眼确认回放下载=金底黑字、资源下载=#202000 底金字金边。

━━━━━━━━━━━━━━━━━━
【阶段 3｜底部积雪（单元素，先验证渐变方向）】
#xmas-ground：position:fixed;left/right:0;bottom:0;height:90px;z-index:9999;pointer-events:none;
background:linear-gradient(to top,#fff 0%,#fff 35%,rgba(255,255,255,.75) 60%,rgba(255,255,255,.35) 80%,rgba(255,255,255,0) 100%)
不要 box-shadow。
验收：dom.get("#xmas-ground","id") 返回 xmas-ground，且背景规则含 "to top"（越靠上越透明）。

━━━━━━━━━━━━━━━━━━
【阶段 4｜飘雪（先来 5 片，验证能飘，再扩到 70 片）】
1. 先只生成 5 片 .xf，验证动画在跑；
2. 验收通过后再改成 70 片。
样式：
#xmas-snow{position:fixed;inset:0;pointer-events:none;z-index:9998;overflow:hidden}
@keyframes xfall{0%{transform:translateY(-10vh) translateX(0) rotate(0);opacity:0}
10%{opacity:.9}90%{opacity:.9}100%{transform:translateY(105vh) translateX(60px) rotate(360deg);opacity:0}}
.xf{position:absolute;top:0;pointer-events:none;animation-name:xfall;animation-timing-function:linear;animation-iteration-count:infinite}
.xf::before{content:"";position:absolute;inset:0;
background:linear-gradient(0deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%),
linear-gradient(60deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%),
linear-gradient(120deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%);
border-radius:2px;filter:drop-shadow(0 0 2px rgba(255,255,255,.8))}
每片随机：大小 4~9px、left 0~100vw、时长 8~18s、延迟 -0~-14s、透明度 0.45~0.9。
验收：dom.get("#xmas-snow","children.length") 等于目标片数。

━━━━━━━━━━━━━━━━━━
【阶段 5｜圣诞树（先静态，先不管点击）】
#xmas-tree：position:fixed;right:18px;bottom:40px;width:110px;height:150px;z-index:10000;cursor:pointer;hover scale(1.08)
结构：星星★(#ffd54a,text-shadow光晕) + 三层松绿三角(#1e7d4f/#249a5e/#2ab86e，border 三角) + 树干 #7b4a1e + 6 颗彩球(红#e53935/黄#ffd54a/蓝#42a5f5，box-shadow 微光)。
验收：dom.get("#xmas-tree","id") 返回 xmas-tree，肉眼确认三层塔身+星星+彩球都在。

━━━━━━━━━━━━━━━━━━
【阶段 6｜音乐播放器（放圣诞树下方！）】
- 定位：#xmas-player{position:fixed;right:18px;bottom:8px;z-index:10000;background:rgba(20,30,24,.85);border-radius:10px;padding:6px;backdrop-filter:blur(4px)}，内部 audio 宽 220px 高 36px。
- 关键：树是 bottom:40px 高 150px，播放器必须 bottom:8px（在树下方），不得遮挡树身。
- 音源（已验证可用，纯音乐 Jingle Bells，约 112 秒）：
  http://123.121.147.7:1936/kk/20261125123517866724.zip_/Jingle%20Bells.m4a
- 用原生 <audio controls autoplay preload="auto" loop>（原生控件不受 CSP 限制，可点击）。
验收：dom.get("#xmas-audio","readyState") === 4、duration ≈ 112、error.code 为 null、paused === false。若 paused 为 true，先 dom.call("#xmas-audio","load") 再 play 一次。
注意：若页面是 https 而音源是 http，可能被混合内容策略拦截；届时告知用户换 https 或本地文件，不要反复重试。

━━━━━━━━━━━━━━━━━━
【阶段 7｜点击手写动画（结构 → 动画，分两步）】
7a 结构（先验证选择器能命中，再谈动画）：
  #mc-check(display:none)、#xmas-tree(label[for=mc-check])、#mc-overlay(label[for=mc-check])
  三者必须是 body 直接子元素，顺序 check → tree → overlay（~ 只对后面的兄弟生效）。
  验收：dom.call("#mc-overlay","matches","#mc-check:checked ~ #mc-overlay") 在勾选后返回 true；
        dom.call("#xmas-tree","click") 后 dom.get("#mc-check","checked") 为 true。
7b 动画（纯描边，禁止 clip-path 遮罩）：
  文字用【单个 <text> + 14 个 <tspan>】，让浏览器自动排版（禁止多个 <text> 手算 x，会错位）：
  <svg id="mc-svg" viewBox="0 0 1400 260" preserveAspectRatio="xMidYMid meet" style="width:min(94vw,1400px)">
    <text x="40" y="175" text-anchor="start" font-family="'Brush Script MT','Segoe Script',cursive"
      font-size="130" fill="none" stroke="#fff" stroke-width="2.5"
      style="filter:drop-shadow(0 0 8px rgba(255,60,60,.9))">
      <tspan class="mc-letter" style="animation-delay:0s">M</tspan>……（空格用 <tspan> </tspan>）
    </text>
  </svg>
  .mc-letter{opacity:0;stroke-dasharray:1200;stroke-dashoffset:1200;animation-fill-mode:both}
  #mc-check:checked ~ #mc-overlay .mc-letter{
    animation-name:mcdraw;animation-duration:0.6s;animation-timing-function:linear;animation-fill-mode:forwards}
  @keyframes mcdraw{0%{opacity:0;stroke-dashoffset:1200}1%{opacity:1}100%{opacity:1;stroke-dashoffset:0}}
  节奏：单字 0.6s，步进 0.25s（第 i 个字母 animation-delay = i*0.25s），流水线书写，整句≈3.85s。
  dasharray 必须 1200（320 会截断 130px 字母周长）。
  验收：dom.call(".mc-letter","matches","#mc-check:checked ~ #mc-overlay .mc-letter") 为 true；
        肉眼确认 M 写到一半时 e 才起笔，笔画完整不截断。

━━━━━━━━━━━━━━━━━━
【阶段 8｜写入启动脚本（最后一步，不要提前）】
- api.startupScript({code, enabled:true})，code 内按上面阶段顺序拼接：theme+colors → 幂等清理 → 样式 → DOM → 雪花 → 手写 tspan。
- 脚本开头必须幂等清理：
  xmas-style、xmas-style2、xmas-style3、xmas-snow-real、xmas-btns、xmas-btns2、
  mc-letter-style、mc-stroke-style、mc-wipe-style、mc-final-style、xmas-ground-fade、
  xmas-snow、xmas-ground、xmas-tree、mc-check、mc-overlay、xmas-script、
  xmas-audio、xmas-player、xmas-music-btn、xmas-bell、xmas-audio-script、
  xmas-dialog-check、xmas-dialog-wrap、xmas-dialog-style
- 保存后立刻 api.startupScript() 回读，逐条断言 code 含：
  appearance.theme("dark")、resource: "#202000"、replay: "#ffd54a"、-webkit-text-fill-color:#000、
  bottom:8px（播放器在树下）、Jingle%20Bells、controls autoplay、
  stroke-dasharray:1200、animation-duration:0.6s、const STEP = 0.25、linear-gradient(to top、<tspan class="mc-letter"
  且断言 code 不含 location.reload
- 启动脚本内禁止 location.reload()；执行环境在 AI 助手框架内，要刷新请用 background 的 chrome.tabs.reload，或直接让用户手动刷新。

━━━━━━━━━━━━━━━━━━
【阶段 9｜整体验收清单】
逐项用 app 代码块回读确认：
① appearance.theme() → mode:"dark"
② appearance.colors() → resource #202000、replay #ffd54a
③ #xmas-ground 存在且渐变含 "to top"
④ #xmas-snow 子节点数 = 70
⑤ #xmas-tree 存在
⑥ #xmas-audio readyState=4、duration≈112、paused=false
⑦ 勾选后 #mc-check:checked ~ #mc-overlay 命中，#mc-overlay 可见
⑧ .mc-letter 动画命中，肉眼为从左到右逐字描边
⑨ 播放器 bottom(8) < 树 bottom(40)，不遮挡树
⑩ api.startupScript() 回读全部断言通过

━━━━━━━━━━━━━━━━━━
【环境硬约束（血泪教训，务必遵守）】
1. 页面有 CSP：动态 insertAdjacentHTML 注入的 <script> 不执行；内联 onclick 不执行；程序化 click()/requestSubmit()/dispatchEvent() 因 isTrusted 校验无法触发扩展自身监听器。→ 交互一律用纯 CSS（checkbox+label）或原生 HTML 元素（<audio controls>）。
2. app 执行器里 new AudioContext() 会 Illegal invocation → 不可能用 Web Audio 合成，音乐只能 <audio> 外链。
3. dom.call 不支持 setAttribute / ownerSVGElement，也不能传函数（回调会被丢弃）。→ 改属性用 dom.set(sel,"innerHTML"|"outerHTML",...)，改文本色用 -webkit-text-fill-color 兜底。
4. SVG <defs> 内元素无法被 ~ 兄弟选择器选中 → clip-path 遮罩方案不可行，只能用 text 自身的描边动画。
5. getBBox / querySelectorAll 的返回值无法序列化 → 不要依赖其数值判断，改用 children.length、matches、getAttribute 字符串等可序列化结果。

完成标准：深色圣诞主题；70 片六角雪花飘落；底部雪堆上淡下白；右下角圣诞树，树的【下方】有可自动播放的 Jingle Bells 原生播放器（不遮挡树）；点击树后中央从左到右逐字描边写出 "Merry Christmas"（单字 0.6s、步进 0.25s、笔画完整），点任意处关闭；回放下载金底黑字、资源下载 #202000 底金字金边；上述全部写入启动脚本并回读断言通过。