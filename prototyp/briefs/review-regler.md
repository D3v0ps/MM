# Granskning: regler och kravspecifikation (ditt namn: regler)
Läs först /home/user/MM/prototyp/briefs/_review-common.md.
Granska ALLA vyer mot CLAUDE-projekt.md "Icke förhandlingsbart" (1–12), "Design", "Språk och ton" och SPEC.md §4, §7, §8, §10. Kontrollera särskilt, både i källkoden och i körning:
- Behörighet per roll (sel.access): ekonom ser inga namn/anteckningar/rapporter; handledare bara tilldelade ärenden; skyddade ärenden bara för namngiven coach och avtalsansvarig; kommunens handläggare bara egna ärenden och inga coachanteckningar; coach/handledare ser ALDRIG eskaleringar till chef (sök efter "eskaler", no_progress_escalated, progress_escalation i vyerna och kör som coach).
- Inga personuppgifter i utskick (st.notifications, ctx.notify-anrop, mallar), i toasts eller i URL/logg. Personnummer maskeras och "Visa" loggas.
- Det interna målet 35 % (internalTarget) syns aldrig i kundens vyer (kom.*, rapport.visa som kommunroll, beställarrapport).
- AI: nivåer, samlad status, avslutsorsak och resultat är tomma tills coachen valt; AI-förslag har belägg; ingen AI för skyddade ärenden; samtycke krävs.
- Rapporter byggs bara av godkända uppgifter (kolla rapport.visa för månadsrapport med utkast).
- Avtalsvärden hårdkodas inte (sök efter 0.32, 0.35, 32, 35, 'BOT', priser, 8–10, 99, '10:00', '16:00' i vyerna – de ska komma från MM.cfg()/sel).
- Fakturaregler (§7.15): beställarreferens krävs, inköpsordernummer bara 99xxxxxxx, ärendenummer som faktureringsobjekt, en faktura per ärende och månad, torsdagsregeln, inga namn på fakturor.
- Färger: bara MB-profilen (grep efter hex-färger och färgnamn i src/views – allt utöver antracit #1E252B, röd #FF0C01/#ED2526, ljusgrå #D1D3D3, blå #6BA2B9, vitt och var(--...) är fel; inget grönt). Status alltid text + ikon.
- Text på svenska i klarspråk; kommunportalen utan förkortningar och med hjälptext vid fält.
Skriv fynden till review/regler.json.
