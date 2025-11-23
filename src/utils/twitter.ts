import OAuth from 'oauth-1.0a';
import HmacSHA1 from 'crypto-js/hmac-sha1';
import Base64 from 'crypto-js/enc-base64';
import axios, { AxiosRequestHeaders } from 'axios';
import { Buffer } from 'buffer';
import { File as ExpoFile } from 'expo-file-system';

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

    async uploadMedia(
        uri: string,
        mimeType?: string,
        options?: { signal?: AbortSignal; onProgress?: (progress: number, state: { processedBytes: number; totalBytes: number }) => void }
    ) {
        try {
            console.log('Reading file info...');
            const file = new ExpoFile(uri);
            if (!file.exists) {
                throw new Error('File does not exist');
            }
            const fileInfo = file.info();

            const totalBytes = fileInfo.size ?? 0;
            if (!totalBytes) {
                throw new Error('Unable to determine file size for upload');
            }
            // Determine media type
            const isVideo = mimeType ? mimeType.startsWith('video/') : (uri.endsWith('.mp4') || uri.endsWith('.mov'));
            const mediaType = mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');

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
                },
                signal: options?.signal,
            });

            const mediaId = initResponse.data.media_id_string;
            console.log('Media ID:', mediaId);

            // APPEND - chunked base64 to avoid huge memory usage and keep RN compatibility
            const appendUrl = 'https://upload.twitter.com/1.1/media/upload.json';
            const chunkSize = isVideo && totalBytes > 50 * 1024 * 1024
                ? 5 * 1024 * 1024
                : 2 * 1024 * 1024;
            const maxConcurrentAppends = isVideo && totalBytes > 50 * 1024 * 1024 ? 4 : 2;
            const handle = file.open();

            try {
                let offset = 0;
                let segmentIndex = 0;
                let processedBytes = 0;
                options?.onProgress?.(0, { processedBytes: 0, totalBytes });

                const inFlight: Promise<void>[] = [];

                const queueNextChunk = () => {
                    while (offset < totalBytes && inFlight.length < maxConcurrentAppends) {
                        const bytesToRead = Math.min(chunkSize, totalBytes - offset);
                        const chunkOffset = offset;
                        const chunkSegmentIndex = segmentIndex;

                        offset += bytesToRead;
                        segmentIndex += 1;

                        const promise = (async () => {
                            handle.offset = chunkOffset;
                            const chunkBytes = handle.readBytes(bytesToRead);
                            const chunkBase64 = Buffer.from(chunkBytes).toString('base64');

                            const appendData = {
                                command: 'APPEND',
                                media_id: mediaId,
                                segment_index: chunkSegmentIndex,
                                media_data: chunkBase64,
                            } as any;

                            const appendReq = {
                                url: appendUrl,
                                method: 'POST',
                                data: appendData,
                            };

                            const appendHeaders = this.getAuthHeader(appendReq);

                            await axios.post(appendUrl, new URLSearchParams(appendData), {
                                headers: {
                                    ...(appendHeaders as unknown as AxiosRequestHeaders),
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                },
                                maxBodyLength: Infinity,
                                maxContentLength: Infinity,
                                signal: options?.signal,
                            });

                            processedBytes += bytesToRead;
                            options?.onProgress?.(
                                Math.min(processedBytes / totalBytes, 0.999),
                                { processedBytes, totalBytes }
                            );
                        })();

                        promise.finally(() => {
                            const idx = inFlight.indexOf(promise);
                            if (idx !== -1) inFlight.splice(idx, 1);
                        });

                        inFlight.push(promise);
                    }
                };

                queueNextChunk();

                while (inFlight.length > 0) {
                    await Promise.race(inFlight);
                    queueNextChunk();
                }
            } finally {
                try {
                    handle.close();
                } catch (closeError) {
                    console.warn('Failed to close file handle', closeError);
                }
            }

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
                },
                signal: options?.signal,
            });
            
            console.log('Finalize complete', finalizeResponse.data);

            if (finalizeResponse.data.processing_info) {
                await this.checkStatus(mediaId, options?.signal);
            }

            options?.onProgress?.(1, { processedBytes: totalBytes, totalBytes });

            return mediaId;

        } catch (error: any) {
            console.error('Upload Media Error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async checkStatus(mediaId: string, signal?: AbortSignal) {
        let processingInfo = null;
        do {
            const statusUrl = `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`;
            const request = {
                url: statusUrl,
                method: 'GET',
            };
            
            const headers = this.getAuthHeader(request);
            
            const response = await axios.get(statusUrl, {
                headers: headers as unknown as AxiosRequestHeaders,
                signal,
            });
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
