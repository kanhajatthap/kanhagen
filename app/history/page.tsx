"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { MasonrySkeleton } from "../../components/Skeleton";
import { Lightbox, type LightboxItem } from "../../components/Lightbox";
import { PageHeader } from "../../components/PageHeader";
import { BlurImage } from "../../components/BlurImage";
import { toast } from "sonner";
import {
  Trash2,
  Download,
  Link2,
  RefreshCcw,
  Copy,
  Wand2,
  X,
  ImageOff,
  Layers,
} from "lucide-react";

type HistoryItem = {
  id: string;
  prompt: string;
  model: string;
  mimeType: string;
  createdAt: string;
  width?: number;
  height?: number;
  seed?: number;
  style?: string;
  imageUrl?: string;
  public?: boolean;
};

const getColumnCount = () => {
  if (typeof window === "undefined") return 4;
  if (window.innerWidth < 640) return 2;
  if (window.innerWidth < 768) return 3;
  if (window.innerWidth < 1024) return 4;
  if (window.innerWidth < 1280) return 5;
  return 6;
};

type Variation = {
  id: string;
  url: string;
  seed: number;
  prompt: string;
};

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [columnCount, setColumnCount] = useState(4);
  const [variationsModal, setVariationsModal] = useState<{ item: HistoryItem; variations: Variation[]; loading: boolean } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const pageRef = useRef(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const isTextItem = useCallback(
    (item: HistoryItem) => item.mimeType === "text/plain" && !item.imageUrl,
    [],
  );

  const imageItems = useMemo(
    () => items.filter((it) => !isTextItem(it)),
    [items, isTextItem],
  );

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      imageItems.map((item) => ({
        url: item.imageUrl || `/api/history/${item.id}/image`,
        prompt: item.prompt,
        seed: item.seed,
      })),
    [imageItems],
  );

  const loadHistory = async (page: number, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      // Paging happens server-side: the list carries no base64, the grid loads
      // bytes per-image from /api/history/:id/image.
      const res = await fetch(`/api/history?page=${page}&limit=${PAGE_SIZE}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Please login to view your history.");
        } else {
          setError("Failed to load history.");
        }
        return;
      }

      const json = await res.json();
      const pageItems: HistoryItem[] = (Array.isArray(json?.items) ? json.items : []).filter(
        (it: HistoryItem) => it.mimeType !== "text/plain",
      );

      if (append) {
        setItems((prev) => [...prev, ...pageItems]);
      } else {
        setItems(pageItems);
      }
      setHasMore(json?.hasMore === true);
      pageRef.current = page + 1;
    } catch {
      setError("Network error while loading history.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    pageRef.current = 1;
    loadHistory(1, false);
  }, []);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    if (!sentinelRef.current || !hasMore || loading || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          loadHistory(pageRef.current, true);
        }
      },
      { rootMargin: "200px" }
    );

    observerRef.current.observe(sentinelRef.current);

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [hasMore, loading, loadingMore, items.length]);

  useEffect(() => {
    const updateColumns = () => setColumnCount(getColumnCount());
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const deleteItem = async (id: string) => {
    const res = await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      toast.error("Failed to delete history item.");
      return;
    }

    setItems((prev) => prev.filter((x) => x.id !== id));
    toast.success("Image deleted");
  };

  const confirmDelete = (id: string) => {
    toast("Delete this image from history?", {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: () => deleteItem(id),
      },
    });
  };

  const copyImageUrl = async (item: HistoryItem) => {
    const url = item.imageUrl || `/api/history/${item.id}/image`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Image URL copied");
    } catch {
      toast.error("Could not copy URL");
    }
  };

  const generateSimilar = async (item: HistoryItem) => {
    setVariationsModal({ item, variations: [], loading: true });

    try {
      const imageUrl = item.imageUrl || `/api/history/${item.id}/image`;
      const res = await fetch("/api/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalImageUrl: imageUrl,
          prompt: item.prompt,
          width: item.width || 1024,
          height: item.height || 1024,
          model: item.model || "flux",
          style: item.style,
          count: 4,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to generate similar images.");
        setVariationsModal(null);
        return;
      }

      const json = await res.json();
      setVariationsModal({ item, variations: json.variations || [], loading: false });
    } catch (error) {
      console.error("Similar images error:", error);
      toast.error("Failed to generate similar images.");
      setVariationsModal(null);
    }
  };

  const regenerate = async (item: HistoryItem) => {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: item.prompt,
        width: item.width || 1024,
        height: item.height || 1024,
        seed: item.seed,
        model_type: item.model,
        style: item.style,
      }),
    });

    if (!res.ok) {
      toast.error("Failed to regenerate image.");
      return;
    }

    toast.success("Image regenerated");
    await loadHistory(1, false);
  };

  const createVariations = async (item: HistoryItem) => {
    setVariationsModal({ item, variations: [], loading: true });

    try {
      const imageUrl = item.imageUrl || `/api/history/${item.id}/image`;
      const res = await fetch("/api/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalImageUrl: imageUrl,
          prompt: item.prompt,
          width: item.width || 1024,
          height: item.height || 1024,
          model: item.model || "flux",
          style: item.style,
          count: 4,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to generate variations.");
        setVariationsModal(null);
        return;
      }

      const json = await res.json();
      setVariationsModal({ item, variations: json.variations || [], loading: false });
    } catch (error) {
      console.error("Variations error:", error);
      toast.error("Failed to generate variations.");
      setVariationsModal(null);
    }
  };

  const distributeIntoColumns = useCallback((items: HistoryItem[], count: number) => {
    const columns: HistoryItem[][] = Array.from({ length: count }, () => []);
    items.forEach((item, index) => {
      columns[index % count].push(item);
    });
    return columns;
  }, []);

  return (
    <main className="min-h-screen w-full">
      <PageHeader
        title="Generated Images"
        subtitle="Your AI-generated image collection"
        onBack={() => router.push("/")}
      />

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {loading && <MasonrySkeleton columns={columnCount} />}

      {!loading && error && <p className="font-medium text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-8 text-center shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/60 sm:p-16">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 shadow-inner dark:from-indigo-950/30 dark:to-purple-950/30 sm:h-20 sm:w-20">
              <ImageOff className="h-8 w-8 text-indigo-500 sm:h-10 sm:w-10" />
            </div>
          </div>
          <p className="text-lg font-medium text-zinc-700 dark:text-zinc-300">No generated images yet</p>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Start creating images to see them here</p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30"
          >
            Start Creating
          </button>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
      <div className="flex gap-3 sm:gap-4" style={{ alignItems: "flex-start" }}>
        {distributeIntoColumns(items, columnCount).map((column, colIndex) => (
          <div key={colIndex} className="flex flex-1 flex-col gap-3 sm:gap-4">
            {column.map((item) => {
              const imageSrc = item.imageUrl || `/api/history/${item.id}/image`;
              const globalIndex = items.findIndex((x) => x.id === item.id);
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="group relative cursor-pointer overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/10 dark:border-zinc-800 dark:bg-zinc-900"
                  onClick={() => setLightboxIndex(globalIndex)}
                >
                  <div className="relative overflow-hidden">
                    <BlurImage
                      src={imageSrc}
                      alt={item.prompt}
                      width={item.width || 1024}
                      height={item.height || 1024}
                      className="h-auto w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />

                    <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <div className="flex justify-end p-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(item.id);
                          }}
                          className="rounded-full bg-black/50 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 p-3">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={imageSrc}
                            download={`ai-image-${item.id}.png`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-900 backdrop-blur-sm transition-colors hover:bg-white"
                            title="Download Image"
                          >
                            <Download className="h-4 w-4" />
                          </a>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyImageUrl(item);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-900 backdrop-blur-sm transition-colors hover:bg-white"
                            title="Copy Image URL"
                          >
                            <Link2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              regenerate(item);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-900 backdrop-blur-sm transition-colors hover:bg-white"
                            title="Regenerate Image (same seed)"
                          >
                            <RefreshCcw className="h-4 w-4" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              generateSimilar(item);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white backdrop-blur-sm transition-colors hover:bg-blue-500"
                            title="Generate Similar Image (new seed)"
                          >
                            <Wand2 className="h-4 w-4" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              createVariations(item);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white backdrop-blur-sm transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30"
                            title="Create Variations"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {item.prompt}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-400">
                      {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
      )}

      {hasMore && !loading && !error && <div ref={sentinelRef} className="h-4" />}

      {loadingMore && (
        <div className="flex items-center justify-center py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
          <span className="ml-2 text-sm text-zinc-500">Loading more...</span>
        </div>
      )}

      {variationsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="flex items-center gap-2 font-heading text-xl font-bold text-zinc-800 dark:text-zinc-100">
                  <Layers className="h-5 w-5 text-indigo-500" />
                  Image Variations
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Based on: {variationsModal.item.prompt.slice(0, 80)}...</p>
              </div>
              <button
                onClick={() => setVariationsModal(null)}
                className="rounded-full p-2 text-zinc-500 hover:bg-gray-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(90vh - 80px)" }}>
              {variationsModal.loading ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
                  <p className="mt-4 text-sm text-zinc-500">Generating variations...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {variationsModal.variations.map((variation, index) => (
                    <div key={variation.id} className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="relative aspect-square overflow-hidden">
                        <BlurImage
                          src={variation.url}
                          alt={`Variation ${index + 1}`}
                          width={512}
                          height={512}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <a
                            href={variation.url}
                            download={`variation-${index + 1}.png`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-900 hover:bg-gray-100"
                            title="Download"
                          >
                            <Download className="h-5 w-5" />
                          </a>
                        </div>
                      </div>
                      <div className="border-t border-gray-200 p-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        Variation {index + 1} · Seed: {variation.seed}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Lightbox
        items={lightboxItems}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
      </div>
      </motion.main>
    </main>
  );
}
