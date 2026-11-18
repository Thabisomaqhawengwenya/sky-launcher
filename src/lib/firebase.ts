/**
 * Firebase configuration and initialisation.
 *
 * Project: Sky Launcher (sky-launcher-app)
 * Console: https://console.firebase.google.com/project/sky-launcher-app/overview
 *
 * Before using auth or Firestore:
 *  1. Open the Firebase Console link above.
 *  2. Go to Build → Authentication → Sign-in method and enable:
 *       • Email/Password
 *       • Google
 *  3. Go to Build → Firestore Database → Create database (choose Native mode,
 *     location nam5 or your nearest region).
 *  4. Add this Firestore security rule so only signed-in users can read/write
 *     their own data:
 *
 *       rules_version = '2';
 *       service cloud.firestore {
 *         match /databases/{database}/documents {
 *           match /users/{uid}/{document=**} {
 *             allow read, write: if request.auth != null && request.auth.uid == uid;
 *           }
 *         }
 *       }
 *
 *  5. Go to Build → Storage → Get started (choose your region), then add:
 *
 *       rules_version = '2';
 *       service firebase.storage {
 *         match /b/{bucket}/o {
 *           match /saves/{uid}/{allPaths=**} {
 *             allow read, write: if request.auth != null && request.auth.uid == uid;
 *           }
 *         }
 *       }
 *
 * That's it — no other manual steps required.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

export const firebaseConfig = {
  apiKey: 'AIzaSyBQ5_oQ4TE7LAVv3QTlpF-yvY811XNtn80',
  authDomain: 'sky-launcher-app.firebaseapp.com',
  projectId: 'sky-launcher-app',
  storageBucket: 'sky-launcher-app.firebasestorage.app',
  messagingSenderId: '415018588984',
  appId: '1:415018588984:web:b8ca7a7b43c3efb27abfcd'
}

// Avoid re-initialising if HMR causes this module to run twice.
function getFirebaseApp(): FirebaseApp {
  const existing = getApps()
  if (existing.length > 0) return existing[0]
  return initializeApp(firebaseConfig)
}

export const firebaseApp: FirebaseApp = getFirebaseApp()
export const auth: Auth = getAuth(firebaseApp)
export const db: Firestore = getFirestore(firebaseApp)
