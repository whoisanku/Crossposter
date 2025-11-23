import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type RootStackParamList = {
    Compose: undefined;
    Settings: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
    const [apiKey, setApiKey] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [accessSecret, setAccessSecret] = useState('');

    useEffect(() => {
        loadCredentials();
    }, []);

    const loadCredentials = async () => {
        try {
            const keys = ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'];
            const values = await AsyncStorage.multiGet(keys);
            
            values.forEach(item => {
                if (item[0] === 'apiKey') setApiKey(item[1] || '');
                if (item[0] === 'apiSecret') setApiSecret(item[1] || '');
                if (item[0] === 'accessToken') setAccessToken(item[1] || '');
                if (item[0] === 'accessSecret') setAccessSecret(item[1] || '');
            });
        } catch (e) {
            console.error(e);
        }
    };

    const saveCredentials = async () => {
        try {
            const data: [string, string][] = [
                ['apiKey', apiKey],
                ['apiSecret', apiSecret],
                ['accessToken', accessToken],
                ['accessSecret', accessSecret]
            ];
            await AsyncStorage.multiSet(data);
            Alert.alert('Success', 'Credentials saved successfully');
            navigation.goBack();
        } catch (e) {
            Alert.alert('Error', 'Failed to save credentials');
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-black">
            <ScrollView contentContainerClassName="p-5">
                <Text className="text-2xl font-bold text-white mb-8">API Settings</Text>
                
                <View className="mb-5">
                    <Text className="text-[#8899a6] mb-2 text-sm">API Key</Text>
                    <TextInput 
                        className="bg-[#192734] text-white p-4 rounded-lg text-base border border-[#253341]"
                        value={apiKey} 
                        onChangeText={setApiKey} 
                        placeholder="Enter API Key"
                        placeholderTextColor="#666"
                    />
                </View>

                <View className="mb-5">
                    <Text className="text-[#8899a6] mb-2 text-sm">API Key Secret</Text>
                    <TextInput 
                        className="bg-[#192734] text-white p-4 rounded-lg text-base border border-[#253341]"
                        value={apiSecret} 
                        onChangeText={setApiSecret} 
                        placeholder="Enter API Secret"
                        secureTextEntry
                        placeholderTextColor="#666"
                    />
                </View>

                <View className="mb-5">
                    <Text className="text-[#8899a6] mb-2 text-sm">Access Token</Text>
                    <TextInput 
                        className="bg-[#192734] text-white p-4 rounded-lg text-base border border-[#253341]"
                        value={accessToken} 
                        onChangeText={setAccessToken} 
                        placeholder="Enter Access Token"
                        placeholderTextColor="#666"
                    />
                </View>

                <View className="mb-5">
                    <Text className="text-[#8899a6] mb-2 text-sm">Access Token Secret</Text>
                    <TextInput 
                        className="bg-[#192734] text-white p-4 rounded-lg text-base border border-[#253341]"
                        value={accessSecret} 
                        onChangeText={setAccessSecret} 
                        placeholder="Enter Access Secret"
                        secureTextEntry
                        placeholderTextColor="#666"
                    />
                </View>

                <TouchableOpacity className="bg-[#1d9bf0] p-4 rounded-full items-center mt-5" onPress={saveCredentials}>
                    <Text className="text-white font-bold text-base">Save Credentials</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}
