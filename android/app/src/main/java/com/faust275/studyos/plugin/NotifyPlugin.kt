package com.faust275.studyos.plugin

/**
 * 原生系统闹钟通知插件（Kotlin）
 * --------------------------------------------------
 * Web 侧只能发页面内 toast，锁屏就没了。装成 App 后，提醒改走系统闹钟：
 * index.html 的 scheduleNativeNotifications 会把未来 21 天的上课/待办到期算好，
 * 通过 Capacitor 调到这里，由 AlarmManager 精确排程，到点由 NotifyReceiver 发通知。
 *
 * 与 Web 侧的接口契约（改签名必须先改 index.html 的 scheduleNativeNotifications）：
 *   available()                  -> { notifications: Boolean, exact: Boolean }
 *   requestPermission()          -> { notifications: Boolean, exact: Boolean, granted?: Boolean }（Android 13+ 弹系统授权框后补 granted）
 *   openSettings()               -> 跳系统「通知」设置页
 *   schedule({ items: [...] })   -> { scheduled: Int, skipped: Int, exact: Boolean }（skipped 为未排入条数）
 *     items 元素：{ id:int, at:long(毫秒时间戳), title:String, body:String }
 *   cancelAll()                  -> { cancelled: true }
 *   scheduleTimer({ at, title, body, route }) -> { scheduled: Boolean }（专注计时专用，ID 1500 独立于课表排程）
 *   cancelTimer()                -> { cancelled: true }
 *   notifyPermissions()          -> 同 available()，保留给老调用方
 *
 * 重启/覆盖安装后闹钟会被系统清空，BootReceiver 会读这里缓存的 items 重新排一遍。
 */
import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.faust275.studyos.MainActivity
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject

/** 排程逻辑集中在这里，插件和开机接收器共用一份。 */
object NotifyScheduler {
    const val CHANNEL_ID = "cp_remind"
    const val EXTRA_TITLE = "cp_title"
    const val EXTRA_BODY = "cp_body"
    const val EXTRA_ID = "cp_id"
    const val EXTRA_ROUTE = "cp_route"
    const val ACTION_SNOOZE = "com.faust275.studyos.NOTIFY_SNOOZE"
    const val ACTION_DISMISS = "com.faust275.studyos.NOTIFY_DISMISS"

    // Android 系统限制单应用并发 AlarmManager 闹钟上限 MAX_ALARMS_PER_UID = 500；
    // 与前端 scheduleNativeNotifications 的 1001…1489 对齐（上限 489 条 + 专注闹钟 1 条 = 490 条预算，勿扩上限）
    const val ID_BASE = 1000
    const val ID_MAX = 1490
    // 专注计时用独立 ID：必须落在 ID_BASE..ID_MAX 之外，否则 schedule()/cancelAll() 会把它一起清掉
    const val TIMER_ID = 1500

    private const val PREFS = "cp_notify"
    private const val KEY_ITEMS = "items"
    private const val PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    fun alarmManager(ctx: Context): AlarmManager? =
        ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    fun notificationManager(ctx: Context): NotificationManager? =
        ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

    fun notificationsEnabled(ctx: Context): Boolean {
        val nm = notificationManager(ctx) ?: return false
        // minSdk 26，areNotificationsEnabled 从 API 24 就有；不能用版本号把它短接掉，
        // 否则 Android 8–12 用户手动关闭通知后仍会显示“排程成功”。
        return nm.areNotificationsEnabled()
    }

    fun canScheduleExact(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return alarmManager(ctx)?.canScheduleExactAlarms() ?: false
    }

    /** 通知渠道：Android 8+ 不建渠道，通知根本不会显示。 */
    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = notificationManager(ctx) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "上课与待办提醒", NotificationManager.IMPORTANCE_HIGH)
                .apply {
                    description = "课表上课提醒与待办到期提醒"
                    enableVibration(true)
                }
        )
    }

    private fun pendingIntent(ctx: Context, id: Int, title: String, body: String, route: String = ""): PendingIntent? {
        val intent = Intent(ctx, NotifyReceiver::class.java).apply {
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_BODY, body)
            putExtra(EXTRA_ROUTE, route)
        }
        return PendingIntent.getBroadcast(ctx, id, intent, PI_FLAGS)
    }

    /** 把一批提醒排进系统闹钟，返回成功排入的条数。 */
    fun schedule(ctx: Context, items: JSONArray): Int {
        val am = alarmManager(ctx) ?: return 0
        // 先清掉上一轮排程，避免条目变少后旧闹钟仍在后台响
        cancelAll(ctx)
        if (!notificationsEnabled(ctx)) return 0
        ensureChannel(ctx)
        val exact = canScheduleExact(ctx)
        var ok = 0
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            val id = it.optInt("id", ID_BASE + i)
            if (id < ID_BASE || id >= ID_MAX) continue
            val at = it.optLong("at", 0L)
            if (at <= System.currentTimeMillis()) continue
            val pi = pendingIntent(
                ctx, id,
                it.optString("title", "提醒"),
                it.optString("body", ""),
                it.optString("route", "")
            ) ?: continue
            try {
                if (exact) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } else {
                    // 没有精确闹钟权限时退化为窗口闹钟，保底能响
                    am.setWindow(AlarmManager.RTC_WAKEUP, at - 30_000L, 60_000L, pi)
                }
                ok++
            } catch (se: SecurityException) {
                // 个别 ROM 会限制闹钟排程，跳过这一条，别让整次同步崩掉
            }
        }
        return ok
    }

    fun cancelAll(ctx: Context) {
        val am = alarmManager(ctx) ?: return
        val cancelled = HashSet<Int>()
        val raw = loadItems(ctx)
        if (raw != null) {
            val arr = try { JSONArray(raw) } catch (_: Exception) { null }
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val id = arr.optJSONObject(i)?.optInt("id", -1) ?: -1
                    if (id < ID_BASE || id >= ID_MAX) continue
                    val pi = pendingIntent(ctx, id, "", "") ?: continue
                    try { am.cancel(pi); cancelled.add(id) } catch (_: Exception) { /* 忽略 */ }
                }
            }
        }
        // 固定区间兜底：清理旧版本遗留或异常中断产生的孤儿闹钟（不影响独立专注闹钟 TIMER_ID=1500）
        for (id in ID_BASE until ID_MAX) {
            if (id in cancelled) continue
            val pi = pendingIntent(ctx, id, "", "") ?: continue
            try { am.cancel(pi) } catch (_: Exception) { /* 忽略 */ }
        }
    }

    /**
     * 专注计时到点提醒：独立于 21 天课表排程，不写 items 缓存。
     * 进程被杀/重启后闹钟随系统清空，由前端恢复计时时重新排一次。
     */
    fun scheduleTimer(ctx: Context, at: Long, title: String, body: String, route: String): Boolean {
        val am = alarmManager(ctx) ?: return false
        if (at <= System.currentTimeMillis()) return false
        if (!notificationsEnabled(ctx)) {
            cancelTimer(ctx)
            return false
        }
        ensureChannel(ctx)
        val pi = pendingIntent(ctx, TIMER_ID, title, body, route) ?: return false
        return try {
            if (canScheduleExact(ctx)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                am.setWindow(AlarmManager.RTC_WAKEUP, at - 30_000L, 60_000L, pi)
            }
            true
        } catch (e: SecurityException) {
            false
        }
    }

    fun cancelTimer(ctx: Context) {
        val am = alarmManager(ctx) ?: return
        val pi = pendingIntent(ctx, TIMER_ID, "", "") ?: return
        try { am.cancel(pi) } catch (e: Exception) { /* 忽略 */ }
    }

    fun saveItems(ctx: Context, json: String?) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ITEMS, json ?: "[]").apply()
        } catch (e: Exception) { /* 忽略 */ }
    }

    fun loadItems(ctx: Context): String? = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ITEMS, null)
    } catch (e: Exception) { null }

    /**
     * 开机 / 覆盖安装后重排：系统会清空 AlarmManager，这里从缓存把未来事件重新排一遍。
     * 过期的条目由 schedule() 自己过滤。
     */
    fun reapply(ctx: Context) {
        val raw = loadItems(ctx) ?: return
        val arr = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        if (arr.length() == 0) return
        if (!notificationsEnabled(ctx)) return
        schedule(ctx, arr)
    }
}

@CapacitorPlugin(
    name = "Notify",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")
    ]
)
class NotifyPlugin : Plugin() {

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(status())
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(status())
            return
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(status())
            return
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback")
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED
        if (granted) {
            // 刚授权就补排一次，用户不用再点「重排」
            NotifyScheduler.reapply(context)
        }
        val ret = status()
        ret.put("granted", granted)
        call.resolve(ret)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:" + context.packageName)
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("无法打开通知设置", e)
        }
    }

    @PluginMethod
    fun schedule(call: PluginCall) {
        val items: JSArray = call.getArray("items") ?: JSArray()
        if (!NotifyScheduler.notificationsEnabled(context)) {
            // 权限没开：清掉可能残留的旧闹钟，把清单留着，用户去授权后 BootReceiver/下次启动还能补排
            NotifyScheduler.cancelAll(context)
            NotifyScheduler.saveItems(context, items.toString())
            call.resolve(JSObject().put("scheduled", 0).put("skipped", items.length())
                .put("exact", NotifyScheduler.canScheduleExact(context)))
            return
        }
        val n = NotifyScheduler.schedule(context, items)
        NotifyScheduler.saveItems(context, items.toString())
        call.resolve(JSObject().put("scheduled", n).put("skipped", items.length() - n)
            .put("exact", NotifyScheduler.canScheduleExact(context)))
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        NotifyScheduler.cancelAll(context)
        NotifyScheduler.saveItems(context, "[]")
        call.resolve(JSObject().put("cancelled", true))
    }

    /** 专注计时：开始/恢复时排一条到点提醒，暂停/结束/重置时取消。 */
    @PluginMethod
    fun scheduleTimer(call: PluginCall) {
        val at = call.getLong("at") ?: 0L
        val title = call.getString("title") ?: "专注结束"
        val body = call.getString("body") ?: ""
        val route = call.getString("route") ?: ""
        val ok = NotifyScheduler.scheduleTimer(context, at, title, body, route)
        call.resolve(JSObject().put("scheduled", ok))
    }

    @PluginMethod
    fun cancelTimer(call: PluginCall) {
        NotifyScheduler.cancelTimer(context)
        call.resolve(JSObject().put("cancelled", true))
    }

    private fun status(): JSObject = JSObject()
        .put("notifications", NotifyScheduler.notificationsEnabled(context))
        .put("exact", NotifyScheduler.canScheduleExact(context))
}

/**
 * Manifest 里声明的 .plugin.NotifyReceiver —— 闹钟到点后由它把通知发出去。
 */
class NotifyReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val nm = NotifyScheduler.notificationManager(ctx) ?: return
        val id = intent.getIntExtra(NotifyScheduler.EXTRA_ID, NotifyScheduler.ID_BASE)
        val title = intent.getStringExtra(NotifyScheduler.EXTRA_TITLE) ?: "提醒"
        val body = intent.getStringExtra(NotifyScheduler.EXTRA_BODY) ?: ""
        val route = intent.getStringExtra(NotifyScheduler.EXTRA_ROUTE) ?: ""

        // 通知上的按钮：知道了 = 直接收掉；10 分钟后再提醒 = 用同一条内容重排一次
        when (intent.action) {
            NotifyScheduler.ACTION_DISMISS -> {
                nm.cancel(id)
                return
            }
            NotifyScheduler.ACTION_SNOOZE -> {
                nm.cancel(id)
                val am = NotifyScheduler.alarmManager(ctx) ?: return
                val again = Intent(ctx, NotifyReceiver::class.java).apply {
                    putExtra(NotifyScheduler.EXTRA_ID, id)
                    putExtra(NotifyScheduler.EXTRA_TITLE, title)
                    putExtra(NotifyScheduler.EXTRA_BODY, body)
                    putExtra(NotifyScheduler.EXTRA_ROUTE, route)
                }
                val pi = PendingIntent.getBroadcast(
                    ctx, id, again,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val at = System.currentTimeMillis() + 10 * 60 * 1000L
                try {
                    if (NotifyScheduler.canScheduleExact(ctx)) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                    } else {
                        am.setWindow(AlarmManager.RTC_WAKEUP, at - 30_000L, 60_000L, pi)
                    }
                } catch (e: SecurityException) { /* 忽略 */ }
                return
            }
        }

        NotifyScheduler.ensureChannel(ctx)
        if (!NotifyScheduler.notificationsEnabled(ctx)) return

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.Notification.Builder(ctx, NotifyScheduler.CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            android.app.Notification.Builder(ctx)
        }
        // 点通知直接回 App（默认落在「今日」）
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (route.isNotEmpty()) putExtra(NotifyScheduler.EXTRA_ROUTE, route)
        }
        val pi = PendingIntent.getActivity(
            ctx, id, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        builder
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .addAction(
                android.R.drawable.ic_popup_reminder, "10 分钟后再提醒",
                actionIntent(ctx, id, NotifyScheduler.ACTION_SNOOZE, title, body, route, 1)
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel, "知道了",
                actionIntent(ctx, id, NotifyScheduler.ACTION_DISMISS, title, body, route, 2)
            )
        nm.notify(id, builder.build())
    }

    private fun actionIntent(
        ctx: Context, id: Int, action: String,
        title: String, body: String, route: String, slot: Int
    ): PendingIntent {
        val i = Intent(ctx, NotifyReceiver::class.java).apply {
            this.action = action
            putExtra(NotifyScheduler.EXTRA_ID, id)
            putExtra(NotifyScheduler.EXTRA_TITLE, title)
            putExtra(NotifyScheduler.EXTRA_BODY, body)
            putExtra(NotifyScheduler.EXTRA_ROUTE, route)
        }
        return PendingIntent.getBroadcast(
            ctx, id * 10 + slot, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}

/**
 * 开机 / 覆盖安装后重排闹钟。系统重启会清空 AlarmManager，
 * 没有这个接收器，用户重启一次手机就再也收不到提醒。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                try { NotifyScheduler.reapply(context) } catch (e: Exception) { /* 忽略 */ }
            }
        }
    }
}
