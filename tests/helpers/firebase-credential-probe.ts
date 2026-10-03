import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { Socket } from 'node:net';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

async function main(): Promise<void> {
  const scenario = process.argv[2];
  assert.ok(scenario);
  let networkAttempts = 0;
  // Guard the transport, not the SDK or crypto being evaluated. No credentials
  // are sent anywhere; even an unexpected token fetch fails this probe.
  Socket.prototype.connect = function (): Socket {
    networkAttempts += 1;
    throw new Error('Network forbidden in synthetic credential probe');
  };
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('Network forbidden in synthetic credential probe');
  };
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, undefined);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, undefined);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  const { getApps, deleteApp } = await import('firebase-admin/app');
  assert.equal(getApps().length, 0);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.FIREBASE_PROJECT_ID = 'demo-mutter-credentials';
  process.env.FIREBASE_CLIENT_EMAIL = 'synthetic@demo-mutter-credentials.iam.gserviceaccount.com';
  process.env.FIREBASE_PRIVATE_KEY = pkcs8;
  switch (scenario) {
    case 'pkcs8': break;
    case 'pkcs8-escaped': process.env.FIREBASE_PRIVATE_KEY = pkcs8.replace(/\n/g, '\\n'); break;
    case 'pkcs1': process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(); break;
    case 'invalid-pem': process.env.FIREBASE_PRIVATE_KEY = 'synthetic-invalid-private-key'; break;
    case 'truncated-pem': process.env.FIREBASE_PRIVATE_KEY = pkcs8.slice(0, 100); break;
    case 'public-key': process.env.FIREBASE_PRIVATE_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString(); break;
    case 'missing-project': delete process.env.FIREBASE_PROJECT_ID; break;
    case 'missing-email': delete process.env.FIREBASE_CLIENT_EMAIL; break;
    case 'missing-key': delete process.env.FIREBASE_PRIVATE_KEY; break;
    default: throw new Error('Unknown credential probe scenario');
  }
  if (scenario.startsWith('missing-')) {
    await assert.rejects(import('../../api/_lib/firebaseAdmin'), { message: 'Missing Firebase Admin environment variables' });
    assert.equal(getApps().length, 0);
  } else if (['invalid-pem', 'truncated-pem', 'public-key'].includes(scenario)) {
    await assert.rejects(import('../../api/_lib/firebaseAdmin'), (error: unknown) => {
      const detail = object(error);
      assert.equal(detail.code, 'app/invalid-credential');
      assert.match(String(detail.message), /Failed to parse private key/);
      return true;
    });
    assert.equal(getApps().length, 0);
  } else {
    const { adminApp, adminAuth, adminDb } = await import('../../api/_lib/firebaseAdmin');
    try {
      assert.equal(getApps().length, 1);
      // This path uses the actual service-account signer. The emulator is absent.
      const token = await adminAuth.createCustomToken('synthetic-rsa-user', { admin: true });
      const parts = token.split('.');
      assert.equal(parts.length, 3);
      const [headerPart, payloadPart, signaturePart] = parts;
      assert.ok(headerPart && payloadPart && signaturePart);
      const header = object(JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')));
      const payload = object(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')));
      assert.equal(header.alg, 'RS256');
      assert.equal(payload.uid, 'synthetic-rsa-user');
      assert.deepEqual(payload.claims, { admin: true });
      assert.equal(payload.iss, process.env.FIREBASE_CLIENT_EMAIL);
      assert.equal(payload.sub, process.env.FIREBASE_CLIENT_EMAIL);
      assert.equal(payload.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
      assert.equal(verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), publicKey, Buffer.from(signaturePart, 'base64url')), true);
      assert.equal(verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}x`), publicKey, Buffer.from(signaturePart, 'base64url')), false);
    } finally {
      await adminDb.terminate();
      await deleteApp(adminApp);
    }
  }
  assert.equal(networkAttempts, 0);
  process.stdout.write(JSON.stringify({ scenario, passed: true, networkAttempts }));
}

void main().catch(() => {
  // Assertion details could contain a JWT/PEM. The parent receives only a safe
  // failure marker and nonzero status; fixtures never print either credential.
  process.stdout.write(JSON.stringify({ scenario: process.argv[2], passed: false }));
  process.exitCode = 1;
});
