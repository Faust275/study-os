package com.faust275.studyos.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.ChronoUnit

data class CourseItem(
    val start: String,
    val end: String,
    val name: String,
    val note: String,
    val kind: String = ""
) {
    fun resolvedKind(): String {
        when (kind) {
            "ana", "alg", "due", "rest", "class" -> return kind
        }
        return when {
            name.contains("分析") || name.contains("数分") -> "ana"
            name.contains("代数") || name.contains("高代") -> "alg"
            name.contains("作业") || name.contains("C程") || name.contains("C 程") || name.contains("周志") || name.contains("备课") -> "due"
            name.contains("跑") || name.contains("琴") || name.contains("出游") || name.contains("电影") || name.contains("休") -> "rest"
            else -> "class"
        }
    }
}

data class TodoItem(
    val id: String = "",
    val title: String,
    val due: String,
    val dueDate: String = "",
    val remainDays: Int?,
    val done: Boolean = false
)

data class ExamItem(val name: String, val date: String)

data class WidgetSnapshot(
    val updatedAt: Long,
    val today: String,
    val weekday: String,
    val courses: List<CourseItem>,
    val scheduleByDate: Map<String, List<CourseItem>> = emptyMap(),
    val todos: List<TodoItem> = emptyList(),
    val nextTodo: TodoItem?,
    val nextExam: ExamItem?
) {
    /** 若 7 日课表字典中已包含 dateIso，则跨午夜后依然新鲜可用；超出字典范围才视为过期。 */
    fun isStaleOn(dateIso: String): Boolean {
        if (scheduleByDate.containsKey(dateIso)) return false
        return today.isNotEmpty() && today != dateIso
    }

    /** 获取指定日期的课程列表；若快照已过期且不在 7 日字典内，返回空列表避免拿旧课冒充今日。 */
    fun coursesFor(dateIso: String): List<CourseItem> {
        scheduleByDate[dateIso]?.let { return it }
        return if (!isStaleOn(dateIso)) courses else emptyList()
    }

    fun weekdayFor(dateIso: String): String {
        return try {
            when (LocalDate.parse(dateIso).dayOfWeek) {
                DayOfWeek.MONDAY -> "周一"
                DayOfWeek.TUESDAY -> "周二"
                DayOfWeek.WEDNESDAY -> "周三"
                DayOfWeek.THURSDAY -> "周四"
                DayOfWeek.FRIDAY -> "周五"
                DayOfWeek.SATURDAY -> "周六"
                DayOfWeek.SUNDAY -> "周日"
                else -> weekday
            }
        } catch (_: Exception) {
            weekday
        }
    }

    fun activeTodoOn(dateIso: String): TodoItem? {
        if (todos.isNotEmpty()) {
            // 当天刚在桌面勾选完成的待办保留在原位以支持反悔取消；跨过截止日后自动切到下一条未过期项
            val valid = todos.filter { it.dueDate.isEmpty() || it.dueDate >= dateIso }
            val notDone = valid.firstOrNull { !it.done }
            val firstValid = valid.firstOrNull()
            return if (today == dateIso && firstValid != null && firstValid.done) firstValid else (notDone ?: firstValid)
        }
        val fallback = nextTodo ?: return null
        if (fallback.dueDate.isNotEmpty() && fallback.dueDate < dateIso && fallback.done) return null
        return fallback
    }

    fun remainDaysFor(todo: TodoItem, dateIso: String): Int? {
        if (todo.dueDate.isNotEmpty()) {
            return try {
                ChronoUnit.DAYS.between(LocalDate.parse(dateIso), LocalDate.parse(todo.dueDate))
                    .toInt()
                    .coerceAtLeast(0)
            } catch (_: Exception) {
                todo.remainDays
            }
        }
        return if (!isStaleOn(dateIso) && today == dateIso) todo.remainDays else null
    }
}

/**
 * 桌面小组件后台操作脏标记与变更事务队列 (Mutation Log)
 */
object WidgetMutations {
    private const val PREF_NAME = "widget_mutations"
    private const val KEY_MUTATIONS = "pending_mutations"
    private const val KEY_VERSION = "mutation_version"

    @Synchronized
    fun recordToggle(context: Context, todoId: String, done: Boolean): Long {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val version = prefs.getLong(KEY_VERSION, 0L) + 1
        val raw = prefs.getString(KEY_MUTATIONS, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }

        val mut = JSONObject().apply {
            put("id", todoId)
            put("done", done)
            put("timestamp", System.currentTimeMillis())
            put("version", version)
        }
        arr.put(mut)
        prefs.edit()
            .putLong(KEY_VERSION, version)
            .putString(KEY_MUTATIONS, arr.toString())
            .apply()
        return version
    }

    @Synchronized
    fun peekPending(context: Context): List<JSONObject> {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_MUTATIONS, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        val list = mutableListOf<JSONObject>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            list.add(o)
        }
        return list
    }

    @Synchronized
    fun ackPending(context: Context, maxVersion: Long): Int {
        if (maxVersion <= 0L) return 0
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_MUTATIONS, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        val keep = JSONArray()
        var dropped = 0
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optLong("version", 0L) <= maxVersion) dropped++ else keep.put(o)
        }
        if (dropped > 0) prefs.edit().putString(KEY_MUTATIONS, keep.toString()).apply()
        return dropped
    }
}

/**
 * 读取 / 解析网页写入的 JSON 快照。
 * 文件位于 App 私有目录，Widget 独立进程可直接读取。
 */
object WidgetData {
    const val FILE_NAME = "widget_data.json"

    fun load(context: Context): WidgetSnapshot? {
        return try {
            val file = File(context.filesDir, FILE_NAME)
            if (!file.exists()) return null
            parse(file.readText())
        } catch (_: Exception) {
            null
        }
    }

    /**
     * 原子落盘：先写临时文件再 rename，避免小组件在截断窗口里读到半截 JSON。
     * 所有写入方都必须经过这里（同名对象的 monitor 同时充当同进程写锁）。
     */
    @Synchronized
    fun writeSnapshot(context: Context, json: String) {
        val file = File(context.filesDir, FILE_NAME)
        val tmp = File(context.filesDir, "$FILE_NAME.tmp")
        tmp.writeText(json)
        if (!tmp.renameTo(file)) {
            file.writeText(json)
            tmp.delete()
        }
    }

    @Synchronized
    fun updateTodoStatus(context: Context, todoId: String, done: Boolean): Boolean {
        return try {
            val file = File(context.filesDir, FILE_NAME)
            if (!file.exists()) return false
            val o = JSONObject(file.readText())
            var updated = false
            val todoObj = o.optJSONObject("nextTodo")
            if (todoObj != null && (todoObj.optString("id") == todoId || todoId.isEmpty())) {
                todoObj.put("done", done)
                updated = true
            }
            val todosArr = o.optJSONArray("todos")
            if (todosArr != null) {
                for (i in 0 until todosArr.length()) {
                    val item = todosArr.optJSONObject(i) ?: continue
                    if (item.optString("id") == todoId) {
                        item.put("done", done)
                        updated = true
                    }
                }
            }
            if (updated) {
                o.put("updatedAt", System.currentTimeMillis())
                writeSnapshot(context, o.toString())
            }
            updated
        } catch (_: Exception) {
            false
        }
    }

    private fun parseCourseArray(arr: JSONArray?): List<CourseItem> {
        if (arr == null) return emptyList()
        val list = mutableListOf<CourseItem>()
        for (i in 0 until arr.length()) {
            val c = arr.optJSONObject(i) ?: continue
            val note = c.optString("note").ifEmpty { c.optString("location") }
            list.add(
                CourseItem(
                    start = c.optString("start"),
                    end = c.optString("end"),
                    name = c.optString("name"),
                    note = note,
                    kind = c.optString("kind")
                )
            )
        }
        return list
    }

    private fun parseTodoObj(t: JSONObject): TodoItem {
        val rd = if (t.has("remainDays") && !t.isNull("remainDays")) t.optInt("remainDays") else null
        return TodoItem(
            id = t.optString("id"),
            title = t.optString("title"),
            due = t.optString("due"),
            dueDate = t.optString("dueDate"),
            remainDays = rd,
            done = t.optBoolean("done", false)
        )
    }

    fun parse(json: String): WidgetSnapshot? {
        return try {
            val o = JSONObject(json)
            val courses = parseCourseArray(o.optJSONArray("courses"))

            val scheduleByDate = LinkedHashMap<String, List<CourseItem>>()
            o.optJSONObject("scheduleByDate")?.let { mapObj ->
                val keys = mapObj.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    scheduleByDate[k] = parseCourseArray(mapObj.optJSONArray(k))
                }
            }

            val todos = mutableListOf<TodoItem>()
            o.optJSONArray("todos")?.let { tArr ->
                for (i in 0 until tArr.length()) {
                    val item = tArr.optJSONObject(i) ?: continue
                    todos.add(parseTodoObj(item))
                }
            }

            val nextTodo = o.optJSONObject("nextTodo")?.let { parseTodoObj(it) }
            val nextExam = o.optJSONObject("nextExam")?.let { e ->
                ExamItem(
                    name = e.optString("name"),
                    date = e.optString("date")
                )
            }

            WidgetSnapshot(
                updatedAt = o.optLong("updatedAt", 0),
                today = o.optString("today"),
                weekday = o.optString("weekday"),
                courses = courses,
                scheduleByDate = scheduleByDate,
                todos = todos,
                nextTodo = nextTodo,
                nextExam = nextExam
            )
        } catch (_: Exception) {
            null
        }
    }
}
