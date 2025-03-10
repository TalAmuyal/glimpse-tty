#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

// index.d.ts can have stronger typing than the generated types, use it as the source of truth
const indexPath = path.join(__dirname, "..", "index.d.ts");
const content = fs.readFileSync(indexPath, "utf8");

// Find the TermEvent interface
const interfaceRegex = /export interface TermEvent {([^}]*)}/s;
const match = content.match(interfaceRegex);

if (!match) {
	console.error("Could not find TermEvent interface");
	process.exit(1);
}

const interfaceContent = match[1];

// Parse the properties
const propRegex = /\s+(\w+)(\?)?:\s*([^;\n]+);?/g;
const props = {};

// Parse all properties
let propMatch = propRegex.exec(interfaceContent);
while (propMatch !== null) {
	const [_, name, optional, type] = propMatch;
	props[name] = {
		type: type.trim(),
		optional: optional === "?",
	};
	propMatch = propRegex.exec(interfaceContent);
}

// Group properties by eventType values
const eventTypes = props.eventType.type
	.split("|")
	.map((t) => t.trim().replace(/['"]/g, ""));
const unionTypes = [];

for (const eventType of eventTypes) {
	const relevantProps = {};
	const prefix = eventType;

	// Find all properties that start with this prefix
	const propsForType = Object.entries(props).filter(([key, value]) => {
		if (key === "eventType") return false;
		const propPrefix = key.replace(/[A-Z]/g, (l) => l.toLowerCase());
		return propPrefix.startsWith(prefix.toLowerCase());
	});

	// If we found exactly one property, it's required
	// If we found more than one, they're all optional
	const makeOptional = propsForType.length > 1;

	for (const [key, value] of propsForType) {
		relevantProps[key] = {
			type: value.type,
			optional: makeOptional,
		};
	}

	// Build the type string
	let typeStr = `{ eventType: '${eventType}'`;

	for (const [key, value] of Object.entries(relevantProps)) {
		typeStr += `, ${key}${value.optional ? "?" : ""}: ${value.type}`;
	}

	typeStr += " }";
	unionTypes.push(typeStr);
}

// Build the final union type
const unionType = `export type TermEvent =\n  ${unionTypes.join(" |\n  ")}`;

// Replace in the file
let newContent = content.replace(interfaceRegex, unionType);

// Add declare keyword to function declarations that don't have it
newContent = newContent.replace(
	/^function\s+(?!export declare)/gm,
	"export declare function ",
);

fs.writeFileSync(indexPath, newContent);
console.log(
	"Successfully converted TermEvent interface to union type and added missing declare keywords",
);
