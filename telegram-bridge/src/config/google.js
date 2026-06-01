import fs from 'fs';
import { google } from 'googleapis';
import { env } from './env.js';

let authClient = null;

export function getGoogleAuth() {
  if (authClient) return authClient;

  if (!fs.existsSync(env.googleServiceAccountPath)) {
    throw new Error(
      `Google service account file not found: ${env.googleServiceAccountPath}. ` +
        'See README.md for setup instructions.'
    );
  }

  const credentials = JSON.parse(
    fs.readFileSync(env.googleServiceAccountPath, 'utf8')
  );

  authClient = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  return authClient;
}

export function getDriveClient() {
  const auth = getGoogleAuth();
  return google.drive({ version: 'v3', auth });
}

export function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}
