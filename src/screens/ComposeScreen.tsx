import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TwitterService } from '../utils/twitter';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type RootStackParamList = {
    Compose: undefined;
    Settings: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Compose'>;

export default function ComposeScreen({ navigation }: Props) {
    const [text, setText] = useState('');
    const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
    const [uploading, setUploading] = useState(false);

    const pickMedia = async (type: 'image' | 'video') => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: type === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            quality: 1,
        });

        if (!result.canceled) {
            setMedia(result.assets[0]);
        }
    };

    const handlePost = async () => {
        if (!text && !media) {
            Alert.alert('Empty Tweet', 'Please enter some text or add media.');
            return;
        }

        setUploading(true);
        try {
            const keys = ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'];
            const values = await AsyncStorage.multiGet(keys);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const credentials: any = {};
            values.forEach(item => credentials[item[0]] = item[1]);

            if (!credentials.apiKey || !credentials.apiSecret || !credentials.accessToken || !credentials.accessSecret) {
                Alert.alert('Missing Credentials', 'Please set your API credentials in Settings.');
                navigation.navigate('Settings');
                setUploading(false);
                return;
            }

            const twitter = new TwitterService(
                credentials.apiKey,
                credentials.apiSecret,
                credentials.accessToken,
                credentials.accessSecret
            );

            const mediaIds: string[] = [];
            if (media) {
                const mediaId = await twitter.uploadMedia(media.uri);
                mediaIds.push(mediaId);
            }

            await twitter.postTweet(text, mediaIds);

            Alert.alert('Success', 'Tweet posted successfully!');
            setText('');
            setMedia(null);

        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to post tweet. Check console/logs.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-black">
            <View className="flex-row justify-between items-center px-5 py-3 border-b border-[#2f3336]">
                <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
                    <Ionicons name="settings-outline" size={24} color="#1d9bf0" />
                </TouchableOpacity>
                <TouchableOpacity
                    className={`bg-[#1d9bf0] py-2 px-5 rounded-full ${(!text && !media) || uploading ? 'opacity-50' : ''}`}
                    onPress={handlePost}
                    disabled={uploading || (!text && !media)}
                >
                    {uploading ? (
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
                            <View className="mt-5 relative rounded-2xl overflow-hidden">
                                {media.type === 'video' || media.uri.endsWith('.mp4') ? (
                                    <View className="w-full h-64 bg-[#192734] justify-center items-center">
                                        <Ionicons name="videocam" size={40} color="#fff" />
                                        <Text className="text-white mt-2">Video Selected</Text>
                                    </View>
                                ) : (
                                    <Image source={{ uri: media.uri }} className="w-full h-64 resize-cover" />
                                )}
                                <TouchableOpacity
                                    className="absolute top-2 right-2 bg-black/50 rounded-full p-1"
                                    onPress={() => setMedia(null)}
                                >
                                    <Ionicons name="close" size={20} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </View>
            </ScrollView>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
                <View className="flex-row border-t border-[#2f3336] p-4 bg-black items-center">
                    <TouchableOpacity className="mr-6" onPress={() => pickMedia('image')}>
                        <Ionicons name="image-outline" size={24} color="#1d9bf0" />
                    </TouchableOpacity>
                    <TouchableOpacity className="mr-6" onPress={() => pickMedia('video')}>
                        <Ionicons name="videocam-outline" size={24} color="#1d9bf0" />
                    </TouchableOpacity>
                    {/* Add more mock buttons for complete Twitter look */}
                     <TouchableOpacity className="mr-6">
                        <Ionicons name="list-outline" size={24} color="#1d9bf0" />
                    </TouchableOpacity>
                     <TouchableOpacity className="mr-6">
                        <Ionicons name="location-outline" size={24} color="#1d9bf0" />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}
