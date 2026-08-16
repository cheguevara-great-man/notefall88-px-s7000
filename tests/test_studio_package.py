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
    assert manifest["id"] == "./"
    assert manifest["lang"] == "zh-CN"
    worker = (STUDIO / "public" / "sw.js").read_text(encoding="utf-8")
    assert "self.__NOTEFALL_PRECACHE__" in worker
    assert "__NOTEFALL_CACHE_VERSION__" in worker
    assert "key.startsWith(CACHE_PREFIX)" in worker
    assert 'new Request(path, { cache: "reload" })' in worker
    assert "skipWaiting(" not in worker
    assert "crypto.subtle.digest" in worker
    assert "precache integrity mismatch" in worker
    assert 'event.request.mode === "navigate"' in worker
    assert "PRECACHE_URLS.has(url.href)" in worker


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
    assert application.attrib[f"{ANDROID_NS}allowBackup"] == "false"
    assert application.attrib[f"{ANDROID_NS}usesCleartextTraffic"] == "true"
    permissions = {item.attrib[f"{ANDROID_NS}name"] for item in manifest.findall("uses-permission")}
    assert "android.permission.INTERNET" in permissions


def test_android_file_provider_never_exposes_shared_storage_root() -> None:
    paths = ElementTree.parse(
        STUDIO / "android" / "app" / "src" / "main" / "res" / "xml" / "file_paths.xml"
    ).getroot()
    assert paths.find("external-path") is None
    cache = paths.find("cache-path")
    assert cache is not None
    assert cache.attrib["path"] == "."


def test_core_csp_is_strict_and_studio_expands_only_converter_script_policy() -> None:
    index = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert "Content-Security-Policy" in index
    assert "object-src 'none'" in index
    assert "base-uri 'self'" in index
    assert "script-src 'self';" in index
    assert "unsafe-eval" not in index

    studio_config = (ROOT / "web" / "vite.studio.config.ts").read_text(encoding="utf-8")
    assert "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';" in studio_config


def test_android_registers_hardware_accelerated_native_waterfall() -> None:
    java_root = STUDIO / "android" / "app" / "src" / "main" / "java" / "io" / "notefall" / "studio"
    activity = (java_root / "MainActivity.java").read_text(encoding="utf-8")
    renderer = (java_root / "NativeWaterfallPlugin.java").read_text(encoding="utf-8")
    assert "registerPlugin(NativeWaterfallPlugin.class)" in activity
    assert '@CapacitorPlugin(name = "NativeWaterfall")' in renderer
    assert "View.LAYER_TYPE_HARDWARE" in renderer
    assert "SystemClock.elapsedRealtime()" in renderer
    assert "postInvalidateOnAnimation()" in renderer
    assert "MIN_ANIMATED_FRAME_MS" in renderer
    assert "maximumNoteDuration" in renderer
    assert "lowerBound(now - maximumNoteDuration - .08)" in renderer
    assert "lowerBoundBeats" in renderer
    assert "lowerBoundPedals" in renderer
    assert "new RectF" not in renderer


def test_ios_declares_local_network_usage_without_arbitrary_web_access() -> None:
    with (STUDIO / "ios" / "App" / "App" / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    assert "NoteFall ESP32 Core" in info["NSLocalNetworkUsageDescription"]
    transport = info["NSAppTransportSecurity"]
    assert transport["NSAllowsLocalNetworking"] is True
    assert "NSAllowsArbitraryLoads" not in transport
