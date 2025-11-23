import axios from 'axios';
import { readAsStringAsync } from 'expo-file-system';

interface BlueskySession {
    did: string;
    accessJwt: string;
    refreshJwt: string;
    handle: string;
}

interface BlueskyBlob {
    ref: {
        $link: string;
    };
    mimeType: string;
    size: number;
}

export class BlueskyService {
    private session: BlueskySession | null = null;
    private pdsUrl = 'https://bsky.social';

    constructor(session?: BlueskySession) {
        if (session) {
            this.session = session;
        }
    }

    async login(identifier: string, appPassword: string): Promise<BlueskySession> {
        try {
            const response = await axios.post(`${this.pdsUrl}/xrpc/com.atproto.server.createSession`, {
                identifier,
                password: appPassword,
            });
            this.session = response.data;
            return response.data;
        } catch (error: any) {
            console.error('Bluesky Login Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async uploadBlob(uri: string, mimeType: string): Promise<BlueskyBlob> {
        if (!this.session) throw new Error('Not authenticated with Bluesky');

        try {
            // For Expo, we need to read the file as binary.
            // However, uploadBlob expects raw bytes.
            // In React Native with axios, passing a Blob or ArrayBuffer works best.
            // But expo-file-system readAsStringAsync with 'base64' is common, then convert to byte array.

            // NOTE: com.atproto.repo.uploadBlob is the simple way.
            // Limit is often 50MB (ish). Videos might need the video service for larger files,
            // but for simplicity and "early trigger" we start here.

            // Fetch the file to get a blob (this works in Expo for local URIs too often, or use readAsStringAsync)
            // Using fetch to get blob is cleaner for binary upload if supported.
            const fetchResponse = await fetch(uri);
            const blob = await fetchResponse.blob();

            const response = await fetch(`${this.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
                method: 'POST',
                headers: {
                    'Content-Type': mimeType,
                    'Authorization': `Bearer ${this.session.accessJwt}`,
                },
                body: blob
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Bluesky Upload Failed: ${errorText}`);
            }

            const data = await response.json();
            return data.blob;

        } catch (error: any) {
            console.error('Bluesky Upload Error:', error);
            throw error;
        }
    }

    async post(text: string, blob?: BlueskyBlob, mimeType?: string) {
        if (!this.session) throw new Error('Not authenticated with Bluesky');

        const now = new Date().toISOString();
        const record: any = {
            $type: 'app.bsky.feed.post',
            text: text,
            createdAt: now,
        };

        if (blob) {
            // Check if it's image or video
            if (mimeType?.startsWith('image')) {
                record.embed = {
                    $type: 'app.bsky.embed.images',
                    images: [
                        {
                            alt: '', // We could add alt text input later
                            image: blob,
                        }
                    ]
                };
            } else if (mimeType?.startsWith('video')) {
                 // Video support via standard uploadBlob (limited) or external video service.
                 // The simple video embed looks like this, but usually requires the blob to be processed by video service?
                 // Wait, standard `app.bsky.embed.video` requires the blob to be uploaded to video service usually?
                 // Or just `uploadBlob` to PDS and reference it?
                 // Docs say "The easiest way to upload a video is to upload it as you would an image - use uploadBlob... However... downside"
                 // So we can use `uploadBlob` result here.
                 record.embed = {
                     $type: 'app.bsky.embed.video',
                     video: blob,
                     // Aspect ratio is optional but recommended. We might not have it easily without extra libs.
                 };
            }
        }

        try {
             const response = await axios.post(`${this.pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
                repo: this.session.did,
                collection: 'app.bsky.feed.post',
                record: record,
            }, {
                headers: {
                    'Authorization': `Bearer ${this.session.accessJwt}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error: any) {
             console.error('Bluesky Post Error:', error.response?.data || error.message);
             throw error;
        }
    }
}
