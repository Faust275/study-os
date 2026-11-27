package com.faust275.studyos.plugin

import com.faust275.studyos.widget.WidgetMutations
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "TodayWidget")
class TodayWidgetPlugin : Plugin() {

    @PluginMethod
    fun getPendingWidgetMutations(call: PluginCall) {
        val mutations = WidgetMutations.peekPending(context)
        val arr = JSArray()
        var maxVersion = 0L
        for (m in mutations) {
            val item = JSObject()
            item.put("id", m.optString("id"))
            item.put("done", m.optBoolean("done"))
            item.put("timestamp", m.optLong("timestamp"))
            val v = m.optLong("version")
            item.put("version", v)
            if (v > maxVersion) maxVersion = v
            arr.put(item)
        }
        val ret = JSObject()
        ret.put("mutations", arr)
        ret.put("maxVersion", maxVersion)
        call.resolve(ret)
    }

    /** JS 应用完这批变更后再确认，失败时不 ack，下次前台会重新下发。 */
    @PluginMethod
    fun ackWidgetMutations(call: PluginCall) {
        val maxVersion = call.getLong("maxVersion") ?: 0L
        val acked = WidgetMutations.ackPending(context, maxVersion)
        call.resolve(JSObject().put("ok", true).put("acked", acked))
    }
}
