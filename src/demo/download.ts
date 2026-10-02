// Nedladdning i prototypen (som den gamla prototypens MM.download): artefaktens nedladdning i claude.ai,
// annars en dialog med texten att kopiera. Kopplas in med <DownloadProvider impl={artifactDownload}> i main.tsx.
//
// claude.ai:s downloads-förmåga (runtime 0.2.x, downloads.d.ts) tar emot text eller binärt innehåll direkt:
// save({ filename, data: string | Blob | ArrayBuffer | ArrayBufferView }). MIME-typen tas från filändelsen (.pdf och .csv är
// tillåtna) – en Blob skickas som den är, så en PDF behöver ingen base64. Binära filer utan förmågan sparas med webbläsarens
// nedladdning (de kan inte visas som text att kopiera).
import { blobDownload, toBlob, type DownloadImpl } from "@/ui/download";
import { showText } from "@/ui/dialog";
import { toast } from "@/ui/toast";
import { getCapability } from "./claude-runtime";

export const artifactDownload: DownloadImpl = async ({ filename, content, mime = "text/csv;charset=utf-8" }) => {
  try {
    const dl = await getCapability("downloads");
    if (dl) {
      // Textfiler får BOM så att Excel läser å, ä och ö rätt (samma som i riktiga appen). Binärt skickas orört.
      await dl.save({ filename, data: toBlob(content, mime) });
      toast(`Filen ${filename} är sparad.`);
      return true;
    }
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === "string" && /cancel|declin|denied/i.test(code)) {
      toast("Nedladdningen avbröts.", "error");
      return false;
    }
  }
  if (typeof content !== "string") return blobDownload({ filename, content, mime });
  showText({ title: `Innehåll i ${filename}`, text: content, note: "Filen kunde inte sparas direkt här. Kopiera innehållet i stället." });
  return false;
};
