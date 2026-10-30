import { useState } from "react";
import type { FormEvent } from "react";
import { AVATAR_DESCRIPTION_MAX } from "@look-studio/shared";
import type { AvatarConcept } from "@look-studio/shared";
import { BUILD_NOTE, buildingLabel } from "../studio/avatar-flow.ts";
import { PHOTO_TYPES, checkPhoto, photoProblemMessage, readPhoto } from "../studio/photo.ts";
import { useAvatarBuilder } from "../studio/use-avatar-builder.ts";
import Window from "./Window.tsx";

function ConceptImage({ concept, index }: { concept: AvatarConcept; index: number }) {
  return <img className="avatar__concept-img" src={concept.image} alt={`Avatar concept ${index + 1}`} />;
}

function DescribeForm({ error, onDraw }: { error: string | null; onDraw: (description: string, photo: string | undefined) => void }) {
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const choosePhoto = async (file: File | undefined) => {
    setPhotoError(null);
    if (file === undefined) {
      return;
    }
    const problem = checkPhoto(file);
    if (problem !== null) {
      setPhotoError(photoProblemMessage(problem));
      return;
    }
    try {
      setPhoto(await readPhoto(file));
    } catch {
      setPhotoError("That photo couldn't be read.");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (description.trim() !== "") {
      onDraw(description.trim(), photo);
    }
  };

  return (
    <form className="avatar__form" onSubmit={submit}>
      <label htmlFor="avatar-description">Describe your character</label>
      <textarea
        id="avatar-description"
        rows={3}
        maxLength={AVATAR_DESCRIPTION_MAX}
        value={description}
        placeholder="A cheerful fox barista with a green apron and round glasses"
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="avatar__row">
        <label className="btn btn--small btn--file">
          {photo === undefined ? "Outfit photo (optional)" : "✓ Photo added"}
          <input
            type="file"
            accept={PHOTO_TYPES.join(",")}
            className="sr-only"
            onChange={(event) => {
              void choosePhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        {photo !== undefined && (
          <button type="button" className="btn btn--small" onClick={() => setPhoto(undefined)}>
            Remove photo
          </button>
        )}
      </div>
      <p className="avatar__note">A photo only guides the outfit and colours. Faces are never copied, and your photo never goes to the 3D service.</p>
      {(photoError ?? error) !== null && (
        <p className="avatar__error" role="alert">
          {photoError ?? error}
        </p>
      )}
      <button type="submit" className="btn btn--big" disabled={description.trim() === ""}>
        ✦ Draw 3 concepts
      </button>
    </form>
  );
}

export default function AvatarWindow({ onModel }: { onModel: (model: ArrayBuffer) => void }) {
  const { flow, draw, pick, back, build, stop } = useAvatarBuilder(onModel);

  return (
    <Window id="avatar" title="Avatar Maker" icon="🧸" flavor="lime" className="win--avatar">
      <div className="avatar" aria-live="polite">
        {flow.step === "describe" && <DescribeForm error={flow.error} onDraw={draw} />}
        {flow.step === "drawing" && (
          <div className="avatar__wait">
            <p role="status">Muse Image is drawing 3 concepts…</p>
            <button type="button" className="btn" onClick={stop}>
              Cancel
            </button>
          </div>
        )}
        {flow.step === "choose" && (
          <fieldset className="avatar__choose">
            <legend>Pick a concept to build</legend>
            <div className="avatar__concepts">
              {flow.concepts.map((concept, index) => (
                <button key={concept.id} type="button" className="avatar__concept" onClick={() => pick(concept.id)}>
                  <ConceptImage concept={concept} index={index} />
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--small" onClick={stop}>
              Start over
            </button>
          </fieldset>
        )}
        {flow.step === "confirm" && (
          <div className="avatar__confirm">
            <ConceptImage concept={flow.concept} index={flow.concepts.indexOf(flow.concept)} />
            <div>
              <p>{BUILD_NOTE}</p>
              {flow.error !== null && (
                <p className="avatar__error" role="alert">
                  {flow.error}
                </p>
              )}
              <div className="avatar__row">
                <button type="button" className="btn btn--big" onClick={build}>
                  Build 3D avatar
                </button>
                <button type="button" className="btn" onClick={back}>
                  Back
                </button>
              </div>
            </div>
          </div>
        )}
        {flow.step === "building" && (
          <div className="avatar__wait">
            <label htmlFor="avatar-progress">{buildingLabel(flow.stage, flow.progress)}</label>
            <progress id="avatar-progress" max={100} value={flow.progress} />
            <button type="button" className="btn btn--small" onClick={stop}>
              Stop waiting
            </button>
          </div>
        )}
        {flow.step === "ready" && (
          <div className="avatar__wait">
            <p role="status">Your avatar is ready. 🧸 Avatar mode is on in LookCam.</p>
            <button type="button" className="btn btn--small" onClick={stop}>
              Make another
            </button>
          </div>
        )}
      </div>
    </Window>
  );
}
