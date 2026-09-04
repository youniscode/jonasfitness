import { ExerciseFigure, movementVariantFor } from "./exercise-figure";

type Props = {
  name: string;
  imageUrl?: string;
  compact?: boolean;
};

export default function ExerciseVisual({ name, imageUrl = "", compact = false }: Props) {
  if (imageUrl) return <div className={`exercise-visual-image${compact ? " compact" : ""}`} role="img" aria-label={name} style={{ backgroundImage: `linear-gradient(180deg,transparent,rgba(14,17,12,.7)),url(${imageUrl})` }} />;
  return <div className={`exercise-visual-svg${compact ? " compact" : ""}`} role="img" aria-label={`${name} exercise illustration`}><svg viewBox="0 0 220 160" aria-hidden="true"><path className="visual-grid" d="M20 135h180M20 105h180M20 75h180M20 45h180"/><ExerciseFigure variant={movementVariantFor(name)} /></svg><span>{name}</span></div>;
}
