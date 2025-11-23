import React, { useState, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Text, Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TwitterService } from '../utils/twitter';
import { BlueskyService } from '../utils/bluesky';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Video, ResizeMode } from 'expo-av';

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

export default function ComposeScreen({ navigation }: Props) {
    const [text, setText] = useState('');
    const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
    const [uploading, setUploading] = useState(false);

    // Bluesky & Early Upload State
    const [blueskyEnabled, setBlueskyEnabled] = useState(true);
    const [blueskyForceDisabled, setBlueskyForceDisabled] = useState(false);
    const [credentials, setCredentials] = useState<Credentials | null>(null);

    const [isMediaUploading, setIsMediaUploading] = useState(false);
    const [twitterMediaId, setTwitterMediaId] = useState<string | null>(null);
    const [blueskyBlob, setBlueskyBlob] = useState<any | null>(null);

    useEffect(() => {
        loadCredentials();
        const unsubscribe = navigation.addListener('focus', () => {
            loadCredentials();
        });
        return unsubscribe;
    }, [navigation]);

    // Validation for Text Length
    useEffect(() => {
        if (text.length > 300) {
            if (!blueskyForceDisabled) {
                setBlueskyForceDisabled(true);
            }
        } else {
            if (blueskyForceDisabled) {
                setBlueskyForceDisabled(false);
            }
        }
    }, [text]);

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
            mediaTypes: [type === 'video' ? 'videos' : 'images'],
            allowsEditing: true,
            quality: 1,
        });

        if (!result.canceled) {
            const asset = result.assets[0];
            setMedia(asset);

            // Reset previous uploads
            setTwitterMediaId(null);
            setBlueskyBlob(null);

            // Trigger Early Uploads
            triggerEarlyUpload(asset);
        }
    };

    const triggerEarlyUpload = async (asset: ImagePicker.ImagePickerAsset) => {
        if (!credentials) return;

        setIsMediaUploading(true);

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
            const twitterUpload = twitter.uploadMedia(asset.uri, inferredMime)
                .then(id => {
                    console.log('Early Twitter Upload Success:', id);
                    setTwitterMediaId(id);
                })
                .catch(err => {
                    console.error('Early Twitter Upload Failed', err);
                    // Don't fail everything, just log
                });
            uploadPromises.push(twitterUpload);
        }

        // 2. Bluesky Upload
        if (credentials.blueskyHandle && credentials.blueskyPassword && blueskyEnabled && !blueskyForceDisabled) {
             const bluesky = new BlueskyService();
             const blueskyUpload = async () => {
                try {
                    await bluesky.login(credentials.blueskyHandle, credentials.blueskyPassword);
                    const inferredMime = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
                    const blob = await bluesky.uploadBlob(asset.uri, inferredMime);
                    console.log('Early Bluesky Upload Success');
                    setBlueskyBlob(blob);
                } catch (err) {
                    console.error('Early Bluesky Upload Failed', err);
                }
             };
             uploadPromises.push(blueskyUpload());
        }

        await Promise.all(uploadPromises);
        setIsMediaUploading(false);
    };

    const handlePost = async () => {
        if (!text && !media) {
            Alert.alert('Empty Tweet', 'Please enter some text or add media.');
            return;
        }

        if (isMediaUploading) {
            Alert.alert('Uploading Media', 'Please wait for media to finish uploading...');
            return;
        }

        setUploading(true);
        try {
            if (!credentials?.apiKey || !credentials?.apiSecret || !credentials?.accessToken || !credentials?.accessSecret) {
                Alert.alert('Missing Credentials', 'Please set your Twitter credentials in Settings.');
                navigation.navigate('Settings');
                setUploading(false);
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
                     const id = await twitter.uploadMedia(media.uri, inferredMime);
                     finalTwitterMediaIds = [id];
                }
            }

            await twitter.postTweet(text, finalTwitterMediaIds);

            // --- Bluesky Post ---
            if (blueskyEnabled && !blueskyForceDisabled && credentials.blueskyHandle && credentials.blueskyPassword) {
                 try {
                     const bluesky = new BlueskyService();
                     // Re-login to ensure session is fresh or reuse if we kept session (Service makes new session on login)
                     await bluesky.login(credentials.blueskyHandle, credentials.blueskyPassword);

                     let finalBlob = blueskyBlob;
                     if (media && !finalBlob) {
                        // Retry upload
                        const inferredMime = media.mimeType || (media.type === 'video' ? 'video/mp4' : 'image/jpeg');
                        finalBlob = await bluesky.uploadBlob(media.uri, inferredMime);
                     }

                     const inferredMime = media?.mimeType || (media?.type === 'video' ? 'video/mp4' : 'image/jpeg');
                     await bluesky.post(text, finalBlob, media ? inferredMime : undefined);
                     Alert.alert('Success', 'Posted to Twitter and Bluesky!');
                 } catch (bskyError) {
                     console.error('Bluesky Post Error', bskyError);
                     Alert.alert('Partial Success', 'Posted to Twitter, but Bluesky failed.');
                 }
            } else {
                Alert.alert('Success', 'Tweet posted successfully!');
            }

            setText('');
            setMedia(null);
            setTwitterMediaId(null);
            setBlueskyBlob(null);

        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to post tweet. Check console/logs.');
        } finally {
            setUploading(false);
        }
    };

    const isBlueskyActive = blueskyEnabled && !blueskyForceDisabled;

    return (
        <SafeAreaView className="flex-1 bg-black">
            <View className="flex-row justify-between items-center px-5 py-3 border-b border-[#2f3336]">
                <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="settings-button">
                    <Ionicons name="settings-outline" size={24} color="#1d9bf0" />
                </TouchableOpacity>

                <View className="flex-row items-center">
                    <Text className={`mr-2 text-sm ${isBlueskyActive ? 'text-blue-400' : 'text-gray-500'}`}>
                        {blueskyForceDisabled ? 'BSKY (Limit > 300)' : 'Post on Bluesky'}
                    </Text>
                    <Switch
                        testID="bluesky-toggle"
                        value={blueskyEnabled}
                        onValueChange={setBlueskyEnabled}
                        disabled={blueskyForceDisabled}
                        trackColor={{ false: "#767577", true: "#1d9bf0" }}
                        thumbColor={blueskyEnabled ? "#fff" : "#f4f3f4"}
                    />
                </View>

                <TouchableOpacity
                    testID="post-button"
                    className={`bg-[#1d9bf0] py-2 px-5 rounded-full ${(!text && !media) || uploading || isMediaUploading ? 'opacity-50' : ''}`}
                    onPress={handlePost}
                    disabled={uploading || isMediaUploading || (!text && !media)}
                >
                    {uploading || isMediaUploading ? (
                        <ActivityIndicator color="#fff" size="small" />
                    ) : (
                        <Text className="text-white font-bold text-base">Post</Text>
                    )}
                </TouchableOpacity>
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
                                {media.type === 'video' || media.uri.endsWith('.mp4') ? (
                                    <Video
                                        source={{ uri: media.uri }}
                                        rate={1.0}
                                        volume={1.0}
                                        isMuted={false}
                                        resizeMode={ResizeMode.COVER}
                                        shouldPlay={false}
                                        useNativeControls
                                        style={{ width: '100%', height: 256 }}
                                    />
                                ) : (
                                    <Image source={{ uri: media.uri }} className="w-full h-64 resize-cover" />
                                )}

                                <TouchableOpacity
                                    className="absolute top-2 right-2 bg-black/50 rounded-full p-1 z-10"
                                    onPress={() => {
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
                                        <Text className="text-white mt-2 font-bold">Uploading...</Text>
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
                    <Text className={`text-sm ${text.length > 300 ? 'text-red-500' : 'text-gray-500'}`}>
                        {text.length}/300 (for BSky)
                    </Text>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}
