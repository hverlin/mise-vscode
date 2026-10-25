import { describe, expect, it } from "bun:test";
import { coalesceRuns } from "./fn";

describe("coalesceRuns", () => {
	/** A run that waits for `finish`, counting how many were started */
	const createRun = () => {
		const finishes: Array<(error?: Error) => void> = [];
		const run = () =>
			new Promise<void>((resolve, reject) => {
				finishes.push((error) => (error ? reject(error) : resolve()));
			});
		const finish = async (error?: Error) => {
			finishes[finishes.length - 1]?.(error);
			// the next run starts once the promises have settled
			await new Promise((resolve) => setTimeout(resolve, 0));
		};
		return { run, finish, started: () => finishes.length };
	};

	it("runs at once when nothing runs", async () => {
		const { run, finish, started } = createRun();
		const request = coalesceRuns(run, 60_000);

		const done = request();
		expect(started()).toBe(1);
		await finish();
		await done;
	});

	it("gives a request made while it runs a run of its own", async () => {
		const { run, finish, started } = createRun();
		const request = coalesceRuns(run, 60_000);
		let askedDone = false;

		const running = request();
		const asked = request().then(() => {
			askedDone = true;
		});
		await finish();
		await running;
		expect(started()).toBe(2);
		expect(askedDone).toBe(false);

		await finish();
		await asked;
		expect(askedDone).toBe(true);
	});

	it("has the requests made while it runs share one more run", async () => {
		const { run, finish, started } = createRun();
		const request = coalesceRuns(run, 60_000);

		const running = request();
		const storm = [request(), request(), request()];
		await finish();
		await finish();
		await Promise.all([running, ...storm]);
		expect(started()).toBe(2);
	});

	it("starts a new run for a request made after the last one", async () => {
		const { run, finish, started } = createRun();
		const request = coalesceRuns(run, 60_000);

		const first = request();
		await finish();
		await first;
		const second = request();
		expect(started()).toBe(2);
		await finish();
		await second;
	});

	it("still runs the next one when a run fails", async () => {
		const { run, finish, started } = createRun();
		const request = coalesceRuns(run, 60_000);

		const failing = request();
		const asked = request();
		await finish(new Error("mise failed"));
		await expect(failing).rejects.toThrow("mise failed");
		expect(started()).toBe(2);

		await finish();
		await asked;
		const after = request();
		expect(started()).toBe(3);
		await finish();
		await after;
	});

	it("stops holding the next run back once a run hangs too long", async () => {
		const { run, finish, started } = createRun();
		const request = coalesceRuns(run, 20);

		void request();
		const asked = request();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(started()).toBe(2);

		await finish();
		await asked;
	});
});
