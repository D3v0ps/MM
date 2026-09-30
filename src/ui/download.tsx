"use client";
// Nedladdning och kopiering. Skärmar använder aldrig <a download> direkt – de anropar useDownload().
// Riktiga appen: Blob + tillfällig länk (standard, ingen provider behövs).
// Prototypen: DownloadProvider med artefaktens nedladdningsfunktion, annars textdialog att kopiera från (src/demo).
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { toast } from "./toast";

export type DownloadFile = { filename: string; content: string | Blob; mime?: string };
/** Sparar filen. Returnerar true om den sparades (eller lämnades till webbläsaren). */
export type DownloadImpl = (file: DownloadFile) => Promise<boolean>;

/** Standard i riktiga appen: Blob + tillfällig länk. Textfiler får BOM så att Excel läser å, ä och ö rätt. */
export const blobDownload: DownloadImpl = async ({ filename, content, mime = "text/csv;charset=utf-8" }) => {
  try {
    const blob = typeof content === "string" ? new Blob([mime.startsWith("text/") ? `﻿${content}` : content], { type: mime }) : content;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Filen ${filename} laddas ned.`);
    return true;
  } catch {
    toast("Filen kunde inte laddas ned. Försök igen.", "error");
    return false;
  }
};

const DownloadContext = createContext<DownloadImpl>(blobDownload);

/** Byt hur filer sparas (prototypen). Utan provider används blobDownload. */
export function DownloadProvider({ impl, children }: { impl: DownloadImpl; children: ReactNode }) {
  return <DownloadContext.Provider value={impl}>{children}</DownloadContext.Provider>;
}

/** const download = useDownload(); await download("fakturaunderlag-2027-01.csv", csv); */
export function useDownload() {
  const impl = useContext(DownloadContext);
  return useCallback((filename: string, content: string | Blob, mime?: string) => impl({ filename, content, mime }), [impl]);
}

/** const copy = useCopy(); await copy(text) – visar "Kopierat." eller ett fel. */
export function useCopy() {
  return useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Kopierat.");
      return true;
    } catch {
      toast("Kunde inte kopiera automatiskt. Markera texten och kopiera själv.", "error");
      return false;
    }
  }, []);
}
