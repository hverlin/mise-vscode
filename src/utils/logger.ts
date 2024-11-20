import * as util from "node:util";
import * as vscode from "vscode";

export enum LogLevel {
	DEBUG = "debug",
	INFO = "info",
	WARN = "warn",
	ERROR = "error",
}

export class Logger {
	private static instance: Logger;
	private readonly outputChannel: vscode.LogOutputChannel;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel("Mise", {
			log: true,
		});
	}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	private log(level: LogLevel, ...args: unknown[]) {
		this.outputChannel[level](util.format(...args));

		if ([LogLevel.WARN, LogLevel.ERROR].includes(level)) {
			const notify =
				level === LogLevel.WARN
					? vscode.window.showWarningMessage
					: vscode.window.showErrorMessage;

			const error = args.find((arg) => arg instanceof Error);
			let errorMessage = args.find((arg) => typeof arg === "string");

			if (error) {
				errorMessage = errorMessage
					? `${errorMessage}: ${error.message}`
					: error.message;
			}
			void notify(`Mise: ${errorMessage}`, "Show Logs").then((selection) => {
				if (selection === "Show Logs") {
					this.show();
				}
			});
		}
	}

	public debug(...args: unknown[]) {
		this.log(LogLevel.DEBUG, ...args);
	}

	public info(...args: unknown[]) {
		this.log(LogLevel.INFO, ...args);
	}

	public warn(...args: unknown[]) {
		this.log(LogLevel.WARN, ...args);
	}

	public error(...args: unknown[]) {
		this.log(LogLevel.ERROR, ...args);
	}

	public show() {
		this.outputChannel.show();
	}

	public dispose() {
		this.outputChannel.dispose();
	}
}

export const logger = Logger.getInstance();
