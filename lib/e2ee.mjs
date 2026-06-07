/**
 * Shared E2EE helpers for Agent Relay agent scripts.
 * Matches Web Crypto in arelay src/lib/e2ee.ts — do not hand-roll Python ECDH/HKDF.
 */
import { webcrypto } from 'node:crypto';

export const TEXT_ENCODER = new TextEncoder();
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export function defaultRelayUrl() {
	return (process.env.AGENT_RELAY_URL ?? 'https://arelay.app').replace(/\/$/, '');
}

export function bytesToBase64Url(bytes) {
	return Buffer.from(bytes).toString('base64url');
}

export function toArrayBuffer(bytes) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function importPublicKey(publicKeyJwk) {
	return webcrypto.subtle.importKey(
		'jwk',
		{ kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x, y: publicKeyJwk.y },
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		[]
	);
}

async function deriveContentKey(privateKey, publicKey, usages) {
	return webcrypto.subtle.deriveKey(
		{ name: 'ECDH', public: publicKey },
		privateKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		usages
	);
}

export async function encryptBytes(plaintext, recipientPublicKeyJwk) {
	const recipientPublicKey = await importPublicKey(recipientPublicKeyJwk);
	const ephemeralKeyPair = await webcrypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveKey']
	);
	const contentKey = await deriveContentKey(ephemeralKeyPair.privateKey, recipientPublicKey, [
		'encrypt'
	]);
	const iv = webcrypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await webcrypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: toArrayBuffer(iv) },
		contentKey,
		toArrayBuffer(plaintext)
	);
	const epk = await webcrypto.subtle.exportKey('jwk', ephemeralKeyPair.publicKey);
	const ciphertextBytes = new Uint8Array(ciphertext);

	return {
		v: 1,
		alg: 'P-256-ECDH-A256GCM',
		epk: { kty: epk.kty, crv: epk.crv, x: epk.x, y: epk.y },
		iv: bytesToBase64Url(iv),
		ciphertext: bytesToBase64Url(ciphertextBytes),
		ciphertextBytes
	};
}

export async function encryptString(plaintext, recipientPublicKeyJwk) {
	const encrypted = await encryptBytes(TEXT_ENCODER.encode(plaintext), recipientPublicKeyJwk);
	const { ciphertextBytes: _ciphertextBytes, ...envelope } = encrypted;
	return envelope;
}

export function splitEnvelopeForArtifact(envelope) {
	const { ciphertext, ciphertextBytes, ...payload } = envelope;
	return {
		encrypted_payload: payload,
		ciphertext_base64: ciphertext,
		size_bytes: ciphertextBytes?.byteLength ?? Buffer.from(ciphertext, 'base64url').byteLength
	};
}

export async function agentFetch(relayUrl, apiToken, path, init = {}) {
	const res = await fetch(`${relayUrl}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			...(init.headers ?? {})
		}
	});
	const text = await res.text();
	let body;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	if (!res.ok) {
		throw new Error(`${init.method ?? 'GET'} ${path} failed (${res.status}): ${JSON.stringify(body)}`);
	}
	return body;
}

export async function fetchE2eeConfig(relayUrl, apiToken) {
	try {
		const config = await agentFetch(relayUrl, apiToken, '/api/agent/e2ee/config');
		if (!config?.configured || !config.publicKeyJwk) {
			throw new Error(
				'E2EE is not configured for this account. Human must complete Set up encryption in the portal.'
			);
		}
		return config;
	} catch (err) {
		if (String(err).includes('428')) {
			throw new Error(
				'E2EE is not configured for this account (428 e2ee_required). Human must complete Set up encryption in the portal.'
			);
		}
		throw err;
	}
}

export function contentTypeForPath(path) {
	const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : '';
	switch (ext) {
		case '.md':
			return 'text/markdown';
		case '.txt':
			return 'text/plain';
		case '.html':
		case '.htm':
			return 'text/html';
		case '.json':
			return 'application/json';
		case '.pdf':
			return 'application/pdf';
		case '.png':
			return 'image/png';
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.gif':
			return 'image/gif';
		case '.webp':
			return 'image/webp';
		case '.svg':
			return 'image/svg+xml';
		default:
			return 'application/octet-stream';
	}
}

export function assertArtifactSize(bytes, label = 'Artifact') {
	if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
		const maxMb = MAX_ARTIFACT_BYTES / (1024 * 1024);
		throw new Error(`${label} is ${bytes.byteLength} bytes; maximum is ${maxMb} MB per file.`);
	}
}
