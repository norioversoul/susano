import type { Metadata } from "next";
import { Cinematic } from "./Cinematic";

export const metadata: Metadata = { title: "Cinematic · Susano" };

export default function CinematicPage() {
  return <Cinematic />;
}
