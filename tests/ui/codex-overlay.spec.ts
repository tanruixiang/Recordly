import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openRecordingSettings(page: Page) {
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	await home.getByRole("button", { name: "Settings", exact: true }).click();
	await home.getByRole("row", { name: "Recording", exact: true }).click();
	return home;
}

test("macOS recording settings save the Codex overlay toggle independently of audio", async ({
	page,
}) => {
	await installDesktopBridge(page);
	const home = await openRecordingSettings(page);
	const toggle = home.getByRole("switch", { name: "Hide Codex overlay in recordings" });
	await expect(toggle).not.toBeChecked();
	await toggle.press("Space");
	await expect(toggle).toBeChecked();
	const preferences = await page.evaluate(() => window.electronAPI.getRecordingPreferences());
	expect(preferences).toMatchObject({
		hideCodexOverlay: true,
		systemAudioEnabled: true,
		microphoneEnabled: false,
	});
	await page.screenshot({
		path: "test-results/codex-overlay-setting.png",
		animations: "disabled",
	});
	await toggle.press("Space");
	await expect(toggle).not.toBeChecked();
	expect(await page.evaluate(() => window.electronAPI.getRecordingPreferences())).toMatchObject({
		hideCodexOverlay: false,
		systemAudioEnabled: true,
	});
});

test("Windows does not offer the macOS Codex overlay option", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
	});
	const home = await openRecordingSettings(page);
	await expect(home.getByRole("switch", { name: "Hide HUD from recordings" })).toBeVisible();
	await expect(
		home.getByRole("switch", { name: "Hide Codex overlay in recordings" }),
	).toHaveCount(0);
});

test("native capture receives current Codex preferences after the HUD has mounted", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.startNativeScreenRecording = async (_source, options) => {
			document.documentElement.dataset.nativeCaptureOptions = JSON.stringify(options);
			return { success: false, userNotified: true };
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const record = page.getByRole("button", { name: "Record", exact: true });
	await expect(record).toBeVisible();
	for (const hideCodexOverlay of [true, false]) {
		await page.evaluate(async (enabled) => {
			delete document.documentElement.dataset.nativeCaptureOptions;
			await window.electronAPI.setRecordingPreferences({ hideCodexOverlay: enabled });
		}, hideCodexOverlay);
		await record.click();
		await expect
			.poll(async () => {
				const value = await page
					.locator("html")
					.getAttribute("data-native-capture-options");
				return value ? JSON.parse(value) : null;
			})
			.toMatchObject({
				hideCodexOverlay,
				capturesSystemAudio: true,
				capturesMicrophone: false,
			});
	}
});
