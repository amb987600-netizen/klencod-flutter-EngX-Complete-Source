package com.engx.maintenance;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen widget backed only by the last snapshot written by EngXWidgetsPlugin. */
public class EngXWidgetProvider extends AppWidgetProvider {
    private static final int REQUEST_HOME = 4101;
    private static final int REQUEST_NEW_ORDER = 4102;
    private static final int REQUEST_SCAN = 4103;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) updateWidget(context, manager, widgetId);
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, EngXWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        for (int id : ids) updateWidget(context, manager, id);
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_engx);
        JSONObject snapshot = readSnapshot(context);
        boolean enabled = snapshot.optBoolean("enabled", false);

        views.setTextViewText(R.id.widget_open_orders, String.valueOf(enabled ? nonNegative(snapshot.optInt("openOrders", 0)) : 0));
        views.setTextViewText(R.id.widget_pm_due, String.valueOf(enabled ? nonNegative(snapshot.optInt("pmDue", 0)) : 0));
        views.setTextViewText(R.id.widget_status, enabled ? "الصيانة الوقائية القادمة" : "افتح EngX لتفعيل الودجت");
        String updatedAt = enabled ? snapshot.optString("updatedAt", "") : "";
        views.setTextViewText(R.id.widget_updated, updatedAt.isEmpty() ? "آخر تحديث: —" : "آخر تحديث: " + updatedAt);

        JSONArray upcoming = enabled ? snapshot.optJSONArray("upcoming") : null;
        int[] titleIds = {R.id.widget_item_1_title, R.id.widget_item_2_title, R.id.widget_item_3_title};
        int[] dateIds = {R.id.widget_item_1_date, R.id.widget_item_2_date, R.id.widget_item_3_date};
        for (int i = 0; i < titleIds.length; i++) {
            JSONObject item = upcoming == null ? null : upcoming.optJSONObject(i);
            boolean visible = item != null && !item.optString("title", "").isEmpty();
            views.setViewVisibility(titleIds[i], visible ? android.view.View.VISIBLE : android.view.View.GONE);
            views.setViewVisibility(dateIds[i], visible ? android.view.View.VISIBLE : android.view.View.GONE);
            if (visible) {
                views.setTextViewText(titleIds[i], item.optString("title", ""));
                views.setTextViewText(dateIds[i], item.optString("date", ""));
            }
        }

        views.setOnClickPendingIntent(R.id.widget_root, deepLink(context, "engx://home", REQUEST_HOME));
        views.setOnClickPendingIntent(R.id.widget_new_order, deepLink(context, "engx://new-order", REQUEST_NEW_ORDER));
        views.setOnClickPendingIntent(R.id.widget_scan, deepLink(context, "engx://scan", REQUEST_SCAN));
        manager.updateAppWidget(widgetId, views);
    }

    private static PendingIntent deepLink(Context context, String uri, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static JSONObject readSnapshot(Context context) {
        String raw = context.getSharedPreferences(EngXWidgetsPlugin.PREFS_NAME, Context.MODE_PRIVATE)
                .getString(EngXWidgetsPlugin.SNAPSHOT_KEY, "{}");
        try {
            return new JSONObject(raw == null ? "{}" : raw);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static int nonNegative(int value) { return Math.max(0, value); }
}
