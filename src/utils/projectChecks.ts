import type { KeyPosition, SourcePosition } from "./miseFileParser";

type CheckStatus = MiseProjectCheck["status"];

/** The checks needing attention first */
const STATUS_ORDER: CheckStatus[] = ["fail", "error", "skipped", "pass"];

const STATUS_LABELS: Record<CheckStatus, string> = {
	fail: "failed",
	error: "could not run",
	skipped: "skipped",
	pass: "passed",
};

/** Codicon of each status */
export const PROJECT_CHECK_ICONS: Record<CheckStatus, string> = {
	fail: "error",
	error: "warning",
	skipped: "circle-slash",
	pass: "pass",
};

export function sortProjectChecks(
	checks: MiseProjectCheck[],
): MiseProjectCheck[] {
	return [...checks].sort(
		(a, b) =>
			STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
			a.name.localeCompare(b.name),
	);
}

export const isFailedProjectCheck = (check: MiseProjectCheck) =>
	check.status === "fail" || check.status === "error";

/** e.g. `1 failed, 2 passed`, the checks needing attention first */
export function formatProjectChecksSummary(checks: MiseProjectCheck[]): string {
	return STATUS_ORDER.map((status) => ({
		status,
		count: checks.filter((check) => check.status === status).length,
	}))
		.filter(({ count }) => count > 0)
		.map(({ status, count }) => `${count} ${STATUS_LABELS[status]}`)
		.join(", ");
}

/** What went wrong and what to do about it */
export function formatProjectCheckDetail(check: MiseProjectCheck): string {
	return [check.message, check.hint ? `Hint: ${check.hint}` : undefined]
		.filter(Boolean)
		.join(" · ");
}

/** Position of the `[doctor.checks.<name>]` declaring a check */
export function findProjectCheckPosition(
	positions: KeyPosition[],
	name: string,
): SourcePosition | undefined {
	return positions.find(
		({ key }) =>
			key.length === 3 &&
			key[0] === "doctor" &&
			key[1] === "checks" &&
			key[2] === name,
	)?.keyStart;
}
