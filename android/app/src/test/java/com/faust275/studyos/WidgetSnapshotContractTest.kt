package com.faust275.studyos

import com.faust275.studyos.widget.CourseItem
import com.faust275.studyos.widget.ExamItem
import com.faust275.studyos.widget.TodoItem
import com.faust275.studyos.widget.WidgetSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSnapshotContractTest {

    @Test
    fun sevenDayDictionaryPreventsMidnightStalenessAndStaleLeak() {
        val fri = CourseItem("08:00", "09:35", "百万立方", "")
        val sat = CourseItem("15:00", "17:00", "练习钢琴", "")
        val snap = WidgetSnapshot(
            updatedAt = 1L,
            today = "2026-11-27",
            weekday = "周五",
            courses = listOf(fri),
            scheduleByDate = mapOf(
                "2026-11-27" to listOf(fri),
                "2026-11-28" to listOf(sat),
                "2026-11-29" to emptyList()
            ),
            todos = listOf(
                TodoItem("2026-11-28|cprog", "C 程作业", "周六晚前", "2026-11-28", 1, false),
                TodoItem("2026-11-30|geo", "几何学作业", "周一课前", "2026-11-30", 3, false)
            ),
            nextTodo = TodoItem("2026-11-28|cprog", "C 程作业", "周六晚前", "2026-11-28", 1, false),
            nextExam = ExamItem("全校停课考试", "2027-01-06")
        )

        // 跨午夜到周六：未打开 App 仍从 7 日字典精准命中周六安排，动态刷新星期与待办剩余天数
        assertFalse(snap.isStaleOn("2026-11-28"))
        assertEquals("周六", snap.weekdayFor("2026-11-28"))
        assertEquals(listOf(sat), snap.coursesFor("2026-11-28"))
        val satTodo = snap.activeTodoOn("2026-11-28")!!
        assertEquals("C 程作业", satTodo.title)
        assertEquals(0, snap.remainDaysFor(satTodo, "2026-11-28"))

        // 跨到周日：前一条截止日已过，自动推进到周一待办，剩余天数动态算为 1 天（明天）
        val sunTodo = snap.activeTodoOn("2026-11-29")!!
        assertEquals("几何学作业", sunTodo.title)
        assertEquals(1, snap.remainDaysFor(sunTodo, "2026-11-29"))

        // 超出 7 日窗口后：明确标记过期且返回空课程列表，绝不拿旧课冒充今日上课中
        assertTrue(snap.isStaleOn("2026-12-10"))
        assertTrue(snap.coursesFor("2026-12-10").isEmpty())
    }
}
