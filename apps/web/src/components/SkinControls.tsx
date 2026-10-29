import { useEffect, useMemo, useState } from "react";
import { SkinCoverage } from "@look-studio/shared";
import type { LookSpec } from "@look-studio/shared";
import type { SkinRender } from "../scene/skin-smoother.ts";

const percentText = (value: number) => (value === 0 ? "off" : `${value}%`);

export function useSkinSettings(look: LookSpec | null) {
  const [touchUp, setTouchUp] = useState(0);
  const [coverage, setCoverage] = useState<SkinCoverage>("none");
  const [cover, setCover] = useState(0);
  const lookId = look?.id;
  const lookSkin = look?.makeup?.skin;
  const lookCover = look?.grooming?.shadowCover;

  useEffect(() => {
    setTouchUp(lookSkin === undefined ? 0 : Math.round(lookSkin.smoothing * 100));
    setCoverage(lookSkin?.coverage ?? "none");
    setCover(lookCover === undefined ? 0 : Math.round(lookCover * 100));
  }, [lookId, lookSkin, lookCover]);

  const finish = lookSkin?.finish ?? "natural";
  const skin: SkinRender = useMemo(
    () => ({ smoothing: touchUp / 100, coverage, finish, cover: cover / 100 }),
    [touchUp, coverage, finish, cover],
  );
  return { skin, touchUp, setTouchUp, coverage, setCoverage, cover, setCover };
}

type SkinSettings = ReturnType<typeof useSkinSettings>;

function PercentSlider({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-valuetext={percentText(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>{percentText(value)}</output>
    </>
  );
}

export default function SkinControls({ settings }: { settings: SkinSettings }) {
  return (
    <div className="player__touchup">
      <PercentSlider id="touch-up" label="✨ Touch-up" value={settings.touchUp} onChange={settings.setTouchUp} />
      <label htmlFor="coverage">Coverage</label>
      <select id="coverage" value={settings.coverage} onChange={(event) => settings.setCoverage(SkinCoverage.parse(event.target.value))}>
        {SkinCoverage.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <PercentSlider id="stubble-cover" label="Stubble cover" value={settings.cover} onChange={settings.setCover} />
    </div>
  );
}
