package io.notefall.studio;

import android.Manifest;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

@CapacitorPlugin(
    name = "NoteFallDiscovery",
    permissions = {
        @Permission(alias = "nearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES })
    }
)
public class NoteFallDiscoveryPlugin extends Plugin {
    private static final int PORT = 32188;
    private static final byte[] PROBE = "NOTEFALL_DISCOVER_V1".getBytes(StandardCharsets.US_ASCII);

    @PluginMethod
    public void resolve(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            requestPermissionForAlias("nearbyWifi", call, "nearbyWifiPermissionCallback");
            return;
        }
        new Thread(() -> discover(call), "notefall-discovery").start();
    }

    @PermissionCallback
    private void nearbyWifiPermissionCallback(PluginCall call) {
        if (getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            call.reject("Nearby devices permission is required to find NoteFall 88");
            return;
        }
        new Thread(() -> discover(call), "notefall-discovery").start();
    }

    private void discover(PluginCall call) {
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            socket.setSoTimeout(2500);
            Network active = activeNetwork();
            if (active != null) active.bindSocket(socket);
            boolean sent = false;
            for (InetAddress address : broadcastAddresses()) {
                try {
                    socket.send(new DatagramPacket(PROBE, PROBE.length, address, PORT));
                    sent = true;
                } catch (IOException ignored) {
                    // Some Android vendors reject the global broadcast while
                    // still allowing the active Wi-Fi subnet broadcast.
                }
            }
            if (!sent) throw new IOException("all discovery broadcasts were rejected");
            byte[] buffer = new byte[512];
            long deadline = System.currentTimeMillis() + 2800;
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                socket.receive(packet);
                String body = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
                JSONObject json = new JSONObject(body);
                if (!"NoteFall 88".equals(json.optString("project"))) continue;
                String host = json.optString("host", packet.getAddress().getHostAddress());
                if (!isIpv4(host)) continue;
                JSObject result = new JSObject();
                result.put("host", host);
                call.resolve(result);
                return;
            }
            call.reject("NoteFall 88 was not found on this network");
        } catch (Exception error) {
            call.reject("NoteFall discovery failed", error);
        }
    }

    private Set<InetAddress> broadcastAddresses() throws Exception {
        Set<InetAddress> result = new LinkedHashSet<>();
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        Network active = manager.getActiveNetwork();
        LinkProperties properties = active == null ? null : manager.getLinkProperties(active);
        if (properties != null) {
            for (LinkAddress link : properties.getLinkAddresses()) {
                InetAddress address = link.getAddress();
                if (!(address instanceof Inet4Address)) continue;
                int prefix = link.getPrefixLength();
                if (prefix < 0 || prefix > 32) continue;
                byte[] raw = address.getAddress().clone();
                int hostBits = 32 - prefix;
                for (int bit = 0; bit < hostBits; bit++) {
                    int byteIndex = 3 - bit / 8;
                    raw[byteIndex] = (byte) (raw[byteIndex] | (1 << (bit % 8)));
                }
                result.add(InetAddress.getByAddress(raw));
            }
        }
        result.add(InetAddress.getByName("255.255.255.255"));
        return result;
    }

    private Network activeNetwork() {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        return manager.getActiveNetwork();
    }

    private boolean isIpv4(String value) {
        String[] parts = value.split("\\.", -1);
        if (parts.length != 4) return false;
        try {
            for (String part : parts) {
                int number = Integer.parseInt(part);
                if (number < 0 || number > 255) return false;
            }
            return true;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }
}
