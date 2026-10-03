// Visningsloggens minne per sidbesök (useAuditView i src/ui/case.tsx): deltagarkort, rapport och transkript loggas en gång
// per besök på sidan – inte en gång per omrendering och inte en gång per webbläsarsession. Sedan sidbytena blev grunda
// (D0 1.1) lever modulerna hela sessionen, så minnet måste tömmas när skalet visar en annan sida (usePageEffects i
// page-effects.tsx). Byte av bara query (flik, filter) är samma besök och tömmer inte. Bara nycklar – inga personuppgifter.
const seen = new Set<string>();

export const auditViewSeen = (key: string): boolean => seen.has(key);
export const markAuditView = (key: string): void => {
  seen.add(key);
};
/** Nytt sidbesök: töm minnet så att samma kort, rapport eller transkript loggas igen när det visas på nytt. */
export function resetAuditViews(): void {
  seen.clear();
}
