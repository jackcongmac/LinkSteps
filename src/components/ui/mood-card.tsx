"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Heart, Loader2, MessageSquare, Mic } from "lucide-react";
import MoodPicker, {
  moodOptions,
  type MoodLevel,
  type MoodIconName,
} from "@/components/ui/mood-picker";

/** Returns the SpeechRecognition constructor, or null if unsupported. */
function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

// ── Types ────────────────────────────────────────────────────

type MicState = "idle" | "recording" | "error";

interface MoodCardProps {
  childName?: string;
  /** When true the Save Log button shows a spinner and is disabled. */
  saving?: boolean;
  onSave: (mood: MoodLevel, iconName: MoodIconName, note?: string) => void;
}

// ── Component ────────────────────────────────────────────────

export default function MoodCard({
  childName = "Ethan",
  saving = false,
  onSave,
}: MoodCardProps) {
  const [selected, setSelected] = useState<MoodLevel | undefined>();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  // Voice input state
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");

  // Refs — stable across renders, safe for use inside recognition callbacks
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  /**
   * Ref-based recording flag.
   * iOS Safari fires `onend` after every utterance even with continuous=true.
   * We restart recognition if this flag is still true — avoiding stale-closure
   * issues that would occur if we read `micState` inside the callback.
   */
  const isRecordingRef = useRef(false);

  // ── SSR-safe feature detection ──────────────────────────
  useEffect(() => {
    setIsSpeechSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore — recognition may already be stopped
      }
    };
  }, []);

  // ── Voice control ────────────────────────────────────────

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    setMicState("idle");
    setInterimTranscript("");
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    setMicError(null);
    setNoteOpen(true); // auto-open note panel

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    // Respect the user's browser language (works for both zh and en)
    recognition.lang = navigator.language || "zh-CN";

    recognition.onstart = () => setMicState("recording");

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      // Show live interim text as a hint below the textarea
      setInterimTranscript(interim);

      // Append confirmed finals to the note
      if (final) {
        setNote((prev) => {
          const sep = prev && !prev.endsWith(" ") ? " " : "";
          return prev + sep + final;
        });
        setInterimTranscript("");
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      isRecordingRef.current = false;
      setInterimTranscript("");

      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        // @QA: explicit permission-denied message
        setMicError(
          "Microphone access was denied. Please allow access in your browser settings and try again.",
        );
        setMicState("error");
      } else if (event.error === "no-speech") {
        // Silence timeout — reset quietly, no error shown
        setMicState("idle");
      } else {
        setMicError("Voice input failed. Please try again.");
        setMicState("error");
      }
    };

    recognition.onend = () => {
      /**
       * @QA iOS Safari compat:
       * iOS fires `onend` after every phrase even when continuous=true.
       * If we're still supposed to be recording (isRecordingRef), restart.
       * Use the ref — NOT micState — to avoid stale closure.
       */
      if (isRecordingRef.current) {
        try {
          recognition.start();
        } catch {
          isRecordingRef.current = false;
          setMicState("idle");
          setInterimTranscript("");
        }
      } else {
        setMicState("idle");
        setInterimTranscript("");
      }
    };

    recognitionRef.current = recognition;
    isRecordingRef.current = true;

    try {
      recognition.start();
    } catch {
      isRecordingRef.current = false;
      setMicState("idle");
    }
  }, []);

  function handleMicClick() {
    if (micState === "recording") {
      stopRecording();
    } else {
      setMicError(null);
      startRecording();
    }
  }

  // Closing the note panel while recording should stop the mic
  function handleToggleNote() {
    if (noteOpen && micState === "recording") stopRecording();
    setNoteOpen((prev) => !prev);
  }

  function handleSave() {
    if (selected === undefined) return;
    if (micState === "recording") stopRecording();
    const option = moodOptions.find((o) => o.level === selected);
    if (option) {
      onSave(selected, option.iconName, note.trim() || undefined);
    }
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Heart className="h-5 w-5 text-sky-600" aria-hidden="true" />
        <h2 className="text-slate-700 font-medium">
          How is {childName} feeling today?
        </h2>
      </div>

      <MoodPicker value={selected} onChange={setSelected} />

      {/* Note toggle row + mic button */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={handleToggleNote}
          aria-expanded={noteOpen}
          aria-controls="mood-card-note"
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-sky-500 transition-colors active:scale-95"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {noteOpen ? "Hide note" : "Add note"}
        </button>

        {/*
          @QA Graceful degradation:
          isSpeechSupported is false until useEffect confirms the API exists.
          The button is never rendered on unsupported browsers/SSR.
        */}
        {isSpeechSupported && (
          <div className="relative flex items-center justify-center">
            {/* Sonar-ring pulse while recording */}
            {micState === "recording" && (
              <span
                className="absolute h-8 w-8 rounded-full bg-rose-200 animate-ping"
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={handleMicClick}
              aria-label={
                micState === "recording"
                  ? "Stop voice input"
                  : "Start voice input"
              }
              aria-pressed={micState === "recording"}
              className={`relative z-10 rounded-full p-1.5 transition-colors active:scale-95 ${
                micState === "recording"
                  ? "text-rose-500"
                  : "text-slate-400 hover:text-sky-500"
              }`}
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Note expand panel */}
      <div
        className="grid"
        style={{
          gridTemplateRows: noteOpen ? "1fr" : "0fr",
          transition: "grid-template-rows 280ms ease",
        }}
        aria-hidden={!noteOpen}
      >
        {/* @QA: px-0.5 pb-0.5 gives the 2 px focus:ring-2 room to paint
            without being clipped by overflow-hidden */}
        <div className="overflow-hidden px-0.5 pb-0.5">
          <textarea
            id="mood-card-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for today..."
            rows={3}
            aria-label="Optional note"
            className="
              mt-3 w-full resize-none rounded-2xl
              bg-slate-50 border-0
              p-3 text-sm text-slate-700 placeholder:text-slate-400
              outline-none focus:ring-2 focus:ring-sky-200
              transition-shadow
            "
          />

          {/* Live interim transcript hint */}
          {micState === "recording" && interimTranscript && (
            <p className="mt-1 px-1 text-xs italic text-slate-400">
              {interimTranscript}…
            </p>
          )}

          {/* @QA: permission-denied / generic mic error */}
          {micError && (
            <p className="mt-2 px-1 text-xs text-rose-500" role="alert">
              {micError}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={selected === undefined || saving}
        onClick={handleSave}
        className={`mt-4 flex w-full items-center justify-center gap-2 rounded-3xl py-3 text-sm font-medium transition-transform ${
          selected !== undefined && !saving
            ? "bg-sky-500 text-white active:scale-95"
            : "bg-slate-200 text-slate-400 cursor-not-allowed"
        }`}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          "Save Log"
        )}
      </button>
    </section>
  );
}
