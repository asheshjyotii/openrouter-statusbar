/**
 * openrouter-statusbar — a minimal one-line status bar for Pi.
 *
 *   ../first/second (main)   kimi-k2.6 · high · ━━━━━━━━━━────────── 52% · 104k/200k · $0.003/$3.41
 *
 * Colour is deliberately quiet: everything is dim gray (#6b7280) except the
 * directory (normal foreground) and the context bar, the single state accent
 * (dim below 50%, yellow 50-80%, red above 80%). `·` separators sit one shade
 * darker. Honours NO_COLOR and falls back to 16-colour ANSI without truecolor.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { rgbColor, truncateToWidth, visibleWidth, type Color } from "@earendil-works/pi-tui";

const CONTEXT_BAR_WIDTH = 20;
const CREDITS_TTL_MS = 60_000;

/** Dim gray for everything by default. */
const DIM = rgbColor(0x6b, 0x72, 0x80);
/** One shade darker for the `·` separators. */
const DARKER = rgbColor(0x4b, 0x55, 0x63);

// --- Pure formatting helpers -------------------------------------------------

/** `../second-to-last/last` */
export function shortDir(cwd: string): string {
	const parts = cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
	if (parts.length === 0) return "/";
	if (parts.length === 1) return parts[0];
	if (parts.length === 2) return parts.join("/");
	return `../${parts.slice(-2).join("/")}`;
}

/** `provider/model` -> `model` */
export function shortModel(id: string | undefined): string {
	if (!id) return "no-model";
	const slash = id.lastIndexOf("/");
	return slash >= 0 ? id.slice(slash + 1) : id;
}

/** 999 -> "999", 11100 -> "11k", 1049000 -> "1M", 1500000 -> "1.5M" */
export function fmtTokens(n: number | null | undefined): string {
	if (n === null || n === undefined || !isFinite(n)) return "?";
	if (n < 1000) return String(Math.round(n));
	const k = n / 1000;
	if (k < 999.5) return scaleNumber(k) + "k";
	return scaleNumber(n / 1_000_000) + "M";
}

/** One decimal below 10 (trailing `.0` dropped), whole numbers above. */
function scaleNumber(v: number): string {
	if (v >= 10) return String(Math.round(v));
	return v.toFixed(1).replace(/\.0$/, "");
}

/** Money: 3 decimals below $0.01, otherwise 2. */
export function fmtMoney(v: number): string {
	if (!isFinite(v)) return "?";
	if (v === 0) return "0.00";
	return v.toFixed(Math.abs(v) < 0.01 ? 3 : 2);
}

export type ContextState = "ok" | "warn" | "high";

/** dim < 50%, yellow 50-80%, red > 80%. `null` when usage is unknown. */
export function contextState(percent: number | null | undefined): ContextState | null {
	if (percent === null || percent === undefined || !isFinite(percent)) return null;
	if (percent > 80) return "high";
	if (percent >= 50) return "warn";
	return "ok";
}

/** `━━━━━━━━━━──────────` (caller appends the integer percent). */
export function contextBar(percent: number | null | undefined): string {
	const empty = "─".repeat(CONTEXT_BAR_WIDTH);
	if (percent === null || percent === undefined || !isFinite(percent)) return empty;
	const p = Math.min(100, Math.max(0, percent));
	const filled = Math.round((p / 100) * CONTEXT_BAR_WIDTH);
	return "━".repeat(filled) + "─".repeat(CONTEXT_BAR_WIDTH - filled);
}

// --- Colour ------------------------------------------------------------------

export type ColorTier = "none" | "truecolor" | "16";

/**
 * `none` when NO_COLOR is set to a non-empty value, `truecolor` when the
 * terminal reports it, otherwise the 16-colour ANSI fallback (which also reads
 * fine on 256-colour terminals).
 */
export function detectColorTier(theme?: Pick<Theme, "getColorMode">): ColorTier {
	const noColor = process.env.NO_COLOR;
	if (typeof noColor === "string" && noColor !== "") return "none";
	try {
		if (theme?.getColorMode?.() === "truecolor") return "truecolor";
	} catch {
		// fall through to the safe default
	}
	return "16";
}

export interface Palette {
	dim(text: string): string;
	darker(text: string): string;
	yellow(text: string): string;
	red(text: string): string;
}

const TRUE_COLOR_DARK = { yellow: rgbColor(0xea, 0xb3, 0x08), red: rgbColor(0xef, 0x44, 0x44) };
const TRUE_COLOR_LIGHT = { yellow: rgbColor(0xb4, 0x53, 0x09), red: rgbColor(0xb9, 0x1c, 0x1c) };

/** Style closures for the current theme; cache and drop them in `invalidate()`. */
export function makePalette(theme: Theme): Palette {
	const tier = detectColorTier(theme);

	if (tier === "none") {
		const identity = (text: string) => text;
		return { dim: identity, darker: identity, yellow: identity, red: identity };
	}

	if (tier === "truecolor") {
		const accents = theme.appearance === "light" ? TRUE_COLOR_LIGHT : TRUE_COLOR_DARK;
		const fg = (color: Color) => (text: string) => theme.style(text, { fg: color });
		return { dim: fg(DIM), darker: fg(DARKER), yellow: fg(accents.yellow), red: fg(accents.red) };
	}

	const wrap = (open: string) => (text: string) => (text ? `\x1b[${open}m${text}\x1b[0m` : text);
	return { dim: wrap("90"), darker: wrap("2;90"), yellow: wrap("33"), red: wrap("31") };
}

// --- Extension ---------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let requestRender: (() => void) | undefined;

	// --- OpenRouter remaining credits ---------------------------------------
	let remainingCredits: number | null = null;
	let creditsFetchedAt = 0;
	let creditsInFlight = false;

	function getApiKey(): string | undefined {
		if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
		// zero-config fallback: pi's auth store (~/.pi/agent/auth.json)
		try {
			const path = join(process.env.HOME ?? "", ".pi", "agent", "auth.json");
			const auth = JSON.parse(readFileSync(path, "utf8")) as {
				openrouter?: { key?: unknown };
			};
			const key = auth?.openrouter?.key;
			return typeof key === "string" ? key : undefined;
		} catch {
			return undefined;
		}
	}

	async function refreshCredits(): Promise<void> {
		const key = getApiKey();
		if (!key || creditsInFlight) return;
		if (Date.now() - creditsFetchedAt < CREDITS_TTL_MS) return;
		creditsInFlight = true;
		try {
			const res = await fetch("https://openrouter.ai/api/v1/credits", {
				headers: { Authorization: `Bearer ${key}` },
			});
			if (res.ok) {
				const json = (await res.json()) as {
					data?: { total_credits?: string | number; total_usage?: string | number };
				};
				const d = json?.data;
				if (d) {
					const total = parseFloat(String(d.total_credits ?? "0"));
					const used = parseFloat(String(d.total_usage ?? "0"));
					if (!isNaN(total) && !isNaN(used)) {
						remainingCredits = total - used;
						creditsFetchedAt = Date.now();
					}
				}
			}
		} catch {
			// network hiccup: keep the last value and retry next cycle
		} finally {
			creditsInFlight = false;
		}
	}

	// --- session cost (current branch) ---------------------------------------
	function sessionCost(ctx: ExtensionContext): number {
		let cost = 0;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				cost += entry.message.usage?.cost?.total ?? 0;
			}
		}
		return cost;
	}

	// --- mount the status bar ------------------------------------------------
	function mountFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			requestRender = () => tui.requestRender();

			let palette: Palette | undefined;
			const colors = () => (palette ??= makePalette(theme));

			const timer = setInterval(() => {
				refreshCredits().then(() => tui.requestRender());
			}, CREDITS_TTL_MS);
			refreshCredits().then(() => tui.requestRender());

			return {
				dispose() {
					unsubBranch();
					clearInterval(timer);
					requestRender = undefined;
				},
				invalidate() {
					palette = undefined;
				},
				render(width: number): string[] {
					const p = colors();
					const sep = ` ${p.darker("·")} `;

					// left: ../first/second (branch)
					let left = shortDir(ctx.cwd);
					const branch = footerData.getGitBranch();
					if (branch) left += ` ${p.dim(`(${branch})`)}`;

					// right: model · thinking · bar pct · tokens · $cost/$remaining
					const segments: string[] = [];

					const model = shortModel(ctx.model?.id);
					const level = ctx.thinkingLevel;
					segments.push(level ? `${p.dim(model)} ${p.darker("·")} ${p.dim(level)}` : p.dim(model));

					const usage = ctx.getContextUsage();
					const percent = usage?.percent ?? null;
					const state = contextState(percent);
					const accent = state === "high" ? p.red : state === "warn" ? p.yellow : p.dim;

					if (usage && percent !== null) {
						segments.push(accent(`${contextBar(percent)} ${Math.round(percent)}%`));
						if (usage.tokens !== null) {
							segments.push(p.dim(`${fmtTokens(usage.tokens)}/${fmtTokens(usage.contextWindow)}`));
						}
					} else {
						segments.push(p.dim(contextBar(null)));
					}

					const remaining = remainingCredits;
					segments.push(
						p.dim(`$${fmtMoney(sessionCost(ctx))}/${remaining !== null ? `$${fmtMoney(remaining)}` : "$?"}`),
					);

					const right = segments.join(sep);
					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	}

	// --- lifecycle -------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		mountFooter(ctx);
	});

	pi.on("message_end", async () => {
		requestRender?.();
	});
	pi.on("model_select", async () => {
		requestRender?.();
	});
	pi.on("thinking_level_select", async () => {
		requestRender?.();
	});

	pi.on("agent_end", async () => {
		creditsFetchedAt = 0; // force refresh: usage changed server-side
		await refreshCredits();
		requestRender?.();
	});

	pi.registerCommand("statusbar-openrouter", {
		description: "Re-mount the status bar and refresh OpenRouter credits",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("statusbar-openrouter only applies in TUI mode", "info");
				return;
			}
			creditsFetchedAt = 0;
			await refreshCredits();
			mountFooter(ctx);
			requestRender?.();
			ctx.ui.notify(
				remainingCredits !== null
					? `statusbar-openrouter re-mounted. OpenRouter remaining: $${fmtMoney(remainingCredits)}`
					: "statusbar-openrouter re-mounted. Set OPENROUTER_API_KEY to show remaining credits.",
				"info",
			);
		},
	});
}
