import OAuth from 'oauth-1.0a';
import HmacSHA1 from 'crypto-js/hmac-sha1';
import Base64 from 'crypto-js/enc-base64';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';

export class TwitterService {
    constructor(consumerKey, consumerSecret, accessToken, accessTokenSecret) {
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

    getAuthHeader(request) {
        const token = {
            key: this.accessToken,
            secret: this.accessTokenSecret,
        };
        return this.oauth.toHeader(this.oauth.authorize(request, token));
    }

    async uploadMedia(uri) {
        try {
            console.log('Reading file info...');
            const fileInfo = await FileSystem.getInfoAsync(uri);
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
            const initData = {
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
                    ...initHeaders,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const mediaId = initResponse.data.media_id_string;
            console.log('Media ID:', mediaId);

            // APPEND
            // Read file as base64.
            const fileContent = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            
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
            
            await axios.post(appendUrl, new URLSearchParams(appendData), {
                headers: {
                    ...appendHeaders,
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
                    ...finalizeHeaders,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            console.log('Finalize complete', finalizeResponse.data);

            if (finalizeResponse.data.processing_info) {
                await this.checkStatus(mediaId);
            }

            return mediaId;

        } catch (error) {
            console.error('Upload Media Error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async checkStatus(mediaId) {
        let processingInfo = null;
        do {
            const statusUrl = `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`;
            const request = {
                url: statusUrl,
                method: 'GET',
            };
            
            const headers = this.getAuthHeader(request);
            
            const response = await axios.get(statusUrl, { headers });
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

    async postTweet(text, mediaIds = []) {
        try {
            const url = 'https://api.twitter.com/2/tweets';
            const data = {
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
                    ...headers,
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
            
        } catch (error) {
            console.error('Post Tweet Error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}
