package com.faust275.studyos

import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.Period

/**
 * 锁定 Health Connect 1.1.0 的聚合请求契约：
 * AggregateGroupByPeriodRequest 只接受 LocalDateTime 过滤器，
 * 传 Instant 会在构造器内直接抛 IllegalArgumentException（不是发给系统后才失败）。
 * 回归时若有人把 readMetrics 改回 Instant，这里会先红。
 */
class HealthConnectRequestContractTest {

    @Test
    fun localDateTimeFilterConstructs() {
        val start = LocalDateTime.of(2026, 11, 1, 0, 0)
        val end = LocalDateTime.of(2026, 11, 27, 12, 0)
        val req = AggregateGroupByPeriodRequest(
            metrics = emptySet<AggregateMetric<*>>(),
            timeRangeFilter = TimeRangeFilter.between(start, end),
            timeRangeSlicer = Period.ofDays(1)
        )
        req.hashCode()
    }

    @Test
    fun instantFilterThrowsImmediately() {
        val start = Instant.parse("2026-11-01T00:00:00Z")
        val end = Instant.parse("2026-11-27T00:00:00Z")
        try {
            AggregateGroupByPeriodRequest(
                metrics = emptySet<AggregateMetric<*>>(),
                timeRangeFilter = TimeRangeFilter.between(start, end),
                timeRangeSlicer = Period.ofDays(1)
            )
            fail("Instant 过滤器应在构造时抛 IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertEquals(
                "Either use TimeRangeFilter with LocalDateTime or AggregateGroupByDurationRequest",
                e.message
            )
        }
    }
}