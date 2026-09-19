import { supabase, anonClient, API_BASE, getAuthToken } from './supabase';
import type { Lead, TourPackage } from '@/types';

// --- AUTH ---

export type RegisterPayload = {
    full_name: string;
    email: string;
    phone?: string;
    access_key: string;
    password: string;
};

export async function registerStaff(payload: RegisterPayload) {
    const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
    }
    return data as { user: any; message: string };
}

// --- LEADS ---

export async function getLeads() {
    // Try with the current session first, fall back to anon client
    let client = supabase;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        console.log('API: No active session, using anon client for getLeads');
        client = anonClient;
    }

    const { data, error } = await client
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('API: getLeads error:', error);
        throw error;
    }
    const allLeads = data as Lead[];
    return allLeads.filter(l => l.notes !== '[DELETED]');
}

export async function createLead(lead: Partial<Lead>) {
    if (lead.phone) {
        const cleanPhone = lead.phone.replace(/\D/g, '');
        if (cleanPhone) {
            // Retrieve all leads (including soft-deleted ones) to do phone matching
            const { data: existingLeads } = await supabase
                .from('leads')
                .select('*');
            
            if (existingLeads) {
                const matchingDeletedLead = existingLeads.find((l: any) => {
                    if (!l.phone || l.notes !== '[DELETED]') return false;
                    const cleanExistingPhone = l.phone.replace(/\D/g, '');
                    return cleanExistingPhone === cleanPhone || 
                           cleanExistingPhone.endsWith(cleanPhone) || 
                           cleanPhone.endsWith(cleanExistingPhone);
                });

                if (matchingDeletedLead) {
                    // Restore the existing soft-deleted lead and update it with the new info
                    const { data, error } = await supabase
                        .from('leads')
                        .update({
                            ...lead,
                            notes: null,
                            created_at: new Date().toISOString() // update timestamp to bring it to top
                        })
                        .eq('id', matchingDeletedLead.id)
                        .select();

                    if (!error && data?.[0]) {
                        console.log('Restored soft-deleted lead:', data[0]);
                        return data[0] as Lead;
                    }
                }
            }
        }
    }

    const { data, error } = await supabase
        .from('leads')
        .insert([lead])
        .select();

    if (error) throw error;
    return data?.[0] as Lead;
}

export async function updateLead(id: string, updates: Partial<Lead>) {
    const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as Lead;
}

export async function deleteLead(id: string) {
    // 1. Fetch the lead's phone number first so we can delete their conversation state
    const { data: lead } = await supabase
        .from('leads')
        .select('phone')
        .eq('id', id)
        .maybeSingle();

    if (lead?.phone) {
        const cleanPhone = lead.phone.replace('whatsapp:', '').trim();
        // 2. Delete conversation tracking state from whatsapp_conversations table
        await supabase
            .from('whatsapp_conversations')
            .delete()
            .eq('phone', cleanPhone);
    }

    // 3. Soft delete the lead from leads table by setting notes to '[DELETED]'
    const { error } = await supabase
        .from('leads')
        .update({ notes: '[DELETED]' })
        .eq('id', id);

    if (error) throw error;
}

// --- TOURS ---

export async function uploadTourImage(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 600;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);

                // Compress heavily to ensure it fits in a database column
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                resolve(dataUrl);
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
}

export async function getTours() {
    // Try with current session first, fall back to anon client
    let client = supabase;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        client = anonClient;
    }

    const { data, error } = await client
        .from('tours')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data as TourPackage[];
}

export async function createTour(tour: Partial<TourPackage>) {
    const { data, error } = await supabase
        .from('tours')
        .insert([tour])
        .select();

    if (error) throw error;
    return data?.[0] as TourPackage;
}

export async function updateTour(id: string, updates: Partial<TourPackage>) {
    const { data, error } = await supabase
        .from('tours')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as TourPackage;
}

export async function deleteTour(id: string) {
    const { error } = await supabase
        .from('tours')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// --- STAFF ---

export async function getStaff() {
    console.log('API: getStaff called');
    const { data, error } = await supabase
        .from('staffs')
        .select('*')
        .order('full_name', { ascending: true });

    if (error) {
        console.error('API: getStaff error:', error);
        throw error;
    }

    console.log('API: getStaff success, count:', data?.length);
    return data as any[];
}

export async function createStaff(user: any, _password?: string) {
    console.log('API: createStaff (Simplified) initiated for', user.email);
    const staffId = (user.id || crypto.randomUUID()) as any;

    // Direct database insertion only - bypassing Supabase Auth
    const { data: staffData, error: staffError } = await supabase
        .from('staffs')
        .insert([{
            id: staffId,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            avatar_url: user.avatar_url || null,
            department: user.department || null,
            phone: user.phone || null,
            status: 'active',
        }])
        .select()
        .single();

    if (staffError) throw staffError;

    // Sync to profiles table for lead assignments
    try {
        await supabase.from('profiles').upsert([{
            id: staffId,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
        }]);
    } catch (_) {
    }

    return { data: staffData };
}

export async function updateStaff(id: string, updates: any) {
    const { data, error } = await supabase
        .from('staffs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;

    // Sync to profiles table
    try {
        const profileUpdates: any = {};
        if (updates.full_name) profileUpdates.full_name = updates.full_name;
        if (updates.email) profileUpdates.email = updates.email;
        if (updates.role) profileUpdates.role = updates.role;
        if (Object.keys(profileUpdates).length > 0) {
            await supabase.from('profiles').update(profileUpdates).eq('id', id);
        }
    } catch (_) {
    }

    return data;
}

export async function deleteStaff(id: string) {
    // 1. Unassign any leads currently assigned to this staff member to prevent FK constraint error
    try {
        await supabase
            .from('leads')
            .update({ assigned_staff_id: null })
            .eq('assigned_staff_id', id);
    } catch (leadErr) {
        console.error('Failed to unassign leads for staff member before deletion:', leadErr);
    }

    // 2. Delete staff member from 'staffs' table
    const { error: staffError } = await supabase
        .from('staffs')
        .delete()
        .eq('id', id);

    if (staffError) throw staffError;

    // 3. Delete staff member from 'profiles' table (best-effort cleanup)
    try {
        await supabase
            .from('profiles')
            .delete()
            .eq('id', id);
    } catch (_) {
    }
}

// --- WHATSAPP ---

export async function sendWhatsAppMessage(
    to: string,
    message: string,
    contentSid?: string,
    contentVariables?: Record<string, string>
) {
    const token = getAuthToken();

    const response = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ to, message, contentSid, contentVariables }),
    });

    if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'Failed to send WhatsApp message';
        try {
            const errObj = JSON.parse(errText);
            errMsg = errObj.error || errObj.message || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
    }

    return await response.json();
}

export async function deleteWhatsAppMessage(id: string) {
    const { error } = await supabase
        .from('whatsapp_messages')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

export async function updateWhatsAppMessage(id: string, content: string) {
    const { data, error } = await supabase
        .from('whatsapp_messages')
        .update({ content })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function triggerBirthdayWishesCheck() {
    const token = getAuthToken();

    try {
        const response = await fetch(`${API_BASE}/api/whatsapp/birthday-check`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('triggerBirthdayWishesCheck failed response:', errText);
        } else {
            const result = await response.json();
            console.log('triggerBirthdayWishesCheck complete:', result);
        }
    } catch (err) {
        console.error('Error invoking triggerBirthdayWishesCheck:', err);
    }
}
