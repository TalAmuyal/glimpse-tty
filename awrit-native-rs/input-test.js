const {
	termEnableFeatures,
	listenForInput,
	termDisableFeatures,
} = require("./index");
const util = require("node:util");

const features = termEnableFeatures();

console.log = (...data) =>
	process.stderr.write(
		`\r\n${util
			.formatWithOptions({ colors: true }, ...data)
			.trim()
			.replace(/\n/g, "\n\r")}`,
	);

const { promise: block, resolve: unblock } = Promise.withResolvers();

async function main() {
	console.log(features);
	const cleanup = listenForInput((x) => {
		console.log("\r", x);
		if (x.keyEvent?.code === "c" && x.keyEvent?.modifiers.includes("ctrl")) {
			unblock();
		}
	}, 200);
	await block;
	cleanup();
	termDisableFeatures(features);
}

main();
