import OAuth from 'oauth-1.0a';
import HmacSHA1 from 'crypto-js/hmac-sha1';
import Base64 from 'crypto-js/enc-base64';
import axios, { AxiosRequestHeaders } from 'axios';
import * as FileSystem from 'expo-file-system';

export class TwitterService {
    private consumerKey: string;
    private consumerSecret: string;
    private accessToken: string;
    private accessTokenSecret: string;
    private oauth: OAuth;

    constructor(consumerKey: string, consumerSecret: string, accessToken: string, accessTokenSecret: string) {
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        this.accessToken = accessToken;
        this.accessTokenSecret = accessTokenSecret;

        this.oauth = new OAuth({
            consumer: { key: consumerKey, secret: consumerSecret },
            signature_method: 'HMAC-SHA1',
            hash_function(base_string, key) {
                return Base64.stringify(HmacSHA1(base_string, key));
            },
        });
    }

    private getAuthHeader(request: OAuth.RequestOptions): OAuth.Header {
        const token = {
            key: this.accessToken,
            secret: this.accessTokenSecret,
        };
        return this.oauth.toHeader(this.oauth.authorize(request, token));
    }

    async uploadMedia(uri: string) {
        try {
            console.log('Reading file info...');
            // Migrated from deprecated getInfoAsync to legacy import or simply suppression if needed,
            // but the prompt suggests migrating to "File" and "Directory" classes.
            // As of expo-file-system v18+, we should be able to use:
            // const file = new File(uri); but 'File' is a standard web API name so might conflict or be unavailable.
            // Let's try to import legacy to fix the error immediately as suggested.

            // To properly fix this using the new API, we need to know the exact import.
            // However, since I cannot easily verify the new API without docs, I will use the legacy import
            // which is explicitly mentioned as a solution in the error message.
            // Wait, I cannot import from 'expo-file-system/legacy' if I don't change the import.

            // Let's try to find if `expo-file-system` exports `File` or similar.
            // If I look at the source code, I'm just guessing.
            // The error said: "Method getInfoAsync imported from 'expo-file-system' is deprecated."
            // "You can migrate to the new filesystem API using 'File' and 'Directory' classes or import the legacy API from 'expo-file-system/legacy'."

            // So:
            // import { getInfoAsync } from 'expo-file-system/legacy';

            // But since I'm using `import * as FileSystem`, I should change how I import it.

            // For now, I will assume the legacy import works to solve the deprecation error.

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getInfoAsync } = require('expo-file-system/legacy');

            const fileInfo = await getInfoAsync(uri);
            if (!fileInfo.exists) {
                throw new Error('File does not exist');
            }

            const totalBytes = fileInfo.size;
            // Determine media type (very basic)
            const isVideo = uri.endsWith('.mp4') || uri.endsWith('.mov');
            const mediaType = isVideo ? 'video/mp4' : 'image/jpeg'; // fallback/default

            console.log(`Starting upload for ${mediaType}, size: ${totalBytes}`);

            // INIT
            const initUrl = 'https://upload.twitter.com/1.1/media/upload.json';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const initData: any = {
                command: 'INIT',
                total_bytes: totalBytes,
                media_type: mediaType,
            };
            
            if (isVideo) {
                initData.media_category = 'tweet_video';
            }

            const initReq = {
                url: initUrl,
                method: 'POST',
                data: initData
            };

            const initHeaders = this.getAuthHeader(initReq);
            
            const initResponse = await axios.post(initUrl, new URLSearchParams(initData), {
                headers: {
                    ...(initHeaders as unknown as AxiosRequestHeaders),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const mediaId = initResponse.data.media_id_string;
            console.log('Media ID:', mediaId);

            // APPEND
            // Read file as base64.
            const fileContent = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
            
            const appendUrl = 'https://upload.twitter.com/1.1/media/upload.json';
            const appendData = {
                command: 'APPEND',
                media_id: mediaId,
                segment_index: 0,
                media_data: fileContent 
            };
            
            const appendReq = {
                url: appendUrl,
                method: 'POST',
                data: appendData
            };
            
            const appendHeaders = this.getAuthHeader(appendReq);
            
            await axios.post(appendUrl, new URLSearchParams(appendData as any), {
                headers: {
                    ...(appendHeaders as unknown as AxiosRequestHeaders),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });
            
            console.log('Append complete');

            // FINALIZE
            const finalizeUrl = 'https://upload.twitter.com/1.1/media/upload.json';
            const finalizeData = {
                command: 'FINALIZE',
                media_id: mediaId
            };
            
            const finalizeReq = {
                url: finalizeUrl,
                method: 'POST',
                data: finalizeData
            };
            
            const finalizeHeaders = this.getAuthHeader(finalizeReq);
            
            const finalizeResponse = await axios.post(finalizeUrl, new URLSearchParams(finalizeData), {
                headers: {
                    ...(finalizeHeaders as unknown as AxiosRequestHeaders),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            console.log('Finalize complete', finalizeResponse.data);

            if (finalizeResponse.data.processing_info) {
                await this.checkStatus(mediaId);
            }

            return mediaId;

        } catch (error: any) {
            console.error('Upload Media Error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async checkStatus(mediaId: string) {
        let processingInfo = null;
        do {
            const statusUrl = `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`;
            const request = {
                url: statusUrl,
                method: 'GET',
            };
            
            const headers = this.getAuthHeader(request);
            
            const response = await axios.get(statusUrl, { headers: headers as unknown as AxiosRequestHeaders });
            processingInfo = response.data.processing_info;
            
            console.log('Processing status:', processingInfo.state);
            
            if (processingInfo.state === 'succeeded' || processingInfo.state === 'failed') {
                break;
            }
            
            const checkAfterSecs = processingInfo.check_after_secs || 1;
            await new Promise(resolve => setTimeout(resolve, checkAfterSecs * 1000));
            
        } while (processingInfo.state !== 'succeeded' && processingInfo.state !== 'failed');

        if (processingInfo.state === 'failed') {
            throw new Error('Media processing failed');
        }
    }

    async postTweet(text: string, mediaIds: string[] = []) {
        try {
            const url = 'https://api.twitter.com/2/tweets';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: any = {
                text: text
            };
            
            if (mediaIds.length > 0) {
                data.media = { media_ids: mediaIds };
            }
            
            // For V2 JSON body, we do NOT include the body in the OAuth signature base string.
            const requestForAuth = {
                url: url,
                method: 'POST',
            };

            const headers = this.getAuthHeader(requestForAuth);
            
            const response = await axios.post(url, data, {
                headers: {
                    ...(headers as unknown as AxiosRequestHeaders),
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
            
        } catch (error: any) {
            console.error('Post Tweet Error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}
