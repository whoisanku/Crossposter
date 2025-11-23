import React, { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity, Text, Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TwitterService } from '../utils/twitter';
// Attempting to import icons, if vector-icons is not linked we might need another way or just text.
// Expo template usually includes vector-icons.
import { Ionicons } from '@expo/vector-icons'; 

export default function ComposeScreen({ navigation }) {
    const [text, setText] = useState('');
    const [media, setMedia] = useState(null); // { uri, type }
    const [uploading, setUploading] = useState(false);

    const pickMedia = async (type) => {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: type === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true, // videos sometimes don't support editing on some platforms
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
            const credentials = {};
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

            let mediaIds = [];
            if (media) {
                const mediaId = await twitter.uploadMedia(media.uri);
                mediaIds.push(mediaId);
            }

            const response = await twitter.postTweet(text, mediaIds);
            
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
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
                    <Ionicons name="settings-outline" size={24} color="#1d9bf0" />
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.postButton, (!text && !media) && styles.postButtonDisabled]} 
                    onPress={handlePost}
                    disabled={uploading || (!text && !media)}
                >
                    {uploading ? (
                        <ActivityIndicator color="#fff" size="small" />
                    ) : (
                        <Text style={styles.postButtonText}>Post</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder="What's happening?"
                        placeholderTextColor="#666"
                        multiline
                        autoFocus
                        value={text}
                        onChangeText={setText}
                        textAlignVertical="top"
                    />
                </View>

                {media && (
                    <View style={styles.mediaPreview}>
                        {media.type === 'video' || media.uri.endsWith('.mp4') ? (
                            <View style={styles.videoPlaceholder}>
                                <Ionicons name="videocam" size={40} color="#fff" />
                                <Text style={{color: 'white'}}>Video Selected</Text>
                            </View>
                        ) : (
                            <Image source={{ uri: media.uri }} style={styles.imagePreview} />
                        )}
                        <TouchableOpacity style={styles.removeMedia} onPress={() => setMedia(null)}>
                            <Ionicons name="close-circle" size={24} color="#fff" />
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={100}>
                <View style={styles.toolbar}>
                    <TouchableOpacity style={styles.toolbarButton} onPress={() => pickMedia('image')}>
                        <Ionicons name="image-outline" size={24} color="#1d9bf0" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.toolbarButton} onPress={() => pickMedia('video')}>
                        <Ionicons name="videocam-outline" size={24} color="#1d9bf0" />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: '#2f3336',
    },
    postButton: {
        backgroundColor: '#1d9bf0',
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: 20,
    },
    postButtonDisabled: {
        opacity: 0.5,
    },
    postButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    content: {
        flexGrow: 1,
        padding: 20,
    },
    inputContainer: {
        flex: 1,
    },
    input: {
        color: '#ffffff',
        fontSize: 18,
        lineHeight: 24,
        minHeight: 150,
    },
    mediaPreview: {
        marginTop: 20,
        position: 'relative',
        borderRadius: 16,
        overflow: 'hidden',
    },
    imagePreview: {
        width: '100%',
        height: 250,
        resizeMode: 'cover',
    },
    videoPlaceholder: {
        width: '100%',
        height: 250,
        backgroundColor: '#192734',
        justifyContent: 'center',
        alignItems: 'center',
    },
    removeMedia: {
        position: 'absolute',
        top: 10,
        right: 10,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 12,
    },
    toolbar: {
        flexDirection: 'row',
        borderTopWidth: 0.5,
        borderTopColor: '#2f3336',
        padding: 15,
        backgroundColor: '#000000',
    },
    toolbarButton: {
        marginRight: 20,
    }
});
