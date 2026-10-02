// Logotypen överst i PDF:erna – samma ordmärke som Brand i src/ui/layout.tsx: "MILJONBEMANNING" i versaler med röd punkt
// (logotypfilernas röda #ED2526), och "Miljonmatch" under. Det här är det enda stället PDF:erna ritar logotypen: byt till den
// riktiga logotypfilen här (<Image src={…} style={{ width: …, height: … }} />) när den finns, så får alla rapporter den.
import { Text, View } from "@react-pdf/renderer";
import { PDF_COLOR, PDF_SIZE } from "./theme";

export function PdfBrand() {
  return (
    <View style={{ flexDirection: "column", gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <Text style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1.1, textTransform: "uppercase", color: PDF_COLOR.antracit }}>Miljonbemanning</Text>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PDF_COLOR.rodLogo, marginLeft: 2, marginBottom: 3 }} />
      </View>
      <Text style={{ fontSize: PDF_SIZE.small, color: PDF_COLOR.muted }}>Miljonmatch</Text>
    </View>
  );
}
