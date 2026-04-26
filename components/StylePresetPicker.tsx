import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  AudioWaveform,
  Check,
  ChevronDown,
  Coffee,
  Disc3,
  Film,
  Flame,
  Guitar,
  Heart,
  Mic,
  Music,
  Music2,
  Piano,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StylePreset } from '../types/training';

const ICONS: Record<string, LucideIcon> = {
  AudioWaveform,
  Coffee,
  Disc3,
  Film,
  Flame,
  Guitar,
  Heart,
  Mic,
  Music,
  Music2,
  Piano,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Zap,
};

function resolveIcon(name: string): LucideIcon {
  return ICONS[name] ?? Music;
}

interface StylePresetPickerProps {
  presets: StylePreset[];
  selectedId: string | null;
  onSelect: (preset: StylePreset) => void;
}

export const StylePresetPicker: React.FC<StylePresetPickerProps> = ({
  presets,
  selectedId,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => presets.find(p => p.id === selectedId) ?? presets[0],
    [presets, selectedId],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  if (!selected) return null;

  const SelectedIcon = resolveIcon(selected.icon);

  return (
    <div
      ref={containerRef}
      className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-visible relative"
    >
      <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5">
        <div>
          <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Style preset
          </span>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
            One-click vetted settings — you can still tweak everything below.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-pink-400 flex-shrink-0">
            <SelectedIcon size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
              {selected.displayName}
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate">
              {selected.description}
            </p>
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`text-zinc-400 dark:text-zinc-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-80 overflow-y-auto rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-xl">
          {presets.map(preset => {
            const Icon = resolveIcon(preset.icon);
            const isActive = preset.id === selected.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onSelect(preset);
                  setOpen(false);
                }}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-pink-500/10'
                    : 'hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
              >
                <span className={`flex-shrink-0 mt-0.5 ${isActive ? 'text-pink-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  <Icon size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-semibold ${isActive ? 'text-pink-400' : 'text-zinc-900 dark:text-white'}`}>
                    {preset.displayName}
                  </div>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5 line-clamp-2 leading-tight">
                    {preset.description}
                  </p>
                </div>
                {isActive && (
                  <span className="text-pink-400 flex-shrink-0 mt-0.5">
                    <Check size={12} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
