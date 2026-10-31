import { OCCASIONS, SKIN_TONES, UNDERTONES, VIBE_MAX, VIBE_MIN, clampVibe, vibeLabel } from "../studio/prompt-compose.ts";
import type { Occasion, SkinChoice } from "../studio/prompt-compose.ts";

interface VibeControlsProps {
  occasion: Occasion | null;
  vibe: number;
  disabled: boolean;
  onOccasion: (occasion: Occasion | null) => void;
  onVibe: (vibe: number) => void;
  skin: SkinChoice;
  onSkin: (skin: SkinChoice) => void;
}

function toggled<T extends string>(current: T | undefined, option: T): T | undefined {
  return current === option ? undefined : option;
}

export default function VibeControls({ occasion, vibe, disabled, onOccasion, onVibe, skin, onSkin }: VibeControlsProps) {
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
      <div className="vibe__skin">
        <span id="skin-tone-label">Your skin tone</span>
        <div className="chips" role="group" aria-labelledby="skin-tone-label">
          {SKIN_TONES.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={skin.tone === option}
              disabled={disabled}
              onClick={() => onSkin({ ...skin, tone: toggled(skin.tone, option) })}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="vibe__skin">
        <span id="undertone-label">Your undertone</span>
        <div className="chips" role="group" aria-labelledby="undertone-label">
          {UNDERTONES.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={skin.undertone === option}
              disabled={disabled}
              onClick={() => onSkin({ ...skin, undertone: toggled(skin.undertone, option) })}
            >
              {option}
            </button>
          ))}
        </div>
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
