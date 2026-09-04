// Shared exercise line-art grammar, extracted from ExerciseVisual so the
// Add-Exercise picker thumbnails reuse the exact same movement figures as the
// coach programme surfaces. Pure presentational SVG: the figure inherits its
// stroke color via currentColor and is always aria-hidden (the accessible name
// of any surrounding control comes from the exercise text).
export type MovementVariant = "bench" | "press" | "fly" | "pull" | "row" | "squat" | "legpress" | "lunge" | "hinge" | "curl" | "calf" | "core" | "carry";

/** Deterministic movement family for an exercise name (same rules as before). */
export function movementVariantFor(name: string): MovementVariant {
  const value = name.toLowerCase();
  if (value.includes("bench") || value.includes("hip thrust")) return "bench";
  if (value.includes("overhead press")) return "press";
  if (value.includes("fly") || value.includes("lateral raise")) return "fly";
  if (value.includes("pull-up") || value.includes("pulldown")) return "pull";
  if (value.includes("row")) return "row";
  if (value.includes("leg press")) return "legpress";
  if (value.includes("split squat") || value.includes("lunge")) return "lunge";
  if (value.includes("squat")) return "squat";
  if (value.includes("deadlift")) return "hinge";
  if (value.includes("curl") || value.includes("pressdown") || value.includes("extension")) return "curl";
  if (value.includes("calf")) return "calf";
  if (value.includes("plank") || value.includes("crunch")) return "core";
  if (value.includes("carry")) return "carry";
  return "press";
}

/** The movement figure. Intended for small neutral tiles; never aria-labelled here. */
export function ExerciseFigure({ variant }: { variant: MovementVariant }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (variant === "bench") return <g {...common}><path d="M37 119h141M58 105h100M70 105V87m79 18V87M67 76h82M91 76l18-13 27 4M109 63l-6-17m33 21 12-18M55 46h109M55 38v16m109-16v16"/><circle cx="143" cy="61" r="10"/></g>;
  if (variant === "press") return <g {...common}><circle cx="111" cy="42" r="11"/><path d="M111 54v43m0 0-25 33m25-33 25 33M111 67 83 48m28 19 28-19M75 39h17m38 0h17M75 33v12m72-12v12"/></g>;
  if (variant === "fly") return <g {...common}><circle cx="111" cy="43" r="11"/><path d="M111 55v43m0 0-23 32m23-32 23 32M111 69 68 62m43 7 43-7M57 54v16m108-16v16"/></g>;
  if (variant === "pull") return <g {...common}><path d="M54 29h114M62 29v12m98-12v12"/><circle cx="111" cy="59" r="10"/><path d="M104 52 77 34m41 18 27-18M111 70v36m0 0-22 26m22-26 22 26"/></g>;
  if (variant === "row") return <g {...common}><circle cx="78" cy="60" r="10"/><path d="M87 66 112 84m-25-18-9 42m34-24 34-7m-34 7-19 27m19-27 13 29M45 118h104M145 68v20"/></g>;
  if (variant === "squat") return <g {...common}><circle cx="111" cy="43" r="10"/><path d="M111 54v36m0-24-31 10m31-10 31 10M80 76h62M111 90 83 108m28-18 28 18m-56 0 19 24m37-24-19 24M69 68v16m84-16v16"/></g>;
  if (variant === "legpress") return <g {...common}><circle cx="73" cy="75" r="10"/><path d="M82 80 105 99m-23-19-10 34m33-15 30-28m-30 28 29 10M139 55l22 22m-31-31 40 40M45 119h68"/></g>;
  if (variant === "lunge") return <g {...common}><circle cx="111" cy="40" r="10"/><path d="M111 51v45m0-31-25 13m25-13 25 13M111 96 78 113m33-17 35 27m-68-10-17 17m85-7h22M78 70v16m66-16v16"/></g>;
  if (variant === "hinge") return <g {...common}><circle cx="88" cy="52" r="10"/><path d="M96 58 126 78m-30-20-9 43m39-23 22 20m-61 3-17 29m17-29 28 29M61 98h100M61 91v14m100-14v14"/></g>;
  if (variant === "curl") return <g {...common}><circle cx="111" cy="42" r="10"/><path d="M111 53v45m0 0-21 32m21-32 21 32M111 66 84 83m27-17 27 17M84 83l11-20m43 20-11-20M78 52h14m38 0h14"/></g>;
  if (variant === "calf") return <g {...common}><circle cx="111" cy="39" r="10"/><path d="M111 50v47m0-31-24 18m24-18 24 18M111 97 91 127m20-30 20 30M79 129h65M91 127v-12m40 12v-12"/></g>;
  if (variant === "core") return <g {...common}><circle cx="61" cy="77" r="10"/><path d="M71 81 113 94l43 2M113 94 96 119m60-23 18 24M44 122h145"/></g>;
  return <g {...common}><circle cx="111" cy="41" r="10"/><path d="M111 52v47m0-31-27 20m27-20 27 20M111 99 88 131m23-32 23 32M76 88v33m70-33v33M68 121h16m54 0h16"/></g>;
}
