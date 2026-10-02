// Sammanfogar klassnamn och löser Tailwind-konflikter (sista vinner).
// tailwind-merge måste känna till temats egna storlekar – annars tolkas t.ex. `text-label` som en färg
// och tar bort `text-text-muted` (eller tvärtom).
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["label", "meta", "small", "ui", "body", "h1", "h2", "h3", "portal"],
      radius: ["mb", "card"],
      shadow: ["card", "pop"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
