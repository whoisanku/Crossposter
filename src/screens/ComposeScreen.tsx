import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, TouchableOpacity, Text, Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, NativeModules } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TwitterService } from '../utils/twitter';
import { BlueskyService } from '../utils/bluesky';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { File as ExpoFile } from 'expo-file-system';
import { VideoView, createVideoPlayer, type VideoPlayer } from 'expo-video';
import * as ImageManipulator from 'expo-image-manipulator';

type RootStackParamList = {
    Compose: undefined;
    Settings: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Compose'>;

interface Credentials {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
    blueskyHandle: string;
    blueskyPassword: string;
}

const MAX_BSKY_IMAGE_BYTES = 950 * 1024; // slightly under documented ~976KB limit
const TWITTER_MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MIN_COMPRESSIBLE_FILE_BYTES = 5 * 1024 * 1024;

let CachedVideoCompressor: any | null = null;

const compressImageIfNeeded = async (asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> => {
    let currentUri = asset.uri;
    let currentAsset = asset;

    const passes = [
        { maxDim: 1600, quality: 0.8 },
        { maxDim: 1200, quality: 0.7 },
        { maxDim: 1000, quality: 0.6 },
    ];

    for (let i = 0; i < passes.length; i++) {
        const info = new ExpoFile(currentUri).info();
        if (!info.exists) {
            return { ...currentAsset, uri: currentUri, mimeType: asset.mimeType || 'image/jpeg' };
        }

        const size = info.size;
        if (size && size <= MAX_BSKY_IMAGE_BYTES) {
            return { ...currentAsset, uri: currentUri, mimeType: asset.mimeType || 'image/jpeg' };
        }

        const { maxDim, quality } = passes[i];
        const currentWidth = currentAsset.width || maxDim;
        const targetWidth = currentWidth > maxDim ? maxDim : currentWidth;

        const result = await ImageManipulator.manipulateAsync(
            currentUri,
            [{ resize: { width: targetWidth } }],
            { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
        );

        currentUri = result.uri;
        currentAsset = {
            ...currentAsset,
            uri: result.uri,
            width: result.width ?? currentAsset.width,
            height: result.height ?? currentAsset.height,
            mimeType: 'image/jpeg',
        };
    }

    return currentAsset;
};

const isVideoCompressorLinked = !!NativeModules.Compressor;

const getVideoCompressor = async () => {
    if (!isVideoCompressorLinked) {
        return null;
    }

    if (CachedVideoCompressor) {
        return CachedVideoCompressor;
    }

    try {
        const mod = await import('react-native-compressor');
        CachedVideoCompressor = mod?.Video ?? null;
        return CachedVideoCompressor;
    } catch (e) {
        console.warn('Failed to load react-native-compressor, skipping video compression.', e);
        return null;
    }
};

const selectVideoProfile = (asset: ImagePicker.ImagePickerAsset) => {
    const width = asset.width ?? 0;
    const height = asset.height ?? 0;
    const isSquare = width === height && width > 0;
    const isLandscape = width >= height;

    // Optimized for "Twitter-like" fast uploads
    // 720p is the sweet spot for mobile uploads (quality/speed)
    // Bitrate ~2.0-2.5 Mbps is sufficient for H.264 720p

    if (isSquare) {
        return { maxSide: 720, bitrate: 2_000_000 }; // 720x720, 2Mbps
    }

    // 1280x720 landscape, 720x1280 portrait
    return {
        maxSide: 1280,
        bitrate: 2_500_000, // 2.5 Mbps
    };
};

const compressVideoForUpload = async (asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> => {
    if (asset.type !== 'video') return asset;

    const videoCompressor = await getVideoCompressor();

    if (!videoCompressor) {
        console.warn('Video compressor unavailable; skipping compression. Rebuild with native modules to enable.');
        return { ...asset, mimeType: asset.mimeType || 'video/mp4' };
    }

    const profile = selectVideoProfile(asset);
    const passes = [
        { maxSide: profile.maxSide, bitrate: profile.bitrate },
        // fallback: tighter bitrate
        { maxSide: profile.maxSide, bitrate: Math.max(1_500_000, Math.floor(profile.bitrate * 0.7)) },
    ];

    let workingUri = asset.uri;
    let workingAsset = { ...asset, mimeType: asset.mimeType || 'video/mp4' };

    for (let i = 0; i < passes.length; i++) {
        const pass = passes[i];
        try {
            const compressedUri = await videoCompressor.compress(
                workingUri,
                {
                    compressionMethod: 'manual',
                    maxSize: pass.maxSide,
                    bitrate: pass.bitrate,
                    minimumFileSizeForCompress: MIN_COMPRESSIBLE_FILE_BYTES,
                }
            );

            workingUri = compressedUri;
            workingAsset = {
                ...asset,
                uri: compressedUri,
                mimeType: 'video/mp4',
            };

            const sizeInfo = new ExpoFile(compressedUri).info();
            if (sizeInfo.exists && sizeInfo.size && sizeInfo.size <= TWITTER_MAX_VIDEO_BYTES) {
                return workingAsset;
            }
        } catch (err) {
            console.error('Video compression failed', err);
            // Try the next pass if available
        }
    }

    const finalInfo = new ExpoFile(workingUri).info();
    if (finalInfo.exists && finalInfo.size && finalInfo.size > TWITTER_MAX_VIDEO_BYTES) {
        Alert.alert('Video too large', 'Compressed video is still over Twitter’s 512MB limit. Please trim or record a shorter clip.');
    }

    return workingAsset;
};

const optimizeMediaForUpload = async (asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> => {
    if (asset.type === 'image') {
        return await compressImageIfNeeded(asset);
    }
    if (asset.type === 'video') {
        return await compressVideoForUpload(asset);
    }
    return asset;
};

export default function ComposeScreen({ navigation }: Props) {
    const [text, setText] = useState('');
    const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
    const [uploading, setUploading] = useState(false);

    // Bluesky & Early Upload State
    const [blueskyEnabled, setBlueskyEnabled] = useState(true);
    const [blueskyDisabledReason, setBlueskyDisabledReason] = useState<string | null>(null);
    const [credentials, setCredentials] = useState<Credentials | null>(null);

    const [isMediaUploading, setIsMediaUploading] = useState(false);
    const [twitterMediaId, setTwitterMediaId] = useState<string | null>(null);
    const [blueskyBlob, setBlueskyBlob] = useState<any | null>(null);
    const [videoPlayer, setVideoPlayer] = useState<VideoPlayer | null>(null);
    const uploadSessionRef = useRef(0);
    const uploadControllersRef = useRef<AbortController[]>([]);
    const [pendingPost, setPendingPost] = useState(false);
    const [pendingPostSession, setPendingPostSession] = useState<number | null>(null);
    const [twitterUploadProgress, setTwitterUploadProgress] = useState<number | null>(null);

    useEffect(() => {
        loadCredentials();
        const unsubscribe = navigation.addListener('focus', () => {
            loadCredentials();
            setBlueskyEnabled(true);
        });
        return unsubscribe;
    }, [navigation]);

    const releaseVideoPlayer = (player: VideoPlayer | null) => {
        if (player && typeof (player as any).release === 'function') {
            try {
                (player as any).release();
            } catch (e) {
                console.warn('Failed to release video player', e);
            }
        }
    };

    const resetPendingPost = () => {
        setPendingPost(false);
        setPendingPostSession(null);
    };

    const validateVideoForTwitter = (asset: ImagePicker.ImagePickerAsset | null) => {
        if (!asset || asset.type !== 'video') return true;

        const info = new ExpoFile(asset.uri).info();
        if (info.exists && info.size && info.size > TWITTER_MAX_VIDEO_BYTES) {
            Alert.alert('Video too large', 'Clip exceeds Twitter’s 512MB limit even after compression.');
            return false;
        }

        return true;
    };

    const cancelActiveUploads = (clearUploadingState = false) => {
        uploadControllersRef.current.forEach(controller => controller.abort());
        uploadControllersRef.current = [];

        if (clearUploadingState) {
            setIsMediaUploading(false);
            setTwitterUploadProgress(null);
        }
    };

    const trackUploadController = (controller: AbortController) => {
        uploadControllersRef.current.push(controller);
        return () => {
            uploadControllersRef.current = uploadControllersRef.current.filter(c => c !== controller);
        };
    };

    // Validate Bluesky eligibility based on content
    useEffect(() => {
        const overLimit = text.length >= 300;
        const reason = media?.type === 'video'
            ? 'BlueskyVideo not supported'
            : overLimit
                ? 'Limit >= 300'
                : null;

        setBlueskyDisabledReason(reason);

        // Auto-disable only when content is not eligible
        if (reason && blueskyEnabled) {
            setBlueskyEnabled(false);
        }
    }, [media?.type, text.length]);

    // Manage video player lifecycle for previews
    useEffect(() => {
        let newPlayer: VideoPlayer | null = null;

        setVideoPlayer(prev => {
            releaseVideoPlayer(prev);
            return null;
        });

        if (media?.type === 'video') {
            newPlayer = createVideoPlayer({ uri: media.uri });
            setVideoPlayer(newPlayer);
        }

        return () => {
            releaseVideoPlayer(newPlayer);
        };
    }, [media?.uri, media?.type]);

    useEffect(() => {
        return () => {
            cancelActiveUploads();
        };
    }, []);

    const loadCredentials = async () => {
        try {
            const keys = ['apiKey', 'apiSecret', 'accessToken', 'accessSecret', 'blueskyHandle', 'blueskyPassword'];
            const values = await AsyncStorage.multiGet(keys);
            const creds: any = {};
            values.forEach(item => creds[item[0]] = item[1]);
            setCredentials(creds);
        } catch (e) {
            console.error(e);
        }
    };

    const pickMedia = async (type: 'image' | 'video') => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: type === 'video' ? ['videos'] : ['images'],
            allowsEditing: true,
            quality: type === 'video' ? 0.55 : 1,
            videoExportPreset: type === 'video' ? ImagePicker.VideoExportPreset.H264_1280x720 : undefined,
            videoQuality: type === 'video' ? ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720 : undefined,
        });

        if (!result.canceled) {
            cancelActiveUploads(true);
            resetPendingPost();

            const asset = result.assets[0];
            const optimizedAsset = await optimizeMediaForUpload(asset);
            if (!validateVideoForTwitter(optimizedAsset)) {
                return;
            }
            setMedia(optimizedAsset);

            // Reset previous uploads
            setTwitterMediaId(null);
            setBlueskyBlob(null);

            const newSessionId = uploadSessionRef.current + 1;
            uploadSessionRef.current = newSessionId;

            // Trigger Early Uploads
            triggerEarlyUpload(optimizedAsset, newSessionId);
        }
    };

    const triggerEarlyUpload = async (asset: ImagePicker.ImagePickerAsset, sessionId: number) => {
        if (!credentials) return;

        setIsMediaUploading(true);
        setTwitterUploadProgress(asset.type === 'video' ? 0 : null);

        const uploadPromises = [];

        // 1. Twitter Upload
        if (credentials.apiKey && credentials.accessToken) {
            const twitter = new TwitterService(
                credentials.apiKey,
                credentials.apiSecret,
                credentials.accessToken,
                credentials.accessSecret
            );
            const inferredMime = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
            const twitterController = new AbortController();
            const stopTracking = trackUploadController(twitterController);

            const twitterUpload = twitter.uploadMedia(asset.uri, inferredMime, {
                signal: twitterController.signal,
                onProgress: progress => {
                    if (uploadSessionRef.current !== sessionId) return;
                    setTwitterUploadProgress(progress);
                },
            })
                .then(id => {
                    if (uploadSessionRef.current !== sessionId) return;
                    console.log('Early Twitter Upload Success:', id);
                    setTwitterMediaId(id);
                })
                .catch(err => {
                    if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.message?.toLowerCase?.().includes('aborted')) {
                        console.log('Early Twitter Upload Canceled');
                        return;
                    }
                    console.error('Early Twitter Upload Failed', err);
                    // Don't fail everything, just log
                })
                .finally(stopTracking);
            uploadPromises.push(twitterUpload);
        }

        // 2. Bluesky Upload (images only)
        if (asset.type !== 'video' && credentials.blueskyHandle && credentials.blueskyPassword && blueskyEnabled && !blueskyDisabledReason) {
             const bluesky = new BlueskyService();
             const blueskyUpload = async () => {
                try {
                    await bluesky.login(credentials.blueskyHandle, credentials.blueskyPassword);
                    const inferredMime = asset.mimeType || 'image/jpeg';
                    const blob = await bluesky.uploadBlob(asset.uri, inferredMime);
                    if (uploadSessionRef.current !== sessionId) return;
                    console.log('Early Bluesky Upload Success');
                    setBlueskyBlob(blob);
                } catch (err) {
                    console.error('Early Bluesky Upload Failed', err);
                }
             };
             uploadPromises.push(blueskyUpload());
        }

        await Promise.all(uploadPromises);
        if (uploadSessionRef.current === sessionId) {
            setIsMediaUploading(false);
            setTwitterUploadProgress(null);
        }
    };

    const performPost = async () => {
        setUploading(true);
        try {
            if (!text && !media) {
                Alert.alert('Empty Tweet', 'Please enter some text or add media.');
                return;
            }

            if (!credentials?.apiKey || !credentials?.apiSecret || !credentials?.accessToken || !credentials?.accessSecret) {
                Alert.alert('Missing Credentials', 'Please set your Twitter credentials in Settings.');
                navigation.navigate('Settings');
                return;
            }

            if (!validateVideoForTwitter(media)) {
                return;
            }

            // --- Twitter Post ---
            const twitter = new TwitterService(
                credentials.apiKey,
                credentials.apiSecret,
                credentials.accessToken,
                credentials.accessSecret
            );

            // Ensure media is uploaded if not already (retry if failed early or logic missed)
            let finalTwitterMediaIds: string[] = [];
            if (media) {
                if (twitterMediaId) {
                    finalTwitterMediaIds = [twitterMediaId];
                } else {
                    // Retry upload
                     const inferredMime = media.mimeType || (media.type === 'video' ? 'video/mp4' : 'image/jpeg');
                     setIsMediaUploading(true);
                     setTwitterUploadProgress(media.type === 'video' ? 0 : null);
                     try {
                         const id = await twitter.uploadMedia(media.uri, inferredMime, {
                            onProgress: progress => setTwitterUploadProgress(progress),
                         });
                         finalTwitterMediaIds = [id];
                     } finally {
                         setTwitterUploadProgress(null);
                         setIsMediaUploading(false);
                     }
                }
            }

            await twitter.postTweet(text, finalTwitterMediaIds);

            // --- Bluesky Post ---
            const isVideo = media?.type === 'video';
            const canPostToBluesky = !isVideo && blueskyEnabled && !blueskyDisabledReason && credentials.blueskyHandle && credentials.blueskyPassword;

            if (canPostToBluesky) {
                 try {
                     const bluesky = new BlueskyService();
                     // Re-login to ensure session is fresh or reuse if we kept session (Service makes new session on login)
                     await bluesky.login(credentials.blueskyHandle, credentials.blueskyPassword);

                     let finalBlob = blueskyBlob;
                     if (media && !finalBlob) {
                        // Retry upload
                        const inferredMime = media.mimeType || 'image/jpeg';
                        finalBlob = await bluesky.uploadBlob(media.uri, inferredMime);
                     }

                     const inferredMime = media?.mimeType || 'image/jpeg';
                     await bluesky.post(text, finalBlob, media ? inferredMime : undefined);
                     Alert.alert('Success', 'Posted to Twitter and Bluesky!');
                 } catch (bskyError) {
                     console.error('Bluesky Post Error', bskyError);
                     Alert.alert('Partial Success', 'Posted to Twitter, but Bluesky failed.');
                 }
            } else {
                const skipReason = blueskyDisabledReason || (media?.type === 'video' ? 'Video posts are Twitter-only' : null);
                Alert.alert('Success', skipReason ? `Tweet posted. Bluesky skipped: ${skipReason}.` : 'Tweet posted successfully!');
            }

            setText('');
            setMedia(null);
            setTwitterMediaId(null);
            setBlueskyBlob(null);
            setBlueskyEnabled(true);

        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to post tweet. Check console/logs.');
        } finally {
            setUploading(false);
            resetPendingPost();
        }
    };

    const handlePost = async () => {
        if (!text && !media) {
            Alert.alert('Empty Tweet', 'Please enter some text or add media.');
            return;
        }

        const currentSession = uploadSessionRef.current;

        if (isMediaUploading) {
            setPendingPost(true);
            setPendingPostSession(currentSession);
            return;
        }

        await performPost();
    };

    useEffect(() => {
        if (!pendingPost) return;
        if (pendingPostSession === null) return;
        if (pendingPostSession !== uploadSessionRef.current) return;
        if (uploading || isMediaUploading) return;

        void performPost();
    }, [isMediaUploading, pendingPost, pendingPostSession, uploading]);

    const isBlueskyBlocked = !!blueskyDisabledReason;
    const isBlueskyActive = blueskyEnabled && !isBlueskyBlocked;
    const isPostDisabled = uploading || (!text && !media);
    const isPostQueued = pendingPost && isMediaUploading;
    const uploadPercent = twitterUploadProgress !== null ? Math.round(twitterUploadProgress * 100) : null;

    return (
        <SafeAreaView className="flex-1 bg-black">
            <View className="flex-row justify-between items-center px-5 py-3 border-b border-[#2f3336]">
                <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="settings-button">
                    <Ionicons name="settings-outline" size={24} color="#1d9bf0" />
                </TouchableOpacity>

                <View className="items-end">
                    <TouchableOpacity
                        testID="post-button"
                        className={`bg-[#1d9bf0] py-2 px-5 rounded-full ${isPostDisabled ? 'opacity-50' : ''}`}
                        onPress={handlePost}
                        disabled={isPostDisabled}
                    >
                        {uploading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text className="text-white font-bold text-base">Post</Text>
                        )}
                    </TouchableOpacity>
                    {isPostQueued && (
                        <Text className="text-[11px] text-gray-400 mt-1">Finishing upload first...</Text>
                    )}
                </View>
            </View>

            <ScrollView contentContainerClassName="flex-grow p-5">
                <View className="flex-row">
                     {/* Avatar placeholder */}
                    <View className="w-10 h-10 rounded-full bg-gray-600 mr-3 justify-center items-center">
                         <Ionicons name="person" size={20} color="#fff" />
                    </View>
                    <View className="flex-1">
                        <TextInput
                            testID="compose-input"
                            className="text-white text-lg leading-6 min-h-[150px]"
                            placeholder="What's happening?"
                            placeholderTextColor="#666"
                            multiline
                            autoFocus
                            value={text}
                            onChangeText={setText}
                            textAlignVertical="top"
                        />
                         {media && (
                            <View className="mt-5 relative rounded-2xl overflow-hidden bg-[#192734]">
                                {media.type === 'video' ? (
                                    videoPlayer ? (
                                        <VideoView
                                            player={videoPlayer}
                                            nativeControls
                                            contentFit="cover"
                                            style={{ width: '100%', height: 256 }}
                                        />
                                    ) : (
                                        <View className="w-full h-64 items-center justify-center">
                                            <ActivityIndicator size="large" color="#1d9bf0" />
                                        </View>
                                    )
                                ) : (
                                    <Image source={{ uri: media.uri }} style={{ width: '100%', height: 256 }} resizeMode="cover" />
                                )}

                                <TouchableOpacity
                                    className="absolute top-2 right-2 bg-black/50 rounded-full p-1 z-10"
                                    onPress={() => {
                                        uploadSessionRef.current = uploadSessionRef.current + 1;
                                        cancelActiveUploads(true);
                                        resetPendingPost();
                                        setVideoPlayer(prev => {
                                            releaseVideoPlayer(prev);
                                            return null;
                                        });
                                        setMedia(null);
                                        setTwitterMediaId(null);
                                        setBlueskyBlob(null);
                                    }}
                                >
                                    <Ionicons name="close" size={20} color="#fff" />
                                </TouchableOpacity>

                                {isMediaUploading && (
                                     <View className="absolute inset-0 bg-black/60 justify-center items-center z-0">
                                        <ActivityIndicator size="large" color="#1d9bf0" />
                                        <Text className="text-white mt-2 font-bold">
                                            {uploadPercent !== null ? `Uploading ${uploadPercent}%` : 'Uploading...'}
                                        </Text>
                                     </View>
                                )}
                            </View>
                        )}
                    </View>
                </View>
            </ScrollView>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
                <View className="flex-row border-t border-[#2f3336] p-4 bg-black items-center justify-between">
                    <View className="flex-row">
                        <TouchableOpacity className="mr-6" onPress={() => pickMedia('image')}>
                            <Ionicons name="image-outline" size={24} color="#1d9bf0" />
                        </TouchableOpacity>
                        <TouchableOpacity className="mr-6" onPress={() => pickMedia('video')}>
                            <Ionicons name="videocam-outline" size={24} color="#1d9bf0" />
                        </TouchableOpacity>
                    </View>
                    <View className="flex-row items-center">
                        <Text className={`mr-2 text-sm ${isBlueskyActive ? 'text-blue-400' : 'text-gray-500'}`}>
                            {blueskyDisabledReason ? `Post on Bluesky` : 'Post on Bluesky'}
                        </Text>
                        <Switch
                            testID="bluesky-toggle"
                            value={isBlueskyActive}
                            onValueChange={setBlueskyEnabled}
                            disabled={isBlueskyBlocked}
                            trackColor={{ false: "#767577", true: "#1d9bf0" }}
                            thumbColor={isBlueskyActive ? "#fff" : "#f4f3f4"}
                        />
                    </View>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}
