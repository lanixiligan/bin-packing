// Placard colours for DG class diamonds (shared by DgBadge and the checker page).
/** Placard fill per Table 9.1 column (6.1 / 6.2 share "6"), plus food and fire-risk icons. */
export const DG_FILL: Record<string, string> = {
  "1": "#F7941D", "2.1": "#E2231A", "2.2": "#00A651", "2.3": "#FFFFFF", "3": "#E2231A",
  "4.1": "repeating-linear-gradient(90deg,#E2231A 0 3px,#FFFFFF 3px 6px)",
  "4.2": "linear-gradient(180deg,#FFFFFF 50%,#E2231A 50%)", "4.3": "#0072BC", "5.1": "#FFD200",
  "5.2": "linear-gradient(180deg,#E2231A 50%,#FFD200 50%)", "6": "#FFFFFF", "6.1": "#FFFFFF", "6.2": "#FFFFFF",
  "7": "linear-gradient(180deg,#FFD200 50%,#FFFFFF 50%)", "8": "linear-gradient(180deg,#FFFFFF 50%,#111111 50%)",
  "9": "linear-gradient(180deg,transparent 50%,#FFFFFF 50%),repeating-linear-gradient(90deg,#111111 0 3px,#FFFFFF 3px 6px)",
};
export const DG_ICON: Record<string, string> = { F: "\u{1F37D}️", R: "\u{1F525}" };
