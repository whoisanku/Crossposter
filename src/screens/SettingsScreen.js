import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen({ navigation }) {
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
            const data = [
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
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={styles.title}>API Settings</Text>
                
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>API Key</Text>
                    <TextInput 
                        style={styles.input} 
                        value={apiKey} 
                        onChangeText={setApiKey} 
                        placeholder="Enter API Key"
                        placeholderTextColor="#666"
                    />
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>API Key Secret</Text>
                    <TextInput 
                        style={styles.input} 
                        value={apiSecret} 
                        onChangeText={setApiSecret} 
                        placeholder="Enter API Secret"
                        secureTextEntry
                        placeholderTextColor="#666"
                    />
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Access Token</Text>
                    <TextInput 
                        style={styles.input} 
                        value={accessToken} 
                        onChangeText={setAccessToken} 
                        placeholder="Enter Access Token"
                        placeholderTextColor="#666"
                    />
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Access Token Secret</Text>
                    <TextInput 
                        style={styles.input} 
                        value={accessSecret} 
                        onChangeText={setAccessSecret} 
                        placeholder="Enter Access Secret"
                        secureTextEntry
                        placeholderTextColor="#666"
                    />
                </View>

                <TouchableOpacity style={styles.saveButton} onPress={saveCredentials}>
                    <Text style={styles.saveButtonText}>Save Credentials</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
    },
    scrollContent: {
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#ffffff',
        marginBottom: 30,
    },
    inputGroup: {
        marginBottom: 20,
    },
    label: {
        color: '#8899a6',
        marginBottom: 8,
        fontSize: 14,
    },
    input: {
        backgroundColor: '#192734',
        color: '#ffffff',
        padding: 15,
        borderRadius: 8,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#253341',
    },
    saveButton: {
        backgroundColor: '#1d9bf0',
        padding: 15,
        borderRadius: 25,
        alignItems: 'center',
        marginTop: 20,
    },
    saveButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
    }
});
