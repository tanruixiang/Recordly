import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
let directory: string;
let settingsPath: string;

beforeEach(async () => {
	vi.resetModules();
	handlers.clear();
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-codex-preferences-"));
	settingsPath = path.join(directory, "recordings-settings.json");
	vi.doMock("electron", () => ({
		app: { getPath: () => directory },
		BrowserWindow: {},
		ipcMain: {
			handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
			on: vi.fn(),
		},
	}));
	vi.doMock("../../windows", () => ({ createCountdownWindow: vi.fn() }));
	vi.doMock("../../cursorHider", () => ({ hideCursor: vi.fn() }));
	const { registerSettingsHandlers } = await import("./settings");
	registerSettingsHandlers();
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
	vi.doUnmock("electron");
	vi.doUnmock("../../windows");
	vi.doUnmock("../../cursorHider");
});

describe("Codex overlay recording preference", () => {
	it("defaults off for existing preferences and preserves the existing audio settings", async () => {
		await fs.writeFile(
			settingsPath,
			JSON.stringify({ microphoneEnabled: true, systemAudioEnabled: true }),
		);
		await expect(handlers.get("get-recording-preferences")!(undefined)).resolves.toMatchObject({
			success: true,
			hideCodexOverlay: false,
			microphoneEnabled: true,
			systemAudioEnabled: true,
		});
	});

	it("persists both toggle states without replacing older recording settings", async () => {
		await fs.writeFile(
			settingsPath,
			JSON.stringify({ microphoneEnabled: true, recordingsDir: "/custom-recordings" }),
		);
		const set = handlers.get("set-recording-preferences")!;
		const get = handlers.get("get-recording-preferences")!;
		for (const hideCodexOverlay of [true, false]) {
			await expect(set(undefined, { hideCodexOverlay })).resolves.toEqual({ success: true });
			await expect(get(undefined)).resolves.toMatchObject({
				hideCodexOverlay,
				microphoneEnabled: true,
			});
			expect(JSON.parse(await fs.readFile(settingsPath, "utf8"))).toEqual({
				hideCodexOverlay,
				microphoneEnabled: true,
				recordingsDir: "/custom-recordings",
			});
		}
	});
});
