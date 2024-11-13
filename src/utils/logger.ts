import * as util from "node:util";
import * as vscode from "vscode";

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

export class Logger {
	private static instance: Logger;
	private outputChannel: vscode.OutputChannel;
	private logLevel: LogLevel;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel("Mise");
		this.logLevel = LogLevel.INFO; // Default log level
	}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	public setLogLevel(level: LogLevel) {
		this.logLevel = level;
		this.info(`Log level set to ${LogLevel[level]}`);
	}

	private formatMessage(level: string, message: string): string {
		const timestamp = new Date().toISOString();
		return `[${timestamp}] [${level}] ${message}`;
	}

	private shouldLog(level: LogLevel): boolean {
		return level >= this.logLevel;
	}

	private log(level: LogLevel, message: string, error?: Error) {
		if (!this.shouldLog(level)) {
			return;
		}

		const formattedMessage = this.formatMessage(LogLevel[level], message);
		this.outputChannel.appendLine(formattedMessage);

		if (error) {
			this.outputChannel.appendLine(
				this.formatMessage(LogLevel[level], `Error Details: ${error.message}`),
			);
			if (error.stack) {
				this.outputChannel.appendLine(
					this.formatMessage(LogLevel[level], `Stack Trace: ${error.stack}`),
				);
			}
		}

		// Show in Problem panel for warnings and errors
		if (level >= LogLevel.WARN) {
			const notify =
				level === LogLevel.WARN
					? vscode.window.showWarningMessage
					: vscode.window.showErrorMessage;

			let errorMessage = message;
			if (error) {
				errorMessage = `${message}: ${error.message}`;
			}
			void notify(`Mise: ${errorMessage}`);
		}
	}

	public debug(message: string) {
		this.log(LogLevel.DEBUG, message);
	}

	public info(message: unknown) {
		this.log(
			LogLevel.INFO,
			typeof message === "string" ? message : util.inspect(message),
		);
	}

	public warn(message: string) {
		this.log(LogLevel.WARN, message);
	}

	public error(message: string, error?: Error) {
		this.log(LogLevel.ERROR, message, error);
	}

	public group(title: string) {
		if (!this.shouldLog(LogLevel.DEBUG)) {
			return;
		}
		this.outputChannel.appendLine(`\n▼ ${title}`);
	}

	public groupEnd() {
		if (!this.shouldLog(LogLevel.DEBUG)) {
			return;
		}
		this.outputChannel.appendLine("▲ End\n");
	}

	public show() {
		this.outputChannel.show();
	}

	public dispose() {
		this.outputChannel.dispose();
	}
}

export const logger = Logger.getInstance();
