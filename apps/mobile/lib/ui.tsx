import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme, type ViewStyle } from "react-native";

export function useTheme() {
  const dark = useColorScheme() === "dark";
  return dark
    ? { bg: "#0d1016", surface: "#151a22", text: "#e8ebf1", muted: "#9aa4b5", border: "#262d39", accent: "#748ffc", accentInk: "#0d1016", ok: "#4ade80", warn: "#fbbf24", bad: "#f87171" }
    : { bg: "#f6f7f9", surface: "#ffffff", text: "#12151b", muted: "#5b6474", border: "#e3e6eb", accent: "#3b5bdb", accentInk: "#ffffff", ok: "#15703c", warn: "#a15c00", bad: "#b42318" };
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function Button({ title, onPress, primary, disabled, busy }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; busy?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: primary ? t.accent : t.surface, borderColor: primary ? t.accent : t.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      {busy ? <ActivityIndicator color={primary ? t.accentInk : t.text} /> : <Text style={{ color: primary ? t.accentInk : t.text, fontWeight: "600", fontSize: 16 }}>{title}</Text>}
    </Pressable>
  );
}

export function T({ children, muted, size = 15, bold, color }: { children: React.ReactNode; muted?: boolean; size?: number; bold?: boolean; color?: string }) {
  const t = useTheme();
  return <Text style={{ color: color ?? (muted ? t.muted : t.text), fontSize: size, fontWeight: bold ? "700" : "400", lineHeight: size * 1.4 }}>{children}</Text>;
}

export const ASSESS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  no_major_conflicts: { label: "No major conflicts detected", tone: "ok" },
  additional_verification_recommended: { label: "Additional verification recommended", tone: "warn" },
  high_risk_inconsistencies: { label: "High-risk inconsistencies detected", tone: "bad" },
  unable_to_assess: { label: "Unable to assess reliably", tone: "muted" },
};
export const STATUS: Record<string, string> = {
  consistent: "Consistent", potential_discrepancy: "Potential discrepancy", inconclusive: "Inconclusive",
  not_visible: "Not visible", not_supported_by_device: "Not supported by device", not_applicable: "Not applicable",
};

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  btn: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
