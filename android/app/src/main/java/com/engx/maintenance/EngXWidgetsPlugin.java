package com.engx.maintenance;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native bridge for the cached, user-opted-in home-screen widget snapshot. */
@CapacitorPlugin(name = "EngXWidgets")
public class EngXWidgetsPlugin extends Plugin {
    public static final String PREFS_NAME = "engx-widget";
    public static final String SNAPSHOT_KEY = "snapshot";

    @PluginMethod
    public void update(PluginCall call) {
        try {
            JSObject data = call.getData();
            JSONObject snapshot = new JSONObject();
            snapshot.put("enabled", data != null && data.optBoolean("enabled", false));
            snapshot.put("openOrders", Math.max(0, data == null ? 0 : data.optInt("openOrders", 0)));
            snapshot.put("pmDue", Math.max(0, data == null ? 0 : data.optInt("pmDue", 0)));

            JSONArray upcoming = new JSONArray();
            JSONArray supplied = data == null ? null : data.optJSONArray("upcoming");
            if (supplied != null) {
                for (int i = 0; i < supplied.length() && upcoming.length() < 3; i++) {
                    JSONObject item = supplied.optJSONObject(i);
                    if (item == null) continue;
                    JSONObject safe = new JSONObject();
                    safe.put("title", truncate(item.optString("title", ""), 80));
                    safe.put("date", truncate(item.optString("date", ""), 40));
                    upcoming.put(safe);
                }
            }
            snapshot.put("upcoming", upcoming);
            snapshot.put("updatedAt", truncate(data == null ? "" : data.optString("updatedAt", ""), 40));

            Context context = getContext();
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(SNAPSHOT_KEY, snapshot.toString()).apply();
            EngXWidgetProvider.updateAll(context);
            call.resolve();
        } catch (Exception error) {
            call.reject("تعذر تحديث ودجت EngX", error);
        }
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) return "";
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
