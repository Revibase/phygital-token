// Injected into every frame (Playwright init script) by webauthn-bridge.ts.
// Routes navigator.credentials to the test's virtual authenticator through the
// `__webauthn` binding, so ceremonies need no hardware or OS prompt. Everything
// that consumes the credential (the app, the signer iframe, servers, the
// program) stays real.
(() => {
	const b64 = (bytes) => {
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s);
	};
	const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

	// BufferSources cross the binding as { __b64 }; signals stay behind.
	const encode = (value) => {
		if (value instanceof ArrayBuffer) return { __b64: b64(new Uint8Array(value)) };
		if (ArrayBuffer.isView(value))
			return { __b64: b64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
		if (Array.isArray(value)) return value.map(encode);
		if (value && typeof value === 'object') {
			const out = {};
			for (const [k, v] of Object.entries(value))
				if (k !== 'signal' && v !== undefined) out[k] = encode(v);
			return out;
		}
		return value;
	};
	const decode = (value) => {
		if (Array.isArray(value)) return value.map(decode);
		if (value && typeof value === 'object') {
			if (typeof value.__b64 === 'string') return unb64(value.__b64);
			const out = {};
			for (const [k, v] of Object.entries(value)) out[k] = decode(v);
			return out;
		}
		return value;
	};

	const credential = (c) => {
		const r = c.response;
		const response = r.attestationObject
			? {
					clientDataJSON: r.clientDataJSON,
					attestationObject: r.attestationObject,
					getTransports: () => r.transports,
					getAuthenticatorData: () => r.authenticatorData,
					getPublicKey: () => r.publicKey,
					getPublicKeyAlgorithm: () => r.publicKeyAlgorithm
				}
			: {
					clientDataJSON: r.clientDataJSON,
					authenticatorData: r.authenticatorData,
					signature: r.signature,
					userHandle: r.userHandle ?? null
				};
		return {
			id: c.id,
			rawId: c.rawId,
			type: 'public-key',
			authenticatorAttachment: c.authenticatorAttachment,
			response,
			getClientExtensionResults: () => c.extensions
		};
	};

	const feature = { create: 'publickey-credentials-create', get: 'publickey-credentials-get' };
	async function ceremony(op, options) {
		if (options?.signal?.aborted)
			throw new DOMException('The operation was aborted.', 'AbortError');
		// Keep the browser's Permissions-Policy gate: a frame the page didn't
		// delegate WebAuthn to must still fail (Chromium exposes the check).
		const policy = document.permissionsPolicy ?? document.featurePolicy;
		if (window !== window.top && policy && !policy.allowsFeature(feature[op])) {
			throw new DOMException(`${feature[op]} is not allowed in this frame`, 'NotAllowedError');
		}
		const result = await window.__webauthn(op, encode(options ?? {}));
		if (result.error) throw new DOMException(result.error.message, result.error.name);
		return credential(decode(result.credential));
	}

	Object.defineProperty(navigator, 'credentials', {
		configurable: true,
		value: {
			create: (options) => ceremony('create', options),
			get: (options) => ceremony('get', options),
			preventSilentAccess: async () => {},
			store: async () => {
				throw new DOMException('Not supported', 'NotSupportedError');
			}
		}
	});
	if (window.PublicKeyCredential) {
		window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
		window.PublicKeyCredential.isConditionalMediationAvailable = async () => false;
	}
})();
