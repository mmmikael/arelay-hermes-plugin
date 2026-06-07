#!/usr/bin/env node
/**
 * Hermes cron delivery helper for Agent Relay.
 *
 * Reads cron output from stdin as JSON, encrypts it with the account public key,
 * creates an Agent Relay session, and uploads the output as an encrypted artifact.
 *
 * Media files are validated and read before session creation. If a later upload fails,
 * the error includes sessionId and partial artifact count (orphan session in portal).
 */
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
	TEXT_ENCODER,
	agentFetch,
	assertArtifactSize,
	contentTypeForPath,
	defaultRelayUrl,
	encryptBytes,
	encryptString,
	fetchE2eeConfig,
	splitEnvelopeForArtifact
} from './lib/e2ee.mjs';

function usage() {
	console.log(`Usage:
  node e2ee_cron_deliver.mjs --stdin-json
  node e2ee_cron_deliver.mjs --help

Input JSON:
  {
    "title": "Hermes cron delivery",
    "summary": "Uploaded by Hermes cron via Agent Relay.",
    "filename": "cron-output.md",
    "contentType": "text/markdown",
    "message": "# Report",
    "mediaFiles": ["/path/to/file.png"]
  }

Environment:
  AGENT_RELAY_URL    Agent Relay base URL (default: ${defaultRelayUrl()})
  AGENT_API_TOKEN    Agent Relay bearer token

Requires Node.js 18+.
`);
}

function parseArgs(argv) {
	if (argv.includes('--help') || argv.includes('-h')) {
		return { help: true };
	}
	if (argv.includes('--stdin-json')) {
		return { stdinJson: true };
	}
	throw new Error('Expected --stdin-json. Use --help for usage.');
}

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function validateMediaFile(path) {
	const fileStat = await stat(path);
	if (!fileStat.isFile()) {
		throw new Error(`mediaFiles entry is not a file: ${path}`);
	}
	assertArtifactSize({ byteLength: fileStat.size }, basename(path));
	return fileStat.size;
}

async function uploadArtifact({ relayUrl, apiToken, publicKeyJwk, sessionId, filename, contentType, bytes }) {
	assertArtifactSize(bytes, filename);
	const encryptedFile = await encryptBytes(bytes, publicKeyJwk);
	const encryptedFilename = await encryptString(filename, publicKeyJwk);
	const encryptedContentType = await encryptString(contentType, publicKeyJwk);
	const artifactPayload = splitEnvelopeForArtifact(encryptedFile);

	const { artifact } = await agentFetch(relayUrl, apiToken, `/api/agent/sessions/${sessionId}/artifacts`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			encrypted: true,
			encrypted_filename: encryptedFilename,
			encrypted_content_type: encryptedContentType,
			...artifactPayload
		})
	});
	return artifact;
}

async function deliver(input) {
	const relayUrl = defaultRelayUrl();
	const apiToken = process.env.AGENT_API_TOKEN;
	if (!apiToken) {
		throw new Error('AGENT_API_TOKEN is required');
	}

	const title = String(input.title || 'Hermes cron delivery');
	const summary = String(input.summary || 'Uploaded by Hermes cron via Agent Relay.');
	const filename = String(input.filename || 'cron-output.md');
	const contentType = String(input.contentType || 'text/markdown');
	const message = String(input.message || '');
	const mediaFiles = input.mediaFiles || [];

	const messageBytes = TEXT_ENCODER.encode(message);
	assertArtifactSize(messageBytes, filename);

	const preparedMedia = [];
	for (const mediaPath of mediaFiles) {
		const path = String(mediaPath);
		await validateMediaFile(path);
		const bytes = await readFile(path);
		assertArtifactSize(bytes, basename(path));
		preparedMedia.push({
			filename: basename(path),
			contentType: contentTypeForPath(path),
			bytes
		});
	}

	const { publicKeyJwk } = await fetchE2eeConfig(relayUrl, apiToken);

	const encryptedTitle = await encryptString(title, publicKeyJwk);
	const encryptedSummary = await encryptString(summary, publicKeyJwk);

	const { session } = await agentFetch(relayUrl, apiToken, '/api/agent/sessions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			encrypted: true,
			encrypted_title: encryptedTitle,
			encrypted_summary: encryptedSummary
		})
	});

	const sessionId = session.id;
	const artifacts = [];

	try {
		const primaryArtifact = await uploadArtifact({
			relayUrl,
			apiToken,
			publicKeyJwk,
			sessionId,
			filename,
			contentType,
			bytes: messageBytes
		});
		artifacts.push(primaryArtifact.id);

		for (const media of preparedMedia) {
			const mediaArtifact = await uploadArtifact({
				relayUrl,
				apiToken,
				publicKeyJwk,
				sessionId,
				filename: media.filename,
				contentType: media.contentType,
				bytes: media.bytes
			});
			artifacts.push(mediaArtifact.id);
		}
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Upload failed after creating session ${sessionId} (${artifacts.length} artifact(s) uploaded): ${detail}`
		);
	}

	return {
		sessionId,
		artifactIds: artifacts,
		artifactCount: artifacts.length,
		title,
		relayUrl
	};
}

try {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		process.exit(0);
	}

	const inputText = await readStdin();
	const input = inputText.trim() ? JSON.parse(inputText) : {};
	const result = await deliver(input);
	console.log(JSON.stringify(result));
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}
