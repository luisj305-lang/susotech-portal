/**
 * Presentation variant for the administrator dashboard visual refresh.
 *
 * This is a presentation switch only — never an authorization mechanism and
 * never inferred from the current pathname. Only `AdminDashboard` opts in when
 * `profile.role === "admin"`. Every shared consumer keeps `"default"` and its
 * legacy output unchanged.
 */
export type AdminDashboardPresentation = "default" | "admin-dashboard";
