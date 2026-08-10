package io.notefall.studio;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

@CapacitorPlugin(name = "NativeWaterfall")
public class NativeWaterfallPlugin extends Plugin {
    private NativeWaterfallView waterfall;

    private void onUi(Runnable action) {
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(action);
    }

    private NativeWaterfallView ensureView() {
        if (waterfall != null) return waterfall;
        Activity activity = getActivity();
        waterfall = new NativeWaterfallView(activity);
        waterfall.setVisibility(View.GONE);
        waterfall.setClickable(false);
        waterfall.setFocusable(false);
        ViewGroup root = activity.findViewById(android.R.id.content);
        root.addView(waterfall, new FrameLayout.LayoutParams(1, 1));
        return waterfall;
    }

    @PluginMethod
    public void setGeometry(PluginCall call) {
        JSArray keys = call.getArray("keys");
        onUi(() -> ensureView().setGeometry(keys));
        call.resolve();
    }

    @PluginMethod
    public void setScore(PluginCall call) {
        JSArray notes = call.getArray("notes");
        JSArray beats = call.getArray("beats");
        onUi(() -> ensureView().setScore(notes, beats));
        call.resolve();
    }

    @PluginMethod
    public void setState(PluginCall call) {
        JSArray pressed = call.getArray("pressed");
        JSArray expected = call.getArray("expected");
        JSArray wrong = call.getArray("wrong");
        String hand = call.getString("hand", "both");
        Double loopStart = call.getDouble("loopStart");
        Double loopEnd = call.getDouble("loopEnd");
        onUi(() -> ensureView().setState(pressed, expected, wrong, hand, loopStart, loopEnd));
        call.resolve();
    }

    @PluginMethod
    public void setPlayback(PluginCall call) {
        double scoreTime = call.getDouble("scoreTime", 0.0);
        boolean running = call.getBoolean("running", false);
        onUi(() -> ensureView().setPlayback(scoreTime, running));
        call.resolve();
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = call.getString("theme", "neon");
        onUi(() -> ensureView().setTheme(theme));
        call.resolve();
    }

    @PluginMethod
    public void setPreview(PluginCall call) {
        double seconds = call.getDouble("seconds", 4.2);
        onUi(() -> ensureView().setPreview(seconds));
        call.resolve();
    }

    @PluginMethod
    public void showFeedback(PluginCall call) {
        String kind = call.getString("kind", "hit");
        int note = call.getInt("note", -1);
        onUi(() -> ensureView().addFeedback(kind, note));
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        double left = call.getDouble("left", 0.0);
        double top = call.getDouble("top", 0.0);
        double width = call.getDouble("width", 1.0);
        double height = call.getDouble("height", 1.0);
        onUi(() -> {
            NativeWaterfallView view = ensureView();
            float density = view.getResources().getDisplayMetrics().density;
            FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(
                Math.max(1, (int) Math.round(width * density)),
                Math.max(1, (int) Math.round(height * density))
            );
            layout.leftMargin = (int) Math.round(left * density);
            layout.topMargin = (int) Math.round(top * density);
            view.setLayoutParams(layout);
            view.setVisibility(View.VISIBLE);
            view.invalidate();
        });
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        onUi(() -> {
            if (waterfall != null) waterfall.setVisibility(View.GONE);
        });
        call.resolve();
    }

    private static final class NoteBar {
        final int note;
        final double start;
        final double end;
        final boolean left;

        NoteBar(int note, double start, double end, boolean left) {
            this.note = note;
            this.start = start;
            this.end = end;
            this.left = left;
        }
    }

    private static final class KeyGeometry {
        final float x;
        final float width;
        final boolean black;

        KeyGeometry(float x, float width, boolean black) {
            this.x = x;
            this.width = width;
            this.black = black;
        }
    }

    private static final class BeatLine {
        final double time;
        final boolean accent;
        final int measure;

        BeatLine(double time, boolean accent, int measure) {
            this.time = time;
            this.accent = accent;
            this.measure = measure;
        }
    }

    private static final class Feedback {
        final String kind;
        final int note;
        final long createdMs;

        Feedback(String kind, int note) {
            this.kind = kind;
            this.note = note;
            this.createdMs = SystemClock.elapsedRealtime();
        }
    }

    private static final class NativeWaterfallView extends View {
        private static final int PHRASE_MAP_BINS = 72;
        private static final int LEFT = Color.rgb(40, 215, 255);
        private static final int RIGHT = Color.rgb(255, 79, 200);
        private static final int CORRECT = Color.rgb(101, 245, 154);
        private static final int WRONG = Color.rgb(255, 101, 79);
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final List<NoteBar> notes = new ArrayList<>();
        private final List<BeatLine> beats = new ArrayList<>();
        private final List<Feedback> feedback = new ArrayList<>();
        private final KeyGeometry[] keys = new KeyGeometry[128];
        private final boolean[] pressed = new boolean[128];
        private final boolean[] expected = new boolean[128];
        private final boolean[] wrong = new boolean[128];
        private final float[] phraseLeft = new float[PHRASE_MAP_BINS];
        private final float[] phraseRight = new float[PHRASE_MAP_BINS];
        private String selectedHand = "both";
        private String theme = "neon";
        private Double loopStart;
        private Double loopEnd;
        private double baseScoreTime;
        private long baseRealtimeMs;
        private boolean running;
        private double visibleSeconds = 4.2;
        private double scoreDuration;

        NativeWaterfallView(Activity activity) {
            super(activity);
            setLayerType(View.LAYER_TYPE_HARDWARE, null);
            stroke.setStrokeWidth(getResources().getDisplayMetrics().density);
            stroke.setStyle(Paint.Style.STROKE);
        }

        void setPreview(double seconds) {
            visibleSeconds = Math.max(2.4, Math.min(8.0, seconds));
            invalidate();
        }

        void setGeometry(JSArray source) {
            Arrays.fill(keys, null);
            if (source == null) return;
            for (int index = 0; index < source.length(); index += 1) {
                try {
                    JSONObject item = source.getJSONObject(index);
                    int note = item.getInt("note");
                    if (note >= 0 && note < keys.length) {
                        keys[note] = new KeyGeometry(
                            (float) item.getDouble("x"),
                            (float) item.getDouble("width"),
                            item.getBoolean("black")
                        );
                    }
                } catch (JSONException ignored) {
                    // Invalid entries are isolated; the TypeScript bridge validates the score.
                }
            }
            invalidate();
        }

        void setScore(JSArray source, JSArray beatSource) {
            notes.clear();
            beats.clear();
            if (source != null) {
                for (int index = 0; index < source.length(); index += 1) {
                    try {
                        JSONObject item = source.getJSONObject(index);
                        int note = item.getInt("note");
                        double start = item.getDouble("start");
                        double end = item.getDouble("end");
                        if (note >= 21 && note <= 108 && start >= 0 && end >= start) {
                            notes.add(new NoteBar(note, start, end, "left".equals(item.optString("hand"))));
                        }
                    } catch (JSONException ignored) {
                        // Ignore one malformed note rather than losing an otherwise valid score.
                    }
                }
            }
            if (beatSource != null) {
                for (int index = 0; index < beatSource.length(); index += 1) {
                    try {
                        JSONObject item = beatSource.getJSONObject(index);
                        double time = item.getDouble("time");
                        if (time >= 0) beats.add(new BeatLine(time, item.optBoolean("accent"), item.optInt("measure")));
                    } catch (JSONException ignored) {
                        // A damaged visual marker must not discard valid notes.
                    }
                }
            }
            notes.sort(Comparator.comparingDouble(note -> note.start));
            beats.sort(Comparator.comparingDouble(beat -> beat.time));
            buildPhraseMap();
            invalidate();
        }

        private void buildPhraseMap() {
            Arrays.fill(phraseLeft, 0);
            Arrays.fill(phraseRight, 0);
            scoreDuration = 0;
            for (NoteBar note : notes) scoreDuration = Math.max(scoreDuration, note.end);
            if (scoreDuration <= 0) return;
            float peak = 0;
            for (NoteBar note : notes) {
                int bin = Math.max(0, Math.min(PHRASE_MAP_BINS - 1,
                    (int) Math.floor(note.start / scoreDuration * PHRASE_MAP_BINS)));
                float weight = 1f + (float) Math.min(2, Math.max(0, note.end - note.start)) * .25f;
                if (note.left) phraseLeft[bin] += weight;
                else phraseRight[bin] += weight;
                peak = Math.max(peak, phraseLeft[bin] + phraseRight[bin]);
            }
            if (peak <= 0) return;
            for (int index = 0; index < PHRASE_MAP_BINS; index += 1) {
                phraseLeft[index] = (float) Math.sqrt(phraseLeft[index] / peak);
                phraseRight[index] = (float) Math.sqrt(phraseRight[index] / peak);
            }
        }

        void setState(JSArray pressedNotes, JSArray expectedNotes, JSArray wrongNotes, String hand, Double start, Double end) {
            fillNoteSet(pressed, pressedNotes);
            fillNoteSet(expected, expectedNotes);
            fillNoteSet(wrong, wrongNotes);
            selectedHand = hand == null ? "both" : hand;
            loopStart = start;
            loopEnd = end;
            invalidate();
        }

        private void fillNoteSet(boolean[] destination, JSArray source) {
            Arrays.fill(destination, false);
            if (source == null) return;
            for (int index = 0; index < source.length(); index += 1) {
                int note = source.optInt(index, -1);
                if (note >= 0 && note < destination.length) destination[note] = true;
            }
        }

        void setPlayback(double scoreTime, boolean isRunning) {
            baseScoreTime = Math.max(0, scoreTime);
            baseRealtimeMs = SystemClock.elapsedRealtime();
            running = isRunning;
            invalidate();
        }

        void setTheme(String value) {
            theme = "aurora".equals(value) || "contrast".equals(value) ? value : "neon";
            invalidate();
        }

        void addFeedback(String kind, int note) {
            if (note < 21 || note > 108) return;
            String safeKind = "wrong".equals(kind) || "missed".equals(kind) ? kind : "hit";
            long now = SystemClock.elapsedRealtime();
            for (int index = feedback.size() - 1; index >= 0; index -= 1) {
                if (now - feedback.get(index).createdMs >= 900) feedback.remove(index);
            }
            while (feedback.size() >= 24) feedback.remove(0);
            feedback.add(new Feedback(safeKind, note));
            invalidate();
        }

        private int themeColor(int neon, int aurora, int contrast) {
            return "aurora".equals(theme) ? aurora : "contrast".equals(theme) ? contrast : neon;
        }

        private double scoreTime() {
            if (!running) return baseScoreTime;
            return baseScoreTime + (SystemClock.elapsedRealtime() - baseRealtimeMs) / 1000.0;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int width = getWidth();
            int height = getHeight();
            if (width <= 1 || height <= 1) return;
            float keyboardHeight = height * 0.22f;
            float keyboardTop = height - keyboardHeight;
            paint.setShader(new LinearGradient(0, 0, 0, keyboardTop,
                themeColor(Color.rgb(9, 11, 18), Color.rgb(7, 21, 19), Color.rgb(10, 10, 10)),
                themeColor(Color.rgb(17, 24, 39), Color.rgb(20, 36, 58), Color.rgb(32, 32, 32)), Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, width, keyboardTop, paint);
            paint.setShader(null);
            double now = scoreTime();
            drawOctaveGuides(canvas, width, keyboardTop);
            drawTimeline(canvas, width, keyboardTop, now);
            drawNotes(canvas, width, keyboardTop, now);
            drawPhraseMap(canvas, width, keyboardTop, now);
            drawLoop(canvas, width, keyboardTop, now, loopStart, "A");
            drawLoop(canvas, width, keyboardTop, now, loopEnd, "B");
            drawStrikeZone(canvas, width, keyboardTop);
            drawFeedback(canvas, width, keyboardTop);
            drawKeyboard(canvas, width, keyboardTop, keyboardHeight);
            if ((running || !feedback.isEmpty()) && getVisibility() == View.VISIBLE) postInvalidateOnAnimation();
        }

        private float phraseProgress(double time) {
            if (scoreDuration <= 0 || !Double.isFinite(time)) return 0;
            return Math.max(0, Math.min(1, (float) (time / scoreDuration)));
        }

        private void drawPhraseMap(Canvas canvas, int width, float keyboardTop, double now) {
            if (scoreDuration <= 0) return;
            float density = getResources().getDisplayMetrics().density;
            float railWidth = Math.max(12 * density, Math.min(22 * density, width * .012f));
            float x = width - railWidth - Math.max(6 * density, width * .004f);
            float top = Math.max(12 * density, keyboardTop * .025f);
            float height = Math.max(80 * density, keyboardTop - top - 12 * density);
            float half = railWidth / 2;
            float rowHeight = height / PHRASE_MAP_BINS;
            paint.setColor(Color.argb(189, 3, 6, 12));
            canvas.drawRoundRect(new RectF(x, top, x + railWidth, top + height), railWidth / 2, railWidth / 2, paint);
            boolean selectedLeft = "both".equals(selectedHand) || "left".equals(selectedHand);
            boolean selectedRight = "both".equals(selectedHand) || "right".equals(selectedHand);
            int leftColor = themeColor(LEFT, Color.rgb(78, 230, 190), Color.rgb(68, 215, 255));
            int rightColor = themeColor(RIGHT, Color.rgb(184, 156, 255), Color.rgb(255, 207, 63));
            canvas.save();
            canvas.clipRect(x, top, x + railWidth, top + height);
            for (int index = 0; index < PHRASE_MAP_BINS; index += 1) {
                float y = top + index * rowHeight;
                paint.setColor(leftColor);
                paint.setAlpha((int) (255 * (selectedLeft
                    ? (phraseLeft[index] > 0 ? .15f + phraseLeft[index] * .85f : .02f)
                    : (phraseLeft[index] > 0 ? .06f + phraseLeft[index] * .14f : .01f))));
                canvas.drawRect(x, y, x + half, y + Math.max(1, rowHeight + .35f), paint);
                paint.setColor(rightColor);
                paint.setAlpha((int) (255 * (selectedRight
                    ? (phraseRight[index] > 0 ? .15f + phraseRight[index] * .85f : .02f)
                    : (phraseRight[index] > 0 ? .06f + phraseRight[index] * .14f : .01f))));
                canvas.drawRect(x + half, y, x + railWidth, y + Math.max(1, rowHeight + .35f), paint);
            }
            float playheadY = top + phraseProgress(now) * height;
            float previewBottom = top + phraseProgress(now + visibleSeconds) * height;
            paint.setColor(Color.argb(20, 255, 255, 255));
            canvas.drawRect(x, playheadY, x + railWidth, Math.max(playheadY + 2, previewBottom), paint);
            stroke.setColor(Color.argb(194, 255, 255, 255));
            stroke.setStrokeWidth(Math.max(1, density));
            canvas.drawRect(x, playheadY, x + railWidth, Math.max(playheadY + 1, previewBottom), stroke);
            if (loopStart != null && loopEnd != null) {
                float loopTop = top + phraseProgress(loopStart) * height;
                float loopBottom = top + phraseProgress(loopEnd) * height;
                paint.setColor(Color.argb(36, 255, 210, 76));
                canvas.drawRect(x, loopTop, x + railWidth, Math.max(loopTop + 1, loopBottom), paint);
                stroke.setColor(Color.argb(230, 255, 210, 76));
                canvas.drawRect(x, loopTop, x + railWidth, Math.max(loopTop + 1, loopBottom), stroke);
            }
            paint.setColor(Color.WHITE);
            paint.setAlpha(255);
            canvas.drawRect(x - 3 * density, playheadY - density, x + railWidth + 3 * density, playheadY + density, paint);
            canvas.restore();
            stroke.setColor(Color.argb(61, 210, 224, 255));
            stroke.setStrokeWidth(Math.max(1, density));
            canvas.drawRoundRect(new RectF(x, top, x + railWidth, top + height), railWidth / 2, railWidth / 2, stroke);
            paint.setAlpha(255);
        }

        private void drawTimeline(Canvas canvas, int width, float keyboardTop, double now) {
            if (beats.isEmpty()) {
                stroke.setColor(Color.argb(18, 255, 255, 255));
                stroke.setStrokeWidth(getResources().getDisplayMetrics().density);
                for (int second = 0; second <= 5; second += 1) {
                    float y = keyboardTop - (float) (second / visibleSeconds) * keyboardTop;
                    canvas.drawLine(0, y, width, y, stroke);
                }
                return;
            }
            for (BeatLine marker : beats) {
                double delta = marker.time - now;
                if (delta < -0.15 || delta > visibleSeconds) continue;
                float y = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
                stroke.setColor(marker.accent ? Color.argb(97, 139, 167, 255) : Color.argb(23, 255, 255, 255));
                stroke.setStrokeWidth((marker.accent ? 1.5f : 1f) * getResources().getDisplayMetrics().density);
                canvas.drawLine(0, y, width, y, stroke);
                if (marker.accent && y > 18) {
                    paint.setColor(Color.rgb(196, 210, 255));
                    paint.setAlpha(184);
                    paint.setTextSize(11 * getResources().getDisplayMetrics().scaledDensity);
                    paint.setFakeBoldText(true);
                    canvas.drawText("M" + (marker.measure + 1), 10, y - 5, paint);
                    paint.setFakeBoldText(false);
                    paint.setAlpha(255);
                }
            }
        }

        private void drawOctaveGuides(Canvas canvas, int width, float keyboardTop) {
            int color = themeColor(Color.rgb(190, 244, 255), Color.rgb(221, 255, 232), Color.WHITE);
            stroke.setColor(color);
            stroke.setAlpha(20);
            stroke.setStrokeWidth(getResources().getDisplayMetrics().density);
            for (int note = 0; note < keys.length; note += 1) {
                KeyGeometry key = keys[note];
                if (key == null || note % 12 != 0) continue;
                float x = (key.x + key.width / 2f) * width;
                canvas.drawLine(x, 0, x, keyboardTop, stroke);
            }
            stroke.setAlpha(255);
        }

        private void drawStrikeZone(Canvas canvas, int width, float keyboardTop) {
            float zone = Math.max(22 * getResources().getDisplayMetrics().density, keyboardTop * .065f);
            paint.setShader(new LinearGradient(0, keyboardTop - zone, 0, keyboardTop,
                Color.argb(0, 104, 229, 255), Color.argb(36, 104, 229, 255), Shader.TileMode.CLAMP));
            canvas.drawRect(0, keyboardTop - zone, width, keyboardTop, paint);
            paint.setShader(null);
            paint.setColor(themeColor(Color.rgb(190, 244, 255), Color.rgb(221, 255, 232), Color.WHITE));
            paint.setAlpha(230);
            canvas.drawRect(0, keyboardTop - 2, width, keyboardTop, paint);
            paint.setTextSize(10 * getResources().getDisplayMetrics().scaledDensity);
            paint.setFakeBoldText(true);
            canvas.drawText("NOW", 10, keyboardTop - 8, paint);
            paint.setFakeBoldText(false);
            paint.setAlpha(255);
        }

        private void drawFeedback(Canvas canvas, int width, float keyboardTop) {
            long now = SystemClock.elapsedRealtime();
            for (int index = feedback.size() - 1; index >= 0; index -= 1) {
                Feedback item = feedback.get(index);
                float progress = Math.min(1f, (now - item.createdMs) / 900f);
                if (progress >= 1f) {
                    feedback.remove(index);
                    continue;
                }
                KeyGeometry key = keys[item.note];
                if (key == null) continue;
                int color = "hit".equals(item.kind)
                    ? themeColor(CORRECT, Color.rgb(184, 244, 109), Color.rgb(125, 255, 90))
                    : "wrong".equals(item.kind)
                        ? themeColor(WRONG, Color.rgb(255, 154, 95), Color.rgb(255, 89, 77))
                        : Color.rgb(255, 210, 76);
                float x = (key.x + key.width / 2f) * width;
                float y = keyboardTop - 18 * getResources().getDisplayMetrics().density
                    - progress * 44 * getResources().getDisplayMetrics().density;
                paint.setColor(color);
                paint.setAlpha((int) ((1f - progress) * 242));
                paint.setTextSize(20 * getResources().getDisplayMetrics().scaledDensity);
                paint.setFakeBoldText(true);
                paint.setTextAlign(Paint.Align.CENTER);
                canvas.drawText("hit".equals(item.kind) ? "✓" : "wrong".equals(item.kind) ? "×" : "!", x, y, paint);
                stroke.setColor(color);
                stroke.setAlpha((int) ((1f - progress) * 140));
                stroke.setStrokeWidth(1.5f * getResources().getDisplayMetrics().density);
                canvas.drawCircle(x, keyboardTop - 8 * getResources().getDisplayMetrics().density,
                    (5 + progress * 13) * getResources().getDisplayMetrics().density, stroke);
                if (!"contrast".equals(theme)) {
                    for (int spark = 0; spark < 6; spark += 1) {
                        double angle = spark * Math.PI / 3 + item.note * .17;
                        float distance = (7 + progress * (12 + (spark % 3) * 5)) * getResources().getDisplayMetrics().density;
                        paint.setAlpha((int) ((1f - progress) * (140 - spark * 11)));
                        float sx = x + (float) Math.cos(angle) * distance;
                        float sy = keyboardTop - 8 * getResources().getDisplayMetrics().density
                            + (float) Math.sin(angle) * distance * .65f;
                        canvas.drawCircle(sx, sy, Math.max(1, 2.5f - progress * 1.5f) * getResources().getDisplayMetrics().density, paint);
                    }
                }
                paint.setTextAlign(Paint.Align.LEFT);
                paint.setFakeBoldText(false);
                paint.setAlpha(255);
                stroke.setAlpha(255);
            }
        }

        private void drawNotes(Canvas canvas, int width, float keyboardTop, double now) {
            int first = lowerBound(now - 0.36);
            for (int index = first; index < notes.size(); index += 1) {
                NoteBar note = notes.get(index);
                double delta = note.start - now;
                if (delta > visibleSeconds) break;
                KeyGeometry key = keys[note.note];
                if (key == null || note.end < now - 0.35) continue;
                float x = key.x * width + 1;
                float noteWidth = Math.max(3, key.width * width - 2);
                float bottom = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
                float noteHeight = Math.max(5, (float) ((note.end - note.start) / visibleSeconds) * keyboardTop);
                int color = note.left
                    ? themeColor(LEFT, Color.rgb(78, 230, 190), Color.rgb(68, 215, 255))
                    : themeColor(RIGHT, Color.rgb(184, 156, 255), Color.rgb(255, 207, 63));
                boolean selected = "both".equals(selectedHand) || (note.left ? "left" : "right").equals(selectedHand);
                float radius = Math.min(8, noteWidth / 3);
                if (selected && delta >= 0 && delta < .85 && bottom < keyboardTop) {
                    int runwayAlpha = "contrast".equals(theme) ? 56 : 80;
                    paint.setShader(new LinearGradient(0, bottom, 0, keyboardTop,
                        Color.argb("contrast".equals(theme) ? 24 : 8, Color.red(color), Color.green(color), Color.blue(color)),
                        Color.argb(runwayAlpha, Color.red(color), Color.green(color), Color.blue(color)), Shader.TileMode.CLAMP));
                    paint.setAlpha((int) (255 * (1 - delta / 1.1)));
                    canvas.drawRect(x + noteWidth * .18f, bottom, x + noteWidth * .82f, keyboardTop, paint);
                    paint.setShader(null);
                }
                if (!"contrast".equals(theme) && selected && delta > -.08 && delta < .32) {
                    float arrival = 1 - Math.min(1, (float) Math.abs(delta) / .32f);
                    paint.setShader(null);
                    paint.setColor(color);
                    paint.setAlpha((int) (31 + arrival * 56));
                    canvas.drawRoundRect(new RectF(x - 3, bottom - noteHeight - 3, x + noteWidth + 3, bottom + 3), radius + 3, radius + 3, paint);
                }
                paint.setShader(new LinearGradient(0, bottom - noteHeight, 0, bottom, color,
                    note.left
                        ? themeColor(Color.rgb(17, 124, 163), Color.rgb(22, 135, 118), Color.rgb(20, 125, 163))
                        : themeColor(Color.rgb(182, 36, 138), Color.rgb(112, 80, 186), Color.rgb(181, 122, 8)), Shader.TileMode.CLAMP));
                paint.setAlpha(selected ? 220 : 41);
                canvas.drawRoundRect(new RectF(x, bottom - noteHeight, x + noteWidth, bottom), radius, radius, paint);
                paint.setShader(null);
                if (noteWidth >= 7) {
                    paint.setColor(Color.WHITE);
                    paint.setAlpha(selected ? 82 : 16);
                    canvas.drawRect(x + 1, bottom - noteHeight + 2, x + 1 + Math.max(1, noteWidth * .16f), bottom - 2, paint);
                }
            }
            paint.setAlpha(255);
        }

        private int lowerBound(double earliestEnd) {
            int low = 0;
            int high = notes.size();
            while (low < high) {
                int middle = (low + high) >>> 1;
                if (notes.get(middle).start < earliestEnd) low = middle + 1;
                else high = middle;
            }
            return Math.max(0, low - 16);
        }

        private void drawLoop(Canvas canvas, int width, float keyboardTop, double now, Double boundary, String label) {
            if (boundary == null) return;
            double delta = boundary - now;
            if (delta < 0 || delta > visibleSeconds) return;
            float y = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
            stroke.setColor(Color.rgb(255, 210, 76));
            stroke.setStrokeWidth(2 * getResources().getDisplayMetrics().density);
            canvas.drawLine(0, y, width, y, stroke);
            paint.setColor(Color.rgb(255, 210, 76));
            paint.setTextSize(12 * getResources().getDisplayMetrics().scaledDensity);
            paint.setFakeBoldText(true);
            canvas.drawText(label, 10, Math.max(18, y - 6), paint);
            paint.setFakeBoldText(false);
        }

        private void drawKeyboard(Canvas canvas, int width, float top, float height) {
            for (int note = 21; note <= 108; note += 1) {
                KeyGeometry key = keys[note];
                if (key == null || key.black) continue;
                int color = Color.rgb(236, 236, 240);
                if (expected[note]) color = themeColor(Color.rgb(168, 232, 255), Color.rgb(208, 245, 222), Color.WHITE);
                if (pressed[note]) color = wrong[note]
                    ? themeColor(WRONG, Color.rgb(255, 154, 95), Color.rgb(255, 89, 77))
                    : themeColor(CORRECT, Color.rgb(184, 244, 109), Color.rgb(125, 255, 90));
                paint.setColor(color);
                float left = key.x * width;
                float right = left + key.width * width + 0.5f;
                canvas.drawRect(left, top, right, top + height, paint);
                stroke.setColor(Color.rgb(37, 41, 51));
                stroke.setStrokeWidth(1);
                canvas.drawRect(left, top, right, top + height, stroke);
                if (note % 12 == 0 && key.width * width >= 18) {
                    paint.setColor(Color.rgb(83, 96, 112));
                    paint.setTextSize(10 * getResources().getDisplayMetrics().scaledDensity);
                    paint.setFakeBoldText(true);
                    canvas.drawText("C" + (note / 12 - 1), left + 3, top + height - 8, paint);
                    paint.setFakeBoldText(false);
                }
            }
            for (int note = 21; note <= 108; note += 1) {
                KeyGeometry key = keys[note];
                if (key == null || !key.black) continue;
                int color = Color.rgb(21, 24, 33);
                if (expected[note]) color = themeColor(Color.rgb(30, 155, 189), Color.rgb(55, 158, 133), Color.WHITE);
                if (pressed[note]) color = wrong[note]
                    ? themeColor(WRONG, Color.rgb(255, 154, 95), Color.rgb(255, 89, 77))
                    : themeColor(Color.rgb(44, 173, 103), Color.rgb(130, 197, 74), Color.rgb(125, 255, 90));
                paint.setColor(color);
                float left = key.x * width;
                canvas.drawRect(left, top, left + key.width * width, top + height * 0.62f, paint);
            }
        }
    }
}
