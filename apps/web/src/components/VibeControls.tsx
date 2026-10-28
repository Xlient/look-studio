import { OCCASIONS, VIBE_MAX, VIBE_MIN, clampVibe, vibeLabel } from "../studio/prompt-compose.ts";
import type { Occasion } from "../studio/prompt-compose.ts";

interface VibeControlsProps {
  occasion: Occasion | null;
  vibe: number;
  disabled: boolean;
  onOccasion: (occasion: Occasion | null) => void;
  onVibe: (vibe: number) => void;
}

export default function VibeControls({ occasion, vibe, disabled, onOccasion, onVibe }: VibeControlsProps) {
  const label = vibeLabel(vibe);
  return (
    <div className="vibe">
      <div className="chips" role="group" aria-label="Occasion">
        {OCCASIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={occasion === option}
            disabled={disabled}
            onClick={() => onOccasion(occasion === option ? null : option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="vibe__dial">
        <label htmlFor="vibe-dial">Vibe</label>
        <span aria-hidden="true">subtle</span>
        <input
          id="vibe-dial"
          type="range"
          min={VIBE_MIN}
          max={VIBE_MAX}
          step={10}
          value={vibe}
          aria-valuetext={`${vibe}, ${label}`}
          disabled={disabled}
          onChange={(event) => onVibe(clampVibe(Number(event.target.value)))}
        />
        <span aria-hidden="true">bold</span>
        <output htmlFor="vibe-dial" className="vibe__value">
          {label}
        </output>
      </div>
    </div>
  );
}
