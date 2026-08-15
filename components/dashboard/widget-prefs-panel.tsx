"use client";

import { useEffect, useRef, useState } from "react";
import { X, GripVertical, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export const WIDGET_LIMIT = 4;

export type WidgetCatalogItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  dotClass: string;
};

export type WidgetPrefsLabels = {
  title: string;
  active: string;
  available: string;
  done: string;
  cancel: string;
  needMore: (n: number) => string;
  maxReached: string;
};

const ROW_PITCH = 56;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function WidgetPrefsPanel({
  open,
  onClose,
  activeIds,
  catalog,
  onApply,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  activeIds: string[];
  catalog: WidgetCatalogItem[];
  onApply: (ids: string[]) => void;
  labels: WidgetPrefsLabels;
}) {
  const [draft, setDraft] = useState<string[]>(activeIds);
  const dragState = useRef<{ id: string; startY: number; startIndex: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  useEffect(() => {
    if (open) {
      setDraft(activeIds);
      setDragId(null);
      setDragOffsetY(0);
      dragState.current = null;
    }
  }, [open, activeIds]);

  useEffect(() => {
    if (!dragId) return;

    const onMove = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const delta = e.clientY - ds.startY;
      setDragOffsetY(delta);
      const targetIndex = clamp(ds.startIndex + Math.round(delta / ROW_PITCH), 0, draft.length - 1);
      setDraft((prev) => {
        const currentIndex = prev.indexOf(ds.id);
        if (currentIndex === -1 || currentIndex === targetIndex) return prev;
        const next = prev.slice();
        next.splice(currentIndex, 1);
        next.splice(targetIndex, 0, ds.id);
        return next;
      });
    };
    const onUp = () => {
      dragState.current = null;
      setDragId(null);
      setDragOffsetY(0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  if (!open) return null;

  const catalogById: Record<string, WidgetCatalogItem> = {};
  for (const item of catalog) catalogById[item.id] = item;

  const availableItems = catalog.filter((c) => !draft.includes(c.id));
  const atLimit = draft.length >= WIDGET_LIMIT;
  const canSave = draft.length === WIDGET_LIMIT;

  const startDrag = (id: string, index: number, clientY: number) => {
    dragState.current = { id, startY: clientY, startIndex: index };
    setDragId(id);
    setDragOffsetY(0);
  };

  const remove = (id: string) => {
    setDraft((prev) => prev.filter((x) => x !== id));
  };

  const add = (id: string) => {
    if (atLimit) return;
    setDraft((prev) => [...prev, id]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-gray-900 border border-gray-700 sm:rounded-2xl rounded-t-2xl w-full sm:max-w-[420px] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-800 shrink-0">
          <h2 className="text-base font-semibold text-white">{labels.title}</h2>
          <button
            onClick={() => {
              setDraft(activeIds);
              onClose();
            }}
            className="text-gray-500 hover:text-gray-300 p-2 -m-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              {labels.active}
            </div>
            <div className="relative">
              {draft.map((id, index) => {
                const item = catalogById[id];
                if (!item) return null;
                const Icon = item.icon;
                const isDragging = dragId === id;
                return (
                  <div
                    key={id}
                    style={{
                      height: 48,
                      marginBottom: 8,
                      transform: isDragging ? `translateY(${dragOffsetY}px)` : undefined,
                      zIndex: isDragging ? 10 : 1,
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-3 bg-gray-800/60 ${
                      isDragging ? "border-blue-500/60 shadow-lg" : "border-gray-700"
                    }`}
                  >
                    <button
                      onPointerDown={(e) => {
                        e.preventDefault();
                        startDrag(id, index, e.clientY);
                      }}
                      style={{ touchAction: "none" }}
                      className="text-gray-500 hover:text-gray-300 p-1 -ml-1 cursor-grab active:cursor-grabbing"
                      aria-label="drag"
                    >
                      <GripVertical className="w-4 h-4" />
                    </button>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${item.dotClass}`} />
                    <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-200 truncate flex-1">{item.label}</span>
                    <button
                      onClick={() => remove(id)}
                      className="text-gray-500 hover:text-red-400 p-1"
                      aria-label="remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            {!canSave && (
              <p className="text-xs text-amber-400 mt-1">
                {draft.length < WIDGET_LIMIT
                  ? labels.needMore(WIDGET_LIMIT - draft.length)
                  : labels.maxReached}
              </p>
            )}
          </div>

          {availableItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                {labels.available}
              </div>
              <div className="space-y-2">
                {availableItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => add(item.id)}
                      disabled={atLimit}
                      className={`w-full flex items-center gap-2 rounded-xl border px-3 h-12 transition-colors ${
                        atLimit
                          ? "border-gray-800 bg-gray-900/40 opacity-40 cursor-not-allowed"
                          : "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/50"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${item.dotClass}`} />
                      <Icon className={`w-4 h-4 shrink-0 ${atLimit ? "text-gray-600" : "text-blue-400"}`} />
                      <span className={`text-sm truncate flex-1 text-left ${atLimit ? "text-gray-500" : "text-gray-200"}`}>
                        {item.label}
                      </span>
                      <Plus className={`w-4 h-4 shrink-0 ${atLimit ? "text-gray-700" : "text-blue-400"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-800 shrink-0">
          <Button
            variant="outline"
            className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
            onClick={() => {
              setDraft(activeIds);
              onClose();
            }}
          >
            {labels.cancel}
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40"
            disabled={!canSave}
            onClick={() => onApply(draft)}
          >
            <Check className="w-4 h-4 mr-1" />
            {labels.done}
          </Button>
        </div>
      </div>
    </div>
  );
}
