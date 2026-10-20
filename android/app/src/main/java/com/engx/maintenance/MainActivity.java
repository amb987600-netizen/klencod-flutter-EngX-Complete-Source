package com.engx.maintenance;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EngXPrinterPlugin.class);
        registerPlugin(EngXWidgetsPlugin.class);
        registerPlugin(EngXLocalAIPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
