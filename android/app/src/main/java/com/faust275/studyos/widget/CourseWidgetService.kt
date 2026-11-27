package com.faust275.studyos.widget

import com.faust275.studyos.R
import com.faust275.studyos.widget.CourseWidgetProvider.Companion.setThemeTextColor
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.time.LocalDate
import java.time.LocalTime

/**
 * 为小组件里的 ListView 提供今日课程列表项。
 * RemoteViewsService 与应用同进程运行，从 WidgetData 读取快照并按系统当前时刻标记课程状态。
 */
class CourseWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return CourseViewFactory(applicationContext)
    }
}

class CourseViewFactory(
    private val context: Context
) : RemoteViewsService.RemoteViewsFactory {

    private var courses: List<CourseItem> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        val todayIso = LocalDate.now().toString()
        courses = WidgetData.load(context)?.coursesFor(todayIso) ?: emptyList()
    }

    override fun onDestroy() {
        courses = emptyList()
    }

    override fun getCount(): Int = courses.size

    override fun getViewAt(position: Int): RemoteViews {
        val c = courses.getOrNull(position)
            ?: return RemoteViews(context.packageName, R.layout.widget_list_item)
        val rv = RemoteViews(context.packageName, R.layout.widget_list_item)
        val now = LocalTime.now()
        val nowHm = String.format("%02d:%02d", now.hour, now.minute)
        val isOngoing = c.start.isNotEmpty() && c.end.isNotEmpty() && c.start <= nowHm && nowHm <= c.end
        val isDone = c.end.isNotEmpty() && c.end < nowHm
        val dotRes = if (isDone) {
            R.drawable.widget_dot_done
        } else {
            when (c.resolvedKind()) {
                "ana" -> R.drawable.widget_dot_ana
                "alg" -> R.drawable.widget_dot_alg
                "due" -> R.drawable.widget_dot_due
                "rest" -> R.drawable.widget_dot_rest
                else -> R.drawable.widget_dot_class
            }
        }
        rv.setImageViewResource(R.id.item_dot, dotRes)
        rv.setTextViewText(R.id.item_start, if (isOngoing) "▶ ${c.start}" else c.start)
        val startColor = when {
            isDone -> R.color.widget_ink_faint
            isOngoing -> R.color.widget_ok
            else -> R.color.widget_ana
        }
        val nameColor = if (isDone) R.color.widget_ink_faint else R.color.widget_ink
        rv.setThemeTextColor(context, R.id.item_start, startColor)
        rv.setThemeTextColor(context, R.id.item_name, nameColor)
        val note = if (c.note.isNotEmpty()) " · ${c.note}" else ""
        val statusSuffix = if (isOngoing) " [上课中]" else if (isDone) " [已结束]" else ""
        rv.setTextViewText(R.id.item_name, c.name + note + statusSuffix)
        val fill = Intent()
        rv.setOnClickFillInIntent(R.id.item_root, fill)
        return rv
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
}
