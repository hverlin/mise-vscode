// Records the window to a video, through the screencast of its page, and
// joins the videos.
//
// The mouse of the shots is synthetic, so no pointer shows: one is drawn in
// the page, and moves along with the mouse. A caption tells what a scene
// shows.
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const fps = 30;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** adds the pointer, the caption, and the text cursor to the page */
const addOverlay = () => {
	const style = document.createElement("style");
	style.id = "video-style";
	style.textContent = `
		#video-pointer {
			position: fixed; left: 0; top: 0; z-index: 2147483647;
			pointer-events: none; transform-origin: 1px 1px;
			filter: drop-shadow(0 1px 2px #0008);
		}
		.video-ripple {
			position: fixed; z-index: 2147483646; pointer-events: none;
			width: 36px; height: 36px; border-radius: 50%;
			border: 2px solid #fffc; background: #fff3;
		}
		#video-caption {
			position: fixed; left: 50%; bottom: 44px; z-index: 2147483645;
			transform: translateX(-50%); pointer-events: none;
			padding: 8px 18px; border-radius: 8px;
			background: #000d; color: #fff; box-shadow: 0 2px 12px #0008;
			font: 600 17px/1.4 var(--vscode-font-family, system-ui);
			opacity: 0; transition: opacity 250ms;
		}
		/* hidden in the screenshots */
		.monaco-editor .cursors-layer .cursor {
			background-color: #aeafad !important;
			border-color: #aeafad !important;
		}`;
	document.head.append(style);
	const caption = document.createElement("div");
	caption.id = "video-caption";
	document.body.append(caption);
	// an arrow with its tip at (1, 1), built without innerHTML, which the
	// Trusted Types policy of VS Code blocks
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.id = "video-pointer";
	svg.setAttribute("width", "20");
	svg.setAttribute("height", "24");
	const arrow = document.createElementNS(ns, "path");
	arrow.setAttribute("d", "M1 1v17.5l4.6-4.3 3 6.9 3.2-1.4-3-6.8h6.3z");
	arrow.setAttribute("fill", "#111");
	arrow.setAttribute("stroke", "#fff");
	arrow.setAttribute("stroke-width", "1.5");
	arrow.setAttribute("stroke-linejoin", "round");
	svg.append(arrow);
	document.body.append(svg);
};

const removeOverlay = () => {
	for (const id of ["video-style", "video-caption", "video-pointer"]) {
		document.getElementById(id)?.remove();
	}
};

const ripple = ({ x, y }) => {
	const circle = document.createElement("div");
	circle.className = "video-ripple";
	circle.style.left = `${x}px`;
	circle.style.top = `${y}px`;
	document.body.append(circle);
	circle
		.animate(
			[
				{ transform: "translate(-50%, -50%) scale(0.2)", opacity: 0.9 },
				{ transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
			],
			{ duration: 450, easing: "ease-out" },
		)
		.finished.then(() => circle.remove());
};

/** starts ffmpeg, to encode the JPEG frames written to its input */
const encoder = async (file) => {
	const ffmpeg = spawn(
		"ffmpeg",
		[
			"-y",
			"-loglevel",
			"error",
			"-f",
			"image2pipe",
			"-c:v",
			"mjpeg",
			"-framerate",
			String(fps),
			"-i",
			"-",
			"-c:v",
			"libx264",
			"-preset",
			"slow",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			"-f",
			"mp4",
			file,
		],
		{ stdio: ["pipe", "inherit", "inherit"] },
	);
	try {
		await once(ffmpeg, "spawn");
	} catch (error) {
		throw error.code === "ENOENT"
			? new Error("ffmpeg not found in PATH")
			: error;
	}
	// ffmpeg prints why it failed, and exits with an error code
	ffmpeg.stdin.on("error", () => {});
	const exited = new Promise((resolve, reject) =>
		ffmpeg.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`ffmpeg exited with code ${code}`)),
		),
	);
	exited.catch(() => {});
	return { ffmpeg, exited };
};

/** joins the videos `files`, all encoded alike, into `file` */
export function join(files, file) {
	const list = `${file}.txt`;
	writeFileSync(
		list,
		files.map((f) => `file '${f.replaceAll("'", "'\\''")}'\n`).join(""),
	);
	try {
		execFileSync(
			"ffmpeg",
			[
				"-y",
				"-loglevel",
				"error",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				list,
				"-c",
				"copy",
				"-movflags",
				"+faststart",
				"-f",
				"mp4",
				`${file}.part`,
			],
			{ stdio: "inherit" },
		);
		renameSync(`${file}.part`, file);
	} finally {
		rmSync(list, { force: true });
		rmSync(`${file}.part`, { force: true });
	}
}

/**
 * records the window, of `size` logical pixels, to an H.264 mp4 at `file`,
 * with a drawn pointer
 */
export function recorder(page, file, size) {
	let position = { x: size.width * 0.6, y: size.height * 0.4 };
	// times, in seconds since the epoch, left out of the video
	const cuts = [];
	/** `time` once the cuts before it are left out */
	const videoTime = (time) =>
		cuts.reduce(
			(t, cut) =>
				time > cut.from ? t - (Math.min(time, cut.to) - cut.from) : t,
			time,
		);

	const drawPointer = (point, scale = 1) =>
		page.evaluate(
			({ x, y, scale }) => {
				const pointer = document.getElementById("video-pointer");
				pointer.style.transform = `translate(${x - 1}px, ${y - 1}px) scale(${scale})`;
			},
			{ ...point, scale },
		);

	/** the center of `target`, a locator or a point, or `offset` from its top left */
	const pointOf = async (target, offset) => {
		if (!("boundingBox" in target)) {
			return target;
		}
		await target.waitFor();
		const box = await target.boundingBox();
		return offset
			? { x: box.x + offset.x, y: box.y + offset.y }
			: { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};

	const video = {
		/** moves the pointer and the mouse to `target` */
		async moveTo(target, { offset } = {}) {
			const to = await pointOf(target, offset);
			const from = position;
			const distance = Math.hypot(to.x - from.x, to.y - from.y);
			const duration = Math.min(900, 250 + distance);
			const start = Date.now();
			for (;;) {
				const t = Math.min(1, (Date.now() - start) / duration);
				const point = {
					x: from.x + (to.x - from.x) * ease(t),
					y: from.y + (to.y - from.y) * ease(t),
				};
				await drawPointer(point);
				await page.mouse.move(point.x, point.y);
				if (t === 1) {
					break;
				}
				await page.waitForTimeout(15);
			}
			position = to;
		},

		/** moves to `target`, and clicks it */
		async click(target, { button = "left", offset } = {}) {
			await video.moveTo(target, { offset });
			await page.evaluate(ripple, position);
			await drawPointer(position, 0.85);
			await page.mouse.down({ button });
			await page.waitForTimeout(100);
			await page.mouse.up({ button });
			await drawPointer(position);
		},

		/** types `text` at a typing pace */
		async type(text) {
			await page.keyboard.type(text, { delay: 90 });
		},

		/** shows `text` as the caption, or no caption without it */
		async caption(text) {
			await page.evaluate((text) => {
				const caption = document.getElementById("video-caption");
				if (text) {
					caption.textContent = text;
				}
				caption.style.opacity = text ? "1" : "0";
			}, text);
		},

		/** runs `action`, and leaves the time it takes out of the video */
		async cut(action) {
			const cut = { from: Date.now() / 1000, to: Number.POSITIVE_INFINITY };
			cuts.push(cut);
			try {
				await action();
			} finally {
				cut.to = Date.now() / 1000;
			}
		},

		/** records the window while `scenes` run */
		async record(scenes) {
			const part = `${file}.part`;
			mkdirSync(path.dirname(file), { recursive: true });
			const cdp = await page.context().newCDPSession(page);
			let ffmpeg;
			let exited;

			// the screencast sends a frame when the window changes: the last one
			// is repeated until the next, for a constant frame rate
			let start;
			let last;
			let written = 0;
			const writeUntil = async (time) => {
				const count = Math.round((videoTime(time) - start) * fps);
				while (written < count) {
					if (!ffmpeg.stdin.write(last)) {
						// ffmpeg stops reading when it fails
						await Promise.race([once(ffmpeg.stdin, "drain"), exited]);
					}
					written++;
				}
			};
			let stopped = false;
			let frames = Promise.resolve();
			cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
				cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
				if (stopped) {
					return;
				}
				frames = frames.then(async () => {
					start ??= metadata.timestamp;
					if (last) {
						await writeUntil(metadata.timestamp);
					}
					last = Buffer.from(data, "base64");
				});
				// awaited once the scenes ran
				frames.catch(() => {});
			});

			let error;
			let end;
			try {
				({ ffmpeg, exited } = await encoder(part));
				await page.evaluate(addOverlay);
				await drawPointer(position);
				await page.mouse.move(position.x, position.y);
				await cdp.send("Page.startScreencast", {
					format: "jpeg",
					quality: 95,
					maxWidth: size.width * 2,
					maxHeight: size.height * 2,
				});
				await scenes();
				end = Date.now() / 1000;
			} catch (e) {
				error = e;
			}
			stopped = true;
			await cdp.send("Page.stopScreencast").catch(() => {});
			await cdp.detach().catch(() => {});
			await page.evaluate(removeOverlay).catch(() => {});
			try {
				await frames;
				if (error) {
					throw error;
				}
				if (!last) {
					throw new Error("no frame was recorded");
				}
				await writeUntil(end);
				ffmpeg.stdin.end();
				await exited;
				renameSync(part, file);
			} catch (e) {
				// it would wait for the end of its input on SIGTERM
				ffmpeg?.kill("SIGKILL");
				rmSync(part, { force: true });
				throw error ?? e;
			}
		},
	};
	return video;
}
