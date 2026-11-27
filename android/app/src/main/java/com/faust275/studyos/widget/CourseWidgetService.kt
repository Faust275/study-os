package com.faust275.studyos.widget

import com.faust275.studyos.R
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
        rv.setTextViewText(R.id.item_start, if (isOngoing) "▶ ${c.start}" else c.start)
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
