import type { Metadata } from "next";
import { Model3dStudio } from "@/components/model3d/model3d-studio";
import { getModel } from "@/lib/catalog";
import { MODELS_3D } from "@/lib/av/model3d";

export const metadata: Metadata = { title: "Image to 3D" };

/** The page passes the 3D models' names, so the client doesn't load the catalog. */
export default function Page() {
  const names = Object.fromEntries([...MODELS_3D.cloud, ...MODELS_3D.open].map((m) => [m.id, getModel(m.id)?.name ?? m.id]));
  return <Model3dStudio names={names} />;
}
