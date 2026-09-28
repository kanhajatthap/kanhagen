"use client";

import { KeyboardEvent, useState, useRef, DragEvent, useEffect, useImperativeHandle } from "react";
import { toast } from "sonner";
import { ImageSettings, ImageSettingsState } from "./ImageSettings";
import { StylePresets } from "./StylePresets";
import { PromptTemplates } from "./PromptTemplates";
import { Settings2, Sparkles, Plus, SendHorizonal, ImageUp, History, Trash2, ScanText, SlidersHorizontal } from "lucide-react";

export interface PromptInputOptions {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  model: string;
  image?: File;
  batchCount?: number;
  textModel?: "auto" | "gemini" | "pollinations";
  /** Opt-in: publish generated images to the public /explore gallery. */
  isPublic?: boolean;
}

export interface PromptInputHandle {
  setValue: (value: string) => void;
  focus: () => void;
}

interface PromptInputProps {
  onSend: (options: PromptInputOptions) => Promise<void> | void;
  onEnhance?: (prompt: string) => Promise<string>;
  onOCRResult?: (text: string) => void;
  disabled?: boolean;
  ref?: React.Ref<PromptInputHandle>;
}

const ACCEPTED_FORMATS = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXTAREA_LINES = 7;
const LINE_HEIGHT = 24;

const DEFAULT_SETTINGS: ImageSettingsState = {
  width: 1024,
  height: 1024,
  model: "flux",
};

function loadStoredSettings(): ImageSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const sizeLabel = localStorage.getItem("defaultSize");
    if (sizeLabel) {
      const match = sizeLabel.match(/(\d+)\s*x\s*(\d+)/);
      if (match) {
        settings.width = parseInt(match[1], 10);
        settings.height = parseInt(match[2], 10);
      }
    }
    const model = localStorage.getItem("defaultModel");
    if (model) settings.model = model;
  } catch {}
  return settings;
}

export function PromptInput({ onSend, onEnhance, onOCRResult, disabled, ref }: PromptInputProps) {
  const [value, setValue] = useState("");
  const [settings, setSettings] = useState<ImageSettingsState>(loadStoredSettings);
  const [templateValue, setTemplateValue] = useState("");
  const [styleValue, setStyleValue] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [batchMode, setBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(4);
  // Images are private by default; publishing is an explicit opt-in.
  const [isPublic, setIsPublic] = useState(false);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);
  const [textModel, setTextModel] = useState<"auto" | "gemini" | "pollinations">(() => {
    if (typeof window === "undefined") return "auto";
    const stored = localStorage.getItem("defaultChatModel");
    return stored === "gemini" || stored === "pollinations" ? stored : "auto";
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    setValue: (v: string) => {
      setValue(v);
      setShowSuggestions(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    focus: () => textareaRef.current?.focus(),
  }));

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const newHeight = Math.min(
      Math.max(textarea.scrollHeight, LINE_HEIGHT),
      LINE_HEIGHT * MAX_TEXTAREA_LINES
    );
    textarea.style.height = `${newHeight}px`;
  }, [value]);

  // Fetch prompt suggestions
  useEffect(() => {
    if (!value.trim() || value.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/prompt-history?q=${encodeURIComponent(value.trim())}&limit=5`);
        if (res.ok) {
          const json = await res.json();
          const filtered = (json.prompts || []).filter((p: string) => p !== value.trim());
          setSuggestions(filtered);
          setShowSuggestions(filtered.length > 0);
          setSelectedSuggestionIndex(-1);
        }
      } catch {
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Handle paste from clipboard
  useEffect(() => {
    const handlePaste = (e: globalThis.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            handleImageFile(file);
          }
          return;
        }
      }
    };

    const inputContainer = inputContainerRef.current;
    if (inputContainer) {
      inputContainer.addEventListener("paste", handlePaste);
      return () => {
        inputContainer.removeEventListener("paste", handlePaste);
      };
    }
  }, []);

  const handleImageFile = (file: File) => {
    if (!ACCEPTED_FORMATS.includes(file.type)) {
      toast.error("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File too large. Maximum size is 10MB.");
      return;
    }
    setSelectedImage(file);
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file && ACCEPTED_FORMATS.includes(file.type)) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error("File too large. Maximum size is 10MB.");
          return;
        }
        setSelectedImage(file);
      } else if (file) {
        toast.error("Please upload a JPG, PNG, or WEBP image.");
      }
    }
  };

  const handleFileSelect = (file: File | null) => {
    if (file) {
      handleImageFile(file);
    }
  };

  const processOCR = async (imageFile: File) => {
    setIsProcessingOCR(true);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("prompt", "Extract all text from this image.");

      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (json.success && json.text) {
        // Call the callback to display extracted text as chat message
        if (onOCRResult) {
          onOCRResult(json.text);
        }
      } else if (json.success && json.text === "No text found in image.") {
        if (onOCRResult) {
          onOCRResult("No text found in the image.");
        }
      } else {
        toast.error(json.error || "Failed to extract text.");
      }
    } catch (error) {
      console.error("OCR Error:", error);
      toast.error("Failed to process image.");
    } finally {
      setIsProcessingOCR(false);
      setSelectedImage(null);
    }
  };

  const send = async () => {
    if (selectedImage && !value.trim()) {
      await processOCR(selectedImage);
      return;
    }

    const prompt = value.trim();
    if (!prompt && !selectedImage) return;
    setValue("");
    setTemplateValue("");
    setStyleValue("");
    setShowSuggestions(false);
    await onSend({
      prompt,
      width: settings.width,
      height: settings.height,
      seed: settings.seed,
      model: settings.model,
      image: selectedImage || undefined,
      batchCount: batchMode ? batchCount : undefined,
      textModel,
      isPublic,
    });
    setSelectedImage(null);
  };

  const handleEnhance = async () => {
    const prompt = value.trim();
    if (!prompt || !onEnhance || isEnhancing) return;
    setIsEnhancing(true);
    try {
      const enhanced = await onEnhance(prompt);
      setValue(enhanced);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to enhance the prompt.";
      toast.error(msg);
    } finally {
      setIsEnhancing(false);
    }
  };

  const onKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === "Tab" && selectedSuggestionIndex >= 0) {
        e.preventDefault();
        setValue(suggestions[selectedSuggestionIndex]);
        setShowSuggestions(false);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !disabled) {
      e.preventDefault();
      setShowSuggestions(false);
      await send();
    }
  };

  const handleTemplateSelect = (templatePrompt: string, templateValue: string) => {
    setValue(templatePrompt);
    setTemplateValue(templateValue);
  };

  const handleStyleApply = (styleSuffix: string, styleVal: string) => {
    const currentPrompt = value.trim();
    if (currentPrompt) {
      setValue(`${currentPrompt}, ${styleSuffix}`);
    } else {
      setValue(styleSuffix);
    }
    setStyleValue(styleVal);
  };

  return (
    <div className="border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      {/* Mobile options toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 sm:hidden dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setMobileOptionsOpen((v) => !v)}
          aria-expanded={mobileOptionsOpen}
          className={[
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
            mobileOptionsOpen
              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
              : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
          ].join(" ")}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Options
        </button>
      </div>

      {/* Options panel: hidden on mobile by default, slides open on toggle; always visible on sm+ */}
      <div className={[mobileOptionsOpen ? "block animate-reveal-up" : "hidden", "sm:block"].join(" ")}>
        {/* Template and Style Bar */}
        <div className="flex flex-wrap items-center gap-4 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <PromptTemplates onSelect={(prompt) => handleTemplateSelect(prompt, "")} value={templateValue} />
          <StylePresets onApply={(suffix) => handleStyleApply(suffix, "")} value={styleValue} />
        </div>

        {/* Settings Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={[
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              showSettings
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
            ].join(" ")}
            aria-expanded={showSettings}
          >
            <Settings2 className="h-4 w-4" />
            Settings
          </button>

          {/* Batch Mode Toggle */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
            <button
              type="button"
              role="switch"
              aria-checked={batchMode}
              onClick={() => setBatchMode((v) => !v)}
              className={[
                "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200",
                batchMode ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-600",
              ].join(" ")}
              title="Batch mode"
            >
              <span
                className={[
                  "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200",
                  batchMode ? "translate-x-3" : "translate-x-0",
                ].join(" ")}
              />
            </button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Batch</span>
            {batchMode && (
              <select
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value))}
                aria-label="Batch count"
                className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-indigo-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}x</option>
                ))}
              </select>
            )}
          </div>

          {/* Public gallery toggle (images are private unless enabled) */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              aria-label="Publish images to the public gallery"
              onClick={() => setIsPublic((v) => !v)}
              className={[
                "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200",
                isPublic ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-600",
              ].join(" ")}
              title={isPublic ? "Images will be visible in Explore" : "Images stay private to you"}
            >
              <span
                className={[
                  "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200",
                  isPublic ? "translate-x-3" : "translate-x-0",
                ].join(" ")}
              />
            </button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Public</span>
          </div>

          {/* Chat reply model */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Reply:</span>
            <select
              value={textModel}
              onChange={(e) => {
                const next = e.target.value as "auto" | "gemini" | "pollinations";
                setTextModel(next);
                localStorage.setItem("defaultChatModel", next);
              }}
              aria-label="Chat reply model"
              title="Which AI answers your text messages"
              className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-indigo-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value="auto">Auto</option>
              <option value="gemini">Gemini</option>
              <option value="pollinations">Pollinations</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onEnhance && (
            <button
              type="button"
              onClick={handleEnhance}
              disabled={disabled || isEnhancing || !value.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <Sparkles className="h-4 w-4" />
              {isEnhancing ? "Enhancing..." : "Enhance"}
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Expandable Settings Panel */}
      {showSettings && (
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <ImageSettings settings={settings} onChange={setSettings} />
        </div>
      )}

      {/* Input Container with Drag & Drop */}
      <div
        ref={inputContainerRef}
        className="relative mx-auto max-w-3xl px-4 py-4"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag Overlay */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-500 bg-indigo-50/95 backdrop-blur-sm dark:border-indigo-400 dark:bg-indigo-950/80">
            <div className="flex flex-col items-center gap-2">
              <ImageUp className="h-10 w-10 text-indigo-500 dark:text-indigo-400" />
              <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">Drop image here</p>
            </div>
          </div>
        )}

        {/* Image Preview Card */}
        {selectedImage && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
              <img
                src={URL.createObjectURL(selectedImage)}
                alt="Preview"
                className="h-full w-full object-cover"
              />
              {isProcessingOCR && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {selectedImage.name}
              </p>
              <p className="text-xs text-zinc-500">
                {(selectedImage.size / 1024).toFixed(1)} KB
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => processOCR(selectedImage)}
                  disabled={isProcessingOCR}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <ScanText className="h-3.5 w-3.5" />
                  {isProcessingOCR ? "Processing..." : "Extract Text"}
                </button>
                <button
                  onClick={() => setSelectedImage(null)}
                  disabled={isProcessingOCR}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ChatGPT-style Premium Input Container */}
        <div className="mx-auto w-full max-w-3xl">
          {/* Autocomplete Suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <div ref={suggestionsRef} className="mb-2 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setValue(suggestion);
                    setShowSuggestions(false);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                    index === selectedSuggestionIndex
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <History className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="truncate text-zinc-700 dark:text-zinc-300">{suggestion}</span>
                </button>
              ))}
              <div className="border-t border-zinc-100 px-4 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
                Tab to select · Esc to close
              </div>
            </div>
          )}

          <div
            className={[
              "relative flex items-center rounded-2xl border shadow-sm transition-all duration-200",
              isDragging
                ? "border-indigo-500 ring-2 ring-indigo-500/25"
                : "border-zinc-300 bg-white hover:border-zinc-400 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-500/20",
            ].join(" ")}
          >
            {/* Image Upload Button (+) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              id="image-upload"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            />
            <label
              htmlFor="image-upload"
              className="ml-3 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-all duration-200 hover:bg-zinc-200 hover:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              title="Add image"
            >
              <Plus className="h-[18px] w-[18px]" />
            </label>

            {/* Auto-expanding Textarea */}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={selectedImage ? "Add a message..." : "Describe the image you want to create..."}
              className="max-h-[200px] min-h-[50px] flex-1 resize-none bg-transparent px-3 py-4 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 transition-all dark:text-zinc-100 dark:placeholder:text-zinc-500"
              style={{ height: textareaRef.current?.style.height }}
              disabled={disabled}
              rows={1}
            />

            {/* Send Button (Circular Arrow) */}
            <button
              type="button"
              onClick={send}
              disabled={disabled || (!value.trim() && !selectedImage)}
              className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/25 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-indigo-500/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-md disabled:hover:shadow-indigo-500/25"
              title="Send message"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
            AI can make mistakes. Check important information.
          </p>
        </div>
      </div>
    </div>
  );
}

