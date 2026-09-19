import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@/types';
import { useAppStore } from '@/store';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signIn: (identifier: string, password: string, rememberMe?: boolean) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const { setUser, user, fetchLeads, fetchTours } = useAppStore();

    useEffect(() => {
        let mounted = true;

        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (mounted) await handleUserSession(session);
            if (mounted) setLoading(false);
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (mounted) {
                await handleUserSession(session);
                setLoading(false);
            }
        });

        initAuth();

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [setUser]);

    const handleUserSession = async (session: any) => {
        try {
            if (session?.user) {
                const { data: profile, error } = await supabase
                    .from('staffs')
                    .select('*')
                    .eq('id', session.user.id)
                    .maybeSingle();

                if (error) {
                    console.error('Error fetching profile:', error);
                }

                if (profile) {
                    setUser(profile as User);
                    fetchLeads();
                    fetchTours();
                } else {
                    setUser(null);
                }
            } else {
                setUser(null);
            }
        } catch (error) {
            console.error('Error in handleUserSession:', error);
            setUser(null);
        }
    };

    const signIn = async (identifier: string, password: string, rememberMe = true) => {
        const { error } = await supabase.auth.signInWithPassword({ identifier, password, rememberMe });
        if (error) throw error;
    };

    const signOut = async () => {
        try {
            await supabase.auth.signOut();
        } finally {
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
