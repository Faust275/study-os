package com.faust275.studyos;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.faust275.studyos.bridge.DataBridge;
import com.faust275.studyos.plugin.BackupExportPlugin;
import com.faust275.studyos.plugin.HealthConnectPlugin;
import com.faust275.studyos.plugin.NotifyPlugin;
import com.faust275.studyos.plugin.TodayWidgetPlugin;

public class MainActivity extends BridgeActivity {
    private static final String EXTRA_ROUTE = "cp_route";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(TodayWidgetPlugin.class);
        registerPlugin(NotifyPlugin.class);
        registerPlugin(BackupExportPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.addJavascriptInterface(new DataBridge(this), "AndroidBridge");
        }
        applyRoute(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyRoute(intent);
    }

    private void applyRoute(Intent intent) {
        if (intent == null) return;
        final String route = intent.getStringExtra(EXTRA_ROUTE);
        if (route == null || !route.matches("[a-z]{1,20}")) return;
        dispatchRouteWithRetry(route, 0);
    }

    private void dispatchRouteWithRetry(final String route, final int attempt) {
        if (attempt >= 10 || getBridge() == null || getBridge().getWebView() == null) return;
        final WebView wv = getBridge().getWebView();
        final String js = "(function(){if(window.App&&window.App.go){window.App.go('" + route + "');return 'ok';}return 'wait';})()";
        wv.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(js, value -> {
                        if (value == null || !value.contains("ok")) {
                            dispatchRouteWithRetry(route, attempt + 1);
                        }
                    });
                } catch (Exception ignored) {}
            }
        }, 300);
    }
}
