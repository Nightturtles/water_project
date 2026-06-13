package com.cafelytic.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView scrollbar draws full-height through the fixed bottom
        // nav and there is no bottom-inset API on Android. Hide it; stretch
        // overscroll still signals scroll extent.
        bridge.getWebView().setVerticalScrollBarEnabled(false);
    }
}
