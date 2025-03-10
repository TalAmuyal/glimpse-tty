const { platform, arch } = process;
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

// Read package.json to get version
const packageJson = require("../package.json");
const version = packageJson.version;

function getPlatformTarget() {
	switch (platform) {
		case "darwin":
			if (arch === "arm64") {
				return "darwin-arm64";
			}
			if (arch === "x64") {
				return "darwin-x64";
			}
			throw new Error(`Unsupported architecture on macOS: ${arch}`);

		case "linux":
			if (arch === "x64") {
				return "linux-x64-gnu";
			}
			throw new Error(`Unsupported architecture on Linux: ${arch}`);

		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
}

function handleDownloadError(err, outputPath) {
	fs.unlink(outputPath, () => {});
	console.error(`Error downloading binary: ${err.message}`);
	process.exit(1);
}

function handleDownloadSuccess(file) {
	file.close();
	console.log("Download completed successfully");
	process.exit(0);
}

function downloadFromUrl(url, file, outputPath) {
	return https.get(url, (response) => {
		if (response.statusCode === 302 || response.statusCode === 301) {
			downloadFromUrl(response.headers.location, file, outputPath).on(
				"error",
				(err) => handleDownloadError(err, outputPath),
			);
		} else {
			response.pipe(file);
			file.on("finish", () => handleDownloadSuccess(file));
		}
	});
}

function downloadBinary() {
	const target = getPlatformTarget();
	const filename = `awrit-native-rs.${target}.node`;
	const url = `https://github.com/chase/awrit/releases/download/awrit-native-rs-${version}/${filename}`;
	const outputPath = path.resolve(__dirname, `../${filename}`);

	// Check if the binary already exists
	if (fs.existsSync(outputPath)) {
		process.exit(0);
	}

	console.log(`Downloading binary from ${url}`);
	console.log(`Saving to ${filename}`);

	const file = fs.createWriteStream(outputPath);
	downloadFromUrl(url, file, outputPath).on("error", (err) =>
		handleDownloadError(err, outputPath),
	);
}

downloadBinary();
