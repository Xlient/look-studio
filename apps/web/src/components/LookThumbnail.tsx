import type { LookSpec } from "@look-studio/shared";
import { thumbnailModel } from "../studio/look-thumbnail.ts";

export default function LookThumbnail({ look }: { look: LookSpec }) {
  const model = thumbnailModel(look);
  const stripe = model.swatches.length === 0 ? 0 : 72 / model.swatches.length;
  return (
    <svg className="thumb" viewBox="0 0 72 56" width="72" height="56" aria-hidden="true" focusable="false">
      <rect width="72" height="56" fill="#FFFDF5" />
      {model.swatches.map((color, index) => (
        <rect key={`${color}-${index}`} x={index * stripe} y="48" width={stripe} height="8" fill={color} />
      ))}
      <ellipse cx="36" cy="29" rx="14" ry="17" fill="#F3E3D3" stroke="#8B93B8" />
      <ellipse cx="30" cy="25" rx="4" ry="2.5" fill={model.eyes} />
      <ellipse cx="42" cy="25" rx="4" ry="2.5" fill={model.eyes} />
      <circle cx="28" cy="33" r="3.5" fill={model.cheeks} opacity="0.6" />
      <circle cx="44" cy="33" r="3.5" fill={model.cheeks} opacity="0.6" />
      <ellipse cx="36" cy="39" rx="5" ry="2.5" fill={model.lips} />
      <text x="36" y="9" textAnchor="middle" fontSize="9" fill="#10142A">
        {model.glyphs.join(" ")}
      </text>
    </svg>
  );
}
