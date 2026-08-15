import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#10140e", color: "#c4ff36", display: "flex", fontSize: 210, fontWeight: 800, height: "100%", justifyContent: "center", letterSpacing: "-22px", width: "100%" }}>JF</div>,
    size,
  );
}
