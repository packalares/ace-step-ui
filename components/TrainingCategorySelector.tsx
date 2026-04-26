import React from 'react';
import {
  Activity,
  AudioWaveform,
  Check,
  CircleDot,
  Disc,
  Disc3,
  Drum,
  Guitar,
  Heart,
  Mic,
  Music,
  Music2,
  Piano,
  Sliders,
  Waves,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  TrainingCategoryConfig,
  TrainingCategoryId,
  TrainingSubType,
} from '../types/training';

// Map icon-name strings (declared in JSON) to Lucide components. Keep this list
// in sync with the `icon` fields in `data/training-categories.json`.
const ICONS: Record<string, LucideIcon> = {
  Activity,
  AudioWaveform,
  CircleDot,
  Disc,
  Disc3,
  Drum,
  Guitar,
  Heart,
  Mic,
  Music,
  Music2,
  Piano,
  Sliders,
  Waves,
};

function resolveIcon(name: string): LucideIcon {
  return ICONS[name] ?? Music;
}

interface TrainingCategorySelectorProps {
  categories: TrainingCategoryConfig[];
  selectedCategory: TrainingCategoryId | null;
  selectedSubType: string | null;
  onSelectCategory: (id: TrainingCategoryId) => void;
  onSelectSubType: (id: string | null) => void;
}

export const TrainingCategorySelector: React.FC<TrainingCategorySelectorProps> = ({
  categories,
  selectedCategory,
  selectedSubType,
  onSelectCategory,
  onSelectSubType,
}) => {
  const active = categories.find(c => c.id === selectedCategory) ?? null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Pick a training category
        </h3>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-3">
          Each category tunes preprocessing, auto-labelling and training defaults for you.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {categories.map(cat => {
            const Icon = resolveIcon(cat.icon);
            const isActive = cat.id === selectedCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(cat.id)}
                className={`relative text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  isActive
                    ? 'border-pink-500/60 bg-pink-500/10'
                    : 'border-zinc-200 dark:border-white/5 bg-white dark:bg-suno-card hover:border-zinc-300 dark:hover:border-white/10'
                }`}
              >
                {isActive && (
                  <span className="absolute top-1.5 right-1.5 text-pink-400">
                    <Check size={12} />
                  </span>
                )}
                <div className="flex items-start gap-2">
                  <span className={`flex-shrink-0 mt-0.5 ${isActive ? 'text-pink-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold truncate ${isActive ? 'text-pink-400' : 'text-zinc-900 dark:text-white'}`}>
                      {cat.displayName}
                    </div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5 line-clamp-2 leading-tight">
                      {cat.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-type picker — only shown when the active category has sub-types. */}
      {active?.subTypes && active.subTypes.length > 0 && (
        <SubTypePicker
          subTypes={active.subTypes}
          selectedSubType={selectedSubType}
          onSelect={onSelectSubType}
        />
      )}
    </div>
  );
};

interface SubTypePickerProps {
  subTypes: TrainingSubType[];
  selectedSubType: string | null;
  onSelect: (id: string) => void;
}

const SubTypePicker: React.FC<SubTypePickerProps> = ({ subTypes, selectedSubType, onSelect }) => (
  <div>
    <h4 className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
      Sub-type
    </h4>
    <div className="flex flex-wrap gap-1.5">
      {subTypes.map(sub => {
        const Icon = resolveIcon(sub.icon ?? 'Music');
        const isActive = sub.id === selectedSubType;
        return (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelect(sub.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              isActive
                ? 'border-pink-500/60 bg-pink-500/15 text-pink-400'
                : 'border-zinc-200 dark:border-white/5 bg-white dark:bg-suno-card text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/10'
            }`}
          >
            <Icon size={12} />
            {sub.displayName}
          </button>
        );
      })}
    </div>
  </div>
);
