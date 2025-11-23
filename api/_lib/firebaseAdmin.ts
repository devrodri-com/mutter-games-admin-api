
import * as admin from 'firebase-admin';

// Ensure we only initialize the Admin SDK once (required for Vercel serverless)
if (!admin.apps.length) {
  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error('Missing Firebase Admin environment variables');
  }

  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!rawPrivateKey) {
    throw new Error('Missing Firebase Admin environment variables');
  }

  const privateKey =
    rawPrivateKey && rawPrivateKey.includes('\\n')
      ? rawPrivateKey.replace(/\\n/g, '\n')
      : rawPrivateKey;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

// Centralized exports
export const adminApp = admin.app();
export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
