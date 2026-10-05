import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Run the production Swift strategies and exclusion resolver. Only the
// ScreenCaptureKit application/content objects are simulated; no TCC grant is needed.
describe.skipIf(process.platform !== "darwin")("overlay exclusion strategies", () => {
	let directory: string;
	let executable: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-overlays-"));
		executable = join(directory, "helper");
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const strategies = source.slice(
			source.indexOf("protocol OverlayExclusionStrategy"),
			source.indexOf("let targetCaptureFPS"),
		);
		const resolver = source.slice(
			source.indexOf("\tprivate func excludedApplications(in"),
			source.indexOf("\tprivate static func captureDisplay"),
		);
		const activation = source.slice(
			source.indexOf("\t\toverlayExclusionStrategies = config."),
			source.indexOf("\t\t// Include helpers"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import Foundation
struct SCRunningApplication { let processID: Int32; let bundleIdentifier: String }
struct SCShareableContent { let applications: [SCRunningApplication] }
struct CaptureConfig { let hideCodexOverlay: Bool? }
${strategies}
final class Resolver {
    private var overlayExclusionStrategies: [any OverlayExclusionStrategy] = []
    private var excludedProcessIds = Set<Int32>()
    init(config: CaptureConfig, hudPid: Int32) {
        excludedProcessIds = [hudPid]
${activation}
    }
${resolver}
    func run(_ applications: [SCRunningApplication]) -> [Int32] {
        excludedApplications(in: SCShareableContent(applications: applications)).map { $0.processID }
    }
}
let enabled: Bool? = CommandLine.arguments[1] == "missing" ? nil : CommandLine.arguments[1] == "true"
let resolver = Resolver(config: CaptureConfig(hideCodexOverlay: enabled), hudPid: 7)
let apps = CommandLine.arguments.dropFirst(2).enumerated().map { index, bundle in
    SCRunningApplication(processID: Int32(index + 1), bundleIdentifier: bundle)
}
print(resolver.run(apps).map(String.init).joined(separator: ","))
`,
		);
		const build = spawnSync(
			"swiftc",
			[
				"-module-cache-path",
				join(directory, "cache"),
				join(directory, "main.swift"),
				"-o",
				executable,
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		expect(build.status, build.stderr).toBe(0);
	}, 60_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	const applications = [
		"com.openai.sky.CUAService",
		"com.openai.codex",
		"com.example.agent",
		"com.openai.sky.CUAService.extra",
		"com.openai.sky.cuaservice",
		"com.openai.sky.CUAService",
		"dev.recordly.hud",
	];
	it.each([
		["true", "1,6,7"],
		["false", "7"],
		["missing", "7"],
	])("resolves helper processes and preserves HUD exclusions with setting %s", (setting, expected) => {
		const result = spawnSync(executable, [setting, ...applications], {
			encoding: "utf8",
			timeout: 5_000,
		});
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe(expected);
	});
});
