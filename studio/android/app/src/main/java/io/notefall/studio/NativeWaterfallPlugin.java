package io.notefall.studio;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
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
        JSArray pedals = call.getArray("pedals");
        onUi(() -> ensureView().setScore(notes, beats, pedals));
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
        Double timingMs = call.getDouble("timingMs");
        onUi(() -> ensureView().addFeedback(kind, note, timingMs));
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
        final int velocity;
        final boolean left;

        NoteBar(int note, double start, double end, int velocity, boolean left) {
            this.note = note;
            this.start = start;
            this.end = end;
            this.velocity = velocity;
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

    private static final class PedalCue {
        final double time;
        final int value;
        final String kind;
        final String label;

        PedalCue(double time, int value, String kind, String label) {
            this.time = time;
            this.value = value;
            this.kind = kind;
            this.label = label;
        }
    }

    private static final class Feedback {
        final String kind;
        final int note;
        final Double timingMs;
        final long createdMs;

        Feedback(String kind, int note, Double timingMs) {
            this.kind = kind;
            this.note = note;
            this.timingMs = timingMs;
            this.createdMs = SystemClock.elapsedRealtime();
        }
    }

    private static final class NativeWaterfallView extends View {
        private static final int PHRASE_MAP_BINS = 72;
        private static final int LEFT = Color.rgb(40, 215, 255);
        private static final int RIGHT = Color.rgb(255, 79, 200);
        private static final int CORRECT = Color.rgb(101, 245, 154);
        private static final int WRONG = Color.rgb(255, 101, 79);
        private static final long MIN_ANIMATED_FRAME_MS = 15;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path chordPath = new Path();
        private final List<NoteBar> notes = new ArrayList<>();
        private final List<BeatLine> beats = new ArrayList<>();
        private final List<PedalCue> pedals = new ArrayList<>();
        private final List<Feedback> feedback = new ArrayList<>();
        private final KeyGeometry[] keys = new KeyGeometry[128];
        private final boolean[] pressed = new boolean[128];
        private final boolean[] expected = new boolean[128];
        private final boolean[] wrong = new boolean[128];
        private final int[] chordSeen = new int[128];
        private int chordGeneration = 1;
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
        private int dynamicsLow = 32;
        private int dynamicsHigh = 112;
        private boolean dynamicsFlat;
        private double maximumNoteDuration;
        private long lastAnimatedDrawMs = Long.MIN_VALUE;
        private float cachedGradientHeight = -1;
        private String cachedGradientTheme = "";
        private LinearGradient backgroundGradient;
        private LinearGradient strikeGradient;
        private final float density;
        private final float scaledDensity;

        NativeWaterfallView(Activity activity) {
            super(activity);
            density = getResources().getDisplayMetrics().density;
            scaledDensity = getResources().getDisplayMetrics().scaledDensity;
            setLayerType(View.LAYER_TYPE_NONE, null);
            stroke.setStrokeWidth(density);
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

        void setScore(JSArray source, JSArray beatSource, JSArray pedalSource) {
            notes.clear();
            beats.clear();
            pedals.clear();
            if (source != null) {
                for (int index = 0; index < source.length(); index += 1) {
                    try {
                        JSONObject item = source.getJSONObject(index);
                        int note = item.getInt("note");
                        double start = item.getDouble("start");
                        double end = item.getDouble("end");
                        if (note >= 21 && note <= 108 && start >= 0 && end >= start) {
                            int velocity = Math.max(1, Math.min(127, item.optInt("velocity", 96)));
                            notes.add(new NoteBar(note, start, end, velocity, "left".equals(item.optString("hand"))));
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
            if (pedalSource != null) {
                for (int index = 0; index < pedalSource.length(); index += 1) {
                    try {
                        JSONObject item = pedalSource.getJSONObject(index);
                        double time = item.getDouble("time");
                        int value = Math.max(0, Math.min(127, item.optInt("value", 0)));
                        String kind = item.optString("kind", "level");
                        if (!"down".equals(kind) && !"up".equals(kind)
                            && !"change".equals(kind) && !"level".equals(kind)) kind = "level";
                        String label = item.optString("label", "PED");
                        if (time >= 0 && !label.isEmpty()) pedals.add(new PedalCue(time, value, kind, label));
                    } catch (JSONException ignored) {
                        // Invalid pedal metadata must not discard an otherwise playable score.
                    }
                }
            }
            notes.sort(Comparator.comparingDouble(note -> note.start));
            beats.sort(Comparator.comparingDouble(beat -> beat.time));
            pedals.sort(Comparator.comparingDouble(pedal -> pedal.time));
            maximumNoteDuration = 0;
            for (NoteBar note : notes) maximumNoteDuration = Math.max(maximumNoteDuration, note.end - note.start);
            buildDynamicsProfile();
            buildPhraseMap();
            invalidate();
        }

        private void buildDynamicsProfile() {
            if (notes.isEmpty()) {
                dynamicsLow = 32;
                dynamicsHigh = 112;
                dynamicsFlat = false;
                return;
            }
            int[] values = new int[notes.size()];
            for (int index = 0; index < notes.size(); index += 1) values[index] = notes.get(index).velocity;
            Arrays.sort(values);
            int lowIndex = values.length >= 10 ? (int) Math.floor((values.length - 1) * .1) : 0;
            int highIndex = values.length >= 10 ? (int) Math.ceil((values.length - 1) * .9) : values.length - 1;
            dynamicsLow = values[lowIndex];
            dynamicsHigh = values[highIndex];
            dynamicsFlat = dynamicsHigh - dynamicsLow < 12;
        }

        private float normalizedDynamics(int velocity) {
            float absolute = Math.max(1, Math.min(127, velocity)) / 127f;
            float local = dynamicsFlat
                ? absolute
                : Math.max(0, Math.min(1, (velocity - dynamicsLow) / (float) Math.max(1, dynamicsHigh - dynamicsLow)));
            return Math.max(.08f, Math.min(.95f, absolute * .72f + local * .28f));
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
            cachedGradientTheme = "";
            invalidate();
        }

        void addFeedback(String kind, int note, Double timingMs) {
            if (note < 21 || note > 108) return;
            boolean releaseKind = "release-good".equals(kind) || "release-early".equals(kind);
            String safeKind = "wrong".equals(kind) || "missed".equals(kind) || releaseKind ? kind : "hit";
            Double safeTiming = ("hit".equals(safeKind) || releaseKind) && timingMs != null && Double.isFinite(timingMs)
                ? timingMs : null;
            long now = SystemClock.elapsedRealtime();
            for (int index = feedback.size() - 1; index >= 0; index -= 1) {
                if (now - feedback.get(index).createdMs >= 900) feedback.remove(index);
            }
            while (feedback.size() >= 24) feedback.remove(0);
            feedback.add(new Feedback(safeKind, note, safeTiming));
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
            long realtimeMs = SystemClock.elapsedRealtime();
            boolean animated = running || !feedback.isEmpty();
            if (animated && lastAnimatedDrawMs != Long.MIN_VALUE
                && realtimeMs - lastAnimatedDrawMs < MIN_ANIMATED_FRAME_MS) {
                postInvalidateOnAnimation();
                return;
            }
            if (animated) lastAnimatedDrawMs = realtimeMs;
            float keyboardHeight = height * 0.22f;
            float keyboardTop = height - keyboardHeight;
            ensureFrameGradients(keyboardTop);
            paint.setShader(backgroundGradient);
            canvas.drawRect(0, 0, width, keyboardTop, paint);
            paint.setShader(null);
            double now = scoreTime();
            drawOctaveGuides(canvas, width, keyboardTop);
            drawTimeline(canvas, width, keyboardTop, now);
            drawNotes(canvas, width, keyboardTop, now);
            drawChordGuides(canvas, width, keyboardTop, now);
            drawPedalCues(canvas, width, keyboardTop, now);
            drawPhraseMap(canvas, width, keyboardTop, now);
            drawLoop(canvas, width, keyboardTop, now, loopStart, "A");
            drawLoop(canvas, width, keyboardTop, now, loopEnd, "B");
            drawStrikeZone(canvas, width, keyboardTop);
            drawFeedback(canvas, width, keyboardTop);
            drawKeyboard(canvas, width, keyboardTop, keyboardHeight);
            if ((running || !feedback.isEmpty()) && getVisibility() == View.VISIBLE) postInvalidateOnAnimation();
        }

        private void ensureFrameGradients(float keyboardTop) {
            if (backgroundGradient != null && strikeGradient != null
                && Math.abs(cachedGradientHeight - keyboardTop) < .5f
                && cachedGradientTheme.equals(theme)) return;
            cachedGradientHeight = keyboardTop;
            cachedGradientTheme = theme;
            backgroundGradient = new LinearGradient(0, 0, 0, keyboardTop,
                themeColor(Color.rgb(9, 11, 18), Color.rgb(7, 21, 19), Color.rgb(10, 10, 10)),
                themeColor(Color.rgb(17, 24, 39), Color.rgb(20, 36, 58), Color.rgb(32, 32, 32)), Shader.TileMode.CLAMP);
            strikeGradient = new LinearGradient(0, keyboardTop - Math.max(22 * density, keyboardTop * .065f),
                0, keyboardTop, Color.argb(0, 104, 229, 255), Color.argb(36, 104, 229, 255), Shader.TileMode.CLAMP);
        }

        private void drawPedalCues(Canvas canvas, int width, float keyboardTop, double now) {
            if (pedals.isEmpty()) return;
            float laneX = 8 * density;
            float laneWidth = Math.max(58 * density, Math.min(104 * density, width * .078f));
            float labelSize = Math.max(10 * density, Math.min(15 * density, width * .009f));
            float boxHeight = labelSize * 1.75f;
            float[] dash = { 5 * density, 7 * density };
            for (int index = lowerBoundPedals(now - .12); index < pedals.size(); index += 1) {
                PedalCue cue = pedals.get(index);
                double delta = cue.time - now;
                if (delta > visibleSeconds) break;
                float y = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
                float imminent = 1 - Math.min(1, Math.max(0, (float) delta) / (float) Math.min(1.25, visibleSeconds));
                int color = "up".equals(cue.kind) ? Color.rgb(121, 216, 255)
                    : "change".equals(cue.kind) ? Color.rgb(245, 169, 255)
                    : "level".equals(cue.kind) ? Color.rgb(168, 237, 184)
                    : Color.rgb(255, 210, 76);

                stroke.setColor(color);
                stroke.setAlpha((int) (255 * (.12f + imminent * .28f)));
                stroke.setStrokeWidth(Math.max(1, density));
                for (float x = laneX + laneWidth; x < width; x += dash[0] + dash[1]) {
                    canvas.drawLine(x, y, Math.min(width, x + dash[0]), y, stroke);
                }

                float top = Math.max(1, Math.min(keyboardTop - boxHeight - 1, y - boxHeight / 2));
                paint.setColor(Color.argb(230, 3, 6, 12));
                paint.setAlpha(255);
                canvas.drawRoundRect(laneX, top, laneX + laneWidth, top + boxHeight,
                    boxHeight / 2, boxHeight / 2, paint);
                stroke.setColor(color);
                stroke.setAlpha((int) (255 * (.88f + imminent * .12f)));
                stroke.setStrokeWidth(Math.max(1.2f, 1.4f * density));
                canvas.drawRoundRect(laneX, top, laneX + laneWidth, top + boxHeight,
                    boxHeight / 2, boxHeight / 2, stroke);
                paint.setColor(color);
                paint.setAlpha(255);
                paint.setTextSize(labelSize);
                paint.setTextAlign(Paint.Align.CENTER);
                paint.setFakeBoldText(true);
                Paint.FontMetrics metrics = paint.getFontMetrics();
                float baseline = top + boxHeight / 2 - (metrics.ascent + metrics.descent) / 2;
                canvas.drawText(cue.label, laneX + laneWidth / 2, baseline, paint);
                paint.setFakeBoldText(false);
                paint.setTextAlign(Paint.Align.LEFT);
            }
            stroke.setAlpha(255);
            paint.setAlpha(255);
        }

        private float phraseProgress(double time) {
            if (scoreDuration <= 0 || !Double.isFinite(time)) return 0;
            return Math.max(0, Math.min(1, (float) (time / scoreDuration)));
        }

        private void drawPhraseMap(Canvas canvas, int width, float keyboardTop, double now) {
            if (scoreDuration <= 0) return;
            float railWidth = Math.max(12 * density, Math.min(22 * density, width * .012f));
            float x = width - railWidth - Math.max(6 * density, width * .004f);
            float top = Math.max(12 * density, keyboardTop * .025f);
            float height = Math.max(80 * density, keyboardTop - top - 12 * density);
            float half = railWidth / 2;
            float rowHeight = height / PHRASE_MAP_BINS;
            paint.setColor(Color.argb(189, 3, 6, 12));
            canvas.drawRoundRect(x, top, x + railWidth, top + height, railWidth / 2, railWidth / 2, paint);
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
            canvas.drawRoundRect(x, top, x + railWidth, top + height, railWidth / 2, railWidth / 2, stroke);
            paint.setAlpha(255);
        }

        private void drawTimeline(Canvas canvas, int width, float keyboardTop, double now) {
            if (beats.isEmpty()) {
                stroke.setColor(Color.argb(18, 255, 255, 255));
                stroke.setStrokeWidth(density);
                for (int second = 0; second <= 5; second += 1) {
                    float y = keyboardTop - (float) (second / visibleSeconds) * keyboardTop;
                    canvas.drawLine(0, y, width, y, stroke);
                }
                return;
            }
            for (int index = lowerBoundBeats(now - .15); index < beats.size(); index += 1) {
                BeatLine marker = beats.get(index);
                double delta = marker.time - now;
                if (delta > visibleSeconds) break;
                float y = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
                stroke.setColor(marker.accent ? Color.argb(97, 139, 167, 255) : Color.argb(23, 255, 255, 255));
                stroke.setStrokeWidth((marker.accent ? 1.5f : 1f) * density);
                canvas.drawLine(0, y, width, y, stroke);
                if (marker.accent && y > 18) {
                    paint.setColor(Color.rgb(196, 210, 255));
                    paint.setAlpha(184);
                    paint.setTextSize(11 * scaledDensity);
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
            stroke.setStrokeWidth(density);
            for (int note = 0; note < keys.length; note += 1) {
                KeyGeometry key = keys[note];
                if (key == null || note % 12 != 0) continue;
                float x = (key.x + key.width / 2f) * width;
                canvas.drawLine(x, 0, x, keyboardTop, stroke);
            }
            stroke.setAlpha(255);
        }

        private void drawStrikeZone(Canvas canvas, int width, float keyboardTop) {
            float zone = Math.max(22 * density, keyboardTop * .065f);
            paint.setShader(strikeGradient);
            canvas.drawRect(0, keyboardTop - zone, width, keyboardTop, paint);
            paint.setShader(null);
            paint.setColor(themeColor(Color.rgb(190, 244, 255), Color.rgb(221, 255, 232), Color.WHITE));
            paint.setAlpha(230);
            canvas.drawRect(0, keyboardTop - 2, width, keyboardTop, paint);
            paint.setTextSize(10 * scaledDensity);
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
                boolean timed = "hit".equals(item.kind) && item.timingMs != null;
                boolean early = timed && item.timingMs < -25;
                boolean late = timed && item.timingMs > 25;
                boolean releaseGood = "release-good".equals(item.kind);
                boolean releaseEarly = "release-early".equals(item.kind);
                int color = early ? Color.rgb(114, 199, 255)
                    : late ? Color.rgb(255, 189, 107)
                    : releaseGood ? Color.rgb(84, 223, 193)
                    : releaseEarly ? Color.rgb(255, 159, 90)
                    : "hit".equals(item.kind)
                    ? themeColor(CORRECT, Color.rgb(184, 244, 109), Color.rgb(125, 255, 90))
                    : "wrong".equals(item.kind)
                        ? themeColor(WRONG, Color.rgb(255, 154, 95), Color.rgb(255, 89, 77))
                        : Color.rgb(255, 210, 76);
                float x = (key.x + key.width / 2f) * width;
                float y = keyboardTop - 18 * density - progress * 44 * density;
                paint.setColor(color);
                paint.setAlpha((int) ((1f - progress) * 242));
                paint.setTextSize(20 * scaledDensity);
                paint.setFakeBoldText(true);
                paint.setTextAlign(Paint.Align.CENTER);
                String symbol = early ? "↑" : late ? "↓" : timed ? "●"
                    : releaseGood ? "↔" : releaseEarly ? "↘"
                    : "hit".equals(item.kind) ? "✓" : "wrong".equals(item.kind) ? "×" : "!";
                canvas.drawText(symbol, x, y, paint);
                if (timed) {
                    float offset = Math.max(-1, Math.min(1, item.timingMs.floatValue() / 250f));
                    float markerY = keyboardTop - 24 * density + offset * 12 * density;
                    stroke.setColor(color);
                    stroke.setAlpha((int) ((1f - progress) * 184));
                    stroke.setStrokeWidth(Math.max(1, density));
                    canvas.drawLine(x, keyboardTop - 38 * density, x, keyboardTop - 10 * density, stroke);
                    paint.setColor(color);
                    paint.setAlpha((int) ((1f - progress) * 184));
                    canvas.drawCircle(x, markerY, 2.8f * density, paint);
                    if (key.width * width >= 26 * density) {
                        String label = early ? "早 " + Math.min(999, Math.abs(Math.round(item.timingMs)))
                            : late ? "晚 " + Math.min(999, Math.abs(Math.round(item.timingMs))) : "准";
                        paint.setAlpha((int) ((1f - progress) * 230));
                        paint.setTextSize(10 * scaledDensity);
                        canvas.drawText(label, x, y - 16 * density, paint);
                    }
                }
                if ((releaseGood || releaseEarly) && item.timingMs != null
                    && key.width * width >= 26 * density) {
                    String label = releaseEarly
                        ? "短 " + Math.max(0, Math.min(999, Math.round(item.timingMs))) + "%"
                        : "时值";
                    paint.setAlpha((int) ((1f - progress) * 230));
                    paint.setTextSize(10 * scaledDensity);
                    canvas.drawText(label, x, y - 16 * density, paint);
                }
                stroke.setColor(color);
                stroke.setAlpha((int) ((1f - progress) * 140));
                stroke.setStrokeWidth(1.5f * density);
                canvas.drawCircle(x, keyboardTop - 8 * density, (5 + progress * 13) * density, stroke);
                if (!"contrast".equals(theme)) {
                    for (int spark = 0; spark < 6; spark += 1) {
                        double angle = spark * Math.PI / 3 + item.note * .17;
                        float distance = (7 + progress * (12 + (spark % 3) * 5)) * density;
                        paint.setAlpha((int) ((1f - progress) * (140 - spark * 11)));
                        float sx = x + (float) Math.cos(angle) * distance;
                        float sy = keyboardTop - 8 * density
                            + (float) Math.sin(angle) * distance * .65f;
                        canvas.drawCircle(sx, sy, Math.max(1, 2.5f - progress * 1.5f) * density, paint);
                    }
                }
                paint.setTextAlign(Paint.Align.LEFT);
                paint.setFakeBoldText(false);
                paint.setAlpha(255);
                stroke.setAlpha(255);
            }
        }

        private void drawNotes(Canvas canvas, int width, float keyboardTop, double now) {
            int first = lowerBound(now - maximumNoteDuration - .08);
            for (int index = first; index < notes.size(); index += 1) {
                NoteBar note = notes.get(index);
                double delta = note.start - now;
                if (delta > visibleSeconds) break;
                KeyGeometry key = keys[note.note];
                if (key == null || note.end < now - .08) continue;
                float x = key.x * width + 1;
                float noteWidth = Math.max(3, key.width * width - 2);
                float rawBottom = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
                float rawHeight = Math.max(5, (float) ((note.end - note.start) / visibleSeconds) * keyboardTop);
                float bottom = Math.min(keyboardTop, rawBottom);
                float noteTop = Math.max(0, rawBottom - rawHeight);
                float noteHeight = Math.max(2, bottom - noteTop);
                if (noteHeight <= 2 && note.end < now) continue;
                int color = note.left
                    ? themeColor(LEFT, Color.rgb(78, 230, 190), Color.rgb(68, 215, 255))
                    : themeColor(RIGHT, Color.rgb(184, 156, 255), Color.rgb(255, 207, 63));
                boolean selected = "both".equals(selectedHand) || (note.left ? "left" : "right").equals(selectedHand);
                float dynamics = normalizedDynamics(note.velocity);
                float radius = Math.min(8, noteWidth / 3);
                if (selected && delta >= 0 && delta < .85 && bottom < keyboardTop) {
                    int runwayAlpha = "contrast".equals(theme) ? 56 : 80;
                    paint.setShader(new LinearGradient(0, bottom, 0, keyboardTop,
                        Color.argb("contrast".equals(theme) ? 24 : 8, Color.red(color), Color.green(color), Color.blue(color)),
                        Color.argb(runwayAlpha, Color.red(color), Color.green(color), Color.blue(color)), Shader.TileMode.CLAMP));
                    paint.setAlpha((int) (255 * (1 - delta / 1.1) * (.62f + dynamics * .38f)));
                    canvas.drawRect(x + noteWidth * .18f, bottom, x + noteWidth * .82f, keyboardTop, paint);
                    paint.setShader(null);
                }
                if (!"contrast".equals(theme) && selected && delta > -.08 && delta < .32) {
                    float arrival = 1 - Math.min(1, (float) Math.abs(delta) / .32f);
                    paint.setShader(null);
                    paint.setColor(color);
                    paint.setAlpha((int) (20 + arrival * (26 + dynamics * 46)));
                    canvas.drawRoundRect(x - 3, noteTop - 3, x + noteWidth + 3, bottom + 3,
                        radius + 3, radius + 3, paint);
                }
                paint.setShader(new LinearGradient(0, noteTop, 0, bottom, color,
                    note.left
                        ? themeColor(Color.rgb(17, 124, 163), Color.rgb(22, 135, 118), Color.rgb(20, 125, 163))
                        : themeColor(Color.rgb(182, 36, 138), Color.rgb(112, 80, 186), Color.rgb(181, 122, 8)), Shader.TileMode.CLAMP));
                int bodyAlpha = selected ? (int) (158 + dynamics * 87) : 41;
                paint.setAlpha(bodyAlpha);
                canvas.drawRoundRect(x, noteTop, x + noteWidth, bottom, radius, radius, paint);
                paint.setShader(null);
                if (noteWidth >= 7) {
                    paint.setColor(Color.WHITE);
                    paint.setAlpha(selected ? (int) (bodyAlpha * (.2f + dynamics * .46f)) : 16);
                    canvas.drawRect(x + 1, noteTop + 2,
                        x + 1 + Math.max(1, noteWidth * (.1f + dynamics * .14f)), bottom - 2, paint);
                }
                float cap = Math.max(1.5f * density, Math.min(6 * density, noteWidth * (.1f + dynamics * .18f)));
                paint.setColor(Color.WHITE);
                paint.setAlpha(selected ? (int) (255 * (.42f + dynamics * .53f)) : 20);
                canvas.drawRect(x + 1, bottom - cap, x + Math.max(2, noteWidth - 1), bottom, paint);
            }
            paint.setAlpha(255);
        }

        private void drawChordGuides(Canvas canvas, int width, float keyboardTop, double now) {
            int first = lowerBound(now - .061);
            double horizon = Math.min(1.8, visibleSeconds);
            int index = first;
            while (index < notes.size()) {
                NoteBar base = notes.get(index);
                double delta = base.start - now;
                if (delta > horizon) break;
                int end = index + 1;
                while (end < notes.size() && notes.get(end).start - base.start <= .035000001) end += 1;
                if (delta >= -.06) {
                    chordGeneration += 1;
                    if (chordGeneration == Integer.MAX_VALUE) {
                        Arrays.fill(chordSeen, 0);
                        chordGeneration = 1;
                    }
                    int count = 0;
                    float minX = Float.POSITIVE_INFINITY;
                    float maxX = Float.NEGATIVE_INFINITY;
                    boolean left = false;
                    boolean right = false;
                    for (int noteIndex = index; noteIndex < end; noteIndex += 1) {
                        NoteBar note = notes.get(noteIndex);
                        if (!("both".equals(selectedHand) || (note.left ? "left" : "right").equals(selectedHand))) continue;
                        if (chordSeen[note.note] == chordGeneration) continue;
                        chordSeen[note.note] = chordGeneration;
                        KeyGeometry key = keys[note.note];
                        if (key == null) continue;
                        float x = (key.x + key.width / 2f) * width;
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        left |= note.left;
                        right |= !note.left;
                        count += 1;
                    }
                    if (count >= 2) {
                        float y = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
                        float proximity = 1 - (float) Math.max(0, delta) / (float) horizon;
                        float lift = Math.min(18 * density, 5 * density + (maxX - minX) * .035f);
                        int strike = themeColor(Color.rgb(190, 244, 255), Color.rgb(221, 255, 232), Color.WHITE);
                        stroke.setColor(strike);
                        stroke.setAlpha((int) (255 * (("contrast".equals(theme) ? .6f : .34f) + proximity * .38f)));
                        stroke.setStrokeWidth(Math.max(density, Math.min(2.4f * density, width * .0014f)));
                        chordPath.reset();
                        chordPath.moveTo(minX, y - 2 * density);
                        chordPath.quadTo((minX + maxX) / 2, y - lift, maxX, y - 2 * density);
                        canvas.drawPath(chordPath, stroke);
                        for (int noteIndex = index; noteIndex < end; noteIndex += 1) {
                            NoteBar note = notes.get(noteIndex);
                            if (!("both".equals(selectedHand) || (note.left ? "left" : "right").equals(selectedHand))) continue;
                            boolean duplicate = false;
                            for (int prior = index; prior < noteIndex; prior += 1) {
                                if (notes.get(prior).note == note.note) { duplicate = true; break; }
                            }
                            if (duplicate) continue;
                            KeyGeometry key = keys[note.note];
                            if (key == null) continue;
                            paint.setColor(note.left
                                ? themeColor(LEFT, Color.rgb(78, 230, 190), Color.rgb(68, 215, 255))
                                : themeColor(RIGHT, Color.rgb(184, 156, 255), Color.rgb(255, 207, 63)));
                            paint.setAlpha((int) (255 * (.38f + proximity * .5f)));
                            canvas.drawCircle((key.x + key.width / 2f) * width, y - 2 * density,
                                (2 + proximity * 1.8f) * density, paint);
                        }
                        if (left && right && "both".equals(selectedHand)) {
                            canvas.save();
                            canvas.translate((minX + maxX) / 2, y - lift);
                            canvas.rotate(45);
                            paint.setColor(strike);
                            paint.setAlpha((int) (255 * (.42f + proximity * .42f)));
                            canvas.drawRect(-2.4f * density, -2.4f * density, 2.4f * density, 2.4f * density, paint);
                            canvas.restore();
                        }
                    }
                }
                index = end;
            }
            paint.setAlpha(255);
            stroke.setAlpha(255);
        }

        private int lowerBound(double startTime) {
            int low = 0;
            int high = notes.size();
            while (low < high) {
                int middle = (low + high) >>> 1;
                if (notes.get(middle).start < startTime) low = middle + 1;
                else high = middle;
            }
            return low;
        }

        private int lowerBoundBeats(double startTime) {
            int low = 0;
            int high = beats.size();
            while (low < high) {
                int middle = (low + high) >>> 1;
                if (beats.get(middle).time < startTime) low = middle + 1;
                else high = middle;
            }
            return low;
        }

        private int lowerBoundPedals(double startTime) {
            int low = 0;
            int high = pedals.size();
            while (low < high) {
                int middle = (low + high) >>> 1;
                if (pedals.get(middle).time < startTime) low = middle + 1;
                else high = middle;
            }
            return low;
        }

        private void drawLoop(Canvas canvas, int width, float keyboardTop, double now, Double boundary, String label) {
            if (boundary == null) return;
            double delta = boundary - now;
            if (delta < 0 || delta > visibleSeconds) return;
            float y = keyboardTop - (float) (delta / visibleSeconds) * keyboardTop;
            stroke.setColor(Color.rgb(255, 210, 76));
            stroke.setStrokeWidth(2 * density);
            canvas.drawLine(0, y, width, y, stroke);
            paint.setColor(Color.rgb(255, 210, 76));
            paint.setTextSize(12 * scaledDensity);
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
                    paint.setTextSize(10 * scaledDensity);
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
