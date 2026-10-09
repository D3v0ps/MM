# Inspelningen för utringning (46elks)

Den här mappen är en platshållare. Inspelningen spelas in av Miljonbemanning och läggs här innan utringningen kopplas på.

## Vilken inspelning som behövs

En kort inspelning på svenska, högst 15 sekunder. Inga namn, inga personnummer och inget om vad insatsen gäller. Ingen tid och ingen plats – de står i SMS:et och mejlet. Förslag på text:

> Hej, det här är Miljonbemanning. Du har fått en inbjudan till ett möte hos oss. Tid och plats står i ditt SMS eller mejl. Har du frågor, ring 08-400 22 750.

Samma inspelning används för kallelsen till första mötet och för inbjudningar till aktiviteter.

## Fil och adress

- Format: MP3 (eller WAV), mono, tydligt ljud utan musik.
- Filnamn: `kallelse.mp3` i den här mappen (`public/ljud/kallelse.mp3`).
- Adressen blir `https://www.miljonmatch.se/ljud/kallelse.mp3` (produktion: appens adress + `/ljud/kallelse.mp3`). Sökvägen `/ljud/` är öppen utan inloggning (`src/proxy.ts`), så att 46elks kan hämta filen.
- Lägg adressen i Vercel som `MM_CALL_AUDIO_URL` (måste börja med `https://`). Utringningen är avstängd tills `MM_CALL_AUDIO_URL`, `MM_CALL_FROM` (ett nummer hos 46elks) och inloggningen hos 46elks (`ELKS_API_USERNAME`, `ELKS_API_PASSWORD`) finns.

Mer: `docs/DRIFT.md` avsnitt 13.
