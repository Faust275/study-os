# 日迹 (Study OS)

面向单个学期的「课表 + 学习闭环」个人应用：把每天要上的课、要交的作业、专注时长、成绩构成、睡眠与步数、饮食与账目收在一个入口里。同一份代码既是可离线安装的 **PWA**，也是带原生能力的 **Android APK**（Capacitor 壳，包名 `com.faust275.studyos`）。

当前版本 **1.0.10**，面向 2026 冬学期（15 周）自用；不是多用户产品，没有账号体系与云同步。

## 项目背景

这个项目是「通用工具 → 专用工具」的第三次收敛：

1. 最早是 **Course Planner**（`Faust275/course-planner`）：一个通用课表 PWA，课表、待办、计划、专注、记账、成绩、日记都在里面，单文件、可双击打开。它解决的是「什么都能装」，但学期里的调课、停课、考试周、成绩构成这些细节只能靠通用字段硬凑。
2. 随后是 **Math Course Hub**（`Faust275/math-course-hub`）：把课堂讲义、作业与四本教材做成纯静态、可离线的阅读站。它解决的是「内容放在哪」，但不参与日程。
3. 本仓库 **Study OS** 把两者之间缺的那层补上：以 `YYYY-MM-DD` 为唯一时间入口，围绕一个真实学期重写数据模型（15 周段、补课/停课例外、考试周、成绩构成、周复盘），并把需要原生能力的功能（Health Connect、系统通知、桌面小组件、文件导出）放进 Capacitor 壳。

因此它的定位不是「又一个课表 App」，而是作者本人每天真正会打开的学期中枢；很多取舍（单文件、无账号、本地存储、只读健康数据）都是为「单人长期自用」服务的。

### 与前两个项目的关系

| 项目 | 角色 | 与 Study OS 的关系 |
|---|---|---|
| [course-planner](https://github.com/Faust275/course-planner) | 前代通用课表 PWA + Capacitor 壳（`com.faust275.courseplanner`） | 功能思路的前身：课表、专注、记账、成绩等模块在这里首次成型。Study OS 针对单学期重写日期模型与界面，**独立包名**，可与旧版共存、互不覆盖；旧项目保持原样，不再跟进新功能。 |
| [math-course-hub](https://github.com/Faust275/math-course-hub) | 配套讲义 / 教材静态站 | 内容侧搭档。Study OS **不内嵌教材正文**，只在今日页教材入口、英语错词本等处深链过去，避免两处维护同一份内容。 |
| 本仓库 study-os | 学期日程与个人数据中枢 | PWA（GitHub Pages 可直接托管）+ Android APK（GitHub Actions 构建）；数据只存在本机。 |

一句话：**Hub 管内容，Study OS 管日程与数据，Course Planner 是前代通用版**。

## 功能范围

- **今日 / 课表**：15 周冬学期模板，支持调课、停课、考试周等日期例外；3 日居中视图与周视图都以 ISO 日期为准，不依赖「第几周第几天」推算。
- **学习闭环**：章节完成度、专题里程碑、计划 vs 实际、周复盘、专注计时与课程投入统计。
- **成绩**：树形成绩构成、平时分/期末分试算、考勤联动。
- **生活**：睡眠分期与步数（Health Connect，只读）、饮食记录、账本、日记。
- **提醒与导出**：21 天课程提醒、专注结束闹钟（原生 AlarmManager）、`.ics` 日历导出、JSON 备份与自动快照。
- **Android 原生**：4 个桌面小组件（含免拉起打勾）、Health Connect 同步、通知、备份写入 `Download/StudyOS/`。

## 技术架构

```
study-os/
├── index.html              单页应用：视图 + 业务逻辑（无构建步骤）
├── app.css                 离线样式，check:classes 保证类名不悬空
├── sw.js                   Service Worker，缓存版本 study-os-v28
├── manifest.json           PWA 清单
├── tools/check-classes.mjs CSS 类名门禁（CI 必跑）
├── tools/verify-web.mjs    Web 行为回归测试（固定时钟，CI 必跑）
├── .github/workflows/      云端构建 APK + 明文密钥扫描
└── android/
    ├── app/src/main/java/com/faust275/studyos/
    │   ├── MainActivity.java        注册插件、处理 cp_route 深链
    │   ├── bridge/DataBridge.kt     小组件与 WebView 的数据通道
    │   ├── plugin/                  Notify / TodayWidget / HealthConnect / BackupExport
    │   └── widget/                  4 个小组件 Provider 与数据快照
    └── app/build.gradle             版本号推导、签名配置、release 缺钥即失败
```

- **Web 层**：原生 JS（无框架、无打包器），`localStorage` + `IndexedDB` 双持久化，自动快照用于回滚。
- **原生层**：Capacitor 8；Health Connect 使用 `AggregateGroupByPeriodRequest` + `LocalDateTime` 过滤；小组件快照采用临时文件 + rename 原子落盘，勾选队列 peek→ack。
- **离线**：Service Worker 逐项缓存，导航/静态资源缺失时返回明确的 503/504，而不是抛 `TypeError`。
- **CI**：`check:classes` + `test:web` → 构建与 JVM 单测 → 上传 APK；构建前扫描 Token/私钥/keystore，命中即中止。

## 数据与隐私

- 所有业务数据只存在本机（浏览器 IndexedDB / localStorage，或 APK 的 WebView 存储），**没有服务器、没有账号、没有遥测**。
- Health Connect 仅申请读权限，不写回系统。
- Android 清单设置 `allowBackup="false"`：卸载或换机即清空，因此设置页提供导出提醒（超过 7 天未导出会提示），备份默认写入 `Download/StudyOS/`。
- 备份 JSON 不含 API 密钥；照片不进入备份。

## 构建与测试

**网页**：无构建步骤，直接打开 `index.html` 即可。提交前跑：

```bash
npm run check:classes     # index.html 用到的类必须存在于 app.css / inline style
npm run test:web          # 固定时钟 Web 行为与交互回归测试
```

**Android**（需 JDK 21 + Android SDK 36）：

```bash
npm install
npm run sync:www          # 同步网页资源到 www/
npx cap sync android
cd android && ./gradlew testDebugUnitTest assembleDebug
```

`testDebugUnitTest` 里包含 `HealthConnectRequestContractTest`（锁定聚合请求必须用 `LocalDateTime`）与 `WidgetSnapshotContractTest`（锁定小组件 7 日课表快照与跨日契约）。

**CI 出包**：推送 `main` 或打 `v*` 标签，Actions 会跑 `check:classes`、扫描明文密钥并上传 APK。未配置签名 Secret 时产出 debug 包，但 debug 证书每次可能不同，**不能用于长期覆盖升级**。

## 签名（长期自用必读）

应用身份 = 包名 + 签名证书。debug 包用的是本机/CI 临时证书，换机器或清缓存后新包就无法覆盖旧包；`allowBackup=false` 又意味着卸载即清数据。所以要长期自用，请一次性配好固定 keystore，之后永不更换。

1. 在仓库外生成 keystore（口令至少 6 位，PKCS12 下 `-keypass` 与 `-storepass` 相同）：

```bash
keytool -genkeypair -v \
  -keystore /path/outside/repo/studyos-release.keystore \
  -alias studyos -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12 -storepass <口令> -keypass <口令> \
  -dname "CN=StudyOS, OU=Personal, O=YourName, C=CN"
```

2. 本地构建：复制 `android/keystore.properties.example` 为 `android/keystore.properties`（已被 gitignore），填 `storeFile` / `storePassword` / `keyAlias` / `keyPassword`；或使用环境变量 `KEYSTORE_PATH`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`。缺签名时 `assembleRelease` 会直接失败，避免误出未签名包。

3. CI：在仓库 Secrets 配置 `ANDROID_KEYSTORE_BASE64`（keystore 的 Base64 单行）、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。keystore 与口令不要提交到仓库；CI 自带密钥扫描。

4. 从 debug 包切到签名包只需一次：旧包「设置 → 导出备份」→ 卸载 → 安装签名包 → 导入备份。之后同签名的新包可直接覆盖升级。

**versionCode 规则**：由 `package.json` 版本推导（`1.0.10 → 10010`）；CI 取 `max(推导值, 10000 + run_number)`，保证递增。手工构建被提示版本过低时，用 `APP_VERSION_CODE` 覆盖。

## 已知限制

- 单人自用，无多用户、无云同步、无跨设备实时合并（仅同源多标签页做保守同步）。
- 动态空档推荐、实时白噪音、顺延到明天、考场时间录入、节假日/停课批量例外、二维码同步、加密备份、全文笔记搜索均未实现。
- 数据模型与界面围绕 2026 冬学期，换学期需要改模板与日期例外，不是开箱即用的通用日历。
- Health Connect 依赖小米运动健康把数据写入系统；部分机型/权限组合下只能拿到步数或拿不到睡眠分期。
- `.ics` 导出通过稳定 `UID` 与递增 `SEQUENCE` 更新课表时间与跳过状态，但已删除的临时自定义日程不会生成取消墓碑，需在外部日历中手动移除。

## 给审阅者的入口

- 业务与视图集中在 `index.html`（约 330 KB，按注释分区：状态/迁移、日期模型、各页渲染、原生桥）。
- 原生能力看 `android/app/src/main/java/com/faust275/studyos/`，其中 `NotifyPlugin.kt`（21 天提醒 + 专注闹钟 ID 1500）、`HealthConnectPlugin.kt`（LocalDateTime 聚合）、`widget/`（原子快照与勾选队列）最值得先读。
- 数据风险点：`migrateState()` 的清洗白名单、`restoreState()` 的回滚、多标签页 `storage` 监听。
- 构建门禁：`tools/check-classes.mjs`、`tools/verify-web.mjs`、`.github/workflows/build-apk.yml`。

## 更新记录

### v1.0.10
- 清空示例与数据隔离：按演示种子清理未改动的示例成绩、考勤、补录、四象限、日记、账本、饮食与专注底数，按可判定字段保留用户新增及已修改的真实记录；APK 安装版中自动隐藏仅限网页同源使用的知识库同步入口。
- 月历与倒数：月历网格补全整月农历显示，月份切换改用 `YYYY-MM` 并支持跨年翻月；「近期关键倒数」改为按当前日期动态计算并自动递补未过期节点。
- 专注与配额闭环：新增 `focusHistory` 按日专注字典，打通月历历史回看与周复盘；「本周额度计划」按周分桶存储（自动迁移旧版扁平数据），背单词与 23:30 收尾额度直接联动每日习惯打卡。
- 提醒与 `.ics` 导出：统一通过 `getEffectiveDayItems` 消费跳过与顺延状态，修正顺延跨午夜的结束日期与稳定 `UID`/递增 `SEQUENCE`/`STATUS:CANCELLED`；日程变更后自动防抖重排系统闹钟；`NotifyScheduler.cancelAll` 改为按已存排程与固定区间兜底取消。
- 桌面小组件与权限收敛：快照升级为未来 7 日有效课表字典（附课程/事项主题分类）与待办截止日，跨午夜未开 App 仍可展示当日课表与实时待办倒数，超出窗口后空态明确提示同步且不再误标旧课「上课中」；4 个尺寸统一换用暖宣纸/夜砚墨 `values-night` 深浅色资源、衬线标题与课程主题色圆点；重做 1×4 横向通栏与 1×2 紧凑布局；移除未使用的运动/距离健康权限与冗余插件接口；清理 `check:classes` 动态类名与 CSS 变量校验盲区。
- 纸墨视觉重构、安全区与返回关闭栈：统一浅色暖宣纸与深色夜砚墨 CSS 设计令牌；重做今日首屏（大号衬线日期、主线完成度进度环、距下一段倒数与课程色条主卡）、纵向时间轴日程流（进行中高亮与早间已结束项自动折叠）、整周时间轴当前时刻横线与周末列底色、手机端悬浮毛玻璃胶囊底部导航；补全顶部与底部安全区适配，并统一 Android 返回键、Esc 与 PWA 浏览器回退的弹层关闭栈。

### v1.0.9
- 专注计时接入系统闹钟：开始/恢复时排一条独立 ID（1500）的到点通知，暂停、结束、重置、恢复数据等路径同步取消；锁屏或切后台后不再依赖被冻结的 WebView 定时器。课表 21 天提醒的 `cancelAll` 不会误清计时闹钟。
- 导出提醒：记录最近一次备份导出时间，设置页在从未导出或超过 7 天时给出提示，可一键把备份写入 `下载/StudyOS/`。
- 桌面小组件：点组件主体直达「今日」、点课程列表项直达「课表」（复用 `cp_route` 路由）；免拉起打勾逻辑不变。

### v1.0.8
- Health Connect 聚合请求改用 `LocalDateTime` 过滤器：`AggregateGroupByPeriodRequest` 只接受本地时间范围，之前传 `Instant` 会在构造时直接抛 `IllegalArgumentException`，活动数据永远读不到。新增 JVM 契约测试锁定这一行为。
- 补上 Health Connect 睡眠分期 `AWAKE_IN_BED(7)`：在床清醒时间不再漏计，`totalMinutes` 与清醒时长口径一致。
- Android 14+ 权限用途说明入口改为标准 `activity-alias`（`VIEW_PERMISSION_USAGE` + `HEALTH_PERMISSIONS`），不再把 intent-filter 直接挂在主 Activity 上。
- 通知权限判断去掉版本号短路：Android 8–12 用户手动关闭通知后不再显示「排程成功」；同时删除未使用的 `AlarmClock` 跳转与每日重排接收器（重启后统一由 `BootReceiver` 从缓存重排）。
- 桌面小组件数据链：快照改为临时文件 + rename 原子落盘；变更队列改为 peek → JS 应用成功后再 ack，失败不丢；`ACTION_APPWIDGET_UPDATE` 包级广播只刷新各自 provider，避免 4 份组件重复刷新。
- 小米/Zepp CSV：睡眠与活动分两趟独立扫描，不再扫到睡眠就跳过步数行；支持 UTF-8→GBK 编码回退（Excel 另存的 CSV 不再乱码）；表头兜底识别 h/s 单位并对秒/分钟做启发式换算。
- `.ics` 导出：每个 `VEVENT` 补 `DTSTAMP`，声明 `CALSCALE` 与 `Asia/Shanghai` 的 `VTIMEZONE`；折行按 Unicode 码点计算，emoji 等 4 字节字符不再被劈开。
- Service Worker：安装时逐项缓存，单个资源失败不再拖垮整次安装；离线导航与静态资源在缓存缺失时返回明确的 503/504 响应，不再抛 `TypeError`。缓存版本升至 `study-os-v17`。

### v1.0.7
- 健康提示：睡眠为 0（清空演示数据/未录入）时不再误报「昨夜不足 6.5 小时」；仅在有有效睡眠记录时提示。
- 小米 CSV：睡眠字段支持 `deep_duration` 等别名；不再因仅有通用 `duration` 的行而误置零睡眠；总时长可用于补算浅睡；未识别到有效分钟数时继续向上扫描，不再提前 `break` 跳过表头回退。
- Health Connect 活动数据改用 `aggregateGroupByPeriod` 按天聚合，系统按应用优先级去重，避免手环+手机多来源重复计数；按本地零点对齐整日；仅 `SecurityException` 标为未授权，其他异常正常报错；授权请求增加在途保护，重复点击不再覆盖等待中的回调。
- 健康同步并发/节流：同步进行中重复点击直接提示；读取成功（含空数据）也会记录 `lastHcSyncAt`，避免冷启动反复整轮查询。
- 切页重绘：切换标签页时按目标页重绘，复盘写入、饮食增删等跨页变更无需手动刷新即可见。
- 英语错词本与 `wb_mastery_*` 解析拆分为独立容错，单个损坏键不再拖垮另一个模块。
- Service Worker：导航请求仅在 `res.ok` 时写入缓存，错误页/维护页不再覆盖离线首页；缓存版本升至 `study-os-v16`。

### v1.0.6
- 提醒契约：原生 `Notify.schedule` 统一返回 `{ scheduled, skipped }`，网页按实际排入条数提示并置位；冷启动只在系统通知仍开启时静默重排，权限被撤销后不再每次启动弹授权框。
- 专注计时结转：计时期间另一标签页写入新数据时，先合并再结算本次分钟数，避免时长被覆盖；跨夜按结束当天入账。
- 周复盘：目标推进按单位（章 / 公里 / 词）分别累计差值，最多列 3 个单位，无变化显示 `±0`。
- 健康自动同步：仅当已授权时静默读取，不再拉起系统授权页；部分类型未授权会在状态行标注。
- 桌面小组件：待办 ID 改为「日期|id」按日隔离，桌面勾选与网页勾选一一对应；快照待办按截止日排序，「下一个待办」取最近一条。
- 农历修复「初十」：补齐每月 10 日分支，不再显示 `初undefined`。
- 导出：`.ics` 显式声明 `text/calendar`，安卓 10+ 落到「下载/StudyOS」；JSON 备份保持按扩展名推断。
- 文案与配置：manifest 与界面统一为「15 周」；小组件后备标题改为「日迹」；Android assets 的 `capacitor.config.json` 对齐根配置（`webDir=www`、Splash 背景 `#F7F6F3`）。
- CI 新增 `check:classes` 门禁；Service Worker 缓存版本升至 `study-os-v15`。

### v1.0.5
- 修复冷启动恢复竞态：浏览器清空 localStorage、数据只在 IndexedDB 时，启动渲染不再触发一次空状态写入（`switchTab(tab, silent)`），恢复回调末尾立即 `save()` 并 `flushNow()`，避免 250ms 后旧写覆盖 IndexedDB、刷新即丢数据。
- 新增「我的目标」：进度页可自建可量化目标（标题、目标值、当前值、步长、单位、截止日、备注），支持 ± 快速推进、达成提示、编辑、归档/恢复与删除撤销，并接入全局搜索。
- 1.0.4 安全与可读性：撤销按钮随提示到期真正隐藏；目标 ± 按钮加大到 32px；单位为空时不渲染「单位」；新增 `npm run check:classes` 白名单校验，打包前检查 `index.html` 使用到的类是否都在离线 `app.css` 中编译。
- 1.0.4 今日页：在「当前安排」下方新增 1 条「在办目标」微卡，按最近截止日排序，显示完成度与剩余目标数；点击直达进度页并打开目标详情。
- 1.0.4 进度页：新增「计划 vs 实际」一行，按当前周显示章节完成度、累计专注与「按计划 / 超前 N 周 / 落后 N 周」；启动前显示距启动天数，避免伪造天数口径。
- 1.0.4 周复盘：进度页新增周复盘卡，汇总目标推进（取本周最早日期的自动快照为基线，缺失时明确降级）、日程/作业完成、专注分钟与覆盖率、考勤与待补池；可一键写入「复盘」日记，按周去重并支持撤销。自动快照保留期由 7 天延长到 14 天，保证周初基线可用。
- 修复章节卡内「标记」按钮被整卡跳转拦截的问题：分析/代数章节完成状态现在可以正常切换，并即时反映到「计划 vs 实际」。
- 番茄钟：计时中锁定时长与课程切换；跨夜结束按今日入账；冷启动可恢复未结束的计时；重置立即落盘；替换数据的入口会先确认并结算计时（超过 12 小时直接丢弃）；恢复后的数据不会带回旧计时。
- 冷启动恢复修正：启动时的首次保存不再抬高 `_savedAt` 从而挡住 IndexedDB 中更新的数据；计时器在 IndexedDB 恢复完成后再拉起。
- 农历修复：补上失效的 Base64 解码依赖；修正 10 个冬季关键日期的硬编码农历标签。
- 备份导入与恢复加固：先解析、校验再覆盖；最小 JSON 不注入演示数据；撤销统一走 `migrateState()`；回滚快照写入失败会明确提示。
- 迁移容错：导入/旧版本数据中的嵌套字段做类型清洗；成绩、专题、四象限、待补池的 ID 与数值字段、课程制式/等级做白名单归一。
- 自动快照语义修正：每个保存动作都会把当天快照更新为最近状态；裁剪日期持久化且仅在写入成功后推进；快照写入/裁剪会同步刷新复盘缓存。
- 多标签页保守同步：监听 `storage`/`focus`/`visibilitychange`，普通数据变更可被另一标签页静默采纳；任一侧有活动计时时跳过自动采纳。
- 安全加固：用户输入统一转义；`wb_mastery_*`、成绩/账目 SVG 文本、专题与四象限 ID、导入的专注分类与自定义时间块均不再形成可执行 HTML；里程碑/教材链接仅允许 `http/https`。
- CI 打包新增明文密钥扫描：发现 GitHub Token、AWS Key、私钥头或仓库内 keystore/jks/local.properties 时直接中止构建。
- 考勤按课程分科统计：成绩页「考勤联动」按当前课程自动计算；匹克球、身体素质等分别独立。
- 饮食记录按日期隔离，月历胶囊、当日面板、周报与洞察都只展示对应日期的数据。
- 全局搜索扩展：章节、待办、专题里程碑、四象限任务、考勤备注、日记均可搜索；旧版 `w9|d|id` 周块键会夹取到该周实际最后一天。
- 修正「累计支出」等文案口径，清理演示数据与废弃字段。

## 使用范围

本项目为个人自用，仓库公开仅便于部署与审阅，未附开源许可；如需复用代码或数据模型，请先联系作者。