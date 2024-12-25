import vscode, { type ColorThemeKind } from "vscode";

const SVG_ICONS = {
	"arrow-circle-up":
		'<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M5.36891 7.91926L7.50833 5.77984V11.532H8.50833V5.85271L10.5749 7.91926L11.282 7.21216L8.32545 4.25562H7.61835L4.6618 7.21216L5.36891 7.91926Z"/><path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8ZM13 8C13 5.23858 10.7614 3 8 3C5.23858 3 3 5.23858 3 8C3 10.7614 5.23858 13 8 13C10.7614 13 13 10.7614 13 8Z"/></svg>',
	warning:
		'<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4h-1.25z"/></svg>',
} as const;

export function getSvgIcon(
	activeColorThemeKind: ColorThemeKind,
	iconId: keyof typeof SVG_ICONS,
): string {
	const svgData = `data:image/svg+xml;utf8,${encodeURIComponent(SVG_ICONS[iconId])}`;

	return activeColorThemeKind === vscode.ColorThemeKind.Light
		? svgData.replace("currentColor", "rgba(0,0,0,0.5)")
		: svgData.replace("currentColor", "rgba(255,255,255,0.5)");
}
