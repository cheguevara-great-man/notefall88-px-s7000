package io.notefall.studio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeWaterfallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
