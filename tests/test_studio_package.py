import json
import plistlib
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT / "studio"
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def test_studio_manifest_is_installable_and_offline_source_is_versioned() -> None:
    manifest = json.loads((STUDIO / "public" / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["name"] == "NoteFall Studio"
    assert manifest["display"] == "standalone"
    assert manifest["start_url"] == "./"
    worker = (STUDIO / "public" / "sw.js").read_text(encoding="utf-8")
    assert "self.__NOTEFALL_PRECACHE__" in worker
    assert "notefall-studio-dev" in worker
    assert 'event.request.mode === "navigate"' in worker


def test_native_dependencies_are_exact_and_include_lifecycle_plugin() -> None:
    package = json.loads((STUDIO / "package.json").read_text(encoding="utf-8"))
    dependencies = package["dependencies"]
    assert dependencies["@capacitor/core"] == "8.5.0"
    assert dependencies["@capacitor/android"] == "8.5.0"
    assert dependencies["@capacitor/ios"] == "8.5.0"
    assert dependencies["@capacitor/app"] == "8.1.1"
    # CLI 8.5.0 currently pulls xcode -> uuid 7.0.3 (GHSA-w5hq-g745-h8pq).
    # The 8.4.2 build CLI is compatible with the 8.5 runtime packages, passes
    # `cap doctor`/sync/Android builds, and keeps npm audit at zero findings.
    assert package["devDependencies"]["@capacitor/cli"] == "8.4.2"


def test_android_declares_internet_and_intentional_local_cleartext() -> None:
    manifest = ElementTree.parse(STUDIO / "android" / "app" / "src" / "main" / "AndroidManifest.xml").getroot()
    application = manifest.find("application")
    assert application is not None
    assert application.attrib[f"{ANDROID_NS}usesCleartextTraffic"] == "true"
    permissions = {item.attrib[f"{ANDROID_NS}name"] for item in manifest.findall("uses-permission")}
    assert "android.permission.INTERNET" in permissions


def test_android_registers_hardware_accelerated_native_waterfall() -> None:
    java_root = STUDIO / "android" / "app" / "src" / "main" / "java" / "io" / "notefall" / "studio"
    activity = (java_root / "MainActivity.java").read_text(encoding="utf-8")
    renderer = (java_root / "NativeWaterfallPlugin.java").read_text(encoding="utf-8")
    assert "registerPlugin(NativeWaterfallPlugin.class)" in activity
    assert '@CapacitorPlugin(name = "NativeWaterfall")' in renderer
    assert "View.LAYER_TYPE_HARDWARE" in renderer
    assert "SystemClock.elapsedRealtime()" in renderer
    assert "postInvalidateOnAnimation()" in renderer


def test_ios_declares_local_network_usage_without_arbitrary_web_access() -> None:
    with (STUDIO / "ios" / "App" / "App" / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    assert "NoteFall ESP32 Core" in info["NSLocalNetworkUsageDescription"]
    transport = info["NSAppTransportSecurity"]
    assert transport["NSAllowsLocalNetworking"] is True
    assert "NSAllowsArbitraryLoads" not in transport
