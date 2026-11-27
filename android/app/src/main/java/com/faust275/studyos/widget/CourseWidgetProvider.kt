package com.faust275.studyos.widget

import com.faust275.studyos.R
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/**
 * 桌面小组件基类（默认 2×4 完整日程看板）及 1×2 / 2×2 / 1×4 多尺寸 Provider 实现。
 * 支持桌面直接勾选完成待办（后台免拉起 App 闭环），并记录脏标记供前台消费。
 */
open class CourseWidgetProvider : AppWidgetProvider() {

    /** 子类可重写以指定各自尺寸的布局；默认使用 2×4 完整看板。 */
    protected open val layoutRes: Int = R.layout.widget_layout

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) updateAppWidget(context, appWidgetManager, id, layoutRes)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_TOGGLE_TODO) {
            val todoId = intent.getStringExtra("todo_id") ?: ""
            if (todoId.isNotEmpty()) {
                val snap = WidgetData.load(context)
                val todayIso = LocalDate.now().toString()
                val activeTodo = snap?.activeTodoOn(todayIso)
                val curDone = if (activeTodo?.id == todoId) activeTodo.done else (snap?.nextTodo?.done ?: false)
                val newDone = !curDone
                // 1. 记入版本化 Mutation Log
                WidgetMutations.recordToggle(context, todoId, newDone)
                // 2. 本地快照就地更新状态
                WidgetData.updateTodoStatus(context, todoId, newDone)
                // 3. 通知全部多尺寸小组件实例刷新视图（免拉起 App 跨尺寸同步）
                val mgr = AppWidgetManager.getInstance(context)
                val providers = listOf(
                    CourseWidgetProvider::class.java to R.layout.widget_layout,
                    CourseWidgetProv1x2A::class.java to R.layout.widget_layout_1x2,
                    CourseWidgetProv2x2B::class.java to R.layout.widget_layout_2x2,
                    CourseWidgetProv1x4C::class.java to R.layout.widget_layout_1x4
                )
                for ((cls, layout) in providers) {
                    val cn = ComponentName(context, cls)
                    val ids = mgr.getAppWidgetIds(cn)
                    for (id in ids) {
                        updateAppWidget(context, mgr, id, layout)
                    }
                }
            }
            return
        }

        if (intent.action == AppWidgetManager.ACTION_APPWIDGET_UPDATE) {
            // 系统广播带 EXTRA_APPWIDGET_IDS，super.onReceive 已经分发过；
            // 只有网页侧 DataBridge 发来的包级广播（不带 ID）才需要补一次，
            // 且只刷新本类的实例，避免 4 个 provider 互相重复刷新。
            if (intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS) != null) return
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, this.javaClass))
            if (ids.isNotEmpty()) onUpdate(context, mgr, ids)
        }
    }

    companion object {
        const val ACTION_TOGGLE_TODO = "com.faust275.studyos.ACTION_TOGGLE_TODO"
        private const val REQ_LAUNCH_TODAY = 0
        private const val REQ_LIST_TEMPLATE = 1001
        private const val REQ_TOGGLE_TODO = 2001

        internal fun RemoteViews.setThemeTextColor(context: Context, viewId: Int, colorRes: Int) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setColorStateList(viewId, "setTextColor", colorRes)
            } else {
                setTextColor(viewId, context.getColor(colorRes))
            }
        }

        private fun computeDynamicHeaderTitle(snap: WidgetSnapshot, todayIso: String): String {
            if (snap.isStaleOn(todayIso)) return "打开 App 同步今日课程"
            val dayCourses = snap.coursesFor(todayIso)
            if (dayCourses.isEmpty()) return "今日无课"
            val now = LocalTime.now()
            val nowHm = String.format("%02d:%02d", now.hour, now.minute)
            val ongoing = dayCourses.firstOrNull { c ->
                c.start.isNotEmpty() && c.end.isNotEmpty() && c.start <= nowHm && nowHm <= c.end
            }
            if (ongoing != null) {
                return "上课中 · ${ongoing.name}"
            }
            val nextCourse = dayCourses
                .filter { c -> c.start.isNotEmpty() && c.start > nowHm }
                .minByOrNull { c -> c.start }
            if (nextCourse != null) {
                return "下节 ${nextCourse.start} · ${nextCourse.name}"
            }
            return "今日课程已结束"
        }

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            layoutRes: Int = R.layout.widget_layout
        ) {
            val views = RemoteViews(context.packageName, layoutRes)
            val snap = WidgetData.load(context)
            val todayIso = LocalDate.now().toString()
            val hasCourseList = layoutRes != R.layout.widget_layout_1x2

            if (snap != null) {
                val stale = snap.isStaleOn(todayIso)
                views.setTextViewText(R.id.widget_title, computeDynamicHeaderTitle(snap, todayIso))
                views.setTextViewText(
                    R.id.widget_date,
                    if (stale) "数据停在 ${snap.today} · 打开 App 同步"
                    else "${snap.weekdayFor(todayIso)} · $todayIso"
                )
            } else {
                views.setTextViewText(R.id.widget_title, "日迹")
                views.setTextViewText(R.id.widget_date, "打开 App 一次以同步")
            }

            if (hasCourseList) {
                val emptyText = if (snap == null || snap.isStaleOn(todayIso)) {
                    "打开 App 同步今日日程"
                } else {
                    "今天没有课"
                }
                views.setTextViewText(R.id.widget_empty, emptyText)

                val serviceIntent = Intent(context, CourseWidgetService::class.java).apply {
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                    data = android.net.Uri.parse("widget://course/$appWidgetId")
                }
                views.setRemoteAdapter(R.id.widget_list, serviceIntent)
                views.setEmptyView(R.id.widget_list, R.id.widget_empty)
            }

            val todo = snap?.activeTodoOn(todayIso)
            val exam = snap?.nextExam
            if (todo != null) {
                val isDone = todo.done
                views.setTextViewText(R.id.todo_label, if (isDone) "✓ 已完成待办" else "下一个待办")
                val remDays = snap.remainDaysFor(todo, todayIso)
                val remain = when (remDays) {
                    null -> todo.due
                    0 -> "今天"
                    1 -> "明天"
                    else -> "${remDays} 天后"
                }
                views.setTextViewText(R.id.todo_title, if (isDone) "✓ ${todo.title}" else todo.title)
                views.setTextViewText(R.id.todo_remain, if (isDone) "已达成" else remain)
                val accentRes = if (isDone) R.color.widget_ok else R.color.widget_due
                val titleRes = if (isDone) R.color.widget_ink_soft else R.color.widget_ink
                views.setThemeTextColor(context, R.id.todo_label, accentRes)
                views.setThemeTextColor(context, R.id.todo_remain, accentRes)
                views.setThemeTextColor(context, R.id.todo_title, titleRes)

                // 绑定免拉起桌面打勾 Intent（显式广播 + 固定 requestCode + IMMUTABLE）
                if (todo.id.isNotEmpty()) {
                    val toggleIntent = Intent(context, CourseWidgetProvider::class.java).apply {
                        action = ACTION_TOGGLE_TODO
                        putExtra("todo_id", todo.id)
                    }
                    val toggleFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    val pendingToggle = PendingIntent.getBroadcast(
                        context,
                        REQ_TOGGLE_TODO,
                        toggleIntent,
                        toggleFlags
                    )
                    views.setOnClickPendingIntent(R.id.todo_label, pendingToggle)
                    views.setOnClickPendingIntent(R.id.todo_remain, pendingToggle)
                }
            } else if (exam != null && exam.date.isNotEmpty()) {
                views.setTextViewText(R.id.todo_label, "近期节点")
                val days = try {
                    ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(exam.date)).toInt()
                } catch (_: Exception) { null }
                val remain = when {
                    days == null -> exam.date
                    days <= 0 -> "今天"
                    days == 1 -> "明天"
                    else -> "${days} 天后"
                }
                views.setTextViewText(R.id.todo_title, exam.name)
                views.setTextViewText(R.id.todo_remain, remain)
                views.setThemeTextColor(context, R.id.todo_label, R.color.widget_ana)
                views.setThemeTextColor(context, R.id.todo_remain, R.color.widget_ana)
                views.setThemeTextColor(context, R.id.todo_title, R.color.widget_ink)
            } else {
                views.setTextViewText(R.id.todo_label, "待办事项")
                views.setTextViewText(R.id.todo_title, "暂无待办")
                views.setTextViewText(R.id.todo_remain, "")
                views.setThemeTextColor(context, R.id.todo_label, R.color.widget_ink_faint)
                views.setThemeTextColor(context, R.id.todo_title, R.color.widget_ink_faint)
            }

            // 点组件根区域直接落到「今日」，课程列表项落到「课表」
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                putExtra("cp_route", "today")
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pending = PendingIntent.getActivity(context, REQ_LAUNCH_TODAY, launch, flags)
            views.setOnClickPendingIntent(R.id.widget_root, pending)

            if (hasCourseList) {
                val listLaunch = launch?.let { Intent(it).apply { putExtra("cp_route", "schedule") } }
                // ListView 的 PendingIntentTemplate 需要配合 fillInIntent 使用，必须保留 FLAG_MUTABLE
                val listClickFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                else PendingIntent.FLAG_UPDATE_CURRENT
                val listClickPending = PendingIntent.getActivity(context, REQ_LIST_TEMPLATE, listLaunch ?: launch, listClickFlags)
                views.setPendingIntentTemplate(R.id.widget_list, listClickPending)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
            if (hasCourseList) {
                appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list)
            }
        }
    }
}

/** 1×2 迷你胶囊小组件（1行×2列，仅展示标题与待办速览，无课程列表） */
class CourseWidgetProv1x2A : CourseWidgetProvider() {
    override val layoutRes: Int = R.layout.widget_layout_1x2
}

/** 2×2 紧凑方卡小组件（2行×2列） */
class CourseWidgetProv2x2B : CourseWidgetProvider() {
    override val layoutRes: Int = R.layout.widget_layout_2x2
}

/** 1×4 横向通栏小组件（1行×4列） */
class CourseWidgetProv1x4C : CourseWidgetProvider() {
    override val layoutRes: Int = R.layout.widget_layout_1x4
}
